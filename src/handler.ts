import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { TrieRouter } from "hono/router/trie-router";
import { z } from "zod";
import { createContext, type AuthData, type HttpContext } from "./context.js";
import { ForbiddenError, MethodNotAllowedError, RouteNotFoundError, UnauthorizedError } from "./errors.js";
import {
  METHODS,
  controllerName,
  describeController,
  type AuthGuard,
  type AuthRoute,
  type ControllerClass,
  type Method,
} from "./controller.js";
import { isMiddleware, middlewareInstance, type MiddlewareEntry, type ParamSource } from "./metadata.js";
import { resolveArgs } from "./params.js";

export type ErrorHook = (err: unknown, request: Request) => Response | undefined | Promise<Response | undefined>;

export type Authenticate = (request: Request) => AuthData | null | undefined | Promise<AuthData | null | undefined>;

export interface HandlerOptions {
  controllers: ControllerClass[];
  basePath?: string;
  prefix?: string;
  authenticate?: Authenticate;
  middlewares?: MiddlewareEntry[];
  onError?: ErrorHook;
}

type RouteHandler = (request: Request) => Promise<Response>;

export type Handlers = Record<Method | "HEAD" | "OPTIONS", RouteHandler>;

interface RouteEntry {
  method: Method;
  path: string;
  controller: ControllerClass;
  action: string;
  auth: boolean;
  guard: AuthGuard | undefined;
  middlewares: MiddlewareEntry[];
  params: (ParamSource | undefined)[];
}

function joinPaths(...parts: string[]): string {
  const path = parts
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return path.startsWith("/") ? path : `/${path}`;
}

function checkBase(name: string, value: string): string {
  if (value !== "" && !value.startsWith("/")) {
    throw new Error(`[nextroller] \`${name}\` must start with "/": ${JSON.stringify(value)}`);
  }
  return value;
}

function paramNames(path: string): string[] {
  return [...path.matchAll(/\/:([^/{?]+)/g)].map((match) => match[1] ?? "");
}

function collectRoutes(controllers: ControllerClass[], base: string): RouteEntry[] {
  const routes: RouteEntry[] = [];
  for (const controller of controllers) {
    const { prefix, actions } = describeController(controller);
    for (const { action, routes: defs, isProtected, guard, middlewares, params } of actions) {
      for (const { method, path } of defs) {
        const fullPath = joinPaths(base, prefix, path);
        const names = paramNames(fullPath);
        for (const source of params) {
          if (source?.kind === "param" && source.key !== undefined && !names.includes(source.key)) {
            throw new Error(
              `[nextroller] ${controllerName(controller)}: @Param(${JSON.stringify(source.key)}) ` +
                `on "${action}" is not in ${method} ${fullPath}`,
            );
          }
        }
        routes.push({ method, path: fullPath, controller, action, auth: isProtected, guard, middlewares, params });
      }
    }
  }
  return routes;
}

function segmentRank(segment: string): number {
  if (segment.includes("*")) return 2;
  if (segment.startsWith(":")) return 1;
  return 0;
}

function compareSpecificity(a: RouteEntry, b: RouteEntry): number {
  const sa = a.path.split("/");
  const sb = b.path.split("/");
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const diff = segmentRank(sa[i] ?? "") - segmentRank(sb[i] ?? "");
    if (diff !== 0) return diff;
  }
  return 0;
}

function routeKey(route: RouteEntry): string {
  return `${route.method} ${route.path.replace(/\/:[^/{?]+/g, "/:")}`;
}

function checkConflicts(routes: RouteEntry[]): void {
  const seen = new Map<string, RouteEntry>();
  for (const route of routes) {
    const key = routeKey(route);
    const previous = seen.get(key);
    if (previous) {
      throw new Error(
        `[nextroller] duplicate route ${route.method} ${route.path}: ` +
          `${controllerName(previous.controller)}.${previous.action} and ` +
          `${controllerName(route.controller)}.${route.action}`,
      );
    }
    seen.set(key, route);
  }
}

function compose(middlewares: MiddlewareEntry[], ctx: HttpContext, run: () => Promise<Response>): Promise<Response> {
  let called = -1;
  const dispatch = async (index: number): Promise<Response> => {
    if (index <= called) {
      throw new Error("[nextroller] middleware called next() more than once");
    }
    called = index;
    const entry = middlewares[index];
    if (!entry) return run();
    const res = await middlewareInstance(entry).run(ctx, () => dispatch(index + 1));
    if (!(res instanceof Response)) {
      throw new Error("[nextroller] middleware must return a Response");
    }
    return res;
  };
  return dispatch(0);
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new Response(null, { status: 204 });
  return Response.json(result);
}

function errorResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

export function createHandler(options: HandlerOptions): Handlers {
  const { controllers, authenticate, onError, middlewares: globals = [] } = options;
  if (!Array.isArray(globals) || !globals.every(isMiddleware)) {
    throw new Error("[nextroller] `middlewares` must be an array of classes or objects with a run() method");
  }
  const base = joinPaths(checkBase("basePath", options.basePath ?? "/api"), checkBase("prefix", options.prefix ?? ""));

  const routes = collectRoutes(controllers, base).sort(compareSpecificity);
  checkConflicts(routes);

  const unauthenticated = authenticate ? undefined : routes.find((route) => route.auth);
  if (unauthenticated) {
    throw new Error(
      `[nextroller] ${controllerName(unauthenticated.controller)}: ` + "@Auth requires `authenticate` in createHandler",
    );
  }

  const app = new Hono();
  const matcher = new TrieRouter<true>();

  const handleError = async (err: unknown, request: Request): Promise<Response> => {
    if (onError) {
      try {
        const res = await onError(err, request);
        if (res instanceof Response) return res;
      } catch (hookErr) {
        console.error(err, hookErr);
        return errorResponse(500, { error: "Internal server error" });
      }
    }
    if (err instanceof z.ZodError) {
      return errorResponse(422, {
        error: "Validation failed",
        issues: err.issues,
      });
    }
    if (err instanceof HTTPException) {
      return errorResponse(err.status, { error: err.message });
    }
    if (!onError) console.error(err);
    return errorResponse(500, { error: "Internal server error" });
  };

  for (const { method, path, controller, action, auth, guard, middlewares, params } of routes) {
    matcher.add(method, path, true);
    const info: AuthRoute = Object.freeze({
      controller: controllerName(controller),
      action,
      method,
      path,
    });
    app.on(method, path, async (c: Context) => {
      const ctx = createContext(c);
      const run = async (): Promise<Response> => {
        try {
          if (auth) {
            const resolved: AuthData | null | undefined = await authenticate?.(c.req.raw);
            if (resolved == null) {
              throw new UnauthorizedError();
            }
            const allowed: unknown = guard ? await guard(resolved, info) : true;
            if (allowed !== true) {
              throw new ForbiddenError();
            }
            ctx.auth = resolved;
          }
          const instance = new controller() as Record<string, unknown>;
          const method = instance[action] as (...args: unknown[]) => unknown;
          const args = await resolveArgs(params, ctx);
          return toResponse(await method.apply(instance, args));
        } catch (err) {
          return handleError(err, c.req.raw);
        }
      };
      try {
        return await compose([...globals, ...middlewares], ctx, run);
      } catch (err) {
        return handleError(err, c.req.raw);
      }
    });
  }

  app.notFound(async (c) => {
    const allow = METHODS.filter((m) => matcher.match(m, c.req.path)[0].length > 0);
    const run = async (): Promise<Response> => {
      if (c.req.method === "OPTIONS" && allow.length > 0) {
        return new Response(null, { status: 204, headers: { Allow: allow.join(", ") } });
      }
      const err = allow.length > 0 ? new MethodNotAllowedError(allow) : new RouteNotFoundError();
      const res = await handleError(err, c.req.raw);
      if (allow.length > 0 && !res.headers.has("Allow")) {
        res.headers.set("Allow", allow.join(", "));
      }
      return res;
    };
    try {
      return await compose(globals, createContext(c), run);
    } catch (err) {
      return handleError(err, c.req.raw);
    }
  });

  const handle: RouteHandler = async (request) => app.fetch(request);
  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    HEAD: handle,
    OPTIONS: handle,
  };
}

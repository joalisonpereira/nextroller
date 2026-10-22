import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { TrieRouter } from "hono/router/trie-router";
import { z } from "zod";
import { createContext, type AuthData } from "./context.js";
import { MethodNotAllowedError, RouteNotFoundError, UnauthorizedError } from "./errors.js";
import {
  METHODS,
  RESOURCE_ACTIONS,
  controllerName,
  validateController,
  type ActionDef,
  type ControllerClass,
  type Method,
} from "./controller.js";

export type ErrorHook = (
  err: unknown,
  request: Request,
) => Response | void | Promise<Response | void>;

export type Authenticate = (
  request: Request,
) => AuthData | null | undefined | Promise<AuthData | null | undefined>;

export interface HandlerOptions {
  controllers: ControllerClass[];
  basePath?: string;
  prefix?: string;
  authenticate?: Authenticate;
  onError?: ErrorHook;
}

type RouteHandler = (request: Request) => Promise<Response>;

export type Handlers = Record<Method, RouteHandler>;

interface RouteEntry {
  method: Method;
  path: string;
  controller: ControllerClass;
  action: string;
  auth: boolean;
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
    throw new Error(
      `[nextroller] \`${name}\` must start with "/": ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function actionsOf(controller: ControllerClass): Record<string, ActionDef> {
  const { resource, actions } = controller.route;
  const defs: Record<string, ActionDef> = {};
  if (resource) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const [action, def] of Object.entries(RESOURCE_ACTIONS)) {
      if (typeof proto[action] === "function") {
        defs[action] = def;
      }
    }
  }
  return { ...defs, ...actions };
}

function collectRoutes(
  controllers: ControllerClass[],
  base: string,
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  for (const controller of controllers) {
    validateController(controller);
    const defs = Object.entries(actionsOf(controller));
    if (defs.length === 0) {
      throw new Error(
        `[nextroller] ${controllerName(controller)}: controller does not define any route`,
      );
    }
    const { auth, public: publicActions = [] } = controller.route;
    for (const [action, [verbs, path]] of defs) {
      const fullPath = joinPaths(base, controller.route.prefix, path);
      const protectedRoute = auth === true && !publicActions.includes(action);
      for (const method of typeof verbs === "string" ? [verbs] : verbs) {
        routes.push({ method, path: fullPath, controller, action, auth: protectedRoute });
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
    const diff = segmentRank(sa[i]!) - segmentRank(sb[i]!);
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

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new Response(null, { status: 204 });
  return Response.json(result);
}

function errorResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return Response.json(body, { status });
}

export function createHandler(options: HandlerOptions): Handlers {
  const { controllers, authenticate, onError } = options;
  const base = joinPaths(
    checkBase("basePath", options.basePath ?? "/api"),
    checkBase("prefix", options.prefix ?? ""),
  );

  const routes = collectRoutes(controllers, base).sort(compareSpecificity);
  checkConflicts(routes);

  const unauthenticated = authenticate ? undefined : routes.find((route) => route.auth);
  if (unauthenticated) {
    throw new Error(
      `[nextroller] ${controllerName(unauthenticated.controller)}: ` +
        "`route.auth` requires `authenticate` in createHandler",
    );
  }

  const app = new Hono();
  const matcher = new TrieRouter<true>();

  const handleError = async (
    err: unknown,
    request: Request,
  ): Promise<Response> => {
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

  for (const { method, path, controller, action, auth } of routes) {
    matcher.add(method, path, true);
    app.on(method, path, async (c: Context) => {
      try {
        const data = auth ? await authenticate!(c.req.raw) : undefined;
        if (auth && data == null) {
          throw new UnauthorizedError();
        }
        const instance = new controller() as Record<
          string,
          (ctx: unknown) => unknown
        >;
        return toResponse(await instance[action]!(createContext(c, data ?? undefined)));
      } catch (err) {
        return handleError(err, c.req.raw);
      }
    });
  }

  app.notFound(async (c) => {
    const allow = METHODS.filter(
      (m) => matcher.match(m, c.req.path)[0].length > 0,
    );
    const err =
      allow.length > 0
        ? new MethodNotAllowedError(allow)
        : new RouteNotFoundError();
    const res = await handleError(err, c.req.raw);
    if (allow.length > 0 && !res.headers.has("Allow")) {
      res.headers.set("Allow", allow.join(", "));
    }
    return res;
  });

  const handle: RouteHandler = async (request) => app.fetch(request);
  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
  };
}

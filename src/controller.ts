import type { AuthData } from "./context.js";
import { readMeta, type Middleware, type ParamSource } from "./metadata.js";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;

export type ControllerClass = new (...args: any[]) => object;

export interface AuthRoute {
  readonly controller: string;
  readonly action: string;
  readonly method: Method;
  readonly path: string;
}

export type AuthGuard = (auth: AuthData, route: AuthRoute) => boolean | Promise<boolean>;

export interface ControllerAction {
  action: string;
  routes: { method: Method; path: Path }[];
  isProtected: boolean;
  guard: AuthGuard | undefined;
  middlewares: Middleware[];
  params: (ParamSource | undefined)[];
}

export interface ControllerDefinition {
  prefix: Path;
  auth: boolean;
  actions: ControllerAction[];
}

export const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const RESOURCE_ACTIONS: Readonly<Record<string, { methods: readonly Method[]; path: Path }>> = {
  index: { methods: ["GET"], path: "/" },
  store: { methods: ["POST"], path: "/" },
  show: { methods: ["GET"], path: "/:id" },
  update: { methods: ["PUT", "PATCH"], path: "/:id" },
  destroy: { methods: ["DELETE"], path: "/:id" },
};

export function controllerName(controller: unknown): string {
  return (typeof controller === "function" && controller.name) || "<anonymous>";
}

export function isPath(value: unknown): value is Path {
  return typeof value === "string" && value.startsWith("/");
}

export function describeController(controller: unknown): ControllerDefinition {
  const name = controllerName(controller);
  const fail = (message: string) => new Error(`[nextroller] ${name}: ${message}`);

  if (typeof controller !== "function") {
    throw fail("controller must be a class");
  }
  const meta = readMeta(controller);
  if (!meta || meta.prefix === undefined) {
    throw fail("missing @Controller decorator");
  }

  const proto = controller.prototype as Record<string, unknown>;
  const routed = new Map<string, { method: Method; path: Path }[]>();
  if (meta.resource) {
    for (const [action, { methods, path }] of Object.entries(RESOURCE_ACTIONS)) {
      if (typeof proto[action] === "function") {
        routed.set(action, methods.map((method) => ({ method, path })));
      }
    }
  }
  for (const [action, { routes }] of meta.actions) {
    if (routes.length > 0) routed.set(action, routes);
  }

  for (const [action, info] of meta.actions) {
    if (routed.has(action)) continue;
    if (info.public) throw fail(`@Public on "${action}", which is not a route`);
    if (info.middlewares.length > 0) throw fail(`@Use on "${action}", which is not a route`);
    if (info.params.length > 0) throw fail(`parameter decorators on "${action}", which is not a route`);
  }

  if (routed.size === 0) {
    throw fail("controller does not define any route");
  }

  const actions: ControllerAction[] = [];
  for (const [action, routes] of routed) {
    const info = meta.actions.get(action);
    const isPublic = info?.public ?? false;
    const params = info?.params ?? [];
    if (isPublic && !meta.auth) {
      throw fail(`@Public on "${action}" requires @Auth on the controller`);
    }
    const isProtected = meta.auth !== undefined && !isPublic;
    if (!isProtected && params.some((source) => source?.kind === "auth")) {
      throw fail(`@Auth() parameter on "${action}", which is not protected by @Auth`);
    }
    const arity = (proto[action] as Function).length;
    if (params.length > 0) {
      for (let index = 0; index < Math.max(arity, params.length); index++) {
        if (!params[index]) throw fail(`parameter ${index} of "${action}" has no decorator`);
      }
    }
    actions.push({
      action,
      routes,
      isProtected,
      guard: isProtected ? meta.auth?.guard : undefined,
      middlewares: [...meta.middlewares, ...(info?.middlewares ?? [])],
      params,
    });
  }

  return { prefix: meta.prefix, auth: meta.auth !== undefined, actions };
}

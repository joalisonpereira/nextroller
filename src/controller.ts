import type { AuthData } from "./context.js";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;
export type ActionDef = readonly [Method | readonly Method[], Path];

type IsAny<T> = 0 extends 1 & T ? true : false;

type Methods<T> = {
  [K in keyof T]: T[K] extends (...a: any[]) => any ? K : never;
}[keyof T] &
  string;

type ActionName<T> = IsAny<T> extends true ? string : Methods<T>;

type ActionMap<T> = IsAny<T> extends true
  ? { readonly [action: string]: ActionDef }
  : [Methods<T>] extends [never]
    ? { readonly [action: string]: never }
    : { readonly [K in Methods<T>]?: ActionDef };

export interface AuthRoute<T = any> {
  readonly controller: string;
  readonly action: ActionName<T>;
  readonly method: Method;
  readonly path: string;
}

export type AuthGuard<T = any> = {
  bivarianceHack(auth: AuthData, route: AuthRoute<T>): boolean | Promise<boolean>;
}["bivarianceHack"];

export interface Route<T = any> {
  readonly prefix: Path;
  readonly resource?: boolean;
  readonly actions?: ActionMap<T>;
  readonly auth?: boolean | AuthGuard<T>;
  readonly public?: readonly ActionName<T>[];
}

export interface ControllerClass {
  new (...args: any[]): object;
  readonly route: Route;
}

type ActionsOf<C> = C extends { route: { actions: infer A } } ? A : {};
type HasPublic<C> = C extends { route: { public: readonly string[] } } ? true : false;

type CheckActions<C extends ControllerClass> = {
  route: {
    actions?: {
      [K in Exclude<keyof ActionsOf<C>, Methods<InstanceType<C>>>]: never;
    };
  };
};

type CheckPublic<C extends ControllerClass> = HasPublic<C> extends true
  ? { route: { auth: true | AuthGuard; public: readonly Methods<InstanceType<C>>[] } }
  : {};

export const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const RESOURCE_ACTIONS: Readonly<Record<string, ActionDef>> = {
  index: ["GET", "/"],
  store: ["POST", "/"],
  show: ["GET", "/:id"],
  update: [["PUT", "PATCH"], "/:id"],
  destroy: ["DELETE", "/:id"],
};

export function defineController<C extends ControllerClass>(
  controller: C & CheckActions<C> & CheckPublic<C>,
): C {
  validateController(controller);
  return controller;
}

export function controllerName(controller: unknown): string {
  return (typeof controller === "function" && controller.name) || "<anonymous>";
}

function isPath(value: unknown): value is Path {
  return typeof value === "string" && value.startsWith("/");
}

function isMethod(value: unknown): value is Method {
  return METHODS.includes(value as Method);
}

export function validateController(controller: unknown): asserts controller is ControllerClass {
  const name = controllerName(controller);
  const fail = (message: string) => new Error(`[nextroller] ${name}: ${message}`);

  if (typeof controller !== "function") {
    throw fail("controller must be a class");
  }

  const route = (controller as { route?: unknown }).route;
  if (typeof route !== "object" || route === null) {
    throw fail("missing `static route`");
  }

  const { prefix, resource, actions, auth, public: publicActions } = route as Record<string, unknown>;
  if (!isPath(prefix)) {
    throw fail("`route.prefix` must be a string starting with \"/\"");
  }
  if (resource !== undefined && typeof resource !== "boolean") {
    throw fail("`route.resource` must be a boolean");
  }
  if (auth !== undefined && typeof auth !== "boolean" && typeof auth !== "function") {
    throw fail("`route.auth` must be a boolean or a function");
  }
  if (
    actions !== undefined &&
    (typeof actions !== "object" || actions === null || Array.isArray(actions))
  ) {
    throw fail("`route.actions` must be an object");
  }

  const proto = (controller as { prototype: Record<string, unknown> }).prototype;
  for (const [method, def] of Object.entries(actions ?? {})) {
    if (typeof proto[method] !== "function") {
      throw fail(`action "${method}" is not a controller method`);
    }
    if (!Array.isArray(def) || def.length !== 2) {
      throw fail(`action "${method}" must be a [method, path] tuple`);
    }
    const [verbs, path] = def as unknown[];
    const list = Array.isArray(verbs) ? verbs : [verbs];
    if (list.length === 0 || !list.every(isMethod)) {
      throw fail(`action "${method}" has an invalid method: ${JSON.stringify(verbs)}`);
    }
    if (!isPath(path)) {
      throw fail(`action "${method}" has an invalid path: ${JSON.stringify(path)}`);
    }
  }

  if (publicActions === undefined) {
    return;
  }
  if (!Array.isArray(publicActions) || !publicActions.every((a) => typeof a === "string")) {
    throw fail("`route.public` must be an array of method names");
  }
  if (auth !== true && typeof auth !== "function") {
    throw fail("`route.public` requires `route.auth`");
  }
  for (const action of publicActions as string[]) {
    const routed =
      Object.hasOwn(actions ?? {}, action) ||
      (resource === true && Object.hasOwn(RESOURCE_ACTIONS, action));
    if (!routed || typeof proto[action] !== "function") {
      throw fail(`public action "${action}" is not a route of this controller`);
    }
  }
}

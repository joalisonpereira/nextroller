export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;
export type ActionDef = readonly [Method | readonly Method[], Path];

export interface RouteConfig {
  readonly prefix: Path;
  readonly resource?: boolean;
  readonly actions?: { readonly [method: string]: ActionDef };
}

export interface ControllerClass {
  new (...args: any[]): object;
  readonly route: RouteConfig;
}

type Methods<T> = {
  [K in keyof T]: T[K] extends (...a: any[]) => any ? K : never;
}[keyof T] &
  string;
type ActionsOf<C> = C extends { route: { actions: infer A } } ? A : {};

type CheckActions<C extends ControllerClass> = {
  route: {
    actions?: {
      [K in Exclude<keyof ActionsOf<C>, Methods<InstanceType<C>>>]: never;
    };
  };
};

export const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const RESOURCE_ACTIONS: Readonly<Record<string, ActionDef>> = {
  index: ["GET", "/"],
  store: ["POST", "/"],
  show: ["GET", "/:id"],
  update: [["PUT", "PATCH"], "/:id"],
  destroy: ["DELETE", "/:id"],
};

export function defineController<C extends ControllerClass>(
  controller: C & CheckActions<C>,
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

  const { prefix, resource, actions } = route as Record<string, unknown>;
  if (!isPath(prefix)) {
    throw fail("`route.prefix` must be a string starting with \"/\"");
  }
  if (resource !== undefined && typeof resource !== "boolean") {
    throw fail("`route.resource` must be a boolean");
  }
  if (actions === undefined) {
    return;
  }
  if (typeof actions !== "object" || actions === null || Array.isArray(actions)) {
    throw fail("`route.actions` must be an object");
  }

  const proto = (controller as { prototype: Record<string, unknown> }).prototype;
  for (const [method, def] of Object.entries(actions as object)) {
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
}

import type { z } from "zod";
import type { HttpContext } from "./context.js";
import type { AuthGuard, Method, Path } from "./controller.js";

export interface Middleware {
  run(ctx: HttpContext, next: () => Promise<Response>): Response | Promise<Response>;
}

export type MiddlewareEntry = Middleware | (new () => Middleware);

export function isMiddleware(value: unknown): value is MiddlewareEntry {
  const target = typeof value === "function" ? (value as { prototype?: unknown }).prototype : value;
  return typeof (target as { run?: unknown } | null | undefined)?.run === "function";
}

export function middlewareInstance(entry: MiddlewareEntry): Middleware {
  return typeof entry === "function" ? new entry() : entry;
}

export type ParamSource =
  | { kind: "body"; schema?: z.ZodType }
  | { kind: "query" | "param" | "headers"; key?: string; schema?: z.ZodType }
  | { kind: "req" | "ctx" | "auth" };

export interface ActionMeta {
  routes: { method: Method; path: Path }[];
  public: boolean;
  middlewares: MiddlewareEntry[];
  params: (ParamSource | undefined)[];
}

export interface ControllerMeta {
  prefix?: Path;
  resource: boolean;
  auth?: { guard?: AuthGuard };
  middlewares: MiddlewareEntry[];
  actions: Map<string, ActionMeta>;
}

const registry = new WeakMap<object, ControllerMeta>();

export function readMeta(controller: object): ControllerMeta | undefined {
  return registry.get(controller);
}

export function controllerMeta(controller: object): ControllerMeta {
  let meta = registry.get(controller);
  if (!meta) {
    meta = { resource: false, middlewares: [], actions: new Map() };
    registry.set(controller, meta);
  }
  return meta;
}

export function actionMeta(controller: object, action: string): ActionMeta {
  const actions = controllerMeta(controller).actions;
  let meta = actions.get(action);
  if (!meta) {
    meta = { routes: [], public: false, middlewares: [], params: [] };
    actions.set(action, meta);
  }
  return meta;
}

export function decoratorError(target: object, key: string | symbol | undefined, message: string): Error {
  const owner = typeof target === "function" ? target : target.constructor;
  const name = owner.name || "<anonymous>";
  const where = key === undefined ? name : `${name}.${String(key)}`;
  return new Error(`[nextroller] ${where}: ${message}`);
}

export function memberTarget(
  target: object,
  key: string | symbol | undefined,
  decorator: string,
): { controller: object; action: string } {
  if (key === undefined) {
    throw decoratorError(target, key, `${decorator} cannot be used on the constructor`);
  }
  if (typeof target === "function") {
    throw decoratorError(target, key, `${decorator} cannot be used on static members`);
  }
  if (typeof key === "symbol") {
    throw decoratorError(target, key, `${decorator} cannot be used on symbol members`);
  }
  return { controller: target.constructor, action: key };
}

export function addParam(
  target: object,
  key: string | symbol | undefined,
  index: number,
  source: ParamSource,
  decorator: string,
): void {
  const { controller, action } = memberTarget(target, key, decorator);
  const params = actionMeta(controller, action).params;
  if (params[index]) {
    throw decoratorError(target, key, `parameter ${String(index)} has more than one decorator`);
  }
  params[index] = source;
}

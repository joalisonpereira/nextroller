import type { z } from "zod";
import type { HttpContext } from "./context.js";
import type { AuthGuard, Method, Path } from "./controller.js";

export type Middleware = (
  ctx: HttpContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export type ParamSource =
  | { kind: "body"; schema?: z.ZodType }
  | { kind: "query" | "param" | "headers"; key?: string; schema?: z.ZodType }
  | { kind: "req" | "ctx" | "auth" };

export interface ActionMeta {
  routes: { method: Method; path: Path }[];
  public: boolean;
  middlewares: Middleware[];
  params: (ParamSource | undefined)[];
}

export interface ControllerMeta {
  prefix?: Path;
  resource: boolean;
  auth?: { guard?: AuthGuard };
  middlewares: Middleware[];
  actions: Map<string, ActionMeta>;
}

const registry = new WeakMap<Function, ControllerMeta>();

export function readMeta(controller: Function): ControllerMeta | undefined {
  return registry.get(controller);
}

export function controllerMeta(controller: Function): ControllerMeta {
  let meta = registry.get(controller);
  if (!meta) {
    meta = { resource: false, middlewares: [], actions: new Map() };
    registry.set(controller, meta);
  }
  return meta;
}

export function actionMeta(controller: Function, action: string): ActionMeta {
  const actions = controllerMeta(controller).actions;
  let meta = actions.get(action);
  if (!meta) {
    meta = { routes: [], public: false, middlewares: [], params: [] };
    actions.set(action, meta);
  }
  return meta;
}

export function decoratorError(
  target: object,
  key: string | symbol | undefined,
  message: string,
): Error {
  const owner = typeof target === "function" ? target : target.constructor;
  const name = owner.name || "<anonymous>";
  const where = key === undefined ? name : `${name}.${String(key)}`;
  return new Error(`[nextroller] ${where}: ${message}`);
}

export function memberTarget(
  target: object,
  key: string | symbol | undefined,
  decorator: string,
): { controller: Function; action: string } {
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
    throw decoratorError(target, key, `parameter ${index} has more than one decorator`);
  }
  params[index] = source;
}

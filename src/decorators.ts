import { isPath, type AuthGuard, type ControllerClass, type Method, type Path } from "./controller.js";
import {
  actionMeta,
  addParam,
  controllerMeta,
  decoratorError,
  isMiddleware,
  memberTarget,
  type MiddlewareEntry,
} from "./metadata.js";

export interface ControllerOptions {
  resource?: boolean;
}

type ClassDecorator = (target: ControllerClass) => void;

type MethodDecorator = <T extends (...args: never[]) => unknown>(
  target: object,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
) => void;

type ParameterDecorator = (target: object, key: string | symbol | undefined, index: number) => void;

function checkMethod(
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor | undefined,
  decorator: string,
): { controller: object; action: string } {
  const member = memberTarget(target, key, decorator);
  if (typeof descriptor?.value !== "function") {
    throw decoratorError(target, key, `${decorator} can only be used on methods`);
  }
  return member;
}

export function Controller(prefix: Path, options: ControllerOptions = {}): ClassDecorator {
  return (target) => {
    if (typeof target !== "function") {
      throw new Error("[nextroller] @Controller can only be used on classes");
    }
    if (!isPath(prefix)) {
      throw decoratorError(target, undefined, `@Controller prefix must start with "/": ${JSON.stringify(prefix)}`);
    }
    const resource = options.resource ?? false;
    if (typeof resource !== "boolean") {
      throw decoratorError(target, undefined, "@Controller `resource` must be a boolean");
    }
    const meta = controllerMeta(target);
    if (meta.prefix !== undefined) {
      throw decoratorError(target, undefined, "@Controller used more than once");
    }
    meta.prefix = prefix;
    meta.resource = resource;
  };
}

function verb(method: Method, decorator: string) {
  return (path: Path = "/"): MethodDecorator =>
    (target, key, descriptor) => {
      const { controller, action } = checkMethod(target, key, descriptor, decorator);
      if (!isPath(path)) {
        throw decoratorError(target, key, `${decorator} path must start with "/": ${JSON.stringify(path)}`);
      }
      const routes = actionMeta(controller, action).routes;
      if (routes.some((route) => route.method === method && route.path === path)) {
        throw decoratorError(target, key, `duplicate ${decorator}(${JSON.stringify(path)})`);
      }
      routes.unshift({ method, path });
    };
}

export const Get = verb("GET", "@Get");
export const Post = verb("POST", "@Post");
export const Put = verb("PUT", "@Put");
export const Patch = verb("PATCH", "@Patch");
export const Delete = verb("DELETE", "@Delete");

export function Public(): MethodDecorator {
  return (target, key, descriptor) => {
    const { controller, action } = checkMethod(target, key, descriptor, "@Public");
    actionMeta(controller, action).public = true;
  };
}

export function Use(...middlewares: MiddlewareEntry[]): ClassDecorator & MethodDecorator {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    const invalid = middlewares.findIndex((middleware) => !isMiddleware(middleware));
    if (invalid !== -1) {
      throw decoratorError(
        target,
        key,
        `@Use middleware ${String(invalid)} must be a class or an object with a run() method`,
      );
    }
    if (key === undefined) {
      controllerMeta(target).middlewares.unshift(...middlewares);
      return;
    }
    const { controller, action } = checkMethod(target, key, descriptor, "@Use");
    actionMeta(controller, action).middlewares.unshift(...middlewares);
  };
}

export function Auth(): ClassDecorator & ParameterDecorator;
export function Auth(guard: AuthGuard): ClassDecorator;
export function Auth(guard?: AuthGuard): ClassDecorator & ParameterDecorator {
  return (target: object, key?: string | symbol, index?: number) => {
    if (typeof index === "number") {
      if (guard !== undefined) {
        throw decoratorError(target, key, "@Auth(guard) cannot be used on parameters; use @Auth()");
      }
      addParam(target, key, index, { kind: "auth" }, "@Auth");
      return;
    }
    if (typeof target !== "function" || key !== undefined) {
      throw decoratorError(target, key, "@Auth can only be used on classes or parameters");
    }
    if (guard !== undefined && typeof guard !== "function") {
      throw decoratorError(target, undefined, "@Auth guard must be a function");
    }
    const meta = controllerMeta(target);
    if (meta.auth) {
      throw decoratorError(target, undefined, "@Auth used more than once");
    }
    meta.auth = guard ? { guard } : {};
  };
}

import type { z } from "zod";
import { readBody, type HttpContext } from "./context.js";
import { addParam, decoratorError, type ParamSource } from "./metadata.js";

type ParameterDecorator = (target: object, key: string | symbol | undefined, index: number) => void;

function isSchema(value: unknown): value is z.ZodType {
  return typeof (value as { parse?: unknown } | null)?.parse === "function";
}

function param(source: ParamSource, decorator: string): ParameterDecorator {
  return (target, key, index) => addParam(target, key, index, source, decorator);
}

function keyed(kind: "query" | "param" | "headers", decorator: string) {
  return (keyOrSchema?: string | z.ZodType): ParameterDecorator => {
    if (keyOrSchema === undefined) return param({ kind }, decorator);
    if (isSchema(keyOrSchema)) return param({ kind, schema: keyOrSchema }, decorator);
    if (typeof keyOrSchema === "string" && keyOrSchema !== "") {
      const key = kind === "headers" ? keyOrSchema.toLowerCase() : keyOrSchema;
      return param({ kind, key }, decorator);
    }
    return (target, key) => {
      throw decoratorError(target, key, `${decorator} expects a key or a Zod schema`);
    };
  };
}

export function Body(schema?: z.ZodType): ParameterDecorator {
  if (schema !== undefined && !isSchema(schema)) {
    return (target, key) => {
      throw decoratorError(target, key, "@Body expects a Zod schema");
    };
  }
  return param(schema ? { kind: "body", schema } : { kind: "body" }, "@Body");
}

export const Query = keyed("query", "@Query");
export const Param = keyed("param", "@Param");
export const Header = keyed("headers", "@Header");

export function Req(): ParameterDecorator {
  return param({ kind: "req" }, "@Req");
}

export function Ctx(): ParameterDecorator {
  return param({ kind: "ctx" }, "@Ctx");
}

function resolve(source: ParamSource, ctx: HttpContext): unknown {
  switch (source.kind) {
    case "body":
      return source.schema ? ctx.validate.body(source.schema) : readBody(ctx.raw);
    case "query":
      if (source.schema) return ctx.validate.query(source.schema);
      return source.key === undefined ? ctx.query : ctx.query[source.key];
    case "param":
      if (source.schema) return ctx.validate.params(source.schema);
      return source.key === undefined ? ctx.params : ctx.params[source.key];
    case "headers":
      if (source.schema) return ctx.validate.headers(source.schema);
      return source.key === undefined ? ctx.headers : ctx.headers[source.key];
    case "req":
      return ctx.request;
    case "ctx":
      return ctx;
    case "auth":
      return ctx.auth;
  }
}

export async function resolveArgs(
  params: readonly (ParamSource | undefined)[],
  ctx: HttpContext,
): Promise<unknown[]> {
  if (params.length === 0) return [ctx];
  const args: unknown[] = [];
  for (const source of params) {
    args.push(source ? await resolve(source, ctx) : undefined);
  }
  return args;
}

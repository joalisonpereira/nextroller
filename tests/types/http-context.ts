import { expectTypeOf } from "vitest";
import type { HttpContext } from "../../src/index.js";

expectTypeOf<HttpContext["params"]>().toEqualTypeOf<Record<string, string>>();
expectTypeOf<keyof HttpContext<"/me">["params"]>().toEqualTypeOf<never>();
expectTypeOf<HttpContext<"/:id">["params"]>().toEqualTypeOf<{ id: string }>();
expectTypeOf<HttpContext<"/:id/activate">["params"]>().toEqualTypeOf<{ id: string }>();
expectTypeOf<HttpContext<"/:userId/posts/:postId">["params"]>().toEqualTypeOf<{ userId: string; postId: string }>();
expectTypeOf<HttpContext<"/files/:name?">["params"]>().toEqualTypeOf<{ name?: string }>();
expectTypeOf<HttpContext<"/:id{[0-9]+}">["params"]>().toEqualTypeOf<{ id: string }>();
expectTypeOf<HttpContext<"/:id{[0-9]+}?">["params"]>().toEqualTypeOf<{ id?: string }>();

export function activate({ params }: HttpContext<"/:id/activate">): string {
  return params.id;
}

export function untyped({ params }: HttpContext): string | undefined {
  return params.id;
}

export function noParams({ params }: HttpContext<"/me">): unknown {
  // @ts-expect-error -- rota sem params
  return params.id;
}

export function wrongName({ params }: HttpContext<"/:id">): unknown {
  // @ts-expect-error -- param inexistente
  return params.userId;
}

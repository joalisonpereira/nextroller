import type { HttpContext } from "../../src/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Cases = [
  Expect<Equal<HttpContext["params"], Record<string, string>>>,
  Expect<Equal<HttpContext<"/me">["params"], {}>>,
  Expect<Equal<HttpContext<"/:id">["params"], { id: string }>>,
  Expect<Equal<HttpContext<"/:id/activate">["params"], { id: string }>>,
  Expect<Equal<HttpContext<"/:userId/posts/:postId">["params"], { userId: string; postId: string }>>,
  Expect<Equal<HttpContext<"/files/:name?">["params"], { name?: string }>>,
  Expect<Equal<HttpContext<"/:id{[0-9]+}">["params"], { id: string }>>,
  Expect<Equal<HttpContext<"/:id{[0-9]+}?">["params"], { id?: string }>>,
];

export function activate({ params }: HttpContext<"/:id/activate">): string {
  return params.id;
}

export function untyped({ params }: HttpContext): string | undefined {
  return params.id;
}

export function noParams({ params }: HttpContext<"/me">) {
  // @ts-expect-error
  return params.id;
}

export function wrongName({ params }: HttpContext<"/:id">) {
  // @ts-expect-error
  return params.userId;
}

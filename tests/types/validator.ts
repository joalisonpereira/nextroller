import { z } from "zod";
import type { InferValidator } from "../../src/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const create = z.object({ name: z.string().min(1), price: z.number() });

const validator = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().default(1) }),
  id: z.string(),
};

type Validated = InferValidator<typeof validator>;

export type Cases = [
  Expect<Equal<Validated["create"], { name: string; price: number }>>,
  Expect<Equal<Validated["update"], { name?: string | undefined; price?: number | undefined }>>,
  Expect<Equal<Validated["list"], { page: number }>>,
  Expect<Equal<Validated["id"], string>>,
  Expect<Equal<keyof Validated, "create" | "update" | "list" | "id">>,
];

// @ts-expect-error
export type Missing = Validated["missing"];

// @ts-expect-error
export type NotValidator = InferValidator<{ create: string }>;

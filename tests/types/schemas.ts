import { z } from "zod";
import type { InferSchemas } from "../../src/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const create = z.object({ name: z.string().min(1), price: z.number() });

const schemas = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().default(1) }),
  id: z.string(),
};

type Input = InferSchemas<typeof schemas>;

export type Cases = [
  Expect<Equal<Input["create"], { name: string; price: number }>>,
  Expect<Equal<Input["update"], { name?: string | undefined; price?: number | undefined }>>,
  Expect<Equal<Input["list"], { page: number }>>,
  Expect<Equal<Input["id"], string>>,
  Expect<Equal<keyof Input, "create" | "update" | "list" | "id">>,
];

// @ts-expect-error
export type Missing = Input["missing"];

// @ts-expect-error
export type NotSchemas = InferSchemas<{ create: string }>;

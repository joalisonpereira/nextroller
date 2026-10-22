import { expectTypeOf } from "vitest";
import { z } from "zod";
import type { InferValidator } from "../../src/index.js";

const create = z.object({ name: z.string().min(1), price: z.number() });

export const validator = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().default(1) }),
  id: z.string(),
};

type Validated = InferValidator<typeof validator>;

expectTypeOf<Validated["create"]>().toEqualTypeOf<{ name: string; price: number }>();
expectTypeOf<Validated["update"]>().toEqualTypeOf<{ name?: string | undefined; price?: number | undefined }>();
expectTypeOf<Validated["list"]>().toEqualTypeOf<{ page: number }>();
expectTypeOf<Validated["id"]>().toEqualTypeOf<string>();
expectTypeOf<keyof Validated>().toEqualTypeOf<"create" | "update" | "list" | "id">();

// @ts-expect-error -- chave inexistente
export type Missing = Validated["missing"];

// @ts-expect-error -- valor não é schema
export type NotValidator = InferValidator<{ create: string }>;

import type { InferSchemas } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const schemas = {
  create,
  update: create.partial(),
  list: z.object({
    page: z.coerce.number().min(1).default(1),
  }),
};

export type Input = InferSchemas<typeof schemas>;

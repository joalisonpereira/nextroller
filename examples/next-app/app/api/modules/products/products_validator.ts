import { z } from "zod";

export const createSchema = z.object({
  name: z.string().min(1),
});

export const updateSchema = createSchema.partial();

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;

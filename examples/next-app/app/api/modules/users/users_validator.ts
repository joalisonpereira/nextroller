import { z } from "zod";

export const createUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
export const updateUser = createUser.partial();
export const listUsers = z.object({
  page: z.coerce.number().min(1).default(1),
});

export type CreateUser = z.infer<typeof createUser>;
export type UpdateUser = z.infer<typeof updateUser>;

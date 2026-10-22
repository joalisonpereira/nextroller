import type { CreateInput, UpdateInput } from "./validator";

export class ProductsService {
  async list(page: number): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async find(id: string): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async create(ownerId: string, data: CreateInput): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async update(id: string, data: UpdateInput): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async remove(id: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

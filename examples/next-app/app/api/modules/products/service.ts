import type { Validated } from "./validator";

export class ProductsService {
  async list(page: number): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async find(id: string): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async create(ownerId: string, data: Validated["create"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async update(id: string, data: Validated["update"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async remove(id: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

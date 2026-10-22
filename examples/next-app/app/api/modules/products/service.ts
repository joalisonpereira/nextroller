import type { Input } from "./validator";

export class ProductsService {
  async list(page: number): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async find(id: string): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async create(ownerId: string, data: Input["create"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async update(id: string, data: Input["update"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async remove(id: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

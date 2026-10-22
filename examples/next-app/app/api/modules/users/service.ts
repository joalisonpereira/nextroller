import { HTTPException } from "nextroller";
import type { CreateUser, UpdateUser } from "./validator";

export interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  archived: boolean;
  token: string;
}

declare module "nextroller" {
  interface Register {
    auth: User;
  }
}

const PAGE_SIZE = 10;

const users = new Map<string, User>();
let nextId = 1;

export class UsersService {
  async list(page: number) {
    const all = [...users.values()];
    return {
      data: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page,
      total: all.length,
    };
  }

  async find(id: string) {
    return users.get(id) ?? null;
  }

  async findByToken(authorization: string | null) {
    const token = authorization?.replace(/^Bearer /, "");
    return [...users.values()].find((u) => u.token === token) ?? null;
  }

  async create(data: CreateUser) {
    const id = String(nextId++);
    const user: User = {
      id,
      ...data,
      active: false,
      archived: false,
      token: `token-${id}`,
    };
    users.set(id, user);
    return user;
  }

  async update(id: string, data: UpdateUser) {
    const user = this.require(id);
    Object.assign(user, data);
    return user;
  }

  async remove(id: string) {
    this.require(id);
    users.delete(id);
  }

  async activate(id: string) {
    this.require(id).active = true;
  }

  async archive(id: string) {
    this.require(id).archived = true;
  }

  private require(id: string) {
    const user = users.get(id);
    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }
    return user;
  }
}

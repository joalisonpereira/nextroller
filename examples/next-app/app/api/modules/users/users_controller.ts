import { defineController, type HttpContext } from "nextroller";
import { UsersService } from "./users_service";
import { createUser, updateUser, listUsers } from "./users_validator";

class UsersController {
  static route = {
    prefix: "/users",
    resource: true,
    actions: {
      me: ["GET", "/me"],
      activate: ["POST", "/:id/activate"],
      archive: ["PUT", "/:id/archive"],
    },
  } as const;

  constructor(private users = new UsersService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(listUsers);
    return this.users.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const user = await this.users.find(params.id);
    return user ?? response.notFound("User not found");
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate.body(createUser);
    return response.created(await this.users.create(data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.users.update(params.id, await validate.body(updateUser));
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.users.remove(params.id);
  }

  async me({ headers }: HttpContext) {
    return this.users.findByToken(headers.authorization);
  }

  async activate({ params }: HttpContext<"/:id/activate">) {
    await this.users.activate(params.id);
  }

  async archive({ params }: HttpContext<"/:id/archive">) {
    await this.users.archive(params.id);
  }
}

export default defineController(UsersController);

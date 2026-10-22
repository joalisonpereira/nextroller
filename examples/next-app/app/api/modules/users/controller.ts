import { defineController, type HttpContext, type Route } from "nextroller";
import { UsersService } from "./service";
import { validator } from "./validator";

class UsersController {
  static route: Route<UsersController> = {
    prefix: "/users",
    resource: true,
    auth: true,
    public: ["store"],
    actions: {
      me: ["GET", "/me"],
      activate: ["POST", "/:id/activate"],
      archive: ["PUT", "/:id/archive"],
    },
  };

  constructor(private users = new UsersService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(validator.list);
    return this.users.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const user = await this.users.find(params.id);
    return user ?? response.notFound("User not found");
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate.body(validator.create);
    return response.created(await this.users.create(data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.users.update(params.id, await validate.body(validator.update));
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.users.remove(params.id);
  }

  async me({ auth }: HttpContext) {
    return auth;
  }

  async activate({ params }: HttpContext<"/:id/activate">) {
    await this.users.activate(params.id);
  }

  async archive({ params }: HttpContext<"/:id/archive">) {
    await this.users.archive(params.id);
  }
}

export default defineController(UsersController);

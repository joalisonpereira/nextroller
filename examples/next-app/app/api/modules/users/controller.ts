import {
  Auth,
  Body,
  Controller,
  Ctx,
  Get,
  NotFoundError,
  Param,
  Post,
  Public,
  Put,
  Query,
  Use,
  type HttpContext,
} from "nextroller";
import { logRequest } from "@/app/api/middlewares/log";
import { UsersService, type User } from "./service";
import { validator, type Validated } from "./validator";

@Controller("/users", { resource: true })
@Auth()
@Use(logRequest)
export default class UsersController {
  constructor(private users = new UsersService()) {}

  async index(@Query(validator.list) { page }: Validated["list"]) {
    return this.users.list(page);
  }

  async show(@Param("id") id: string) {
    const user = await this.users.find(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  @Public()
  async store(
    @Body(validator.create) data: Validated["create"],
    @Ctx() { response }: HttpContext,
  ) {
    return response.created(await this.users.create(data));
  }

  async update(
    @Param("id") id: string,
    @Body(validator.update) data: Validated["update"],
  ) {
    return this.users.update(id, data);
  }

  async destroy(@Param("id") id: string) {
    await this.users.remove(id);
  }

  @Get("/me")
  async me(@Auth() auth: User) {
    return auth;
  }

  @Post("/:id/activate")
  async activate(@Param("id") id: string) {
    await this.users.activate(id);
  }

  @Put("/:id/archive")
  async archive(@Param("id") id: string) {
    await this.users.archive(id);
  }
}

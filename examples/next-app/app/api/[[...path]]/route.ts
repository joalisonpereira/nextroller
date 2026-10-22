import { createHandler, RouteNotFoundError } from "nextroller";
import UsersController from "@/app/api/modules/users/controller";
import ProductsController from "@/app/api/modules/products/controller";
import { UsersService } from "@/app/api/modules/users/service";
import { logRequest } from "@/app/api/middlewares/log";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  controllers: [UsersController, ProductsController],
  middlewares: [logRequest],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
  onError: (error) => console.error(error),
});

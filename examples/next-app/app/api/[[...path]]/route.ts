import { createHandler, RouteNotFoundError } from "nextroller";
import UsersController from "@/app/api/modules/users/controller";
import ProductsController from "@/app/api/modules/products/controller";
import { UsersService } from "@/app/api/modules/users/service";
import { LoggerMiddleware } from "@/app/api/middlewares/logger";

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHandler({
  basePath: "/api",
  controllers: [UsersController, ProductsController],
  middlewares: [LoggerMiddleware],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
  onError: (error) => console.error(error),
});

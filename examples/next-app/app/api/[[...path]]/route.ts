import { createHandler, RouteNotFoundError } from "nextroller";
import UsersController from "@/app/api/modules/users/users_controller";
import ProductsController from "@/app/api/modules/products/products_controller";
import { UsersService } from "@/app/api/modules/users/users_service";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  controllers: [UsersController, ProductsController],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
  onError: (error) => console.error(error),
});

import { createHandler, RouteNotFoundError } from "nextroller";
import UsersController from "@/app/api/modules/users/users_controller";
import ProductsController from "@/app/api/modules/products/products_controller";
import { UsersService } from "@/app/api/modules/users/users_service";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ code, message }, { status });
}

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  controllers: [UsersController, ProductsController],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
  onError(error) {
    if (error instanceof RouteNotFoundError) {
      return errorResponse(404, "ROUTE_NOT_FOUND", "Recurso inexistente");
    }
  },
});

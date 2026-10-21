import { createHandler } from "nextroller";
import UsersController from "@/app/api/modules/users/users_controller";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  controllers: [UsersController],
  onError: (error) => console.error(error),
});

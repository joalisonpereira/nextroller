import { HTTPException } from "hono/http-exception";
import type { Method } from "./controller.js";

export class RouteNotFoundError extends HTTPException {
  constructor() {
    super(404, { message: "Route not found" });
    this.name = "RouteNotFoundError";
  }
}

export class MethodNotAllowedError extends HTTPException {
  constructor(readonly allow: Method[]) {
    super(405, { message: "Method not allowed" });
    this.name = "MethodNotAllowedError";
  }
}

export class ForbiddenError extends HTTPException {
  constructor() {
    super(403, { message: "Forbidden" });
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends HTTPException {
  constructor() {
    super(401, { message: "Unauthorized" });
    this.name = "UnauthorizedError";
  }
}

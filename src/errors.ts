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

export class BadRequestError extends HTTPException {
  constructor(message = "Bad request") {
    super(400, { message });
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends HTTPException {
  constructor(message = "Unauthorized") {
    super(401, { message });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HTTPException {
  constructor(message = "Forbidden") {
    super(403, { message });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends HTTPException {
  constructor(message = "Not found") {
    super(404, { message });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HTTPException {
  constructor(message = "Conflict") {
    super(409, { message });
    this.name = "ConflictError";
  }
}

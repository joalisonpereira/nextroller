import {
  Auth,
  Controller,
  Get,
  Post,
  Public,
  createHandler,
  type AuthGuard,
  type AuthRoute,
  type HttpContext,
} from "../../src/index.js";
import { expectTypeOf } from "vitest";

declare module "../../src/context.js" {
  interface Register {
    auth: { id: string; role: "admin" | "user" };
  }
}

interface User {
  id: string;
  role: "admin" | "user";
}

expectTypeOf<HttpContext["auth"]>().toEqualTypeOf<User>();
expectTypeOf<AuthRoute["action"]>().toEqualTypeOf<string>();
expectTypeOf<Parameters<AuthGuard>[0]>().toEqualTypeOf<User>();

@Controller("/products", { resource: true })
@Auth()
class Products {
  @Public()
  index() {
    return undefined;
  }

  store({ auth }: HttpContext) {
    return auth.id;
  }

  @Get("/mine")
  mine(@Auth() auth: User) {
    return auth.role;
  }
}

createHandler({
  controllers: [Products],
  authenticate: (request) => Promise.resolve(request.headers.has("authorization") ? { id: "1", role: "user" } : null),
});

createHandler({
  controllers: [Products],
  authenticate: () => undefined,
});

createHandler({
  controllers: [Products],
  // @ts-expect-error -- id deve ser string
  authenticate: () => Promise.resolve({ id: 1 }),
});

@Controller("/guarded", { resource: true })
@Auth((auth, route) => auth.role === "admin" || route.action === "index")
export class Guarded {
  index() {
    return undefined;
  }
}

@Controller("/async", { resource: true })
@Auth((auth) => Promise.resolve(auth.id !== ""))
export class AsyncGuarded {
  index() {
    return undefined;
  }
}

const sharedGuard: AuthGuard = (auth, route) => auth.role === "admin" || route.method === "GET";

@Controller("/shared", { resource: true })
@Auth(sharedGuard)
export class Shared {
  index() {
    return undefined;
  }
}

// @ts-expect-error -- guard deve retornar boolean
@Auth(() => undefined)
export class GuardVoid {}

// @ts-expect-error -- guard incompatível com Register
@Auth((auth: { tenant: string }) => auth.tenant !== "")
export class GuardWrongAuth {}

export class AuthParamWithGuard {
  @Post("/")
  // @ts-expect-error -- guard no parâmetro
  store(@Auth(() => true) auth: User) {
    return auth;
  }
}

export class AuthOnMethod {
  // @ts-expect-error -- @Auth() em método
  @Auth()
  store() {
    return undefined;
  }
}

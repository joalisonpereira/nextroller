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

declare module "../../src/context.js" {
  interface Register {
    auth: { id: string; role: "admin" | "user" };
  }
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type User = { id: string; role: "admin" | "user" };

export type Cases = [
  Expect<Equal<HttpContext["auth"], User>>,
  Expect<Equal<AuthRoute["action"], string>>,
  Expect<Equal<Parameters<AuthGuard>[0], User>>,
];

@Controller("/products", { resource: true })
@Auth()
class Products {
  @Public()
  index() {}

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
  authenticate: async (request) =>
    request.headers.has("authorization") ? { id: "1", role: "user" } : null,
});

createHandler({
  controllers: [Products],
  authenticate: () => undefined,
});

createHandler({
  controllers: [Products],
  // @ts-expect-error
  authenticate: async () => ({ id: 1 }),
});

@Controller("/guarded", { resource: true })
@Auth((auth, route) => auth.role === "admin" || route.action === "index")
export class Guarded {
  index() {}
}

@Controller("/async", { resource: true })
@Auth(async (auth) => auth.id !== "")
export class AsyncGuarded {
  index() {}
}

const sharedGuard: AuthGuard = (auth, route) => auth.role === "admin" || route.method === "GET";

@Controller("/shared", { resource: true })
@Auth(sharedGuard)
export class Shared {
  index() {}
}

// @ts-expect-error
@Auth(() => {})
export class GuardVoid {}

// @ts-expect-error
@Auth((auth: { tenant: string }) => auth.tenant !== "")
export class GuardWrongAuth {}

export class AuthParamWithGuard {
  @Post("/")
  // @ts-expect-error
  store(@Auth(() => true) auth: User) {
    return auth;
  }
}

export class AuthOnMethod {
  // @ts-expect-error
  @Auth()
  store() {}
}

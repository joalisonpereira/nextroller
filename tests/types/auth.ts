import { createHandler, defineController, type HttpContext } from "../../src/index.js";

declare module "../../src/context.js" {
  interface Register {
    auth: { id: string; role: "admin" | "user" };
  }
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Cases = [Expect<Equal<HttpContext["auth"], { id: string; role: "admin" | "user" }>>];

class Products {
  static route = {
    prefix: "/products",
    resource: true,
    auth: true,
    public: ["index", "show"],
    actions: { mine: ["GET", "/mine"] },
  } as const;

  index() {}
  show() {}
  store({ auth }: HttpContext) {
    return auth.id;
  }
  mine({ auth }: HttpContext) {
    return auth.role;
  }
}
const products = defineController(Products);

class AuthOnly {
  static route = { prefix: "/me", auth: true, actions: { me: ["GET", "/"] } } as const;
  me() {}
}
defineController(AuthOnly);

createHandler({
  controllers: [products],
  authenticate: async (request) =>
    request.headers.has("authorization") ? { id: "1", role: "user" } : null,
});

createHandler({
  controllers: [products],
  authenticate: () => undefined,
});

createHandler({
  controllers: [products],
  // @ts-expect-error
  authenticate: async () => ({ id: 1 }),
});

class PublicUnknown {
  static route = { prefix: "/a", resource: true, auth: true, public: ["missing"] } as const;
  index() {}
}
// @ts-expect-error
defineController(PublicUnknown);

class PublicPrivate {
  static route = {
    prefix: "/a",
    auth: true,
    public: ["helper"],
    actions: { helper: ["GET", "/"] },
  } as const;
  private helper() {}
}
// @ts-expect-error
defineController(PublicPrivate);

class PublicWithoutAuth {
  static route = { prefix: "/a", resource: true, public: ["index"] } as const;
  index() {}
}
// @ts-expect-error
defineController(PublicWithoutAuth);

class PublicAuthFalse {
  static route = { prefix: "/a", resource: true, auth: false, public: ["index"] } as const;
  index() {}
}
// @ts-expect-error
defineController(PublicAuthFalse);

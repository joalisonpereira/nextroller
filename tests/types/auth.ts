import {
  createHandler,
  defineController,
  type AuthGuard,
  type AuthRoute,
  type HttpContext,
  type Route,
} from "../../src/index.js";

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

class Guarded {
  static route = {
    prefix: "/guarded",
    resource: true,
    auth: (auth, route) => auth.role === "admin" || route.action === "index",
    public: ["show"],
  } as const satisfies Route;

  index() {}
  show() {}
}
const guarded = defineController(Guarded);
export const guardedPublic: readonly ["show"] = guarded.route.public;

class GuardedAnnotated {
  static route = {
    prefix: "/annotated",
    resource: true,
    auth: async (auth: { id: string; role: "admin" | "user" }, route: AuthRoute) =>
      auth.id !== "" && route.method === "GET",
  } as const;

  index() {}
}
defineController(GuardedAnnotated);

class GuardedUntyped {
  // @ts-expect-error
  static route = { prefix: "/untyped", resource: true, auth: (auth) => auth.role === "admin" } as const;
  index() {}
}
defineController(GuardedUntyped);

class GuardedVoid {
  static route = { prefix: "/void", resource: true, auth: () => {} } as const;
  index() {}
}
// @ts-expect-error
defineController(GuardedVoid);

class GuardedWrongAuth {
  static route = { prefix: "/wrong", resource: true, auth: (auth: { tenant: string }) => auth.tenant !== "" } as const;
  index() {}
}
// @ts-expect-error
defineController(GuardedWrongAuth);

class AnnotatedRoute {
  static route: Route = {
    prefix: "/annotated-route",
    resource: true,
    auth: (auth, route) => auth.role === "admin" || route.method === "GET",
    public: ["index"],
    actions: { approve: [["POST", "PUT"], "/:id/approve"] },
  };

  index() {}
  approve({ auth }: HttpContext) {
    return auth.id;
  }
}
defineController(AnnotatedRoute);

class AnnotatedBadVerb {
  static route: Route = {
    prefix: "/a",
    // @ts-expect-error
    actions: { approve: ["GT", "/x"] },
  };
  approve() {}
}
void AnnotatedBadVerb;

class AnnotatedBadPrefix {
  // @ts-expect-error
  static route: Route = { prefix: "a" };
}
void AnnotatedBadPrefix;

class AnnotatedGuardVoid {
  // @ts-expect-error
  static route: Route = { prefix: "/a", resource: true, auth: () => {} };
  index() {}
}
void AnnotatedGuardVoid;

class GenericRoute {
  static route: Route<GenericRoute> = {
    prefix: "/generic",
    resource: true,
    auth: (auth, route) => {
      type Action = typeof route.action;
      const check: Expect<Equal<Action, "index" | "show" | "approve">> = true;
      return check && auth.role === "admin";
    },
    public: ["index"],
    actions: { approve: ["POST", "/:id/approve"] },
  };

  index() {}
  show() {}
  approve() {}
  private helper() {}
}
defineController(GenericRoute);

class GenericUnknownAction {
  static route: Route<GenericUnknownAction> = {
    prefix: "/a",
    // @ts-expect-error
    actions: { missing: ["GET", "/x"] },
  };
  index() {}
}
void GenericUnknownAction;

class GenericUnknownPublic {
  static route: Route<GenericUnknownPublic> = {
    prefix: "/a",
    resource: true,
    auth: true,
    // @ts-expect-error
    public: ["indx"],
  };
  index() {}
}
void GenericUnknownPublic;

class GenericPrivateAction {
  static route: Route<GenericPrivateAction> = {
    prefix: "/a",
    auth: true,
    // @ts-expect-error
    actions: { helper: ["GET", "/x"] },
  };
  private helper() {}
}
void GenericPrivateAction;

class GenericPropertyPublic {
  static route: Route<GenericPropertyPublic> = {
    prefix: "/a",
    resource: true,
    auth: true,
    // @ts-expect-error
    public: ["count"],
  };
  count = 1;
  index() {}
}
void GenericPropertyPublic;

const sharedGuard: AuthGuard = (auth, route) => auth.role === "admin" || route.action === "index";

class GenericSharedGuard {
  static route: Route<GenericSharedGuard> = { prefix: "/shared", resource: true, auth: sharedGuard };
  index() {}
}
defineController(GenericSharedGuard);

export type DefaultRoute = [
  Expect<Equal<AuthRoute["action"], string>>,
  Expect<Equal<NonNullable<Route["public"]>, readonly string[]>>,
];

import { defineController, type HttpContext } from "../../src/index.js";

class Full {
  static route = {
    prefix: "/users",
    resource: true,
    actions: {
      me: ["GET", "/me"],
      archive: [["PUT", "PATCH"], "/:id/archive"],
    },
  } as const;

  constructor(private readonly secret = "x") {}

  index() {
    return [];
  }
  me(_ctx: HttpContext) {
    return { secret: this.secret };
  }
  archive() {}
}
export const full: typeof Full = defineController(Full);

class OnlyPrefix {
  static route = { prefix: "/ping" } as const;
}
defineController(OnlyPrefix);

class ResourceOnly {
  static route = { prefix: "/posts", resource: true } as const;
  show() {}
}
defineController(ResourceOnly);

class NoRoute {
  index() {}
}
// @ts-expect-error
defineController(NoRoute);

class NoPrefix {
  static route = { resource: true } as const;
}
// @ts-expect-error
defineController(NoPrefix);

class NoAsConst {
  static route = { prefix: "/users", actions: { me: ["GET", "/me"] } };
  me() {}
}
// @ts-expect-error
defineController(NoAsConst);

class UnknownAction {
  static route = { prefix: "/users", actions: { missing: ["GET", "/x"] } } as const;
  me() {}
}
// @ts-expect-error
defineController(UnknownAction);

class PrivateAction {
  static route = { prefix: "/users", actions: { helper: ["GET", "/x"] } } as const;
  private helper() {}
}
// @ts-expect-error
defineController(PrivateAction);

class PropertyAction {
  static route = { prefix: "/users", actions: { count: ["GET", "/x"] } } as const;
  count = 1;
}
// @ts-expect-error
defineController(PropertyAction);

class BadVerb {
  static route = { prefix: "/users", actions: { me: ["GT", "/me"] } } as const;
  me() {}
}
// @ts-expect-error
defineController(BadVerb);

class BadVerbInList {
  static route = { prefix: "/users", actions: { me: [["GET", "PUTS"], "/me"] } } as const;
  me() {}
}
// @ts-expect-error
defineController(BadVerbInList);

class BadPath {
  static route = { prefix: "/users", actions: { me: ["GET", "me"] } } as const;
  me() {}
}
// @ts-expect-error
defineController(BadPath);

class BadPrefix {
  static route = { prefix: "users" } as const;
}
// @ts-expect-error
defineController(BadPrefix);

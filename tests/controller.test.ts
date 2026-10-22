import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Auth,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Public,
  Query,
  Use,
  createHandler,
  type Middleware,
} from "../src/index.js";

type AnyDecorator = (...args: any[]) => void;
const loose = (decorator: unknown) => decorator as AnyDecorator;
const pass: Middleware = (_ctx, next) => next();
const boot = (controller: unknown) => () =>
  createHandler({ controllers: [controller as new () => object], authenticate: () => ({ id: "1", role: "admin" }) });

describe("decorators (validação na decoração)", () => {
  it("rejeita prefix e path sem barra inicial", () => {
    expect(() => {
      @(loose(Controller("users" as `/${string}`)))
      class Users {}
      void Users;
    }).toThrow('Users: @Controller prefix must start with "/": "users"');

    expect(() => {
      class Users {
        @(loose(Get("me" as `/${string}`)))
        me() {}
      }
      void Users;
    }).toThrow('Users.me: @Get path must start with "/": "me"');
  });

  it("rejeita resource não boolean e @Controller repetido", () => {
    expect(() => {
      @(loose(Controller("/a", { resource: "yes" as unknown as boolean })))
      class A {}
      void A;
    }).toThrow("A: @Controller `resource` must be a boolean");

    expect(() => {
      @Controller("/a")
      @Controller("/b")
      class A {}
      void A;
    }).toThrow("A: @Controller used more than once");
  });

  it("rejeita verbo + path repetido no mesmo método", () => {
    expect(() => {
      class A {
        @Get("/x")
        @Get("/x")
        go() {}
      }
      void A;
    }).toThrow('A.go: duplicate @Get("/x")');
  });

  it("rejeita decorator de método em propriedade e membro estático", () => {
    expect(() => {
      class A {
        @(loose(Get("/x")))
        count = 1;
      }
      void A;
    }).toThrow("A.count: @Get can only be used on methods");

    expect(() => {
      class A {
        @Get("/x")
        static go() {}
      }
      void A;
    }).toThrow("A.go: @Get cannot be used on static members");
  });

  it("rejeita @Auth inválido", () => {
    expect(() => {
      @Auth()
      @Auth()
      class A {}
      void A;
    }).toThrow("A: @Auth used more than once");

    expect(() => {
      class A {
        @(loose(Auth()))
        go() {}
      }
      void A;
    }).toThrow("A.go: @Auth can only be used on classes or parameters");

    expect(() => {
      class A {
        go(@(loose(Auth(() => true))) auth: unknown) {
          return auth;
        }
      }
      void A;
    }).toThrow("A.go: @Auth(guard) cannot be used on parameters; use @Auth()");

    expect(() => {
      @(loose(Auth("admin" as never)))
      class A {}
      void A;
    }).toThrow("A: @Auth guard must be a function");
  });

  it("rejeita @Use com valor que não é função", () => {
    expect(() => {
      @Use(pass, "log" as unknown as Middleware)
      class A {}
      void A;
    }).toThrow("A: @Use middleware 1 is not a function");
  });

  it("rejeita parameter decorators inválidos", () => {
    expect(() => {
      class A {
        constructor(@(loose(Body())) readonly body: unknown) {}
      }
      void A;
    }).toThrow("A: @Body cannot be used on the constructor");

    expect(() => {
      class A {
        go(@(loose(Body("name" as never))) body: unknown) {
          return body;
        }
      }
      void A;
    }).toThrow("A.go: @Body expects a Zod schema");

    expect(() => {
      class A {
        go(@(loose(Query(""))) q: unknown) {
          return q;
        }
      }
      void A;
    }).toThrow("A.go: @Query expects a key or a Zod schema");

    expect(() => {
      class A {
        go(@Query() @(loose(Param())) q: unknown) {
          return q;
        }
      }
      void A;
    }).toThrow("A.go: parameter 0 has more than one decorator");
  });
});

describe("createHandler (validação do controller)", () => {
  it("rejeita valor que não é classe e classe sem @Controller", () => {
    expect(boot({})).toThrow("<anonymous>: controller must be a class");
    expect(boot(class Plain {})).toThrow("Plain: missing @Controller decorator");
    class OnlyRoutes {
      @Get()
      go() {}
    }
    expect(boot(OnlyRoutes)).toThrow("OnlyRoutes: missing @Controller decorator");
  });

  it("rejeita controller sem rotas", () => {
    @Controller("/empty", { resource: true })
    class Empty {
      helper() {}
    }
    expect(boot(Empty)).toThrow("Empty: controller does not define any route");
  });

  it("rejeita @Public sem @Auth ou em método que não é rota", () => {
    @Controller("/a", { resource: true })
    class NoAuth {
      @Public()
      index() {}
    }
    expect(boot(NoAuth)).toThrow('NoAuth: @Public on "index" requires @Auth on the controller');

    @Controller("/a", { resource: true })
    @Auth()
    class NotRoute {
      index() {}
      @Public()
      helper() {}
    }
    expect(boot(NotRoute)).toThrow('NotRoute: @Public on "helper", which is not a route');
  });

  it("rejeita @Use e parameter decorators em método que não é rota", () => {
    @Controller("/a", { resource: true })
    class UseHelper {
      index() {}
      @Use(pass)
      helper() {}
    }
    expect(boot(UseHelper)).toThrow('UseHelper: @Use on "helper", which is not a route');

    @Controller("/a", { resource: true })
    class ParamHelper {
      index() {}
      helper(@Body() body: unknown) {
        return body;
      }
    }
    expect(boot(ParamHelper)).toThrow(
      'ParamHelper: parameter decorators on "helper", which is not a route',
    );
  });

  it("exige decorator em todos os parâmetros quando algum tem", () => {
    @Controller("/a")
    class Partial {
      @Post("/:id")
      go(@Param("id") id: string, body: unknown) {
        return { id, body };
      }
    }
    expect(boot(Partial)).toThrow('Partial: parameter 1 of "go" has no decorator');

    @Controller("/a")
    class Hole {
      @Post("/:id")
      go(id: string, @Body(z.object({})) body: unknown) {
        return { id, body };
      }
    }
    expect(boot(Hole)).toThrow('Hole: parameter 0 of "go" has no decorator');
  });

  it("rejeita @Param com chave fora do path", () => {
    @Controller("/users/:userId/posts")
    class Posts {
      @Get("/:id")
      show(@Param("userId") userId: string, @Param("id") id: string) {
        return { userId, id };
      }
      @Get("/latest")
      latest(@Param("id") id: string) {
        return id;
      }
    }
    expect(boot(Posts)).toThrow(
      'Posts: @Param("id") on "latest" is not in GET /api/users/:userId/posts/latest',
    );
  });

  it("rejeita @Auth() em parâmetro de ação pública", () => {
    @Controller("/a", { resource: true })
    @Auth()
    class PublicAuth {
      @Public()
      index(@Auth() auth: unknown) {
        return auth;
      }
    }
    expect(boot(PublicAuth)).toThrow(
      'PublicAuth: @Auth() parameter on "index", which is not protected by @Auth',
    );

    @Controller("/a", { resource: true })
    class NoAuth {
      index(@Auth() auth: unknown) {
        return auth;
      }
    }
    expect(boot(NoAuth)).toThrow('NoAuth: @Auth() parameter on "index", which is not protected by @Auth');
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Auth,
  BadRequestError,
  ConflictError,
  Controller,
  Get,
  HTTPException,
  MethodNotAllowedError,
  ForbiddenError,
  NotFoundError,
  Patch,
  Post,
  Public,
  Put,
  RouteNotFoundError,
  UnauthorizedError,
  type AuthGuard,
  createHandler,
  type HttpContext,
} from "../src/index.js";

function request(method: string, path: string, body?: unknown, headers?: HeadersInit): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

@Controller("/users", { resource: true })
class UsersController {
  index() {
    return [{ id: "1" }];
  }
  show({ params }: HttpContext) {
    return { id: params.id };
  }
  async store({ validate, response }: HttpContext) {
    const data = await validate.body(z.object({ name: z.string().min(1) }));
    return response.created(data);
  }
  update({ params }: HttpContext) {
    return { updated: params.id };
  }
  destroy() {}
  @Get("/me")
  me() {
    return { me: true };
  }
  @Post("/:id/activate")
  activate({ params }: HttpContext) {
    return { activated: params.id };
  }
  @Put("/:id/archive")
  @Patch("/:id/archive")
  archive({ request }: HttpContext) {
    return { archived: request.method };
  }
}

const Users = UsersController;

async function call(
  handlers: ReturnType<typeof createHandler>,
  method: keyof ReturnType<typeof createHandler>,
  path: string,
  body?: unknown,
) {
  const res = await handlers[method](request(method, path, body));
  const text = await res.text();
  return { res, status: res.status, body: text ? JSON.parse(text) : undefined };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("roteamento", () => {
  const api = createHandler({ controllers: [Users] });

  it("gera rotas de resource", async () => {
    expect((await call(api, "GET", "/api/users")).body).toEqual([{ id: "1" }]);
    expect((await call(api, "GET", "/api/users/42")).body).toEqual({ id: "42" });
    expect((await call(api, "PUT", "/api/users/42")).body).toEqual({ updated: "42" });
    expect((await call(api, "PATCH", "/api/users/42")).body).toEqual({ updated: "42" });
  });

  it("prioriza segmento fixo sobre parâmetro", async () => {
    expect((await call(api, "GET", "/api/users/me")).body).toEqual({ me: true });
  });

  it("registra rotas com um ou vários verbos", async () => {
    expect((await call(api, "POST", "/api/users/7/activate")).body).toEqual({ activated: "7" });
    expect((await call(api, "PUT", "/api/users/7/archive")).body).toEqual({ archived: "PUT" });
    expect((await call(api, "PATCH", "/api/users/7/archive")).body).toEqual({ archived: "PATCH" });
  });

  it("ordena por especificidade independente da ordem de declaração", async () => {
    @Controller("/items")
    class Items {
      @Get("/:id")
      byId() {
        return "byId";
      }
      @Get("/latest")
      latest() {
        return "latest";
      }
    }
    const handlers = createHandler({ controllers: [Items] });
    expect((await call(handlers, "GET", "/api/items/latest")).body).toBe("latest");
    expect((await call(handlers, "GET", "/api/items/9")).body).toBe("byId");
  });

  it("monta basePath + prefix + prefix do @Controller + path", async () => {
    const handlers = createHandler({ controllers: [Users], basePath: "/", prefix: "/v1" });
    expect((await call(handlers, "GET", "/v1/users/me")).body).toEqual({ me: true });
    expect((await call(handlers, "GET", "/api/v1/users/me")).status).toBe(404);
  });

  it("decorator de verbo sobrescreve resource", async () => {
    @Controller("/posts", { resource: true })
    class Posts {
      @Get("/by-slug/:slug")
      show({ params }: HttpContext) {
        return params.slug;
      }
    }
    const handlers = createHandler({ controllers: [Posts] });
    expect((await call(handlers, "GET", "/api/posts/by-slug/hello")).body).toBe("hello");
    expect((await call(handlers, "GET", "/api/posts/1")).status).toBe(404);
  });

  it("instancia o controller por request", async () => {
    const constructed = vi.fn();
    @Controller("/count")
    class Counter {
      private hits = 0;
      constructor() {
        constructed();
      }
      @Get()
      hit() {
        return ++this.hits;
      }
    }
    const handlers = createHandler({ controllers: [Counter] });
    expect((await call(handlers, "GET", "/api/count")).body).toBe(1);
    expect((await call(handlers, "GET", "/api/count")).body).toBe(1);
    expect(constructed).toHaveBeenCalledTimes(2);
  });
});

describe("erros de configuração", () => {
  it("rejeita rota duplicada entre controllers", () => {
    @Controller("/users")
    class Me {
      @Get("/me")
      profile() {}
    }
    expect(() => createHandler({ controllers: [Users, Me] })).toThrow(
      "duplicate route GET /api/users/me: UsersController.me and Me.profile",
    );
  });

  it("trata parâmetros com nomes diferentes como a mesma rota", () => {
    @Controller("/users")
    class Other {
      @Get("/:userId")
      find() {}
    }
    expect(() => createHandler({ controllers: [Users, Other] })).toThrow(
      /duplicate route GET \/api\/users\/:userId: UsersController.show and Other.find/,
    );
  });

  it("rejeita rota duplicada entre métodos do mesmo controller", () => {
    @Controller("/dup")
    class Dup {
      @Get("/x")
      a() {}
      @Get("/x")
      b() {}
    }
    expect(() => createHandler({ controllers: [Dup] })).toThrow(
      "duplicate route GET /api/dup/x: Dup.a and Dup.b",
    );
  });

  it("rejeita basePath/prefix sem barra inicial", () => {
    expect(() => createHandler({ controllers: [Users], prefix: "v1" })).toThrow("`prefix`");
    expect(() => createHandler({ controllers: [Users], basePath: "api" })).toThrow("`basePath`");
  });
});

describe("regras de resposta", () => {
  @Controller("/r")
  class Responses {
    @Get("/value")
    value() {
      return { ok: true };
    }
    @Get("/nothing")
    async nothing() {}
    @Get("/raw")
    raw() {
      return new Response("texto", { status: 418 });
    }
    @Get("/nil")
    nil() {
      return null;
    }
  }
  const api = createHandler({ controllers: [Responses] });

  it("valor vira 200 JSON", async () => {
    const { res, body } = await call(api, "GET", "/api/r/value");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({ ok: true });
  });

  it("undefined vira 204 sem corpo", async () => {
    const res = await api.GET(request("GET", "/api/r/nothing"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("Response é retornada como está", async () => {
    const res = await api.GET(request("GET", "/api/r/raw"));
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("texto");
  });

  it("null vira 200 JSON", async () => {
    const { status, body } = await call(api, "GET", "/api/r/nil");
    expect(status).toBe(200);
    expect(body).toBeNull();
  });
});

describe("respostas automáticas", () => {
  const api = createHandler({ controllers: [Users] });

  it("404 JSON quando nenhum path casa", async () => {
    const { res, body } = await call(api, "GET", "/api/nada");
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Route not found" });
    expect(res.headers.get("allow")).toBeNull();
  });

  it("405 com Allow quando o path casa com outro verbo", async () => {
    const { res, body } = await call(api, "DELETE", "/api/users/7/archive");
    expect(res.status).toBe(405);
    expect(body).toEqual({ error: "Method not allowed" });
    expect(res.headers.get("allow")).toBe("PUT, PATCH");
  });

  it("Allow reúne todos os verbos cujas rotas casam o path", async () => {
    const { res } = await call(api, "POST", "/api/users/42");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, PUT, PATCH, DELETE");
  });

  it("404/405 passam pelo onError como RouteNotFoundError/MethodNotAllowedError", async () => {
    const seen: unknown[] = [];
    const handlers = createHandler({
      controllers: [Users],
      onError(err) {
        seen.push(err);
      },
    });
    expect((await call(handlers, "GET", "/api/nada")).status).toBe(404);
    const { res } = await call(handlers, "DELETE", "/api/users/7/archive");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("PUT, PATCH");

    expect(seen[0]).toBeInstanceOf(RouteNotFoundError);
    expect(seen[0]).toBeInstanceOf(HTTPException);
    expect(seen[1]).toBeInstanceOf(MethodNotAllowedError);
    expect((seen[1] as MethodNotAllowedError).allow).toEqual(["PUT", "PATCH"]);
  });

  it("onError customiza 404/405 e o Allow é mantido", async () => {
    const handlers = createHandler({
      controllers: [Users],
      onError(err) {
        if (err instanceof RouteNotFoundError) {
          return Response.json({ message: "Route not found" }, { status: 404 });
        }
        if (err instanceof MethodNotAllowedError) {
          return Response.json({ message: "Method not allowed" }, { status: 405 });
        }
      },
    });
    expect(await call(handlers, "GET", "/api/nada")).toMatchObject({
      status: 404,
      body: { message: "Route not found" },
    });
    const { res, body } = await call(handlers, "DELETE", "/api/users/7/archive");
    expect(body).toEqual({ message: "Method not allowed" });
    expect(res.headers.get("allow")).toBe("PUT, PATCH");
  });

  it("Allow definido pelo onError não é sobrescrito", async () => {
    const handlers = createHandler({
      controllers: [Users],
      onError() {
        return new Response(null, { status: 405, headers: { Allow: "PUT" } });
      },
    });
    const { res } = await call(handlers, "DELETE", "/api/users/7/archive");
    expect(res.headers.get("allow")).toBe("PUT");
  });

  it("HEAD responde como o GET sem corpo", async () => {
    const res = await api.HEAD(request("HEAD", "/api/users/42"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe("");

    const missing = await api.HEAD(request("HEAD", "/api/nada"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("");

    const onlyPost = await api.HEAD(request("HEAD", "/api/users/7/activate"));
    expect(onlyPost.status).toBe(405);
    expect(onlyPost.headers.get("allow")).toBe("POST");
  });

  it("OPTIONS responde 204 com Allow em path existente e 404 nos demais", async () => {
    const res = await api.OPTIONS(request("OPTIONS", "/api/users/42"));
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toBe("GET, PUT, PATCH, DELETE");
    expect(await res.text()).toBe("");

    const missing = await call(api, "OPTIONS", "/api/nada");
    expect(missing).toMatchObject({ status: 404, body: { error: "Route not found" } });
  });

  it("404/405 não são logados", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createHandler({ controllers: [Users] });
    await call(handlers, "GET", "/api/nada");
    await call(handlers, "DELETE", "/api/users/7/archive");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("mapeamento de erros", () => {
  class DomainError extends Error {}

  @Controller("/fail")
  class Failing {
    @Post("/zod")
    async zod({ validate }: HttpContext) {
      return validate.body(z.object({ name: z.string() }));
    }
    @Get("/http")
    http() {
      throw new HTTPException(409, { message: "Conflito" });
    }
    @Get("/domain")
    domain() {
      throw new DomainError("boom");
    }
    @Get("/string")
    string() {
      throw "não é Error";
    }
  }
  const Fail = Failing;

  it("ZodError vira 422 com issues", async () => {
    const api = createHandler({ controllers: [Fail] });
    const { status, body } = await call(api, "POST", "/api/fail/zod", { name: 1 });
    expect(status).toBe(422);
    expect(body.error).toBe("Validation failed");
    expect(body.issues[0].path).toEqual(["name"]);
  });

  it("HTTPException usa status e mensagem", async () => {
    const api = createHandler({ controllers: [Fail] });
    expect(await call(api, "GET", "/api/fail/http")).toMatchObject({
      status: 409,
      body: { error: "Conflito" },
    });
  });

  it("outros erros viram 500 e são logados", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = createHandler({ controllers: [Fail] });
    expect(await call(api, "GET", "/api/fail/domain")).toMatchObject({
      status: 500,
      body: { error: "Internal server error" },
    });
    expect(await call(api, "GET", "/api/fail/string")).toMatchObject({ status: 500 });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("onError devolvendo Response define a resposta", async () => {
    const api = createHandler({
      controllers: [Fail],
      onError(err, req) {
        if (err instanceof DomainError) {
          return Response.json({ error: err.message, url: req.url }, { status: 400 });
        }
      },
    });
    expect(await call(api, "GET", "/api/fail/domain")).toMatchObject({
      status: 400,
      body: { error: "boom", url: "http://localhost/api/fail/domain" },
    });
  });

  it("onError devolvendo undefined segue para o mapeamento padrão sem console.error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    const api = createHandler({
      controllers: [Fail],
      async onError(err) {
        seen.push(err);
      },
    });
    expect((await call(api, "POST", "/api/fail/zod", {})).status).toBe(422);
    expect((await call(api, "GET", "/api/fail/http")).status).toBe(409);
    expect((await call(api, "GET", "/api/fail/domain")).status).toBe(500);
    expect(seen).toHaveLength(3);
    expect(log).not.toHaveBeenCalled();
  });

  it("erro dentro do onError vira 500 e loga os dois erros", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const hookError = new Error("hook");
    const api = createHandler({
      controllers: [Fail],
      onError() {
        throw hookError;
      },
    });
    expect(await call(api, "GET", "/api/fail/http")).toMatchObject({
      status: 500,
      body: { error: "Internal server error" },
    });
    expect(log).toHaveBeenCalledWith(expect.any(HTTPException), hookError);
  });

  it("erro no construtor do controller passa pelo mapeamento", async () => {
    @Controller("/broken")
    class Broken {
      constructor() {
        throw new HTTPException(503, { message: "Indisponível" });
      }
      @Get()
      go() {}
    }
    const api = createHandler({ controllers: [Broken] });
    expect(await call(api, "GET", "/api/broken")).toMatchObject({
      status: 503,
      body: { error: "Indisponível" },
    });
  });
});

describe("autenticação", () => {
  @Controller("/products", { resource: true })
  @Auth()
  class ProductsController {
    static instances = 0;

    constructor() {
      ProductsController.instances++;
    }

    @Public()
    index({ auth }: HttpContext) {
      return { auth: auth ?? null };
    }
    @Public()
    show({ params }: HttpContext<"/:id">) {
      return { id: params.id };
    }
    store({ auth }: HttpContext) {
      return { owner: auth.id };
    }
    @Get("/mine")
    mine({ auth }: HttpContext) {
      return { role: auth.role };
    }
  }

  @Controller("/ping")
  class PingController {
    @Get()
    ping({ auth }: HttpContext) {
      return { auth: auth ?? null };
    }
  }

  const Products = ProductsController;
  const Ping = PingController;
  const users = { "token-1": { id: "1", role: "admin" as const } };

  function handler(options: Partial<Parameters<typeof createHandler>[0]> = {}) {
    const authenticate = vi.fn(async (req: Request) => {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
      return users[token as keyof typeof users] ?? null;
    });
    const api = createHandler({ controllers: [Products, Ping], authenticate, ...options });
    return { api, authenticate };
  }

  async function send(api: ReturnType<typeof createHandler>, method: "GET" | "POST", path: string, token?: string) {
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    const res = await api[method](request(method, path, method === "POST" ? {} : undefined, headers));
    return { res, status: res.status, body: await res.json() };
  }

  it("rota protegida sem usuário vira 401 sem instanciar o controller", async () => {
    const { api } = handler();
    ProductsController.instances = 0;
    expect(await send(api, "POST", "/api/products")).toMatchObject({
      status: 401,
      body: { error: "Unauthorized" },
    });
    expect((await send(api, "GET", "/api/products/mine", "invalid")).status).toBe(401);
    expect(ProductsController.instances).toBe(0);
  });

  it("rota protegida com usuário expõe ctx.auth", async () => {
    const { api, authenticate } = handler();
    expect(await send(api, "POST", "/api/products", "token-1")).toMatchObject({
      status: 200,
      body: { owner: "1" },
    });
    expect((await send(api, "GET", "/api/products/mine", "token-1")).body).toEqual({ role: "admin" });
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(authenticate.mock.calls[0]![0]).toBeInstanceOf(Request);
  });

  it("ações @Public e controllers sem @Auth não chamam authenticate", async () => {
    const { api, authenticate } = handler();
    expect((await send(api, "GET", "/api/products", "token-1")).body).toEqual({ auth: null });
    expect((await send(api, "GET", "/api/products/7")).body).toEqual({ id: "7" });
    expect((await send(api, "GET", "/api/ping", "token-1")).body).toEqual({ auth: null });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("aceita authenticate síncrono e trata undefined como não autenticado", async () => {
    const sync = handler({ authenticate: () => users["token-1"] });
    expect((await send(sync.api, "POST", "/api/products")).body).toEqual({ owner: "1" });
    const none = handler({ authenticate: () => undefined });
    expect((await send(none.api, "POST", "/api/products")).status).toBe(401);
  });

  it("401 passa pelo onError como UnauthorizedError", async () => {
    const onError = vi.fn((err: unknown) => {
      if (err instanceof UnauthorizedError) {
        return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
      }
    });
    const { api } = handler({ onError });
    expect(await send(api, "POST", "/api/products")).toMatchObject({
      status: 401,
      body: { code: "UNAUTHORIZED" },
    });
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(UnauthorizedError);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(HTTPException);
  });

  it("erro lançado no authenticate passa pelo mapeamento", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const forbidden = handler({
      authenticate: () => {
        throw new HTTPException(403, { message: "Token revoked" });
      },
    });
    expect(await send(forbidden.api, "POST", "/api/products")).toMatchObject({
      status: 403,
      body: { error: "Token revoked" },
    });
    const broken = handler({
      authenticate: async () => {
        throw new Error("db down");
      },
    });
    expect((await send(broken.api, "POST", "/api/products")).status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("@Auth sem authenticate falha na inicialização", () => {
    expect(() => createHandler({ controllers: [Ping, Products] })).toThrow(
      "ProductsController: @Auth requires `authenticate` in createHandler",
    );
    expect(() => createHandler({ controllers: [Ping] })).not.toThrow();
  });

  describe("@Auth com guard", () => {
    function build(guard: AuthGuard, onError?: Parameters<typeof createHandler>[0]["onError"]) {
      const spy = vi.fn(guard);
      @Controller("/orders", { resource: true })
      @Auth(spy)
      class OrdersController {
        static instances = 0;

        constructor() {
          OrdersController.instances++;
        }

        @Public()
        index({ auth }: HttpContext) {
          return { auth: auth ?? null };
        }
        show({ auth }: HttpContext) {
          return { viewer: auth.id };
        }
        @Post("/:id/approve")
        @Put("/:id/approve")
        approve({ auth }: HttpContext) {
          return { approvedBy: auth.role };
        }
      }
      const { api, authenticate } = handler({
        controllers: [OrdersController],
        ...(onError ? { onError } : {}),
      });
      return { api, authenticate, spy, OrdersController };
    }

    it("true libera a rota e recebe auth e dados da rota", async () => {
      const { api, spy } = build(() => true);
      expect(await send(api, "POST", "/api/orders/9/approve", "token-1")).toMatchObject({
        status: 200,
        body: { approvedBy: "admin" },
      });
      expect(spy).toHaveBeenCalledWith(
        { id: "1", role: "admin" },
        { controller: "OrdersController", action: "approve", method: "POST", path: "/api/orders/:id/approve" },
      );
      expect(Object.isFrozen(spy.mock.calls[0]![1])).toBe(true);
    });

    it("false vira 403 sem instanciar o controller", async () => {
      const { api, OrdersController } = build((_auth, route) => route.action !== "show");
      expect(await send(api, "GET", "/api/orders/9", "token-1")).toMatchObject({
        status: 403,
        body: { error: "Forbidden" },
      });
      expect(OrdersController.instances).toBe(0);
      expect((await send(api, "POST", "/api/orders/9/approve", "token-1")).status).toBe(200);
    });

    it("aceita função assíncrona e só libera com true estrito", async () => {
      const allowed = build(async (auth) => auth.role === "admin");
      expect((await send(allowed.api, "GET", "/api/orders/1", "token-1")).body).toEqual({ viewer: "1" });
      const truthy = build((() => 1) as unknown as AuthGuard);
      expect((await send(truthy.api, "GET", "/api/orders/1", "token-1")).status).toBe(403);
      const empty = build((() => undefined) as unknown as AuthGuard);
      expect((await send(empty.api, "GET", "/api/orders/1", "token-1")).status).toBe(403);
    });

    it("sem usuário vira 401 antes de chamar o guard", async () => {
      const { api, spy } = build(() => true);
      expect((await send(api, "GET", "/api/orders/1")).status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it("ações @Public não chamam authenticate nem o guard", async () => {
      const { api, spy, authenticate } = build(() => false);
      expect((await send(api, "GET", "/api/orders", "token-1")).body).toEqual({ auth: null });
      expect(spy).not.toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("403 passa pelo onError como ForbiddenError", async () => {
      const onError = vi.fn((err: unknown) => {
        if (err instanceof ForbiddenError) {
          return Response.json({ code: "FORBIDDEN" }, { status: 403 });
        }
      });
      const { api } = build(() => false, onError);
      expect(await send(api, "GET", "/api/orders/1", "token-1")).toMatchObject({
        status: 403,
        body: { code: "FORBIDDEN" },
      });
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(HTTPException);
    });

    it("erro lançado no guard passa pelo mapeamento", async () => {
      const { api } = build(() => {
        throw new HTTPException(402, { message: "Plan required" });
      });
      expect(await send(api, "GET", "/api/orders/1", "token-1")).toMatchObject({
        status: 402,
        body: { error: "Plan required" },
      });
    });

    it("@Auth com guard sem authenticate falha na inicialização", () => {
      @Controller("/g", { resource: true })
      @Auth(() => true)
      class Guarded {
        index() {}
      }
      expect(() => createHandler({ controllers: [Guarded] })).toThrow(
        "Guarded: @Auth requires `authenticate` in createHandler",
      );
    });
  });
});

describe("classes de exceção", () => {
  it.each([
    [new BadRequestError(), 400, "Bad request", "BadRequestError"],
    [new UnauthorizedError(), 401, "Unauthorized", "UnauthorizedError"],
    [new ForbiddenError(), 403, "Forbidden", "ForbiddenError"],
    [new NotFoundError(), 404, "Not found", "NotFoundError"],
    [new ConflictError(), 409, "Conflict", "ConflictError"],
    [new NotFoundError("User not found"), 404, "User not found", "NotFoundError"],
    [new ForbiddenError("Not your order"), 403, "Not your order", "ForbiddenError"],
  ])("%s vira resposta JSON", async (error, status, message, name) => {
    @Controller("/errors")
    class Errors {
      @Get()
      go() {
        throw error;
      }
    }
    expect(error).toBeInstanceOf(HTTPException);
    expect(error.name).toBe(name);
    const api = createHandler({ controllers: [Errors] });
    expect(await call(api, "GET", "/api/errors")).toMatchObject({ status, body: { error: message } });
  });
});

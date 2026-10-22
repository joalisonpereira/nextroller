import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  HTTPException,
  MethodNotAllowedError,
  RouteNotFoundError,
  createHandler,
  defineController,
  type ControllerClass,
  type HttpContext,
} from "../src/index.js";

function request(method: string, path: string, body?: unknown, headers?: HeadersInit): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

class UsersController {
  static route = {
    prefix: "/users",
    resource: true,
    actions: {
      me: ["GET", "/me"],
      activate: ["POST", "/:id/activate"],
      archive: [["PUT", "PATCH"], "/:id/archive"],
    },
  } as const;

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
  me() {
    return { me: true };
  }
  activate({ params }: HttpContext) {
    return { activated: params.id };
  }
  archive({ request }: HttpContext) {
    return { archived: request.method };
  }
}

const Users = defineController(UsersController);

async function call(
  handlers: ReturnType<typeof createHandler>,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

  it("registra actions com um ou vários verbos", async () => {
    expect((await call(api, "POST", "/api/users/7/activate")).body).toEqual({ activated: "7" });
    expect((await call(api, "PUT", "/api/users/7/archive")).body).toEqual({ archived: "PUT" });
    expect((await call(api, "PATCH", "/api/users/7/archive")).body).toEqual({ archived: "PATCH" });
  });

  it("ordena por especificidade independente da ordem de declaração", async () => {
    class Items {
      static route = {
        prefix: "/items",
        actions: { byId: ["GET", "/:id"], latest: ["GET", "/latest"] },
      } as const;
      byId() {
        return "byId";
      }
      latest() {
        return "latest";
      }
    }
    const handlers = createHandler({ controllers: [defineController(Items)] });
    expect((await call(handlers, "GET", "/api/items/latest")).body).toBe("latest");
    expect((await call(handlers, "GET", "/api/items/9")).body).toBe("byId");
  });

  it("monta basePath + prefix + route.prefix + path", async () => {
    const handlers = createHandler({ controllers: [Users], basePath: "/", prefix: "/v1" });
    expect((await call(handlers, "GET", "/v1/users/me")).body).toEqual({ me: true });
    expect((await call(handlers, "GET", "/api/v1/users/me")).status).toBe(404);
  });

  it("actions sobrescreve resource", async () => {
    class Posts {
      static route = {
        prefix: "/posts",
        resource: true,
        actions: { show: ["GET", "/by-slug/:slug"] },
      } as const;
      show({ params }: HttpContext) {
        return params.slug;
      }
    }
    const handlers = createHandler({ controllers: [defineController(Posts)] });
    expect((await call(handlers, "GET", "/api/posts/by-slug/hello")).body).toBe("hello");
    expect((await call(handlers, "GET", "/api/posts/1")).status).toBe(404);
  });

  it("instancia o controller por request", async () => {
    const constructed = vi.fn();
    class Counter {
      static route = { prefix: "/count", actions: { hit: ["GET", "/"] } } as const;
      private hits = 0;
      constructor() {
        constructed();
      }
      hit() {
        return ++this.hits;
      }
    }
    const handlers = createHandler({ controllers: [defineController(Counter)] });
    expect((await call(handlers, "GET", "/api/count")).body).toBe(1);
    expect((await call(handlers, "GET", "/api/count")).body).toBe(1);
    expect(constructed).toHaveBeenCalledTimes(2);
  });
});

describe("erros de configuração", () => {
  it("rejeita rota duplicada entre controllers", () => {
    class Me {
      static route = { prefix: "/users", actions: { profile: ["GET", "/me"] } } as const;
      profile() {}
    }
    expect(() => createHandler({ controllers: [Users, defineController(Me)] })).toThrow(
      "duplicate route GET /api/users/me: UsersController.me and Me.profile",
    );
  });

  it("trata parâmetros com nomes diferentes como a mesma rota", () => {
    class Other {
      static route = { prefix: "/users", actions: { find: ["GET", "/:userId"] } } as const;
      find() {}
    }
    expect(() => createHandler({ controllers: [Users, defineController(Other)] })).toThrow(
      /duplicate route GET \/api\/users\/:userId: UsersController.show and Other.find/,
    );
  });

  it("rejeita controller sem rotas", () => {
    class Empty {
      static route = { prefix: "/empty", resource: true } as const;
    }
    expect(() => createHandler({ controllers: [defineController(Empty)] })).toThrow(
      "Empty: controller does not define any route",
    );
  });

  it("revalida controllers não passados pelo defineController", () => {
    const Bad = class Bad {
      static route = { prefix: "bad" };
    } as unknown as ControllerClass;
    expect(() => createHandler({ controllers: [Bad] })).toThrow("Bad: `route.prefix`");
  });

  it("rejeita basePath/prefix sem barra inicial", () => {
    expect(() => createHandler({ controllers: [Users], prefix: "v1" })).toThrow("`prefix`");
    expect(() => createHandler({ controllers: [Users], basePath: "api" })).toThrow("`basePath`");
  });
});

describe("regras de resposta", () => {
  class Responses {
    static route = {
      prefix: "/r",
      actions: {
        value: ["GET", "/value"],
        nothing: ["GET", "/nothing"],
        raw: ["GET", "/raw"],
        nil: ["GET", "/nil"],
      },
    } as const;
    value() {
      return { ok: true };
    }
    async nothing() {}
    raw() {
      return new Response("texto", { status: 418 });
    }
    nil() {
      return null;
    }
  }
  const api = createHandler({ controllers: [defineController(Responses)] });

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

  class Failing {
    static route = {
      prefix: "/fail",
      actions: {
        zod: ["POST", "/zod"],
        http: ["GET", "/http"],
        domain: ["GET", "/domain"],
        string: ["GET", "/string"],
      },
    } as const;
    async zod({ validate }: HttpContext) {
      return validate.body(z.object({ name: z.string() }));
    }
    http() {
      throw new HTTPException(409, { message: "Conflito" });
    }
    domain() {
      throw new DomainError("boom");
    }
    string() {
      throw "não é Error";
    }
  }
  const Fail = defineController(Failing);

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
    class Broken {
      static route = { prefix: "/broken", actions: { go: ["GET", "/"] } } as const;
      constructor() {
        throw new HTTPException(503, { message: "Indisponível" });
      }
      go() {}
    }
    const api = createHandler({ controllers: [defineController(Broken)] });
    expect(await call(api, "GET", "/api/broken")).toMatchObject({
      status: 503,
      body: { error: "Indisponível" },
    });
  });
});

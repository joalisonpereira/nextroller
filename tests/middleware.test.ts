import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Auth,
  Controller,
  Get,
  HTTPException,
  Public,
  Use,
  createHandler,
  type Middleware,
} from "../src/index.js";

function trace(name: string, events: string[]): Middleware {
  return async (_ctx, next) => {
    events.push(`${name}:before`);
    const res = await next();
    events.push(`${name}:after:${res.status}`);
    return res;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@Use", () => {
  function build(options: { authenticate?: () => { id: string; role: "admin" } | null } = {}) {
    const events: string[] = [];

    @Controller("/m", { resource: true })
    @Use(trace("c1", events), trace("c2", events))
    @Use(trace("c3", events))
    @Auth()
    class Traced {
      @Public()
      @Use(trace("m1", events))
      @Use(trace("m2", events))
      index() {
        events.push("action");
        return { ok: true };
      }

      store() {
        events.push("store");
      }

      @Public()
      @Get("/boom")
      boom() {
        throw new HTTPException(409, { message: "Conflict" });
      }
    }

    const api = createHandler({
      controllers: [Traced],
      authenticate: options.authenticate ?? (() => null),
    });
    return { api, events };
  }

  it("roda middlewares da classe e do método na ordem declarada", async () => {
    const { api, events } = build();
    const res = await api.GET(new Request("http://localhost/api/m"));
    expect(await res.json()).toEqual({ ok: true });
    expect(events).toEqual([
      "c1:before",
      "c2:before",
      "c3:before",
      "m1:before",
      "m2:before",
      "action",
      "m2:after:200",
      "m1:after:200",
      "c3:after:200",
      "c2:after:200",
      "c1:after:200",
    ]);
  });

  it("roda antes da auth e enxerga o 401", async () => {
    const { api, events } = build();
    const res = await api.POST(new Request("http://localhost/api/m", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(events).toEqual([
      "c1:before",
      "c2:before",
      "c3:before",
      "c3:after:401",
      "c2:after:401",
      "c1:after:401",
    ]);
  });

  it("next() devolve a resposta já mapeada quando a ação lança", async () => {
    const { api, events } = build();
    const res = await api.GET(new Request("http://localhost/api/m/boom"));
    expect(res.status).toBe(409);
    expect(events).toContain("c1:after:409");
  });

  it("middleware pode encerrar sem chamar next e alterar a resposta", async () => {
    const action = vi.fn();
    const block: Middleware = () => Response.json({ blocked: true }, { status: 429 });
    const header: Middleware = async (_ctx, next) => {
      const res = await next();
      res.headers.set("x-powered-by", "nextroller");
      return res;
    };

    @Controller("/b")
    @Use(header)
    class Blocked {
      @Get()
      @Use(block)
      go() {
        action();
      }
    }

    const api = createHandler({ controllers: [Blocked] });
    const res = await api.GET(new Request("http://localhost/api/b"));
    expect(res.status).toBe(429);
    expect(res.headers.get("x-powered-by")).toBe("nextroller");
    expect(action).not.toHaveBeenCalled();
  });

  it("enxerga ctx.auth depois de next()", async () => {
    let seen: unknown = "unset";
    const peek: Middleware = async (ctx, next) => {
      const before = ctx.auth;
      const res = await next();
      seen = { before, after: ctx.auth };
      return res;
    };

    @Controller("/p")
    @Use(peek)
    @Auth()
    class Peek {
      @Get()
      go() {}
    }

    const user = { id: "1", role: "admin" as const };
    const api = createHandler({ controllers: [Peek], authenticate: () => user });
    expect((await api.GET(new Request("http://localhost/api/p"))).status).toBe(204);
    expect(seen).toEqual({ before: undefined, after: user });
  });

  it("erro no middleware passa pelo onError e mapeamento", async () => {
    const failing: Middleware = () => {
      throw new HTTPException(503, { message: "Maintenance" });
    };
    const onError = vi.fn();

    @Controller("/f")
    @Use(failing)
    class Failing {
      @Get()
      go() {}
    }

    const api = createHandler({ controllers: [Failing], onError });
    const res = await api.GET(new Request("http://localhost/api/f"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Maintenance" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("rejeita next() repetido e retorno que não é Response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const twice: Middleware = async (_ctx, next) => {
      await next();
      return next();
    };
    const nothing = (() => undefined) as unknown as Middleware;

    @Controller("/x")
    class Broken {
      @Get("/twice")
      @Use(twice)
      a() {}

      @Get("/nothing")
      @Use(nothing)
      b() {}
    }

    const api = createHandler({ controllers: [Broken] });
    expect((await api.GET(new Request("http://localhost/api/x/twice"))).status).toBe(500);
    expect((await api.GET(new Request("http://localhost/api/x/nothing"))).status).toBe(500);
    expect(log.mock.calls.map(([err]) => (err as Error).message)).toEqual([
      "[nextroller] middleware called next() more than once",
      "[nextroller] middleware must return a Response",
    ]);
  });

  it("não roda em 404/405", async () => {
    const { api, events } = build();
    expect((await api.GET(new Request("http://localhost/api/nada"))).status).toBe(404);
    expect((await api.PUT(new Request("http://localhost/api/m", { method: "PUT" }))).status).toBe(405);
    expect(events).toEqual([]);
  });
});

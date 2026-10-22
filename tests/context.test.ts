import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Controller, Get, Post, createHandler, type HttpContext } from "../src/index.js";

type Probe = (ctx: HttpContext) => unknown;

function handlerFor(probe: Probe, method: "GET" | "POST" = "GET", path: `/${string}` = "/") {
  const verb = method === "GET" ? Get : Post;
  @Controller("/probe")
  class Probes {
    @verb(path)
    run(ctx: HttpContext) {
      return probe(ctx);
    }
  }
  return createHandler({ controllers: [Probes] });
}

async function run(probe: Probe, init: RequestInit & { url?: string; path?: `/${string}` } = {}) {
  const method = (init.method ?? "GET") as "GET" | "POST";
  const handlers = handlerFor(probe, method, init.path);
  return handlers[method](new Request(`http://localhost/api/probe${init.url ?? ""}`, init));
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe("HttpContext", () => {
  it("expõe params, query, headers e request", async () => {
    const res = await run(
      ({ params, query, headers, request, raw }) => ({
        params,
        query,
        auth: headers.authorization,
        method: request.method,
        hasRaw: typeof raw.req.param === "function",
      }),
      { url: "/9?page=2&tag=a&tag=b", path: "/:id", headers: { Authorization: "Bearer x" } },
    );
    expect(await res.json()).toEqual({
      params: { id: "9" },
      query: { page: "2", tag: "a" },
      auth: "Bearer x",
      method: "GET",
      hasRaw: true,
    });
  });

  it("validate.body faz parse do JSON", async () => {
    const res = await run(({ validate }) => validate.body(z.object({ n: z.number() })), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 1, extra: true }),
    });
    expect(await json(res)).toEqual({ status: 200, body: { n: 1 } });
  });

  it("validate.body com corpo inválido ou ausente vira {} → 422", async () => {
    const schema = z.object({ n: z.number() });
    const invalid = await run(({ validate }) => validate.body(schema), { method: "POST", body: "{" });
    expect(invalid.status).toBe(422);
    const missing = await run(({ validate }) => validate.body(schema), { method: "POST" });
    expect(missing.status).toBe(422);
    const optional = await run(({ validate }) => validate.body(z.object({ n: z.number().optional() })), {
      method: "POST",
    });
    expect(await json(optional)).toEqual({ status: 200, body: {} });
  });

  it("validate.body aceita application/x-www-form-urlencoded", async () => {
    const res = await run(
      ({ validate }) =>
        validate.body(z.object({ name: z.string(), age: z.coerce.number(), tag: z.array(z.string()) })),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "name=ana&age=30&tag=a&tag=b",
      },
    );
    expect(await json(res)).toEqual({ status: 200, body: { name: "ana", age: 30, tag: ["a", "b"] } });
  });

  it("validate.body com form-urlencoded vazio vira {} → 422", async () => {
    const res = await run(({ validate }) => validate.body(z.object({ name: z.string() })), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(422);
  });

  it("validate.body pode ser chamado mais de uma vez", async () => {
    const res = await run(
      async ({ validate }) => {
        const a = await validate.body(z.object({ a: z.number() }));
        const b = await validate.body(z.object({ b: z.number() }));
        return { ...a, ...b };
      },
      { method: "POST", body: JSON.stringify({ a: 1, b: 2 }) },
    );
    expect(await res.json()).toEqual({ a: 1, b: 2 });
  });

  it("validate.query entrega array para chave repetida e aceita coerce", async () => {
    const schema = z.object({ page: z.coerce.number(), tag: z.array(z.string()) });
    const res = await run(({ validate }) => validate.query(schema), { url: "?page=3&tag=a&tag=b" });
    expect(await res.json()).toEqual({ page: 3, tag: ["a", "b"] });
  });

  it("validate.query falha com 422", async () => {
    const res = await run(({ validate }) => validate.query(z.object({ page: z.coerce.number().min(1) })), {
      url: "?page=0",
    });
    expect(res.status).toBe(422);
  });

  it("validate.params e validate.headers", async () => {
    const res = await run(
      ({ validate }) => ({
        ...validate.params(z.object({ id: z.coerce.number() })),
        ...validate.headers(z.object({ "x-tenant": z.string() })),
      }),
      { url: "/5", path: "/:id", headers: { "X-Tenant": "acme" } },
    );
    expect(await res.json()).toEqual({ id: 5, "x-tenant": "acme" });
  });
});

describe("response helpers", () => {
  it("ok/created/noContent", async () => {
    const ok = await run(({ response }) => response.ok({ a: 1 }, { headers: { "X-A": "1" } }));
    expect(await json(ok)).toEqual({ status: 200, body: { a: 1 } });
    expect(ok.headers.get("x-a")).toBe("1");

    expect(await json(await run(({ response }) => response.created({ id: 1 })))).toEqual({
      status: 201,
      body: { id: 1 },
    });

    const noContent = await run(({ response }) => response.noContent());
    expect(noContent.status).toBe(204);
    expect(await noContent.text()).toBe("");
  });

  it("helpers de erro com mensagem padrão e customizada", async () => {
    expect(await json(await run(({ response }) => response.badRequest()))).toEqual({
      status: 400,
      body: { error: "Bad request" },
    });
    expect(await json(await run(({ response }) => response.forbidden()))).toEqual({
      status: 403,
      body: { error: "Forbidden" },
    });
    expect(await json(await run(({ response }) => response.notFound()))).toEqual({
      status: 404,
      body: { error: "Not found" },
    });
    expect(await json(await run(({ response }) => response.notFound("Usuário não encontrado")))).toEqual({
      status: 404,
      body: { error: "Usuário não encontrado" },
    });
  });

  it("aceita vários cookies via Headers", async () => {
    const res = await run(({ response }) => {
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1");
      headers.append("Set-Cookie", "b=2");
      return response.ok(null, { headers });
    });
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("redirect com status padrão e customizado", async () => {
    const temp = await run(({ response }) => response.redirect("/login"));
    expect(temp.status).toBe(302);
    expect(temp.headers.get("location")).toBe("/login");

    const perm = await run(({ response }) => response.redirect("https://example.com", 308));
    expect(perm.status).toBe(308);
    expect(perm.headers.get("location")).toBe("https://example.com");
  });

  it("redirect rejeita status inválido", async () => {
    const res = await run(({ response }) => response.redirect("/x", 200 as 302));
    expect(res.status).toBe(500);
  });

  it("status com e sem corpo", async () => {
    expect(await json(await run(({ response }) => response.status(202, { queued: true })))).toEqual({
      status: 202,
      body: { queued: true },
    });
    const empty = await run(({ response }) => response.status(205));
    expect(empty.status).toBe(205);
    expect(await empty.text()).toBe("");
  });
});

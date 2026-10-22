import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Auth,
  Body,
  Controller,
  Ctx,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  createHandler,
  type HttpContext,
} from "../src/index.js";

const user = { id: "1", role: "admin" as const };

@Controller("/items/:listId")
@Auth()
class Items {
  @Get("/:id")
  show(@Param("listId") listId: string, @Param("id") id: string, @Param() params: Record<string, string>) {
    return { listId, id, params };
  }

  @Get("/")
  search(
    @Query("q") q: string | undefined,
    @Query() query: Record<string, string>,
    @Query(z.object({ page: z.coerce.number().default(1), tag: z.array(z.string()).optional() }))
    parsed: { page: number; tag?: string[] },
  ) {
    return { q, query, parsed };
  }

  @Post("/")
  create(@Body() raw: unknown, @Body(z.object({ name: z.string() })) body: { name: string }) {
    return { raw, body };
  }

  @Get("/meta/headers")
  headers(
    @Header("X-Trace") trace: string | undefined,
    @Header() all: Record<string, string>,
    @Header(z.object({ "x-trace": z.string() })) parsed: { "x-trace": string },
  ) {
    return { trace, hasAll: typeof all === "object", parsed };
  }

  @Get("/meta/request")
  request(@Req() request: Request, @Ctx() ctx: HttpContext, @Auth() auth: typeof user) {
    return { url: request.url, same: ctx.request === request, auth, ctxAuth: ctx.auth };
  }

  @Get("/meta/params")
  validated(@Param(z.object({ listId: z.coerce.number() })) params: { listId: number }) {
    return params;
  }
}

const api = createHandler({ controllers: [Items], authenticate: () => user });

async function call(method: "GET" | "POST", path: string, init: RequestInit = {}) {
  const res = await api[method](new Request(`http://localhost/api/items${path}`, { method, ...init }));
  return { status: res.status, body: await res.json() };
}

describe("parameter decorators", () => {
  it("@Param injeta uma chave ou todos os params, incluindo os do prefix", async () => {
    expect((await call("GET", "/7/42")).body).toEqual({
      listId: "7",
      id: "42",
      params: { listId: "7", id: "42" },
    });
  });

  it("@Param(schema) valida params", async () => {
    expect((await call("GET", "/7/meta/params")).body).toEqual({ listId: 7 });
    expect((await call("GET", "/x/meta/params")).status).toBe(422);
  });

  it("@Query injeta chave, objeto ou valor validado", async () => {
    expect((await call("GET", "/7?q=abc&page=2&tag=a&tag=b")).body).toEqual({
      q: "abc",
      query: { q: "abc", page: "2", tag: "a" },
      parsed: { page: 2, tag: ["a", "b"] },
    });
    expect((await call("GET", "/7?page=0x")).status).toBe(422);
  });

  it("@Body injeta corpo bruto ou validado", async () => {
    const json = { headers: { "content-type": "application/json" } };
    expect(
      (await call("POST", "/7", { ...json, body: JSON.stringify({ name: "a", extra: 1 }) })).body,
    ).toEqual({ raw: { name: "a", extra: 1 }, body: { name: "a" } });
    expect(await call("POST", "/7", { ...json, body: JSON.stringify({ name: 1 }) })).toMatchObject({
      status: 422,
      body: { error: "Validation failed" },
    });
  });

  it("@Body aceita application/x-www-form-urlencoded", async () => {
    const { body } = await call("POST", "/7", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=ana&tag=a&tag=b",
    });
    expect(body).toEqual({ raw: { name: "ana", tag: ["a", "b"] }, body: { name: "ana" } });
  });

  it("@Header normaliza a chave para minúsculo", async () => {
    expect((await call("GET", "/7/meta/headers", { headers: { "x-trace": "t1" } })).body).toEqual({
      trace: "t1",
      hasAll: true,
      parsed: { "x-trace": "t1" },
    });
    expect((await call("GET", "/7/meta/headers")).status).toBe(422);
  });

  it("@Req, @Ctx e @Auth injetam request, contexto e usuário", async () => {
    expect((await call("GET", "/7/meta/request")).body).toEqual({
      url: "http://localhost/api/items/7/meta/request",
      same: true,
      auth: user,
      ctxAuth: user,
    });
  });
});

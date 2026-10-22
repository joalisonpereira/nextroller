import type { Context } from "hono";
import type { z } from "zod";

interface ResponseOptions {
  headers?: HeadersInit;
}

type RedirectStatus = 301 | 302 | 303 | 307 | 308;

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

function json(data: unknown, status: number, init?: ResponseOptions): Response {
  return Response.json(data, { status, headers: init?.headers });
}

function empty(status: number, init?: ResponseOptions): Response {
  return new Response(null, { status, headers: init?.headers });
}

function queryValues(c: Context): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, list] of Object.entries(c.req.queries())) {
    values[key] = list.length === 1 ? list[0]! : list;
  }
  return values;
}

export function createContext(c: Context) {
  const params = c.req.param() as Record<string, string>;
  const query = c.req.query();
  const headers = c.req.header();

  return {
    request: c.req.raw,
    raw: c,
    params,
    query,
    headers,
    validate: {
      async body<S extends z.ZodType>(schema: S): Promise<z.infer<S>> {
        const data: unknown = await c.req.json().catch(() => ({}));
        return schema.parse(data ?? {}) as z.infer<S>;
      },
      query<S extends z.ZodType>(schema: S): z.infer<S> {
        return schema.parse(queryValues(c)) as z.infer<S>;
      },
      params<S extends z.ZodType>(schema: S): z.infer<S> {
        return schema.parse(params) as z.infer<S>;
      },
      headers<S extends z.ZodType>(schema: S): z.infer<S> {
        return schema.parse(headers) as z.infer<S>;
      },
    },
    response: {
      ok(data: unknown, init?: ResponseOptions): Response {
        return json(data, 200, init);
      },
      created(data: unknown, init?: ResponseOptions): Response {
        return json(data, 201, init);
      },
      noContent(init?: ResponseOptions): Response {
        return empty(204, init);
      },
      badRequest(message = "Bad request", init?: ResponseOptions): Response {
        return json({ error: message }, 400, init);
      },
      forbidden(message = "Forbidden", init?: ResponseOptions): Response {
        return json({ error: message }, 403, init);
      },
      notFound(message = "Not found", init?: ResponseOptions): Response {
        return json({ error: message }, 404, init);
      },
      redirect(url: string, status: RedirectStatus = 302): Response {
        if (!REDIRECT_STATUSES.includes(status)) {
          throw new Error(`[nextroller] invalid redirect status: ${status}`);
        }
        return new Response(null, { status, headers: { Location: url } });
      },
      status(code: number, data?: unknown, init?: ResponseOptions): Response {
        return data === undefined ? empty(code, init) : json(data, code, init);
      },
    },
  };
}

export type HttpContext = ReturnType<typeof createContext>;

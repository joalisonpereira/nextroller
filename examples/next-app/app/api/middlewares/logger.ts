import type { HttpContext, Middleware } from "nextroller";

export class LoggerMiddleware implements Middleware {
  async run({ request }: HttpContext, next: () => Promise<Response>) {
    const start = Date.now();
    const res = await next();
    console.log(
      `${request.method} ${new URL(request.url).pathname} ${res.status} ${Date.now() - start}ms`,
    );
    return res;
  }
}

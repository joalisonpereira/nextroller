import type { Middleware } from "nextroller";

export const logRequest: Middleware = async ({ request }, next) => {
  const start = Date.now();
  const res = await next();
  console.log(`${request.method} ${new URL(request.url).pathname} ${res.status} ${Date.now() - start}ms`);
  return res;
};

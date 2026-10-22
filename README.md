# nextroller

Decorator-based controllers for the **Next.js App Router** route handler.

A single `app/api/[[...path]]/route.ts` receives every API request and dispatches it to methods of controller classes. Routes are declared on the controller itself (`@Controller`, `@Get`, `@Post`, ...): there is no central routes file.

```ts
@Controller("/users", { resource: true })
@Auth()
export default class UsersController {
  constructor(private service = new UsersService()) {}

  async show(@Param("id") id: string) {
    return this.service.find(id);
  }

  @Public()
  async store(@Body(validator.create) data: Validated["create"], @Ctx() { response }: HttpContext) {
    return response.created(await this.service.create(data));
  }
}
```

Built on [Hono](https://hono.dev) (internal routing) and [Zod](https://zod.dev) (validation).

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [App structure](#app-structure)
- [Controllers and routes](#controllers-and-routes)
- [Reading the request](#reading-the-request)
- [Validation](#validation)
- [Responses](#responses)
- [Errors](#errors)
- [Authentication](#authentication)
- [Middlewares](#middlewares)
- [`createHandler`](#createhandler)
- [CLI](#cli)
- [Configuration errors](#configuration-errors)
- [Notes](#notes)

## Features

|                                 |                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 🧭 **Routes in the controller** | `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` and automatic CRUD with `resource: true`  |
| 📥 **Two action styles**        | parameter decorators (`@Body`, `@Query`, `@Param`, ...) or plain `HttpContext`, no decorators         |
| ✅ **Zod validation**           | `@Body(schema)` or `validate.body(schema)`; `ZodError` becomes `422` automatically                    |
| 🔐 **Declarative auth**         | `@Auth()` / `@Auth(guard)` on the class, `@Public()` on the action; verification delegated to the app |
| 🧩 **Middlewares**              | global and per controller/action (`@Use`), following the `run(ctx, next)` pattern                     |
| 🚨 **HTTP exceptions**          | `NotFoundError`, `ForbiddenError`, ... with central handling through `onError`                        |
| 🛣️ **JSON 404/405**             | with the `Allow` header, plus `HEAD` and `OPTIONS` support                                            |
| ⚙️ **CLI**                      | `make:module`, `make:middleware` and `routes`                                                         |
| 🛑 **Fail fast**                | configuration errors break at import or in `createHandler`, never during a request                    |

## Installation

```bash
npm install nextroller zod
```

`next` (v15 or v16) and `zod` (v3.25+ or v4) are peer dependencies. The library uses TypeScript **legacy decorators**, so enable them in your app's `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true,
  },
}
```

Next.js (SWC/Turbopack) and Vitest read this flag from the tsconfig with no extra plugin. Neither `reflect-metadata` nor `emitDecoratorMetadata` is needed.

## Quick start

**1. Generate a module**

```bash
npx nextroller make:module users
```

**2. Create the catch-all** at `app/api/[[...path]]/route.ts`:

```ts
import { createHandler } from "nextroller";
import UsersController from "@/app/api/modules/users/controller";

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHandler({
  controllers: [UsersController],
});
```

**3. Done.** `GET /api/users`, `POST /api/users`, `GET /api/users/:id`, ... are live.

## App structure

The whole API lives in `app/api/`:

```
app/
  api/
    [[...path]]/
      route.ts            # the only route handler; calls createHandler
    middlewares/          # optional: shared middlewares
      logger.ts
    modules/
      users/
        controller.ts     # export default class with @Controller
        service.ts        # business logic
        validator.ts      # Zod schemas
```

| rule                 | detail                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| Module name          | plural, `snake_case` (`users`, `order_items`)                                   |
| File names           | always `controller.ts`, `service.ts`, `validator.ts` (the folder is the module) |
| Class names          | carry the module: `UsersController`, `UsersService`                             |
| Imports              | relative inside the module; `@/app/api/modules/...` outside it                  |
| Reuse across modules | through services, never by importing another module's controller                |
| `route.ts`           | never inside `modules/` or `middlewares/`                                       |

## Controllers and routes

### Class decorators

| decorator                       | usage                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| `@Controller(prefix, options?)` | required. `prefix` starts with `/`. `{ resource: true }` generates the CRUD |
| `@Auth()` / `@Auth(guard)`      | every action requires a user (see [Authentication](#authentication))        |
| `@Use(...middlewares)`          | controller middlewares (see [Middlewares](#middlewares))                    |

The order of class decorators doesn't matter.

### Method decorators

| decorator                                                                       | usage                                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@Get(path?)`, `@Post(path?)`, `@Put(path?)`, `@Patch(path?)`, `@Delete(path?)` | registers the route. `path` is relative to the `prefix` (default `/`) |
| `@Public()`                                                                     | opens an action of a controller that has `@Auth`                      |
| `@Use(...middlewares)`                                                          | middlewares for this action only                                      |

```ts
@Controller("/users")
export default class UsersController {
  @Get("/me")
  me() {}

  @Post("/:id/activate")
  activate() {}

  @Put("/:id/archive")
  @Patch("/:id/archive")
  archive() {}
}
```

Multiple verbs on the same method: stack the decorators.

### Resource

With `@Controller("/users", { resource: true })`, the methods below become routes **if they exist** on the controller:

| method    | verb           | path         |
| --------- | -------------- | ------------ |
| `index`   | `GET`          | `/users`     |
| `store`   | `POST`         | `/users`     |
| `show`    | `GET`          | `/users/:id` |
| `update`  | `PUT`, `PATCH` | `/users/:id` |
| `destroy` | `DELETE`       | `/users/:id` |

A verb decorator on a resource method **replaces** the generated route. Methods without a verb decorator (and outside the resource set) are ignored: use them as helpers.

### Route assembly

```
basePath   +  prefix  +  @Controller  +  action path
"/api"        "/v1"      "/users"        "/:id"         →  /api/v1/users/:id
```

- Routes are **sorted by specificity**: `/users/me` is registered before `/users/:id`, regardless of the order in the code.
- A duplicate route (same verb + path, in the same or another controller) is a startup error that names both methods.
- Paths follow Hono's syntax: `/:id`, `/:id?`, `/:id{[0-9]+}`.

### Dependency injection

Controllers are instantiated **per request**. DI is a default constructor parameter; in tests, pass a fake:

```ts
export default class UsersController {
  constructor(private service = new UsersService()) {}
}

new UsersController(fakeService);
```

Load heavy dependencies with `import()` inside the method, not at the top of the file, to protect cold starts.

## Reading the request

Each action can read the request in two ways. Both are equivalent and can be mixed in the same controller (one style per method):

| style                                         | how it works                                                         | when to use                              |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| [Parameter decorators](#parameter-decorators) | each parameter declares what it receives (`@Param("id") id: string`) | explicit signature, easy-to-test actions |
| [Plain `HttpContext`](#httpcontext)           | no decorators; the method receives the context and destructures it   | less ceremony, everything in one object  |

```ts
async show(@Param("id") id: string) {}

async show({ params }: HttpContext<"/:id">) {}
```

### Parameter decorators

| decorator                                        | injects                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| `@Body()`                                        | raw body (JSON or form-urlencoded)                       |
| `@Body(schema)`                                  | validated body (`validate.body(schema)`)                 |
| `@Query()` / `@Query("k")` / `@Query(schema)`    | whole query / key `k` / validated query                  |
| `@Param()` / `@Param("k")` / `@Param(schema)`    | all params / param `k` / validated params                |
| `@Header()` / `@Header("k")` / `@Header(schema)` | all headers / header `k` (lowercase) / validated headers |
| `@Req()`                                         | the `NextRequest`                                        |
| `@Ctx()`                                         | the whole `HttpContext`                                  |
| `@Auth()`                                        | user resolved by `authenticate`                          |

```ts
@Get("/:id/orders")
async orders(
  @Param("id") id: string,
  @Query(validator.list) { page }: Validated["list"],
  @Auth() auth: User,
) {
  return this.service.orders(auth, id, page);
}
```

Rules:

- If one parameter has a decorator, **all** of them must. To get the context as well, use `@Ctx()`.
- One decorator per parameter.
- `@Param("k")` with `k` missing from the full path is a `createHandler` error (params from the controller `prefix` count).
- `@Auth()` on an unprotected action (`@Public` or a controller without `@Auth`) is a `createHandler` error.

### `HttpContext`

Parameter decorators are optional. A method **without** parameter decorators receives the `HttpContext` as its first argument. It's a plain object, so it can be destructured:

```ts
async show({ params, response }: HttpContext<"/:id">) {
  const item = await this.service.find(params.id);
  return item ?? response.notFound();
}

async store({ auth, validate, response }: HttpContext) {
  const data = await validate.body(validator.create);
  return response.created(await this.service.create(auth.id, data));
}
```

Context fields:

| field      | content                                                               |
| ---------- | --------------------------------------------------------------------- |
| `request`  | `NextRequest` (`nextUrl`, `cookies`, ...)                             |
| `auth`     | value returned by `authenticate` (`undefined` on routes without auth) |
| `params`   | path params                                                           |
| `query`    | query string (a repeated key becomes `string[]`)                      |
| `headers`  | headers, lowercase keys                                               |
| `validate` | `body`, `query`, `params`, `headers` (see [Validation](#validation))  |
| `response` | response helpers (see [Responses](#responses))                        |
| `raw`      | Hono `Context` (escape hatch)                                         |

**Typed params:** `HttpContext<"/:id/activate">` types `params` as `{ id: string }`. Without the generic, `params` is `Record<string, string>`. `"/:id?"` becomes `{ id?: string }`.

> ⚠️ The body is a read-once stream. Always read it through `@Body()` / `validate.body()`. Calling `request.json()` directly consumes the stream and breaks any later read.

## Validation

The `validator.ts` pattern for each module:

```ts
import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const validator = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().min(1).default(1) }),
};

export type Validated = InferValidator<typeof validator>;
```

`Validated["create"]` is the schema's output type. A new schema in `validator` gets its type without editing anything else.

Two ways to validate:

```ts
async store(@Body(validator.create) data: Validated["create"]) {}

async store({ validate }: HttpContext) {
  const data = await validate.body(validator.create);
}
```

| method                     | source                                           | sync?          |
| -------------------------- | ------------------------------------------------ | -------------- |
| `validate.body(schema)`    | JSON or `application/x-www-form-urlencoded` body | no (`Promise`) |
| `validate.query(schema)`   | query string                                     | yes            |
| `validate.params(schema)`  | path params                                      | yes            |
| `validate.headers(schema)` | headers (lowercase keys)                         | yes            |

- A validation failure throws `ZodError`, which becomes **`422`** in the central handler. No `try/catch` in the controller.
- Query, params, headers and form-urlencoded values arrive as strings: use `z.coerce` for numbers/booleans.
- An invalid or missing body becomes `{}` before parsing (Zod reports the 422).
- `@Body(schema)` doesn't bind the parameter type (a legacy decorator limitation): annotate it with `Validated["..."]`.

## Responses

The method's return value defines the response:

| return         | response      |
| -------------- | ------------- |
| object / value | `200` JSON    |
| `undefined`    | `204` no body |
| `Response`     | sent as is    |

Helpers on `ctx.response` (or via `@Ctx()`):

| helper                        | status                                     |
| ----------------------------- | ------------------------------------------ |
| `ok(data, init?)`             | `200` JSON                                 |
| `created(data, init?)`        | `201` JSON                                 |
| `noContent(init?)`            | `204`                                      |
| `badRequest(message?, init?)` | `400` `{ error }`                          |
| `forbidden(message?, init?)`  | `403` `{ error }`                          |
| `notFound(message?, init?)`   | `404` `{ error }`                          |
| `redirect(url, status?)`      | `302` (accepts `301`, `303`, `307`, `308`) |
| `status(code, data?, init?)`  | any status                                 |

`init` is `{ headers?: HeadersInit }`.

Helpers **return** a `NextResponse` (`return response.forbidden()`), so `response.ok(data).cookies.set(...)` works. To stop from anywhere, including a service, **throw** an exception.

## Errors

### Exception classes

All extend `HTTPException` (re-exported by the library), accept `message?` and become `{ error: message }`:

| class                   | status | default message      |
| ----------------------- | ------ | -------------------- |
| `BadRequestError`       | `400`  | `Bad request`        |
| `UnauthorizedError`     | `401`  | `Unauthorized`       |
| `ForbiddenError`        | `403`  | `Forbidden`          |
| `NotFoundError`         | `404`  | `Not found`          |
| `ConflictError`         | `409`  | `Conflict`           |
| `RouteNotFoundError`    | `404`  | `Route not found`    |
| `MethodNotAllowedError` | `405`  | `Method not allowed` |

```ts
throw new NotFoundError("User not found");
throw new HTTPException(423, { message: "Locked" });
```

### Default mapping

| error           | status       | body                                                   |
| --------------- | ------------ | ------------------------------------------------------ |
| `ZodError`      | `422`        | `{ error: "Validation failed", issues }`               |
| `HTTPException` | `err.status` | `{ error: err.message }`                               |
| anything else   | `500`        | `{ error: "Internal server error" }` + `console.error` |

### `onError`

Hook called before the default mapping. Returns a `Response` → that's the final response. Returns `undefined` → the default mapping applies.

```ts
createHandler({
  controllers: [UsersController],
  onError(err, request) {
    if (!(err instanceof HTTPException)) {
      Sentry.captureException(err, { extra: { url: request.url } });
    }
    if (err instanceof OrderLockedError) {
      return Response.json({ error: err.message }, { status: 423 });
    }
  },
});
```

- With `onError`, logging 500s is up to you (the default `console.error` is skipped).
- An error thrown inside `onError` becomes a 500 + `console.error` with both errors.

### Automatic responses

| situation                      | status                            | body                              | header                   |
| ------------------------------ | --------------------------------- | --------------------------------- | ------------------------ |
| no path matches                | `404`                             | `{ error: "Route not found" }`    |                          |
| path matches, verb doesn't     | `405`                             | `{ error: "Method not allowed" }` | `Allow: GET, PUT, PATCH` |
| `OPTIONS` on a registered path | `204`                             |                                   | `Allow`                  |
| `HEAD`                         | same as the path's `GET`, no body |                                   |                          |

404 and 405 go through `onError` (customize with `err instanceof RouteNotFoundError`) and through global middlewares only.

## Authentication

The library **doesn't** read tokens, cookies or sessions. The controller declares who needs a user; the app says how to resolve one.

```ts
@Controller("/products", { resource: true })
@Auth()
export default class ProductsController {
  @Public()
  async index() {}

  async store(@Auth() auth: User, @Body(validator.create) data: Validated["create"]) {}
}
```

```ts
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHandler({
  controllers: [ProductsController],
  authenticate: async (request) => verifyToken(request.headers.get("authorization")),
});
```

### Flow on a protected route

| step                                           | result                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| 1. `authenticate(request)`                     | runs before the controller is instantiated (sync or async) |
| 2. returned `null` / `undefined`               | `401` `{ error: "Unauthorized" }`                          |
| 3. `@Auth(guard)` returned anything but `true` | `403` `{ error: "Forbidden" }`                             |
| 4. allowed                                     | value becomes `ctx.auth` and the `@Auth()` parameter       |

`@Public` actions and controllers without `@Auth` never call `authenticate`.

### Guard

Per-controller rule, based on the user and the route:

```ts
@Controller("/orders", { resource: true })
@Auth((auth, route) => route.method === "GET" || auth.role === "admin")
export default class OrdersController {}
```

| `route.`     | example                        |
| ------------ | ------------------------------ |
| `controller` | `"OrdersController"`           |
| `action`     | `"approve"`                    |
| `method`     | `"POST"`                       |
| `path`       | `"/api/v1/orders/:id/approve"` |

- Only strict `true` allows access (fail-closed): a missing `return` denies it.
- For a custom message/status, throw `ForbiddenError("...")` inside the guard.
- Shared guard: `const isAdmin: AuthGuard = (auth) => auth.role === "admin"`.
- Rules that depend on the resource (ownership, database data) belong in the service, throwing `ForbiddenError`.

### Typing `ctx.auth`

Through declaration merging (without it, `auth` is `unknown`):

```ts
declare module "nextroller" {
  interface Register {
    auth: User;
  }
}
```

With `Register`, the return of `authenticate` and the guard's `auth` parameter are type-checked too.

## Middlewares

A class with `run(ctx, next)`:

```ts
import type { HttpContext, Middleware } from "nextroller";

export class LoggerMiddleware implements Middleware {
  async run({ request }: HttpContext, next: () => Promise<Response>) {
    const start = Date.now();
    const res = await next();
    console.log(`${request.method} ${new URL(request.url).pathname} ${res.status} ${Date.now() - start}ms`);
    return res;
  }
}
```

| form                                        | behavior                             |
| ------------------------------------------- | ------------------------------------ |
| `@Use(LoggerMiddleware)`                    | class: instantiated on every request |
| `@Use(new CorsMiddleware({ origin: "*" }))` | instance: reused across requests     |

| level      | where                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| global     | `createHandler({ middlewares: [...] })` (also runs on 404/405/OPTIONS) |
| controller | `@Use(...)` on the class                                               |
| action     | `@Use(...)` on the method                                              |

**Execution order:** global → controller `@Use` → action `@Use` → auth (`authenticate` + guard) → controller instance → action. Within each level, declaration order.

- They run **before** auth: logging and CORS see 401/403. `ctx.auth` is filled in after `next()`.
- `next()` returns the final `Response`, already mapped by `onError`.
- Stop without calling `next()` by returning a `Response` (e.g. a CORS preflight), or change the returned response.
- Bare functions `(ctx, next) => ...` aren't accepted. Calling `next()` twice or not returning a `Response` → 500.

## `createHandler`

| option         | type                                     | default  | description                             |
| -------------- | ---------------------------------------- | -------- | --------------------------------------- |
| `controllers`  | `Class[]`                                |          | classes with `@Controller`              |
| `basePath`     | `string`                                 | `"/api"` | where the catch-all is mounted          |
| `prefix`       | `string`                                 |          | global prefix, e.g. `"/v1"`             |
| `authenticate` | `(request: NextRequest) => user \| null` |          | required if any controller uses `@Auth` |
| `middlewares`  | `MiddlewareEntry[]`                      |          | global middlewares                      |
| `onError`      | `(err, request) => Response \| void`     |          | error hook                              |

Returns `{ GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS }` to export from `route.ts`.

## CLI

```bash
npx nextroller make:module <name>
npx nextroller make:middleware <name>
npx nextroller routes
```

### `make:module`

```bash
npx nextroller make:module order_items
```

```
✔ Module order_items created

  CREATE  app/api/modules/order_items/controller.ts
  CREATE  app/api/modules/order_items/service.ts
  CREATE  app/api/modules/order_items/validator.ts

Next step: register the controller in app/api/[[...path]]/route.ts

    import OrderItemsController from "@/app/api/modules/order_items/controller";

    controllers: [..., OrderItemsController]
```

- Accepts `snake_case`, `kebab-case`, `camelCase` or `PascalCase` (`orderItems` → `order_items`). Doesn't pluralize.
- Generates `OrderItemsController` with `@Controller("/order-items", { resource: true })` and the 5 CRUD methods, `OrderItemsService`, and the `validator` with `create`, `update` and `list`.
- Looks for `app/` or `src/app/`. Never overwrites an existing module and never edits `route.ts`.
- Warns if `tsconfig.json` doesn't have `experimentalDecorators: true`.

### `make:middleware`

```bash
npx nextroller make:middleware rate_limit
```

Generates `app/api/middlewares/rate_limit.ts` with the `RateLimitMiddleware` class. A `middleware` suffix in the name is dropped (`LoggerMiddleware` → `logger.ts`). Prints both ways to register it: in `route.ts` or with `@Use`.

### `routes`

```bash
npx nextroller routes
```

```
  METHOD  PATH                     HANDLER                     AUTH          MIDDLEWARES
  GET     /api/users               UsersController.index       public        LoggerMiddleware
  GET     /api/users/me            UsersController.me          auth          LoggerMiddleware
  POST    /api/orders/:id/approve  OrdersController.approve    auth + guard  LoggerMiddleware, AuditMiddleware

  3 routes
```

| `AUTH` column  | meaning                              |
| -------------- | ------------------------------------ |
| `-`            | controller without `@Auth`           |
| `public`       | `@Public` action                     |
| `auth`         | requires a user                      |
| `auth + guard` | requires a user and passes the guard |

- **Static analysis:** reads `route.ts` and the controllers without running app code.
- Warns (without failing) about non-literal arguments, controllers without routes and unregistered `modules/*/controller.ts` files.
- Limitations: decorators are recognized by their imported name (no aliases) and controllers must be listed literally in `controllers`.

## Configuration errors

Configuration errors never reach a request:

| when                | examples                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **compile time**    | path without a leading `/`, method decorator on a property, `@Body("x")`, `@Auth(guard)` on a parameter, guard not returning `boolean`, middleware as a bare function                                                   |
| **module import**   | repeated `@Controller`/`@Auth`, decorator on a `static` member, repeated verb + path on a method, two decorators on the same parameter, `@Use` with an invalid item                                                     |
| **`createHandler`** | class without `@Controller`, controller without routes, duplicate route, `@Public` without `@Auth`, `@Auth` without `authenticate`, undecorated parameter, `@Param("k")` outside the path, `@Auth()` on a public action |

## Notes

- The handlers accept a plain `Request` (e.g. in tests) and wrap it in a `NextRequest`; the `NextRequest` sent by Next is used as is.
- Production builds minify class names: the guard's `route.controller` and messages that include a controller name reflect the minified name.
- `ctx.auth` is typed as non-optional even in `@Public` actions (where its value is `undefined`).
- Controller inheritance isn't supported: metadata belongs to the class itself only.

## License

MIT

import { z } from "zod";
import {
  Body,
  Controller,
  Ctx,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Use,
  createHandler,
  type HttpContext,
  type Middleware,
} from "../../src/index.js";

const log: Middleware = { run: (_ctx, next) => next() };

class Timing implements Middleware {
  constructor(private readonly header = "x-time") {}

  async run(_ctx: HttpContext, next: () => Promise<Response>) {
    const res = await next();
    res.headers.set(this.header, "1");
    return res;
  }
}

class NeedsArgs implements Middleware {
  constructor(private readonly header: string) {}

  run(_ctx: HttpContext, next: () => Promise<Response>) {
    return next().then((res) => {
      res.headers.set(this.header, "1");
      return res;
    });
  }
}

@Controller("/users", { resource: true })
@Use(log)
export class Users {
  constructor(private readonly secret = "x") {}

  index({ validate }: HttpContext) {
    return validate.query(z.object({ page: z.coerce.number() }));
  }

  show(@Param("id") id: string) {
    return id;
  }

  @Get("/me")
  @Use(log, Timing, new NeedsArgs("x-id"))
  me(_ctx: HttpContext) {
    return { secret: this.secret };
  }

  @Put("/:id/archive")
  @Patch("/:id/archive")
  archive({ params }: HttpContext<"/:id/archive">) {
    return params.id;
  }

  @Post("/:id/notes")
  note(
    @Param("id") id: string,
    @Body(z.object({ text: z.string() })) body: { text: string },
    @Query() query: Record<string, string>,
    @Query("page") page: string | undefined,
    @Header("authorization") authorization: string | undefined,
    @Req() request: Request,
    @Ctx() { response }: HttpContext,
  ) {
    return response.created({ id, body, query, page, authorization, url: request.url });
  }

  @Delete()
  @Get()
  root() {}

  @Get("/schemas")
  schemas(
    @Query(z.object({ q: z.string() })) query: { q: string },
    @Param(z.object({})) params: object,
    @Header(z.object({})) headers: object,
    @Body() body: unknown,
  ) {
    return { query, params, headers, body };
  }
}

@Controller("/ping")
export class Ping {
  @Get()
  ping() {}
}

// @ts-expect-error
@Controller("users")
export class BadPrefix {}

export class BadPath {
  // @ts-expect-error
  @Get("me")
  me() {}
}

export class OnProperty {
  // @ts-expect-error
  @Get("/me")
  count = 1;
}

export class PublicOnProperty {
  // @ts-expect-error
  @Use(log)
  count = 1;
}

// @ts-expect-error
@Get("/x")
export class VerbOnClass {}

export class BodyWithoutSchema {
  @Post()
  // @ts-expect-error
  store(@Body("name") name: string) {
    return name;
  }
}

export class BadMiddleware {
  // @ts-expect-error
  @Use((ctx: HttpContext) => ctx.request)
  go() {}
}

export class FunctionMiddleware {
  // @ts-expect-error
  @Use(async (_ctx: HttpContext, next: () => Promise<Response>) => next())
  go() {}
}

export class ClassWithArgs {
  // @ts-expect-error
  @Use(NeedsArgs)
  go() {}
}

createHandler({ controllers: [Ping], middlewares: [log, Timing, new NeedsArgs("x-id")] });

// @ts-expect-error
createHandler({ controllers: [Ping], middlewares: [async (_ctx: HttpContext, next: () => Promise<Response>) => next()] });

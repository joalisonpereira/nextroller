import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "dist", "cli", "index.js");
const tsc = path.join(root, "node_modules", ".bin", "tsc");
const tmpRoot = path.join(root, "tests", ".tmp");

let cwd: string;

beforeEach(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
  cwd = fs.mkdtempSync(path.join(tmpRoot, "cli-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function modulesDir(appDir = "app") {
  return path.join(cwd, appDir, "api", "modules");
}

function typecheck() {
  fs.writeFileSync(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        strict: true,
        noEmit: true,
        experimentalDecorators: true,
        skipLibCheck: true,
        module: "esnext",
        moduleResolution: "bundler",
        isolatedModules: true,
        paths: {
          "@/*": ["./*"],
          nextroller: [path.join(root, "src", "index.ts")],
        },
      },
      include: ["**/*.ts"],
    }),
  );
  return spawnSync(tsc, ["-p", cwd], { encoding: "utf8" });
}

describe("nextroller make:module", () => {
  it("gera controller, service e validator que compilam", () => {
    fs.mkdirSync(path.join(cwd, "app"));
    const { code, stdout } = cli("make:module", "order_items");
    expect(code).toBe(0);

    const dir = path.join(modulesDir(), "order_items");
    expect(fs.readdirSync(dir).sort()).toEqual([
      "controller.ts",
      "service.ts",
      "validator.ts",
    ]);
    expect(stdout).toContain("✔ Module order_items created");
    expect(stdout).toContain(
      `CREATE  ${path.join("app", "api", "modules", "order_items", "controller.ts")}`,
    );
    expect(stdout).toContain("register the controller in app/api/[[...path]]/route.ts");
    expect(stdout).toContain(
      'import OrderItemsController from "@/app/api/modules/order_items/controller";',
    );
    expect(stdout).toContain("controllers: [..., OrderItemsController]");

    const controller = fs.readFileSync(path.join(dir, "controller.ts"), "utf8");
    expect(controller).toContain('@Controller("/order-items", { resource: true })');
    expect(controller).toContain("export default class OrderItemsController {");
    expect(controller).toContain("private service = new OrderItemsService()");
    expect(controller).toContain("this.service.list(page)");
    expect(controller).toContain('async show(@Param("id") id: string)');
    expect(controller).toContain("throw new NotFoundError();");
    expect(controller).not.toContain("static route");

    const service = fs.readFileSync(path.join(dir, "service.ts"), "utf8");
    expect(service).toContain("export class OrderItemsService {");
    expect(service).toContain('throw new Error("Not implemented");');

    const validator = fs.readFileSync(path.join(dir, "validator.ts"), "utf8");
    expect(validator).toContain("update: create.partial(),");
    expect(validator).toContain("export type Validated = InferValidator<typeof validator>;");
    expect(controller).toContain('@Body(validator.create) data: Validated["create"]');
    expect(service).toContain('async create(data: Validated["create"])');

    const result = typecheck();
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("avisa quando o tsconfig.json não habilita experimentalDecorators", () => {
    fs.mkdirSync(path.join(cwd, "app"));
    const missing = cli("make:module", "users");
    expect(missing.code).toBe(0);
    expect(missing.stderr).toContain("Warning: nextroller uses legacy decorators");
    expect(missing.stderr).toContain('"experimentalDecorators": true');

    fs.writeFileSync(
      path.join(cwd, "tsconfig.json"),
      '{\n  // comentário\n  "compilerOptions": { "experimentalDecorators": true }\n}\n',
    );
    const enabled = cli("make:module", "orders");
    expect(enabled.code).toBe(0);
    expect(enabled.stderr).toBe("");
  });

  it.each([
    ["orderItems", "order_items"],
    ["OrderItems", "order_items"],
    ["order-items", "order_items"],
    ["users", "users"],
    ["HTTPLogs", "http_logs"],
  ])("converte %s para %s", (input, expected) => {
    fs.mkdirSync(path.join(cwd, "app"));
    expect(cli("make:module", input).code).toBe(0);
    expect(fs.existsSync(path.join(modulesDir(), expected, "controller.ts"))).toBe(true);
  });

  it("usa src/app quando app/ não existe", () => {
    fs.mkdirSync(path.join(cwd, "src", "app"), { recursive: true });
    const { code, stdout } = cli("make:module", "users");
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(modulesDir("src/app"), "users", "service.ts"))).toBe(true);
    expect(stdout).toContain("register the controller in src/app/api/[[...path]]/route.ts");
  });

  it("aborta sem app/ nem src/app/", () => {
    const { code, stderr } = cli("make:module", "users");
    expect(code).toBe(1);
    expect(stderr).toContain("Could not find an app/ or src/app/ directory");
  });

  it("não sobrescreve módulo existente", () => {
    fs.mkdirSync(path.join(modulesDir(), "users"), { recursive: true });
    const { code, stderr } = cli("make:module", "users");
    expect(code).toBe(1);
    expect(stderr).toContain("Module already exists");
    expect(fs.readdirSync(path.join(modulesDir(), "users"))).toEqual([]);
  });

  it.each(["order items", "pedidos!", "__", "1users"])("rejeita nome inválido %j", (name) => {
    fs.mkdirSync(path.join(cwd, "app"));
    const { code, stderr } = cli("make:module", name);
    expect(code).toBe(1);
    expect(stderr).toContain("Invalid name");
    expect(fs.existsSync(modulesDir())).toBe(false);
  });

  it.each([
    [[]],
    [["make:module"]],
    [["make:controller", "users"]],
    [["make:middleware"]],
    [["routes", "extra"]],
    [["toString"]],
  ])("imprime uso para %j", (args) => {
    const { code, stderr } = cli(...args);
    expect(code).toBe(1);
    expect(stderr).toContain("Usage: nextroller <command>");
    expect(stderr).toContain("make:module <name>");
    expect(stderr).toContain("make:middleware <name>");
    expect(stderr).toContain("routes");
  });
});

describe("nextroller make:middleware", () => {
  it("gera a classe em app/api/middlewares e ela compila", () => {
    fs.mkdirSync(path.join(cwd, "app"));
    const { code, stdout } = cli("make:middleware", "rate-limit");
    expect(code).toBe(0);

    const file = path.join(cwd, "app", "api", "middlewares", "rate_limit.ts");
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain('import type { HttpContext, Middleware } from "nextroller";');
    expect(content).toContain("export class RateLimitMiddleware implements Middleware {");
    expect(content).toContain("async run(ctx: HttpContext, next: () => Promise<Response>) {");

    expect(stdout).toContain("✔ Middleware RateLimitMiddleware created");
    expect(stdout).toContain(`CREATE  ${path.join("app", "api", "middlewares", "rate_limit.ts")}`);
    expect(stdout).toContain('import { RateLimitMiddleware } from "@/app/api/middlewares/rate_limit";');
    expect(stdout).toContain("Global, in app/api/[[...path]]/route.ts:");
    expect(stdout).toContain("middlewares: [..., RateLimitMiddleware]");
    expect(stdout).toContain("@Use(RateLimitMiddleware)");

    const result = typecheck();
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.each([
    ["logger", "logger.ts", "LoggerMiddleware"],
    ["LoggerMiddleware", "logger.ts", "LoggerMiddleware"],
    ["request_id_middleware", "request_id.ts", "RequestIdMiddleware"],
    ["requestId", "request_id.ts", "RequestIdMiddleware"],
  ])("converte %s para %s (%s)", (input, file, name) => {
    fs.mkdirSync(path.join(cwd, "app"));
    expect(cli("make:middleware", input).code).toBe(0);
    const content = fs.readFileSync(path.join(cwd, "app", "api", "middlewares", file), "utf8");
    expect(content).toContain(`export class ${name} implements Middleware`);
  });

  it("usa src/app quando app/ não existe", () => {
    fs.mkdirSync(path.join(cwd, "src", "app"), { recursive: true });
    const { code, stdout } = cli("make:middleware", "logger");
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(cwd, "src", "app", "api", "middlewares", "logger.ts"))).toBe(true);
    expect(stdout).toContain("Global, in src/app/api/[[...path]]/route.ts:");
  });

  it("não sobrescreve middleware existente e rejeita nome inválido", () => {
    const dir = path.join(cwd, "app", "api", "middlewares");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "logger.ts"), "original");
    const existing = cli("make:middleware", "logger");
    expect(existing.code).toBe(1);
    expect(existing.stderr).toContain("Middleware already exists");
    expect(fs.readFileSync(path.join(dir, "logger.ts"), "utf8")).toBe("original");

    for (const name of ["middleware", "rate limit", "1log"]) {
      const invalid = cli("make:middleware", name);
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain("Invalid name");
    }
  });
});

describe("nextroller routes", () => {
  function write(file: string, content: string) {
    const target = path.join(cwd, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  function fixture(appDir = "app", alias = "@/app") {
    write(
      `${appDir}/api/[[...path]]/route.ts`,
      `import { createHandler } from "nextroller";
import UsersController from "${alias}/api/modules/users/controller";
import { OrdersController } from "../modules/orders/controller";
import { LoggerMiddleware } from "${alias}/api/middlewares/logger";

// createHandler({ controllers: [Fake] })
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHandler({
  basePath: "/api",
  prefix: "/v1",
  controllers: [UsersController, OrdersController],
  middlewares: [LoggerMiddleware, new CorsMiddleware({ origin: "*" })],
  authenticate: async (request) => null,
  onError(err) {
    console.error(err);
  },
});
`,
    );
    write(
      `${appDir}/api/modules/users/controller.ts`,
      `import { Auth, Controller, Get, Param, Patch, Public, Put, Use } from "nextroller";

/* @Get("/commented") */
@Controller("/users", { resource: true })
@Auth()
@Use(AuditMiddleware)
export default class UsersController {
  static instances = 0;
  private label = "@Get(\"/not-a-route\")";

  constructor(@Inject() private service = new UsersService()) {}

  @Public()
  async index(): Promise<{ data: string[] }> {
    return { data: [] };
  }

  async show(@Param("id") id: string) {
    return { id, text: "@Post('/fake')" };
  }

  @Get("/by-email/:email")
  async update() {}

  @Get("/me")
  @Use(new RateLimitMiddleware({ limit: 10 }))
  me() {}

  @Put("/:id/archive")
  @Patch("/:id/archive")
  archive() {}

  private destroyHelper() {}

  static helper() {}
}
`,
    );
    write(
      `${appDir}/api/modules/orders/controller.ts`,
      `import { Auth, Controller, Post } from "nextroller";

@Auth((auth, route) => route.method === "GET" || auth.role === "admin")
@Controller("/orders", { resource: true })
export class OrdersController {
  index() {}

  @Post("/:id/approve")
  approve() {}
}
`,
    );
    write(
      `${appDir}/api/modules/legacy/controller.ts`,
      `@Controller("/legacy")
export default class LegacyController {}
`,
    );
  }

  it("lista as rotas lidas dos decorators", () => {
    fixture();
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }));
    const { code, stdout, stderr } = cli("routes");
    expect(code).toBe(0);
    const lines = stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.trim().split(/\s{2,}/));
    expect(lines[0]).toEqual(["METHOD", "PATH", "HANDLER", "AUTH", "MIDDLEWARES"]);
    expect(lines.slice(1, -1)).toEqual([
      ["GET", "/api/v1/orders", "OrdersController.index", "auth + guard", "LoggerMiddleware, CorsMiddleware"],
      ["POST", "/api/v1/orders/:id/approve", "OrdersController.approve", "auth + guard", "LoggerMiddleware, CorsMiddleware"],
      ["GET", "/api/v1/users", "UsersController.index", "public", "LoggerMiddleware, CorsMiddleware, AuditMiddleware"],
      ["GET", "/api/v1/users/by-email/:email", "UsersController.update", "auth", "LoggerMiddleware, CorsMiddleware, AuditMiddleware"],
      [
        "GET",
        "/api/v1/users/me",
        "UsersController.me",
        "auth",
        "LoggerMiddleware, CorsMiddleware, AuditMiddleware, RateLimitMiddleware",
      ],
      ["GET", "/api/v1/users/:id", "UsersController.show", "auth", "LoggerMiddleware, CorsMiddleware, AuditMiddleware"],
      ["PUT", "/api/v1/users/:id/archive", "UsersController.archive", "auth", "LoggerMiddleware, CorsMiddleware, AuditMiddleware"],
      ["PATCH", "/api/v1/users/:id/archive", "UsersController.archive", "auth", "LoggerMiddleware, CorsMiddleware, AuditMiddleware"],
    ]);
    expect(lines.at(-1)).toEqual(["8 routes"]);
    expect(stderr).toContain(
      `Warning: ${path.join("app", "api", "modules", "legacy", "controller.ts")} is not registered in createHandler.`,
    );
  });

  it("resolve @/ pelo tsconfig em projetos com src/app", () => {
    fixture("src/app", "@/app");
    write("tsconfig.json", '{\n  // alias do Next com src/\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}');
    const { code, stdout } = cli("routes");
    expect(code).toBe(0);
    expect(stdout).toContain("8 routes");
  });

  it("avisa sobre valores dinâmicos", () => {
    write(
      "app/api/[[...path]]/route.ts",
      `import { createHandler } from "nextroller";
import PingController from "../modules/ping/controller";
export const { GET } = createHandler({ basePath: BASE, controllers: [PingController] });
`,
    );
    write(
      "app/api/modules/ping/controller.ts",
      `@Controller(PREFIX)
class PingController {
  @Get(PATH)
  ping() {}
}
export default PingController;
`,
    );
    const { code, stdout, stderr } = cli("routes");
    expect(code).toBe(0);
    expect(stdout).toContain("/api/<dynamic>/<dynamic>");
    expect(stderr).toContain('`basePath` is not a string literal; using "/api".');
    expect(stderr).toContain("PingController: @Controller prefix is not a string literal");
    expect(stderr).toContain("PingController.ping: @Get path is not a string literal");
  });

  it("falha sem route.ts, sem createHandler ou com controllers não literal", () => {
    fs.mkdirSync(path.join(cwd, "app"));
    expect(cli("routes").stderr).toContain(
      `Could not find ${path.join("app", "api", "[[...path]]", "route.ts")}.`,
    );

    write("app/api/[[...path]]/route.ts", "export const GET = () => new Response();\n");
    expect(cli("routes").stderr).toContain("Could not find a createHandler({ ... }) call");

    write("app/api/[[...path]]/route.ts", "createHandler({ controllers });\n");
    const result = cli("routes");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("`controllers` in createHandler must be an array literal");

    write("app/api/[[...path]]/route.ts", 'import X from "./missing";\ncreateHandler({ controllers: [X] });\n');
    expect(cli("routes").stderr).toContain("Could not resolve the file of controller X.");
  });
});

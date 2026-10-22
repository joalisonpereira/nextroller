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
    expect(controller).toContain("class OrderItemsController {");
    expect(controller).toContain("type Route } from \"nextroller\";");
    expect(controller).toContain("static route: Route<OrderItemsController> = {");
    expect(controller).toContain('prefix: "/order-items",');
    expect(controller).not.toContain("as const");
    expect(controller).toContain("private orderItems = new OrderItemsService()");
    expect(controller).toContain("export default defineController(OrderItemsController);");

    const service = fs.readFileSync(path.join(dir, "service.ts"), "utf8");
    expect(service).toContain("export class OrderItemsService {");
    expect(service).toContain('throw new Error("Not implemented");');

    const validator = fs.readFileSync(path.join(dir, "validator.ts"), "utf8");
    expect(validator).toContain("update: create.partial(),");
    expect(validator).toContain("export type Validated = InferValidator<typeof validator>;");
    expect(controller).toContain("validate.body(validator.create)");
    expect(service).toContain('async create(data: Validated["create"])');

    const result = typecheck();
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
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

  it.each([[[]], [["make:module"]], [["make:controller", "users"]]])(
    "imprime uso para %j",
    (args) => {
      const { code, stderr } = cli(...args);
      expect(code).toBe(1);
      expect(stderr).toContain("Usage: nextroller make:module <name>");
    },
  );
});

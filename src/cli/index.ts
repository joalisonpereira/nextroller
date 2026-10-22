#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { listRoutes } from "./routes.js";
import { CliError, findAppDir } from "./shared.js";
import {
  controllerTemplate,
  middlewareTemplate,
  serviceTemplate,
  validatorTemplate,
  type ModuleNames,
} from "./templates.js";

const USAGE = `${chalk.bold("Usage:")} nextroller ${chalk.cyan("<command>")}

${chalk.bold("Commands:")}
  make:module ${chalk.cyan("<name>")}       Create app/api/modules/<name>/ (controller, service, validator)
  make:middleware ${chalk.cyan("<name>")}   Create app/api/middlewares/<name>.ts
  routes                   List the API routes

${chalk.bold("Examples:")}
  npx nextroller make:module order_items
  npx nextroller make:middleware rate_limit
  npx nextroller routes`;

function toSnakeCase(input: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new CliError(`Invalid name "${input}". Use only letters, numbers, "_" or "-".`);
  }
  const snake = input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/-/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  if (snake === "") {
    throw new CliError(`Invalid name "${input}".`);
  }
  if (/^[0-9]/.test(snake)) {
    throw new CliError(`Invalid name "${input}". The name cannot start with a number.`);
  }
  return snake;
}

function moduleNames(input: string): ModuleNames {
  const module = toSnakeCase(input);
  const words = module.split("_");
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return {
    module,
    pascal,
    kebab: words.join("-"),
  };
}

function decoratorsEnabled(cwd: string): boolean {
  const file = path.join(cwd, "tsconfig.json");
  if (!fs.existsSync(file)) return false;
  return /"experimentalDecorators"\s*:\s*true/.test(fs.readFileSync(file, "utf8"));
}

function makeModule(input: string, cwd: string): void {
  const names = moduleNames(input);
  const appDir = findAppDir(cwd);
  const dir = path.join(appDir, "api", "modules", names.module);
  if (fs.existsSync(dir)) {
    throw new CliError(`Module already exists: ${path.relative(cwd, dir)}`);
  }

  const files: Record<string, string> = {
    "controller.ts": controllerTemplate(names),
    "service.ts": serviceTemplate(names),
    "validator.ts": validatorTemplate(),
  };

  fs.mkdirSync(dir, { recursive: true });
  const created = Object.entries(files).map(([file, content]) => {
    const target = path.join(dir, file);
    fs.writeFileSync(target, content, { flag: "wx" });
    return path.relative(cwd, target);
  });

  const routeFile = path.relative(cwd, path.join(appDir, "api", "[[...path]]", "route.ts"));
  const controller = `${names.pascal}Controller`;
  const importPath = `@/app/api/modules/${names.module}/controller`;

  console.log(
    [
      "",
      `${chalk.green("✔")} Module ${chalk.bold(names.module)} created`,
      "",
      ...created.map((file) => `  ${chalk.green.bold("CREATE")}  ${file}`),
      "",
      `${chalk.bold("Next step:")} register the controller in ${chalk.cyan(routeFile)}`,
      "",
      `    ${chalk.magenta("import")} ${controller} ${chalk.magenta("from")} ${chalk.yellow(`"${importPath}"`)};`,
      "",
      `    controllers: [${chalk.dim("...")}, ${chalk.bold(controller)}]`,
      "",
    ].join("\n"),
  );

  if (!decoratorsEnabled(cwd)) {
    console.warn(
      [
        `${chalk.yellow("⚠")} ${chalk.yellow.bold("Warning:")} nextroller uses legacy decorators. Enable them in ${chalk.cyan("tsconfig.json")}:`,
        "",
        `    "compilerOptions": { ${chalk.bold('"experimentalDecorators": true')} }`,
        "",
      ].join("\n"),
    );
  }
}

function makeMiddleware(input: string, cwd: string): void {
  const snake = toSnakeCase(input).replace(/(^|_)middleware$/, "");
  if (snake === "") {
    throw new CliError(`Invalid name "${input}".`);
  }
  const names = moduleNames(snake);
  const appDir = findAppDir(cwd);
  const target = path.join(appDir, "api", "middlewares", `${names.module}.ts`);
  if (fs.existsSync(target)) {
    throw new CliError(`Middleware already exists: ${path.relative(cwd, target)}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, middlewareTemplate(names), { flag: "wx" });

  const routeFile = path.relative(cwd, path.join(appDir, "api", "[[...path]]", "route.ts"));
  const middleware = `${names.pascal}Middleware`;
  const importPath = `@/app/api/middlewares/${names.module}`;

  console.log(
    [
      "",
      `${chalk.green("✔")} Middleware ${chalk.bold(middleware)} created`,
      "",
      `  ${chalk.green.bold("CREATE")}  ${path.relative(cwd, target)}`,
      "",
      `${chalk.bold("Next step:")} import it where you want to use it`,
      "",
      `    ${chalk.magenta("import")} { ${middleware} } ${chalk.magenta("from")} ${chalk.yellow(`"${importPath}"`)};`,
      "",
      `  Global, in ${chalk.cyan(routeFile)}:`,
      "",
      `    middlewares: [${chalk.dim("...")}, ${chalk.bold(middleware)}]`,
      "",
      "  On a controller or action:",
      "",
      `    @Use(${chalk.bold(middleware)})`,
      "",
    ].join("\n"),
  );
}

const COMMANDS: Record<string, { args: number; run: (args: string[], cwd: string) => void }> = {
  "make:module": {
    args: 1,
    run: ([name = ""], cwd) => {
      makeModule(name, cwd);
    },
  },
  "make:middleware": {
    args: 1,
    run: ([name = ""], cwd) => {
      makeMiddleware(name, cwd);
    },
  },
  routes: {
    args: 0,
    run: (_args, cwd) => {
      listRoutes(cwd);
    },
  },
};

function main(args: string[]): number {
  const [command, ...rest] = args;
  const spec = command !== undefined && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (spec?.args !== rest.length) {
    console.error(USAGE);
    return 1;
  }
  try {
    spec.run(rest, process.cwd());
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${chalk.red("✖")} ${chalk.red.bold("Error:")} ${err.message}`);
      return 1;
    }
    throw err;
  }
}

process.exitCode = main(process.argv.slice(2));

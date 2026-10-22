#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { controllerTemplate, serviceTemplate, validatorTemplate, type ModuleNames } from "./templates.js";

const USAGE = `${chalk.bold("Usage:")} nextroller make:module ${chalk.cyan("<name>")}

${chalk.bold("Example:")}
  npx nextroller make:module order_items`;

class CliError extends Error {}

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
  const pascal = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return {
    module,
    pascal,
    kebab: words.join("-"),
  };
}

function findAppDir(cwd: string): string {
  for (const candidate of ["app", path.join("src", "app")]) {
    const dir = path.join(cwd, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  throw new CliError("Could not find an app/ or src/app/ directory in the current directory.");
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

function main(args: string[]): number {
  const [command, name, ...rest] = args;
  if (command !== "make:module" || name === undefined || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }
  try {
    makeModule(name, process.cwd());
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

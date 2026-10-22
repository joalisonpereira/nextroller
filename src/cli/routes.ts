import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { METHODS, RESOURCE_ACTIONS, type Method } from "../controller.js";
import { CliError, findAppDir } from "./shared.js";

interface Decorator {
  name: string;
  args: string[];
}

interface ParsedMember {
  name: string;
  decorators: Decorator[];
}

interface ParsedClass {
  name: string;
  isDefault: boolean;
  decorators: Decorator[];
  methods: ParsedMember[];
}

interface RouteRow {
  method: Method;
  path: string;
  handler: string;
  auth: string;
  middlewares: string[];
}

const VERBS: Record<string, Method> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
};

const MODIFIERS = new Set([
  "public",
  "private",
  "protected",
  "static",
  "async",
  "readonly",
  "override",
  "abstract",
  "declare",
  "accessor",
  "get",
  "set",
]);

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function skipString(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\") {
      i += 2;
    } else if (c === quote) {
      return i + 1;
    } else if (quote === "`" && c === "$" && s[i + 1] === "{") {
      i = skipBalanced(s, i + 1);
    } else {
      i++;
    }
  }
  return s.length;
}

function skipBalanced(s: string, start: number): number {
  const stack = [OPENERS[s[start]!]!];
  let i = start + 1;
  while (i < s.length && stack.length > 0) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      continue;
    }
    if (OPENERS[c]) stack.push(OPENERS[c]);
    else if (c === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return i;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

function readWord(s: string, i: number): string {
  return /^[A-Za-z_$#][\w$]*/.exec(s.slice(i, i + 200))?.[0] ?? "";
}

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(text, i);
      current += text.slice(i, end);
      i = end - 1;
      continue;
    }
    if (OPENERS[c]) depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

function readDecorator(s: string, start: number): { decorator: Decorator; end: number } {
  let i = start + 1;
  const name = /^[\w$.]+/.exec(s.slice(i, i + 200))?.[0] ?? "";
  i = skipSpace(s, i + name.length);
  if (s[i] !== "(") return { decorator: { name, args: [] }, end: i };
  const end = skipBalanced(s, i);
  return { decorator: { name, args: splitArgs(s.slice(i + 1, end - 1)) }, end };
}

function skipReturnType(s: string, start: number): number {
  let i = start;
  let expectOperand = true;
  while (i < s.length) {
    i = skipSpace(s, i);
    const c = s[i]!;
    if (c === "{") {
      if (!expectOperand) return i;
      i = skipBalanced(s, i);
      expectOperand = false;
    } else if (c === ";") {
      return i;
    } else if (c === "(" || c === "[" || c === "<") {
      i = c === "<" ? skipAngles(s, i) : skipBalanced(s, i);
      expectOperand = false;
    } else if (c === "|" || c === "&" || c === "," || c === "?" || c === ":") {
      i++;
      expectOperand = true;
    } else if (c === "=" && s[i + 1] === ">") {
      i += 2;
      expectOperand = true;
    } else if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      expectOperand = false;
    } else {
      i++;
      expectOperand = false;
    }
  }
  return i;
}

function skipAngles(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "<") depth++;
    else if (c === ">" && s[i - 1] !== "=") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (OPENERS[c]) {
      i = skipBalanced(s, i);
      continue;
    } else if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      continue;
    }
    i++;
  }
  return i;
}

function skipStatement(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ";" || c === "\n") return i + 1;
    if (c === "}") return i;
    if (OPENERS[c]) i = skipBalanced(s, i);
    else if (c === '"' || c === "'" || c === "`") i = skipString(s, i);
    else i++;
  }
  return i;
}

function parseMembers(s: string, start: number, end: number): ParsedMember[] {
  const methods: ParsedMember[] = [];
  let decorators: Decorator[] = [];
  let i = start;
  while (i < end) {
    i = skipSpace(s, i);
    if (i >= end) break;
    const c = s[i]!;
    if (c === "@") {
      const read = readDecorator(s, i);
      decorators.push(read.decorator);
      i = read.end;
      continue;
    }
    if (c === ";" || c === ",") {
      i++;
      continue;
    }

    const modifiers = new Set<string>();
    let name = "";
    while (i < end) {
      i = skipSpace(s, i);
      if (s[i] === "*") {
        i++;
        continue;
      }
      if (s[i] === "[") {
        i = skipBalanced(s, i);
        name = "[computed]";
        break;
      }
      if (s[i] === '"' || s[i] === "'") {
        const close = skipString(s, i);
        name = s.slice(i + 1, close - 1);
        i = close;
        break;
      }
      const word = readWord(s, i);
      if (word === "") {
        i++;
        break;
      }
      i += word.length;
      const next = s[skipSpace(s, i)];
      if (MODIFIERS.has(word) && next !== "(" && next !== "=" && next !== ":" && next !== ";") {
        modifiers.add(word);
        continue;
      }
      name = word;
      break;
    }

    i = skipSpace(s, i);
    if (s[i] === "?" || s[i] === "!") i = skipSpace(s, i + 1);
    if (s[i] === "<") i = skipSpace(s, skipAngles(s, i));

    if (s[i] === "(") {
      i = skipBalanced(s, i);
      i = skipSpace(s, i);
      if (s[i] === ":") i = skipReturnType(s, i + 1);
      i = skipSpace(s, i);
      if (s[i] === "{") i = skipBalanced(s, i);
      const isRoute =
        name !== "" &&
        name !== "constructor" &&
        !name.startsWith("#") &&
        !modifiers.has("static") &&
        !modifiers.has("get") &&
        !modifiers.has("set");
      if (isRoute) methods.push({ name, decorators });
    } else {
      i = skipStatement(s, i);
    }
    decorators = [];
  }
  return methods;
}

function parseClasses(source: string): ParsedClass[] {
  const s = stripComments(source);
  const classes: ParsedClass[] = [];
  const defaultName = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(s)?.[1];
  let pending: Decorator[] = [];
  let isDefault = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      continue;
    }
    if (c === "@") {
      const read = readDecorator(s, i);
      pending.push(read.decorator);
      i = read.end;
      continue;
    }
    if (OPENERS[c]) {
      i = skipBalanced(s, i);
      pending = [];
      isDefault = false;
      continue;
    }
    if (c === ";") {
      pending = [];
      isDefault = false;
      i++;
      continue;
    }
    const word = /[A-Za-z_$]/.test(c) && !/[\w$]/.test(s[i - 1] ?? "") ? readWord(s, i) : "";
    if (word === "") {
      i++;
      continue;
    }
    i += word.length;
    if (word === "default") {
      isDefault = true;
    } else if (word === "class") {
      i = skipSpace(s, i);
      const name = readWord(s, i);
      let open = i + name.length;
      while (open < s.length && s[open] !== "{") {
        open = s[open] === "<" ? skipAngles(s, open) : open + 1;
      }
      const close = skipBalanced(s, open);
      classes.push({
        name,
        isDefault: isDefault || (name !== "" && name === defaultName),
        decorators: pending,
        methods: parseMembers(s, open + 1, close - 1),
      });
      pending = [];
      isDefault = false;
      i = close;
    } else if (word !== "export" && word !== "abstract" && word !== "declare") {
      pending = [];
      isDefault = false;
    }
  }
  return classes;
}

function literal(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const match = /^(["'`])([\s\S]*)\1$/.exec(text.trim());
  if (!match || (match[1] === "`" && match[2]!.includes("${"))) return undefined;
  return match[2];
}

function middlewareName(text: string): string {
  const created = /^new\s+([\w$.]+)/.exec(text);
  if (created) return created[1]!;
  return /^[\w$.]+$/.test(text) ? text : "<inline>";
}

function arrayItems(text: string | undefined): string[] | undefined {
  const value = text?.trim();
  if (!value?.startsWith("[") || !value.endsWith("]")) return undefined;
  return splitArgs(value.slice(1, -1));
}

function objectProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  const body = text.trim().replace(/^\{|\}$/g, "");
  for (const entry of splitArgs(body)) {
    const match = /^([\w$]+|"[^"]+"|'[^']+')\s*(?::([\s\S]*))?$/.exec(entry);
    if (!match) continue;
    const key = match[1]!.replace(/^["']|["']$/g, "");
    props.set(key, (match[2] ?? key).trim());
  }
  return props;
}

function parseImports(source: string): Map<string, { specifier: string; isDefault: boolean }> {
  const imports = new Map<string, { specifier: string; isDefault: boolean }>();
  const pattern = /import\s+(type\s+)?([\w$\s{},]+?)\s+from\s+["']([^"']+)["']/g;
  for (const [, typeOnly, clause, specifier] of source.matchAll(pattern)) {
    if (typeOnly) continue;
    const named = /\{([\s\S]*)\}/.exec(clause!)?.[1];
    const defaultName = clause!.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (defaultName && /^[\w$]+$/.test(defaultName)) {
      imports.set(defaultName, { specifier: specifier!, isDefault: true });
    }
    for (const part of named?.split(",") ?? []) {
      const [original, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (original) imports.set((alias ?? original).trim(), { specifier: specifier!, isDefault: false });
    }
  }
  return imports;
}

function aliasRoots(cwd: string): string[] {
  const file = path.join(cwd, "tsconfig.json");
  if (fs.existsSync(file)) {
    const match = /"@\/\*"\s*:\s*\[([^\]]*)\]/.exec(fs.readFileSync(file, "utf8"));
    const targets = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!.replace(/\*$/, ""));
    if (targets.length > 0) return targets.map((target) => path.resolve(cwd, target));
  }
  return [cwd];
}

function resolveImport(specifier: string, fromDir: string, cwd: string): string | undefined {
  const bases = specifier.startsWith("@/")
    ? aliasRoots(cwd).map((root) => path.join(root, specifier.slice(2)))
    : specifier.startsWith(".")
      ? [path.resolve(fromDir, specifier)]
      : [];
  for (const base of bases) {
    const stripped = base.replace(/\.(js|ts)$/, "");
    for (const candidate of [`${stripped}.ts`, `${stripped}.tsx`, path.join(stripped, "index.ts")]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function joinPaths(...parts: string[]): string {
  const joined = parts
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function segmentRank(segment: string): number {
  if (segment.includes("*")) return 2;
  if (segment.startsWith(":")) return 1;
  return 0;
}

function compareRows(a: RouteRow, b: RouteRow): number {
  const sa = a.path.split("/");
  const sb = b.path.split("/");
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const diff = segmentRank(sa[i]!) - segmentRank(sb[i]!) || sa[i]!.localeCompare(sb[i]!);
    if (diff !== 0) return diff;
  }
  return sa.length - sb.length || METHODS.indexOf(a.method) - METHODS.indexOf(b.method);
}

function controllerRows(
  parsed: ParsedClass,
  file: string,
  base: string,
  globals: string[],
  warn: (message: string) => void,
): RouteRow[] {
  const find = (decorators: Decorator[], name: string) => decorators.find((d) => d.name === name);
  const controller = find(parsed.decorators, "Controller");
  if (!controller) {
    throw new CliError(`${parsed.name} in ${file} has no @Controller decorator.`);
  }
  let prefix = literal(controller.args[0]);
  if (prefix === undefined) {
    warn(`${parsed.name}: @Controller prefix is not a string literal; shown as "<dynamic>".`);
    prefix = "/<dynamic>";
  }
  const resource = /\bresource\s*:\s*true\b/.test(controller.args[1] ?? "");
  const auth = find(parsed.decorators, "Auth");
  const classMiddlewares = parsed.decorators
    .filter((d) => d.name === "Use")
    .flatMap((d) => d.args.map(middlewareName));

  const rows: RouteRow[] = [];
  for (const method of parsed.methods) {
    const verbs = method.decorators.filter((d) => VERBS[d.name]);
    const routes: { method: Method; path: string }[] = verbs.map((d) => {
      const value = d.args[0] === undefined ? "/" : literal(d.args[0]);
      if (value === undefined) {
        warn(`${parsed.name}.${method.name}: @${d.name} path is not a string literal; shown as "<dynamic>".`);
      }
      return { method: VERBS[d.name]!, path: value ?? "/<dynamic>" };
    });
    if (routes.length === 0 && resource && Object.hasOwn(RESOURCE_ACTIONS, method.name)) {
      const { methods, path: resourcePath } = RESOURCE_ACTIONS[method.name]!;
      routes.push(...methods.map((verb) => ({ method: verb, path: resourcePath })));
    }
    const isPublic = method.decorators.some((d) => d.name === "Public");
    const authLabel = !auth ? "-" : isPublic ? "public" : auth.args.length > 0 ? "auth + guard" : "auth";
    const middlewares = [
      ...globals,
      ...classMiddlewares,
      ...method.decorators.filter((d) => d.name === "Use").flatMap((d) => d.args.map(middlewareName)),
    ];
    for (const route of routes) {
      rows.push({
        method: route.method,
        path: joinPaths(base, prefix, route.path),
        handler: `${parsed.name}.${method.name}`,
        auth: authLabel,
        middlewares,
      });
    }
  }
  if (rows.length === 0) warn(`${parsed.name}: controller does not define any route.`);
  return rows;
}

const METHOD_COLORS: Record<Method, (text: string) => string> = {
  GET: chalk.green,
  POST: chalk.yellow,
  PUT: chalk.blue,
  PATCH: chalk.blue,
  DELETE: chalk.red,
};

function printTable(rows: RouteRow[]): void {
  const header = ["METHOD", "PATH", "HANDLER", "AUTH", "MIDDLEWARES"];
  const cells = rows.map((row) => [
    row.method,
    row.path,
    row.handler,
    row.auth,
    row.middlewares.length > 0 ? row.middlewares.join(", ") : "-",
  ]);
  const widths = header.map((title, col) => Math.max(title.length, ...cells.map((cell) => cell[col]!.length)));
  const pad = (text: string, col: number) => (col === header.length - 1 ? text : text.padEnd(widths[col]!));
  const colorize = (text: string, col: number, row: RouteRow) => {
    if (col === 0) return METHOD_COLORS[row.method](text);
    if (col === 1) return text.replace(/:[\w$]+(\{[^}]*\})?\??/g, (param) => chalk.cyan(param));
    if (col === 3 || col === 4) return text.trimEnd() === "-" ? chalk.dim(text) : text;
    return text;
  };

  const lines = [
    "",
    `  ${header.map((title, col) => chalk.bold(pad(title, col))).join("  ")}`,
    ...cells.map((cell, index) => {
      const row = rows[index]!;
      return `  ${cell.map((text, col) => colorize(pad(text, col), col, row)).join("  ")}`.trimEnd();
    }),
    "",
    `  ${chalk.dim(`${rows.length} ${rows.length === 1 ? "route" : "routes"}`)}`,
    "",
  ];
  console.log(lines.join("\n"));
}

export function listRoutes(cwd: string): void {
  const appDir = findAppDir(cwd);
  const routeFile = path.join(appDir, "api", "[[...path]]", "route.ts");
  if (!fs.existsSync(routeFile)) {
    throw new CliError(`Could not find ${path.relative(cwd, routeFile)}.`);
  }
  const source = stripComments(fs.readFileSync(routeFile, "utf8"));
  const call = /\bcreateHandler\s*\(/.exec(source);
  const open = call ? source.indexOf("{", call.index) : -1;
  if (!call || open === -1) {
    throw new CliError(`Could not find a createHandler({ ... }) call in ${path.relative(cwd, routeFile)}.`);
  }
  const options = objectProperties(source.slice(open, skipBalanced(source, open)));

  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  const readOption = (key: string, fallback: string) => {
    if (!options.has(key)) return fallback;
    const value = literal(options.get(key));
    if (value === undefined) warn(`\`${key}\` is not a string literal; using ${JSON.stringify(fallback)}.`);
    return value ?? fallback;
  };
  const base = joinPaths(readOption("basePath", "/api"), readOption("prefix", ""));

  const controllers = arrayItems(options.get("controllers"));
  if (!controllers) {
    throw new CliError("`controllers` in createHandler must be an array literal to list routes.");
  }
  const globals = (arrayItems(options.get("middlewares")) ?? []).map(middlewareName);

  const imports = parseImports(source);
  const registered = new Set<string>();
  const rows: RouteRow[] = [];
  for (const identifier of controllers) {
    const imported = imports.get(identifier);
    const file = imported && resolveImport(imported.specifier, path.dirname(routeFile), cwd);
    if (!imported || !file) {
      throw new CliError(`Could not resolve the file of controller ${identifier}.`);
    }
    registered.add(path.resolve(file));
    const classes = parseClasses(fs.readFileSync(file, "utf8"));
    const parsed = imported.isDefault
      ? classes.find((c) => c.isDefault)
      : classes.find((c) => c.name === identifier);
    if (!parsed) {
      throw new CliError(`Could not find class ${identifier} in ${path.relative(cwd, file)}.`);
    }
    rows.push(...controllerRows(parsed, path.relative(cwd, file), base, globals, warn));
  }

  const modulesDir = path.join(appDir, "api", "modules");
  if (fs.existsSync(modulesDir)) {
    for (const module of fs.readdirSync(modulesDir).sort()) {
      const file = path.join(modulesDir, module, "controller.ts");
      if (fs.existsSync(file) && !registered.has(path.resolve(file))) {
        warn(`${path.relative(cwd, file)} is not registered in createHandler.`);
      }
    }
  }

  printTable(rows.sort(compareRows));
  for (const message of warnings) {
    console.warn(`${chalk.yellow("⚠")} ${chalk.yellow.bold("Warning:")} ${message}`);
  }
}

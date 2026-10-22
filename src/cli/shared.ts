import fs from "node:fs";
import path from "node:path";

export class CliError extends Error {}

export function findAppDir(cwd: string): string {
  for (const candidate of ["app", path.join("src", "app")]) {
    const dir = path.join(cwd, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  throw new CliError("Could not find an app/ or src/app/ directory in the current directory.");
}

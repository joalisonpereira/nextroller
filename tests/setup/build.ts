import { execSync } from "node:child_process";

export default function setup() {
  execSync("yarn -s build", { stdio: "inherit" });
}

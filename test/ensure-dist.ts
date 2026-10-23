import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const cliPath = join(repoRoot, "dist/cli.js");

/** `npm run check` runs `tsc` before vitest; avoid concurrent rebuilds that corrupt `dist/`. */
export function ensureDistBuilt(): string {
  if (!existsSync(cliPath)) {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  }
  if (!existsSync(cliPath)) {
    throw new Error("dist/cli.js missing after build");
  }
  return cliPath;
}

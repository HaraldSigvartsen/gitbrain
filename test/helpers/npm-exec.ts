import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { isWindows } from "./platform.js";

type NpmExecOptions = Pick<ExecFileSyncOptions, "cwd" | "encoding" | "stdio">;

/** Run npm on the current PATH (Windows resolves `npm.cmd` via cmd.exe). */
export function execNpm(args: string[], options: NpmExecOptions = {}): string {
  const encoding = options.encoding ?? "utf8";
  if (isWindows) {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
      ...options,
      encoding,
    }) as string;
  }
  return execFileSync("npm", args, { ...options, encoding }) as string;
}

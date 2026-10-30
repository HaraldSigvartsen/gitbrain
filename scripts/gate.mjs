import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (
  !existsSync(join(root, "node_modules", "typescript")) ||
  !existsSync(join(root, "node_modules", "vitest"))
) {
  console.error("gitbrain: dependencies are missing. From the repo root, run: npm install");
  process.exit(1);
}

console.log("gitbrain: local gate — typecheck and tests (npm run check)");

const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", "run", "--silent", "check"], {
        cwd: root,
        stdio: "inherit",
      })
    : spawnSync("npm", ["run", "--silent", "check"], {
        cwd: root,
        stdio: "inherit",
      });

if (result.error) {
  console.error(`gitbrain: failed to start npm run check (${result.error.message})`);
  process.exit(1);
}

const code = result.status ?? 1;
if (code !== 0) {
  console.error("gitbrain: gate failed. Fix the errors above, then run: npm run gate");
  process.exit(code);
}

// Rust memory engine (crates/gitbrain-mem): run its tests when cargo is available.
const rustManifest = join(root, "crates", "gitbrain-mem", "Cargo.toml");
if (existsSync(rustManifest) && process.env.GITBRAIN_SKIP_RUST !== "1") {
  const probe = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    console.log("gitbrain: cargo not found, skipping crates/gitbrain-mem tests.");
  } else {
    console.log("gitbrain: local gate — crates/gitbrain-mem (cargo test)");
    const rust = spawnSync("cargo", ["test", "--quiet", "--manifest-path", rustManifest], {
      cwd: root,
      stdio: "inherit",
    });
    if (rust.error || rust.status !== 0) {
      console.error("gitbrain: gate failed in crates/gitbrain-mem. Fix it, then run: npm run gate");
      process.exit(rust.status ?? 1);
    }
  }
}

console.log("gitbrain: gate passed.");

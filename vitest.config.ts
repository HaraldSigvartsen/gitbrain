import { platform } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Git fixture tests are slow on Windows runners when the suite runs in parallel.
    testTimeout: platform() === "win32" ? 30_000 : 5_000,
  },
});

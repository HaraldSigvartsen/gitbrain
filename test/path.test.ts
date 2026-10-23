import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { posixRelativePath, toPosixRepoPath } from "../src/path.js";

describe("toPosixRepoPath", () => {
  it("normalises backslashes and duplicate slashes", () => {
    expect(toPosixRepoPath("src\\foo\\\\bar.ts")).toBe("src/foo/bar.ts");
    expect(toPosixRepoPath("already/posix.ts")).toBe("already/posix.ts");
  });
});

describe("posixRelativePath", () => {
  it("returns posix separators on all platforms", () => {
    const project = join(tmpdir(), "gitbrain-posix-rel");
    const abs = join(project, ".brain", "reports", "2026-01-01.md");
    expect(posixRelativePath(project, abs)).toBe(".brain/reports/2026-01-01.md");
  });
});

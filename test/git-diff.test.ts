import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_TREE_SHA,
  collectChangeSet,
  oldestShaInCappedWindow,
} from "../src/git/diff.js";
import { GitError } from "../src/git/exec.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitbrain-git-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function commitAll(repo: string, message: string): string {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-m", message], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

describe("collectChangeSet", () => {
  it("throws a clear error outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitbrain-nogit-"));
    expect(() => collectChangeSet(dir, null)).toThrow(GitError);
    expect(() => collectChangeSet(dir, null)).toThrow(/not a git repository/i);
  });

  it("reports a single-commit first run from the empty tree", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "hello.txt"), "hi\n");
    const sha = commitAll(repo, "init");

    const change = collectChangeSet(repo, null);
    expect(change.headSha).toBe(sha);
    expect(change.sinceSha).toBe(EMPTY_TREE_SHA);
    expect(change.capped).toBe(false);
    expect(change.commits).toEqual([{ sha, subject: "init" }]);
    expect(change.files).toEqual([
      {
        path: "hello.txt",
        status: "added",
        added: 1,
        removed: 0,
      },
    ]);
    expect(change.touchedPaths).toEqual(["hello.txt"]);
  });

  it("collects commits and file changes since last_reconciled_sha", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "a.txt"), "a\n");
    const first = commitAll(repo, "first");
    writeFileSync(join(repo, "b.txt"), "b\n");
    commitAll(repo, "second");
    writeFileSync(join(repo, "a.txt"), "a2\n");
    const third = commitAll(repo, "third");

    const change = collectChangeSet(repo, first);
    expect(change.sinceSha).toBe(first);
    expect(change.headSha).toBe(third);
    expect(change.commits.map((c) => c.subject)).toEqual(["second", "third"]);
    expect(change.files.some((f) => f.path === "b.txt" && f.status === "added")).toBe(true);
    expect(change.files.some((f) => f.path === "a.txt" && f.status === "modified")).toBe(true);
  });

  it("detects deletes and renames", () => {
    const repo = tmpRepo();
    writeFileSync(join(repo, "keep.txt"), "k\n");
    writeFileSync(join(repo, "old-name.txt"), "content\n");
    const base = commitAll(repo, "seed");
    unlinkSync(join(repo, "keep.txt"));
    renameSync(join(repo, "old-name.txt"), join(repo, "new-name.txt"));
    commitAll(repo, "rename and delete");

    const change = collectChangeSet(repo, base);
    expect(change.files).toContainEqual({
      path: "new-name.txt",
      status: "renamed",
      previousPath: "old-name.txt",
      added: 0,
      removed: 0,
    });
    expect(change.files).toContainEqual({
      path: "keep.txt",
      status: "deleted",
      added: 0,
      removed: 1,
    });
    expect(change.touchedPaths).toEqual(
      expect.arrayContaining(["keep.txt", "old-name.txt", "new-name.txt"]),
    );
    expect(existsSync(join(repo, "new-name.txt"))).toBe(true);
  });

  it("caps first-run history when commit count exceeds the cap", () => {
    const shas = ["a", "b", "c", "d", "e"];
    const { window, capped } = oldestShaInCappedWindow(shas, 3);
    expect(capped).toBe(true);
    expect(window).toEqual(["c", "d", "e"]);
  });

  it("does not cap a short first-run history", () => {
    const repo = tmpRepo();
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
      commitAll(repo, `commit ${i}`);
    }

    const change = collectChangeSet(repo, null);
    expect(change.capped).toBe(false);
    expect(change.commits).toHaveLength(3);
  });
});

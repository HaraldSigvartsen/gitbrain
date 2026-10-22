import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

describe("scheduling examples", () => {
  it("ships a GitHub Action workflow that heals and opens a PR", () => {
    const yaml = readFileSync(new URL("examples/github-action/heal.yml", root), "utf8");
    expect(yaml).toMatch(/brain heal/);
    expect(yaml).toMatch(/fetch-depth:\s*0/);
    expect(yaml).toMatch(/peter-evans\/create-pull-request/);
  });

  it("documents cron and launchd recipes", () => {
    const doc = readFileSync(new URL("docs/scheduling.md", root), "utf8");
    expect(doc).toMatch(/crontab/);
    expect(doc).toMatch(/launchctl/);
    expect(doc).toMatch(/examples\/github-action/);
  });
});

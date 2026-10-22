# GitHub Action: scheduled `brain heal`

1. Install [gitbrain](https://github.com/HaraldSigvartsen/gitbrain) in CI (the workflow uses `npm install -g github:HaraldSigvartsen/gitbrain`).
2. Copy [`heal.yml`](heal.yml) to `.github/workflows/brain-heal.yml` in your project.
3. Ensure the default `GITHUB_TOKEN` can open pull requests (`permissions` in the workflow).

The job runs `brain heal` (not `--dry-run`). If memory changed, [create-pull-request](https://github.com/peter-evans/create-pull-request) commits `.brain/` updates and opens a PR for human review. No-op runs produce no PR.

Cron and local-machine recipes: [docs/scheduling.md](../../docs/scheduling.md).

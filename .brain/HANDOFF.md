# gitbrain — session handoff

> The warm start for the next session. Overwrite it at the end of every session and
> keep it under a screenful. Detail belongs in CONTEXT.md or DECISIONS.md.

- **Date:** 2026-10-25
- **What we did:** Added a local pre-push gate so typecheck + vitest run before `git push`. `npm run gate` runs `npm run check`. `.githooks/pre-push` is switched on by local `core.hooksPath=.githooks` (`prepare` / `npm run hooks:install`). Documented for humans in CONTRIBUTING.md and for agents in AGENTS.md. Recorded D-0011. Did not add a GitHub Actions workflow.
- **Where we stopped:** Hook install and push-blocking behavior are covered by `test/local-gate.test.ts`. The existing `.github/workflows/ci.yml` matrix is unchanged.
- **Next steps:** Review the PR. After merge, each clone needs one `npm install` (or `npm run hooks:install`) so the hook is active.
- **Open threads:** Pull-request CI still spends Actions minutes on the OS/Node matrix. Narrowing that workflow was out of scope; the gate only moves the fast check onto the machine that is about to push.

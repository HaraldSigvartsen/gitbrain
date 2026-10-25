# Contributing to gitbrain

Thanks for reading this — human contributions are especially welcome in a repo
that is otherwise built by a scheduled agent.

## Getting set up

```bash
git clone https://github.com/HaraldSigvartsen/gitbrain
cd gitbrain
npm install     # build, and point this clone at .githooks
npm run gate    # typecheck (tsc --noEmit) + tests (vitest)
```

Node >= 20. That's the whole setup — no services, no env vars.

## Local gate before you push

`npm run gate` runs `npm run check`: `tsc --noEmit`, then `vitest run`. That is the fast check CI already runs. It does not emit `dist/` (`npm run build` does that) and it does not rewrite formatting (`npm run format`).

`npm install` runs `prepare`, which builds and executes `npm run hooks:install`. That sets this clone's local git config `core.hooksPath` to `.githooks` (the setting is not committed; each clone does it once). The `pre-push` hook there runs `npm run gate` and aborts the push when the gate fails.

```bash
npm run gate    # what you and agents run before push
git push        # the hook runs the same gate again
```

If you installed with `npm install --ignore-scripts`, run `npm run hooks:install` yourself. `core.hooksPath` replaces `.git/hooks` for this clone; keep any extra hooks in `.githooks/`.

`git push --no-verify` skips the hook. Use it only when you mean to push without the gate.

Agents: run `npm run gate` and get a clean pass before every push. Do not add a GitHub Actions workflow as a substitute — the existing CI workflow stays, and new hosted checks are out of scope. See [AGENTS.md](AGENTS.md).

## What to work on

[ROADMAP.md](ROADMAP.md) is the backlog and the spec: each unchecked unit is
roughly PR-sized and lists its acceptance criteria. When in doubt, pick the
first unchecked unit so the version order stays intact. Open an issue first if
you want to build something that isn't on the roadmap.

## Ground rules

- **Design rules first.** Read [ARCHITECTURE.md](ARCHITECTURE.md) — plain files,
  code wins, boring technology, small dependency surface, idempotency. New
  runtime dependencies need a `D-xxxx` decision entry in this repo's own
  `.brain/DECISIONS.md` justifying them.
- **Tests come with the code.** Every unit of logic ships with vitest coverage.
  `npm run gate` (that is, `npm run check`) must pass locally before you push;
  the pre-push hook enforces it, and CI runs the same check on pull requests.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- **Update the brain.** If your PR changes how something works, update
  `.brain/CONTEXT.md` and, for significant choices, add a `D-xxxx` entry to
  `.brain/DECISIONS.md`. Describe your PR the way you'd write a decision entry:
  what forces were at play and what you chose.

## The dog is food

This repo uses gitbrain on itself. If you find the memory stale or wrong,
that's a bug — either in the discipline or in the tool. Fix either.

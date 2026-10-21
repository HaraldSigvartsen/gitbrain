# Contributing to gitbrain

Thanks for reading this — human contributions are especially welcome in a repo
that is otherwise built by a scheduled agent.

## Getting set up

```bash
git clone https://github.com/HaraldSigvartsen/gitbrain
cd gitbrain
npm install
npm run check   # typecheck (tsc --noEmit) + tests (vitest)
```

Node >= 20. That's the whole setup — no services, no env vars.

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
- **Tests come with the code.** Every unit of logic ships with vitest coverage;
  `npm run check` must pass or the CI (and the build agent) will reject it.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- **Update the brain.** If your PR changes how something works, update
  `.brain/CONTEXT.md` and, for significant choices, add a `D-xxxx` entry to
  `.brain/DECISIONS.md`. Describe your PR the way you'd write a decision entry:
  what forces were at play and what you chose.

## The dog is food

This repo uses gitbrain on itself. If you find the memory stale or wrong,
that's a bug — either in the discipline or in the tool. Fix either.

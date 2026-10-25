# Agents working in this repo

Run the local gate before you push. Do not add a GitHub Actions workflow to stand in for it.

1. `npm install` once per clone. That builds the CLI and sets `git config core.hooksPath .githooks`.
2. If install scripts were skipped, run `npm run hooks:install`.
3. `npm run gate` — typecheck (`tsc --noEmit`) and tests (`vitest run`), the same `npm run check` CI runs. It should finish in a few minutes.
4. `git push`. `.githooks/pre-push` runs the gate again and aborts the push when it fails.

`git push --no-verify` skips the hook. Use it only when you are deliberately not running the gate.

Project memory for this repo is in `.brain/`. Contributor setup and the gate are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

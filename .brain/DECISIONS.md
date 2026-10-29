# gitbrain — decision log

> Decisions a future session (or a future you) must not unknowingly reverse.
> Never delete entries — supersede them. The reconciler closes entries the code has overruled.

Entry format (new entries go at the top, right below this header):

    ## D-0001 — <short, searchable title>
    - **Date:** <yyyy-mm-dd>
    - **Status:** active            <!-- active | superseded | closed -->
    - **Context:** <the problem and the forces at play>
    - **Choice:** <what we chose, and what we rejected>
    - **Consequences:** <what this implies and what it rules out>

IDs are sequential (D-0001, D-0002, …) and are never reused.

---

## D-0011 — Local pre-push gate, not more GitHub Actions
- **Date:** 2026-10-25
- **Status:** active
- **Context:** GitHub Pro still bills Actions minutes, and the existing CI matrix (3 OS × 2 Node versions) already runs `npm run check` on pull requests. Adding more hosted workflows would spend minutes on a check a laptop finishes in one shot. The repo also keeps a small dependency surface (D-0002).
- **Choice:** `npm run gate` runs the existing fast check (`tsc --noEmit` and `vitest run`). A POSIX hook at `.githooks/pre-push` runs it and aborts a failed push. `npm install` (via `prepare`) and `npm run hooks:install` set this clone's local `core.hooksPath` to `.githooks`. Rejected: husky (another devDependency, and `prepare` already builds), copying the hook into `.git/hooks` (drifts from the committed script), and any new GitHub Actions workflow.
- **Consequences:** Each clone enables the hook once (`npm install` or `npm run hooks:install`). `core.hooksPath` replaces `.git/hooks` for that clone. If `core.hooksPath` is already set to something else, install leaves it and you run `npm run gate` by hand. `git push --no-verify` still bypasses the hook. `.github/workflows/ci.yml` stays; this does not remove hosted CI. The hook is not part of the published npm tarball (`files` whitelist). Agents run `npm run gate` before push.

## D-0010 — npm identity is @siggysaggy/gitbrain
- **Date:** 2026-10-25
- **Status:** active
- **Context:** Publishing under `@haraldsigvartsen` was impossible — that npm scope does not exist; Harald's npm user is `siggysaggy`. First publish attempts appeared staged-but-404 (suspected 2FA/OTP), then resolved: versions 0.3.0 and 0.3.1 went live on 24 Oct 2026.
- **Choice:** Package name `@siggysaggy/gitbrain`; GitHub repo stays `HaraldSigvartsen/gitbrain`; binary stays `brain`. README and docs install lines now use the npm name.
- **Consequences:** The 0.3.1 tarball reports `--version 0.3.0` (src/version.ts was out of sync at publish time) — fixed on main, ship with the next release. A stray `0.0.0-stage` version sits in the registry's version list; harmless, ignore or deprecate later.

## D-0009 — README demo is a committed GIF; the transcript stays canonical
- **Date:** 2026-10-23
- **Status:** active
- **Context:** The README needs a real demo (v0.7), not an ASCII sketch. A GIF is a binary asset in a text repo and can silently rot when CLI output changes.
- **Choice:** `docs/demo.gif` (647KB, 920×520) is recorded by `./scripts/demo.sh --vhs` from `scripts/demo.tape`; the demo uses a fixed heal date so the committed text transcript (`examples/demo-project/demo-transcript.txt`) regenerates byte-identically — if a change alters heal output, `--refresh` shows it in git and the GIF must be re-recorded. Fixed `vhs record <tape>` → `vhs <tape>` (current VHS CLI). Social preview lives at `docs/social-preview.svg` (source) and `docs/social-preview.jpg` (1200×640, 87KB) for GitHub repo settings upload.
- **Consequences:** Regenerate both together: `npm run build && ./scripts/demo.sh --refresh && ./scripts/demo.sh --vhs`. The social preview upload itself is a manual repo-settings action (no stable API).

## D-0008 — Optional LLM summary via native fetch (no new runtime deps)
- **Date:** 2026-10-23
- **Status:** active
- **Context:** v0.6 roadmap calls for optional LLM summarisation on `brain heal` and `brain ask` without making network calls the default or adding SDK dependencies.
- **Choice:** `--summarize` flags call an OpenAI-compatible `POST /v1/chat/completions` using Node’s built-in `fetch`. Keys and model come from env (`GITBRAIN_LLM_*`, fallback `OPENAI_API_KEY`). Prompts only include structured drift or retrieval facts already computed offline. Rejected: bundling OpenAI SDK; reading `.env` files from the repo.
- **Consequences:** Default CLI stays offline. Users who opt in must supply credentials via environment variables only. Tests inject a mock `fetch`.

## D-0007 — Repo paths are always posix in brains and drift output
- **Date:** 2026-10-23
- **Status:** active
- **Context:** Windows git and editors can emit backslash paths; mixed separators break drift matching and make reports non-portable.
- **Choice:** Centralise `toPosixRepoPath` in `src/path.ts`; normalise git name-status/numstat paths, CONTEXT/`Where:` parsing, heal CLI report paths, and staged `.brain/` paths for commit. CI runs on ubuntu/macos/windows with Node 20 and 22. Rejected: leaving paths OS-native in markdown.
- **Consequences:** All repo-relative paths in memory files and reports use `/`. Filesystem access still uses `node:path` joins under the project root.

## D-0006 — First-run cap uses rev-list count/skip; heal --since is a floor ref
- **Date:** 2026-10-23
- **Status:** active
- **Context:** Large repos made first heal load every SHA via `rev-list --reverse`. Operators also need to bound catch-up without editing `brain.json`.
- **Choice:** Cap the first-run window with `rev-list --count` and `--skip` (no full SHA list). `brain heal --since` accepts a commit-ish or ISO date; the effective floor is the later of `--since` and `last_reconciled_sha`. First-run windows still cap at 500 commits when the range is larger. Rejected: raising the cap or disabling it by default.
- **Consequences:** `--since` cannot skip reconciling commits newer than the ledger floor. Documented in README and `docs/cli.md`.

## D-0005 — Recorded SHAs are hex-validated; numstat parsed only in -z form
- **Date:** 2026-10-22
- **Status:** active
- **Context:** `last_reconciled_sha` comes from `brain.json` — repo-controlled input — and `execFile` passes it straight into git's argv, so a crafted value starting with `--` would be parsed by git as an option (option injection). Separately, plain `git diff --numstat` brace-compresses same-directory rename paths (`src/{old.ts => new.ts}`), which made rename line counts silently read as 0/0 and fed the drift detector's "heavily rewritten" heuristic wrong.
- **Choice:** Validate the recorded SHA as 7–40 hex chars before any git call, with a friendly error for SHAs that history no longer contains. Parse numstat only with `-z`, where a rename record is `added\tremoved\t` + NUL + old + NUL + new (verified empirically). Rejected: unquoting the brace-compressed form.
- **Consequences:** Any future code path that passes ledger values to git must validate first. Same-directory renames with edits now carry real counts (regression-tested).

## D-0004 — Markdown is the source of truth; brain.json is only an index
- **Date:** 2026-10-21
- **Status:** active
- **Context:** Agents and humans edit markdown; a machine needs stable IDs and statuses to reason about drift. Two sources of truth would diverge.
- **Choice:** The `.brain/*.md` files are canonical. `brain.json` is a derived index that must always be reconstructible from the markdown (a future `brain lint` enforces this). Rejected: JSON-only memory (hostile to humans and agents) and markdown-only (no stable machine contract).
- **Consequences:** Every entry needs an ID in its heading. Parsing the markdown is a required part of v0.3, not optional.

## D-0003 — vitest 5 for the dev toolchain
- **Date:** 2026-10-21
- **Status:** active
- **Context:** vitest 2.x pulled in tinypool/esbuild/vite versions with critical advisories (prototype-pollution RCE gadgets, dev-server request forgery). Dev-only, but a public repo should not ship a lockfile with known criticals.
- **Choice:** vitest `^5.0.5`, clean reinstall. Audit is clean. Rejected: staying on 2.x and ignoring dev-only advisories.
- **Consequences:** Node >= 20 stays the floor. Keep the test API surface minimal (`describe`/`it`/`expect`, `defineConfig`) so future major bumps stay cheap.

## D-0002 — commander is the only runtime dependency
- **Date:** 2026-10-21
- **Status:** active
- **Context:** The tool must stay boring, offline and small. A hand-rolled argument parser would be churn for every new command; a heavy CLI framework would be dependency sprawl.
- **Choice:** `commander` as the single runtime dependency. Git access will shell out to the `git` binary via `execFile` — no git libraries. Rejected: isomorphic-git, oclif, yargs.
- **Consequences:** Any new runtime dependency needs its own decision entry here. Prettier/TypeScript/vitest are dev-only.

## D-0001 — Project name "gitbrain", npm package scoped
- **Date:** 2026-10-21
- **Status:** superseded
- **Context:** The bare npm name `gitbrain` is taken by an unrelated package; the GitHub name is free and no notable project uses it. Splitting names (one on GitHub, another on npm) would confuse users.
- **Choice:** GitHub repo `HaraldSigvartsen/gitbrain`, binary `brain`, npm package `@haraldsigvartsen/gitbrain`. The ledger strips the scope so the project name is `gitbrain`. Rejected: renaming the project to fit a free npm name.
- **Consequences:** README install uses the GitHub URL until v0.7 publishes to npm. Revisit whether the bare npm name became available or transferable at v0.7.

> healed 2026-10-25 — superseded by D-0010: the npm scope had to follow the actual npm username (`siggysaggy`), not the GitHub handle. GitHub repo name and binary name are unchanged.

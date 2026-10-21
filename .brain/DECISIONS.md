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
- **Status:** active
- **Context:** The bare npm name `gitbrain` is taken by an unrelated package; the GitHub name is free and no notable project uses it. Splitting names (one on GitHub, another on npm) would confuse users.
- **Choice:** GitHub repo `HaraldSigvartsen/gitbrain`, binary `brain`, npm package `@haraldsigvartsen/gitbrain`. The ledger strips the scope so the project name is `gitbrain`. Rejected: renaming the project to fit a free npm name.
- **Consequences:** README install uses the GitHub URL until v0.7 publishes to npm. Revisit whether the bare npm name became available or transferable at v0.7.

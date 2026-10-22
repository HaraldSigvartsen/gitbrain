# Demo project: drift then heal

A minimal fake repo that shows what happens when code moves on but `.brain/` memory does not.

## Story

1. An agent recorded **O-0001** pointing at `src/checkout/queue.ts`.
2. A later commit **deleted** that file.
3. `brain heal` closes the observation and writes a dated drift report.

## Files

| Path | Purpose |
|------|---------|
| [`build-history.sh`](build-history.sh) | Recreates the git history in any empty directory (uses `dist/cli.js` from the gitbrain repo). |
| [`snapshots/before-heal/`](snapshots/before-heal/) | Project tree at `HEAD` **before** heal (stale observation). |
| [`snapshots/after-heal/`](snapshots/after-heal/) | Same tree **after** `brain heal` (closed entry + report). |
| [`heal-output.txt`](heal-output.txt) | Terminal output from `brain heal` on a freshly built repo. |
| [`demo-transcript.txt`](demo-transcript.txt) | Full command transcript (`scripts/demo.sh --refresh`). |

## Try it locally

From the gitbrain repository root (after `npm run build`):

```bash
DIR=$(mktemp -d)
./examples/demo-project/build-history.sh "$DIR"
node dist/cli.js heal --dry-run "$DIR"   # preview
node dist/cli.js heal "$DIR"             # apply
```

Compare your tree to the committed snapshots, or diff against `heal-output.txt`.

Or run the scripted walkthrough from the gitbrain repo root:

```bash
npm run build
./scripts/demo.sh              # live demo in a temp directory
./scripts/demo.sh --refresh    # update heal-output.txt + demo-transcript.txt
```

When refreshing snapshots from a built repo, exclude `.git` (e.g. `rsync -a --exclude .git "$DIR"/ snapshots/before-heal/`).

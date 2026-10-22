#!/usr/bin/env bash
# Build a tiny git repo that demonstrates memory drift (observation → deleted file).
# Usage: build-history.sh <empty-target-directory>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="${GITBRAIN_CLI:-$ROOT/dist/cli.js}"
TARGET="${1:?usage: $0 <empty-target-directory>}"

if [[ -e "$TARGET" ]] && [[ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]]; then
  echo "refusing to use non-empty directory: $TARGET" >&2
  exit 1
fi

mkdir -p "$TARGET"
cd "$TARGET"

git init -q
git config user.email "demo@example.com"
git config user.name "gitbrain demo"

if [[ ! -f "$CLI" ]]; then
  echo "missing CLI at $CLI — run npm run build in the gitbrain repo first" >&2
  exit 1
fi

# Stable project label in .brain/ (independent of the temp directory name).
echo '{"name":"acme-checkout"}' > package.json

node "$CLI" init >/dev/null

cat > .brain/OBSERVATIONS.md <<'EOF'
# acme-checkout — observations ("things I noticed")

## O-0001 — Race in checkout queue
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** `src/checkout/queue.ts`
- **Found:** 2026-10-20
- **Detail:** Consumer races when two workers ack the same batch.

---
EOF

node - <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const ledger = JSON.parse(readFileSync(".brain/brain.json", "utf8"));
ledger.observations = [
  {
    id: "O-0001",
    title: "Race in checkout queue",
    status: "open",
    updated: "2026-10-20",
  },
];
writeFileSync(".brain/brain.json", JSON.stringify(ledger, null, 2) + "\n");
NODE

mkdir -p src/checkout
cat > src/checkout/queue.ts <<'EOF'
/** Minimal queue stub — removed in a later commit to trigger heal. */
export function processBatch(): void {}
EOF

cat > README.md <<'EOF'
# acme-checkout (demo)

Fake project for gitbrain examples. Memory still points at `src/checkout/queue.ts` after the file was deleted.
EOF

git add -A
git commit -q -m "Add checkout queue and brain memory"

rm src/checkout/queue.ts
rmdir src/checkout 2>/dev/null || true
git add -A
git commit -q -m "Remove queue module"

echo "Demo repo ready at $TARGET ($(git rev-parse --short HEAD))"

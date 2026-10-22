# acme-checkout — observations ("things I noticed")

## O-0001 — Race in checkout queue
- **Priority:** IMPORTANT
- **Status:** fixed
- **Where:** `src/checkout/queue.ts`
- **Found:** 2026-10-20
- **Detail:** Consumer races when two workers ack the same batch.

---

> healed 2026-10-22 — src/checkout/queue.ts was deleted in the reconciled range

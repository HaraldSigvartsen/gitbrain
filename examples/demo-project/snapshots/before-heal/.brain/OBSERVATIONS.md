# acme-checkout — observations ("things I noticed")

## O-0001 — Race in checkout queue
- **Priority:** IMPORTANT
- **Status:** open
- **Where:** `src/checkout/queue.ts`
- **Found:** 2026-10-20
- **Detail:** Consumer races when two workers ack the same batch.

---

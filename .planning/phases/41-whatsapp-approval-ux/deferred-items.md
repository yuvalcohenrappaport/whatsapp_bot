# Phase 41 — Deferred Items

Out-of-scope failures observed while executing the phase. NOT caused by Phase 41 changes. Do NOT auto-fix as part of this phase.

## Pre-existing vitest failures (unrelated to approval module)

Observed during Plan 41-01 (`npx vitest run`, 2026-04-19):

- `src/db/queries/__tests__/actionables.test.ts` — collection error: `better-sqlite3` native binding did not self-register (`/home/yuval/whatsapp-bot/node_modules/better-sqlite3/build/Release/better_sqlite3.node`). Known Node/Electron-ABI mismatch; needs a `npm rebuild better-sqlite3` outside this phase.
- `src/db/__tests__/backfill.test.ts` — same native-module failure (10 tests blocked behind the same import).
- `src/commitments/__tests__/CommitmentDetectionService.test.ts` — 4 tests red; flagged as pre-existing baseline failures in Phase 36 SUMMARY + STATE.md. Out of scope for Phase 41.

Phase 41's surface (`src/approval/`) is pure-function TS with no DB and no Gemini calls, so these failures cannot be triggered by Plan 41-01..05. They are logged here for visibility and will be picked up in a future plumbing cleanup plan.

**Verification that Plan 41-01 is green:** `npx vitest run src/approval/__tests__/` → 2 files, 34 tests, all pass, 237ms total.

# Phase 45 Deferred Items

Items discovered during Phase 45 plan execution that are OUT OF SCOPE for the current plan
but should be addressed in future work. Each entry includes: what, when found, why deferred,
scope-boundary justification.

---

## 1. `NODE_ENV=test` not recognized by `src/config.ts` Zod enum — **RESOLVED 2026-04-20**

- **Found:** Plan 45-02, Task 2 verification (running regression check on plan 43-01's `actionables.test.ts`).
- **Symptom:** `npx vitest run src/api/__tests__/actionables.test.ts` failed with `process.exit(1)` because `src/config.ts:44` called `process.exit(1)` after Zod rejected `NODE_ENV=test`. Valid enum values were only `development` and `production`.
- **Fix:** Added `'test'` to the Zod enum in `src/config.ts:7` → `NODE_ENV: z.enum(['development', 'production', 'test']).default('development')`. One-line change, runtime behavior unchanged (enum still defaults to `development`; `test` is only chosen when vitest sets it).
- **Verification:** 35/35 tests pass under explicit `NODE_ENV=test` across `approvalHandler.test.ts` (20) + `actionablesWriteActions.test.ts` (15). Suites that ALSO hit `better-sqlite3` still need Node 20 to match PM2's interpreter pin — that's a separate ABI concern, not this deferred item.

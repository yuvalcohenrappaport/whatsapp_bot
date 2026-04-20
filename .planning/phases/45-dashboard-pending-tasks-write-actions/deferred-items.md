# Phase 45 Deferred Items

Items discovered during Phase 45 plan execution that are OUT OF SCOPE for the current plan
but should be addressed in future work. Each entry includes: what, when found, why deferred,
scope-boundary justification.

---

## 1. `NODE_ENV=test` not recognized by `src/config.ts` Zod enum

- **Found:** Plan 45-02, Task 2 verification (running regression check on plan 43-01's `actionables.test.ts`).
- **Symptom:** `npx vitest run src/api/__tests__/actionables.test.ts` fails with `process.exit(1)` because `src/config.ts:44` calls `process.exit(1)` after Zod rejects `NODE_ENV=test`. Valid enum values are only `development` and `production`.
- **Scope check:** Verified pre-existing by reverting Plan 45-02's route changes and re-running — same failure.
- **Impact:** Any vitest file that imports from `src/config.js` (directly or transitively) without mocking it will fail under default Vitest env. Workaround: `NODE_ENV=development npx vitest run <path>`.
- **Plan 45-02 scope:** Worked around locally by mocking `../../config.js` inside `actionablesWriteActions.test.ts` — my new suite runs 15/15 green without any env flag.
- **Proper fix (future chore):** Either (a) add `'test'` to the Zod enum in `src/config.ts` env schema, or (b) set `NODE_ENV=development` in a vitest setup file / `vitest.config.ts`.
- **Why deferred:** Repo-wide test-infra concern, not a Plan-45 feature requirement. Per SCOPE BOUNDARY rule — "only auto-fix issues DIRECTLY caused by the current task's changes."

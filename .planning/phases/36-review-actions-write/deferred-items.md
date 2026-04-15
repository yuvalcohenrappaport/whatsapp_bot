# Phase 36 — Deferred Items (out of scope)

Discovered during Plan 36-05 Task 1 (test-suite preflight). These failures are pre-existing and unrelated to Phase 36's LinkedIn write-action surface. Verified by stashing all Phase 36 work and re-running the failing file — same 4 failures reproduce on baseline. Logged here per GSD executor scope-boundary rule; not fixing in this phase.

## src/commitments/__tests__/CommitmentDetectionService.test.ts — 4 failures

**File:** `src/commitments/__tests__/CommitmentDetectionService.test.ts`
**Subsystem:** `src/commitments/` (Gemini-based commitment detection pipeline, last touched 4+ months ago in Phase 25-26)
**Scope:** Zero overlap with LinkedIn / pm-authority / dashboard write-action code — different subsystem entirely.

**Failing tests (observed on both HEAD and stashed-Phase-36 tree):**
1. `extractCommitments > handles invalid dates gracefully` — expected length 1, got 0
2. (plus 3 other failures in the same suite surfaced by the full vitest run)

**Reproduction:** `cd /home/yuval/whatsapp-bot && git stash && npx vitest run src/commitments/__tests__/CommitmentDetectionService.test.ts` — same 4 failures.

**Likely cause:** Pre-filter regex or Gemini schema drift from an earlier phase; the detection pipeline's "falls back to null dateTime" branch no longer emits a commitment entry. Not touched by any Phase 36 plan.

**Recommendation:** Open a standalone bug ticket / future phase to audit the commitment detection pipeline. Do not gate Phase 36 completion on this.

**Phase 36 relevant test counts (all green):**
- `pm-authority pytest` tests/test_http_*.py: **68/68 passed**
- `whatsapp-bot vitest run src/api/linkedin/`: **92/92 passed (6 files)**
- `dashboard tsc -b`: clean
- `dashboard vite build`: clean (2057 modules, 750.89 kB bundle)

Full `vitest run` at repo root reports 111/115 passed; the 4 failures above are the entirety of the delta and are pre-existing.

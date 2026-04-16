# Phase 37 — Deferred Items (out of scope for execution)

Pre-existing failures discovered while running the full vitest suite during Plan 37-01.
NOT caused by Phase 37 work. Documented per GSD scope-boundary policy.

## src/commitments/__tests__/CommitmentDetectionService.test.ts (4 failures)

Failing tests (pre-existing, unrelated to LinkedIn schema additions):
- `returns commitments when Gemini returns high/medium confidence`
- `filters out low confidence results`
- `handles null dateTime (timeless commitments)`
- `handles invalid dates gracefully`

Source file last touched in commits a2a88cd (Phase 26-02) and e3e7e9c (Phase 25-01).
LinkedIn schema and lesson-mode UX work does not import from src/commitments/. Skipping per scope rule.

Recommendation: open a separate maintenance ticket to re-baseline the Gemini
extraction tests; not blocking on Phase 37.

## Pre-existing dashboard tsc -b errors (4 errors, observed during Plan 37-04)

Unrelated to Phase 37 files:

- `src/components/groups/KeywordRuleFormDialog.tsx:105` — `Record<string, unknown>` cast to `CreateKeywordRuleInput` (missing required fields name/pattern/responseType).
- `src/pages/Overview.tsx:166` — `regeneratePersona` and `isRegeneratingPersona` missing from settings hook return type.
- `src/pages/Overview.tsx:181` — `globalPersona` missing from `Settings` type.

These errors existed on HEAD before Plan 37-04. Verified via `git stash` / `npx tsc -b` round-trip. LinkedIn subsystem typecheck is clean (no `linkedin|postStatus|LinkedIn` hits in tsc output).

Recommendation: separate maintenance plan for the groups + overview settings/persona refactor.

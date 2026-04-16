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

## BLOCKER — whatsapp-bot crash loop on boot (observed 2026-04-16 during Plan 37-05 Task 2)

`src/ai/gemini.ts:1` imports `getPairedExamples` and `getAllFromMeMessages` from `../db/queries/messages.js`, but `src/db/queries/messages.ts` only exports `insertMessage`, `getRecentMessages`, and `getStyleExamples`. The missing named imports cause ESM instantiation to fail with `SyntaxError: The requested module '../db/queries/messages.js' does not provide an export named 'getAllFromMeMessages'`.

Introduced in commit `82e9fdda` (`feat(31-01): add resolveContent, sendVoiceWithTimeout, ttsQueue, export buildSystemPrompt`, 2026-03-30) — the symbols are imported and called in `gemini.ts:149` (`getPairedExamples`) and `gemini.ts:243` (`getAllFromMeMessages`) but their query-side implementations never landed in `messages.ts`.

Impact on Phase 37: `npx pm2 restart whatsapp-bot` puts the service into a crash loop (pid churn visible via `pm2 describe whatsapp-bot` → restart count climbing every ~8s). Port 3000 never binds. `/api/linkedin/*` proxy is unreachable. The previous pid (2044484) had uptime 10h pre-restart, but restart count was already 422 — the bot has been cycling for weeks. It likely gets through enough boot cycles to briefly serve requests between crashes.

BLOCKS Plan 37-05 Task 3 (live browser walkthrough) — the dashboard cannot proxy to pm-authority without whatsapp-bot up.

Out of scope for Phase 37 per scope-boundary policy — touching `src/ai/gemini.ts` or `src/db/queries/messages.ts` would be adding backend AI query behavior with unknown semantics. Flagged to owner in the Plan 37-05 checkpoint return.

Recommendation: separate maintenance plan to either (a) implement `getPairedExamples` + `getAllFromMeMessages` in `messages.ts` with proper Drizzle queries, or (b) stub them to throw-on-call and stop importing them from gemini.ts at module top-level.

## Additional state.db reality check (observed 2026-04-16 during Plan 37-05 Task 2)

Live pm-authority state.db has only PUBLISHED (3) and REJECTED (27) posts. Zero posts in PENDING_LESSON_SELECTION, PENDING_VARIANT, DRAFT, APPROVED, or PENDING_PII_REVIEW.

Lesson-mode artifacts exist but are attached to REJECTED posts:
- 4 lesson_candidates rows attached to 1 REJECTED post (1 selected)
- 8 post_variants rows attached to 4 REJECTED posts (2 variants each)

Data seeding options for SC walkthrough (if whatsapp-bot is unblocked):
- Path A (non-destructive recycle): flip a REJECTED post with lesson_candidates back to PENDING_LESSON_SELECTION by clearing `lesson_candidates.selected` and setting `posts.status`. Similarly for PENDING_VARIANT.
- Path B (real generation): `cd /home/yuval/pm-authority && ./.venv/bin/python -m generation.cli ...` to produce a fresh lesson run — 10-60s LLM call.
- Path C (observational degradation): skip SC#3 fal.ai verification; inject a mock post via devtools to check only UI primitives.

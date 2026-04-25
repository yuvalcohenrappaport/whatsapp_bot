---
phase: 51-richer-trip-memory
plan: 02
subsystem: classifier
tags: [zod, gemini, trip-memory, hebrew, tdd, travel-agent-v2.1]

# Dependency graph
requires:
  - phase: 51-01
    provides: tripDecisions v2.1 columns (proposed_by, category, cost_amount, cost_currency, origin) + insertTripDecision signature that accepts them
provides:
  - TripClassifierSchema v2.1 shape (4 new nullable fields per decision: category, cost_amount, cost_currency, proposed_by)
  - Exported `classifyBatch(messages)` helper (pure Gemini wrapper, no DB touch) for tests + future non-pipeline callers
  - `resolveProposerJid(name, batch)` — maps classifier's proposer NAME to senderJid via case-insensitive substring match
  - Exported `processTripContext(groupJid, messages)` so the persistence path is unit-testable
  - 10 Hebrew test fixtures covering flights/lodging/activities/food/transit/shopping/destination/budget/USD/multi-message proposer attribution
  - Accuracy harness (10/10 passed on the current Gemini model)
affects: [51-03-conflict-detector (consumes inferred decisions with costAmount+costCurrency), 51-04-self-report-commands (mirrors proposed_by wiring for origin='self_reported'), 55-dashboard (category rollups + per-person attribution)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.mock delegating to vi.importActual with vi.fn() wrappers — same mock module can serve both real-API accuracy tests and per-test overrides, no need to split files"
    - "Classifier field guide in prompt: explicit enum rules + 7 worked examples beats abstract field descriptions for Hebrew decision classification"
    - "Name→JID resolution via case-insensitive substring match on senderName, falls back to null when the classifier returns a name not present in the batch"

key-files:
  created:
    - src/groups/__tests__/tripClassifier.fixtures.ts
    - src/groups/__tests__/tripClassifier.test.ts
  modified:
    - src/groups/tripContextManager.ts

key-decisions:
  - "Classifier schema extension fits within the existing single generateJson call — no second Gemini round-trip. The 4 new fields are required-nullable Zod entries, so the model always emits them."
  - "Expose `classifyBatch` and export `processTripContext` + `TripClassifierSchema` rather than restructuring the module — keeps persistence wiring intact for the live pipeline while giving tests clean seams."
  - "Proposer NAME→JID resolution lives in tripContextManager (not tripMemory) because it needs the batch's senderJid context, and it runs once per decision insert. Case-insensitive substring match tolerates minor model spelling drift (e.g. 'Yossi' vs 'יוסי')."
  - "vi.mock delegates to the real provider by default via vi.importActual; persistence test overrides generateJson via mockResolvedValueOnce. One mock declaration, both suites satisfied, no need to split the test file."

patterns-established:
  - "Gemini classifier prompt + examples: 'Field guide' section with explicit enum rules, followed by 7+ worked examples in Hebrew covering every field's null/non-null transitions, yields ≥0.8 accuracy on a single-shot prompt."
  - "Test harness for real-API classifiers: gate the accuracy suite on GEMINI_API_KEY via `it.skipIf(!hasKey)`, print a passed/N log line for observability, fail on ratio < threshold rather than all-or-nothing."

requirements-completed: [MEM2-01, MEM2-02, MEM2-04]

# Metrics
duration: 12min
completed: 2026-04-23
---

# Phase 51 Plan 02: Classifier Upgrade — proposed_by + category + cost_amount + cost_currency

**Gemini trip-context classifier now extracts the four v2.1 structured fields from Hebrew WhatsApp chat with 10/10 accuracy on the hand-written fixture dataset, and writes them through to `trip_decisions` with `origin='inferred'`.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-23T20:01:10Z
- **Completed:** 2026-04-23T20:12:51Z
- **Tasks:** 2 (TDD RED → GREEN)
- **Files modified:** 1 (tripContextManager.ts)
- **Files created:** 2 (fixtures + test harness)

## Accomplishments

- **Zod schema extended:** `TripClassifierSchema` now has `category` (7-value enum, nullable), `cost_amount` (number, nullable), `cost_currency` (3-char ISO-4217, nullable), `proposed_by` (string, nullable) on every decision entry. Exported so tests can safeParse shapes directly.
- **Prompt tightened with Field guide:** 8-rule category enum taxonomy + currency-symbol inference table + explicit proposer-attribution rules ("first message in batch wins; later 'סגרנו' doesn't reassign"), followed by 7 Hebrew worked examples. Single-shot prompt, no multi-turn dance, no second Gemini call.
- **`classifyBatch(messages)` exported:** pure wrapper around prompt-build + generateJson, no DB coupling. Built for tests but reusable by any non-debounce caller.
- **`resolveProposerJid(name, batch)` added:** maps classifier's proposer NAME to senderJid via case-insensitive substring. Case tolerates model spelling drift.
- **Persistence wired end-to-end:** `processTripContext`'s decision loop now passes `category`, `costAmount`, `costCurrency`, `proposedBy`, and `origin: 'inferred'` to `insertTripDecision` alongside the existing fields.
- **10 Hebrew fixtures cover the edge cases:** flight (EUR), hotel (EUR, 3 nights), activity-no-price (colosseum), restaurant (food category, per-person), transit (train rome→florence), shopping (leather, Florence), multi-message proposer resolution (Wizz: Yossi proposes, Dani seals), USD currency (restaurant), destination-only (Italy, null cost), total budget (5000 EUR, category=null).
- **Accuracy harness 10/10 passed** on the real Gemini API (≥0.8 threshold, achieved 1.0). Every fixture matched every new field.
- **Persistence round-trip mock green:** `insertTripDecision` called with `origin='inferred'`, `category='flights'`, `costAmount=450`, `costCurrency='EUR'`, `proposedBy='יוסי@s.whatsapp.net'` (the resolved JID).

## Task Commits

TDD cycle — 2 atomic commits:

1. **Task 1 (RED):** `ae78be6` `test(51-02): add failing classifier accuracy + persistence tests`
2. **Task 2 (GREEN):** `19e60aa` `feat(51-02): classifier extracts proposed_by, category, cost, currency with >=0.8 accuracy`

## Files Created/Modified

- `src/groups/__tests__/tripClassifier.fixtures.ts` — 10 Hebrew fixtures with expected decision fields (213 lines)
- `src/groups/__tests__/tripClassifier.test.ts` — Schema tests + accuracy harness (skipped without GEMINI_API_KEY) + persistence mock test (199 lines)
- `src/groups/tripContextManager.ts` — TripClassifierSchema export + 4 new nullable fields + Field guide in prompt + classifyBatch helper + resolveProposerJid + processTripContext export + insertTripDecision call wired with new fields + origin='inferred'

## Decisions Made

- **Single Gemini call, no second round-trip:** the 4 new fields fit inside the existing `decisions[]` schema. Adding a second call would double classifier latency and cost for zero correctness gain.
- **Name→JID resolution is insensitive-substring, not exact:** the model occasionally emits Latin transliterations (Yossi / יוסי). Substring match on `senderName.toLowerCase().includes(classifierName.toLowerCase())` tolerates the drift without a fuzzy-match library.
- **vi.mock with vi.importActual delegation:** avoided splitting the test file into "accuracy.test.ts" and "persistence.test.ts". Single file, single mock declaration that delegates to the real provider by default, per-test override via `mockResolvedValueOnce`.
- **Classifier proposer attribution = FIRST proposer:** when `[Yossi: I propose Wizz, Dani: sealed]` lands in one batch, `proposed_by='יוסי'`. Documented explicitly in the prompt so the model doesn't drift toward "last speaker wins".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `vi.mock` default implementation returned undefined, breaking accuracy suite**
- **Found during:** Task 2 verify (first full test run)
- **Issue:** The plan's RED template used `vi.mock('../../ai/provider.js', () => ({ generateJson: vi.fn(), ... }))`. The default-returning `vi.fn()` resolves to `undefined`, which caused `classifyBatch` to return null for every fixture in the accuracy suite — not the intended behavior, because the accuracy suite is supposed to hit real Gemini. Persistence suite also had to call `mockResolvedValue` every time to re-install the payload.
- **Fix:** Switched the `vi.mock` factory to `await vi.importActual(...)` and wrap `generateJson`/`generateText` with `vi.fn(actual.generateJson)`. Default delegates to the real provider; the persistence test overrides via `mockResolvedValueOnce` inside the `beforeEach` scope. One file, both suites satisfied.
- **Files modified:** `src/groups/__tests__/tripClassifier.test.ts` (committed in `19e60aa`)
- **Verification:** 4/4 tests green (2 schema + 1 accuracy 10/10 + 1 persistence); without the key: 3 passed + 1 skipped. Deterministic regardless of API-key availability.
- **Committed in:** `19e60aa` (Task 2 commit)

### Integration events (NOT deviations)

- **Plan 51-03's `runAfterInsert` hook was injected into `processTripContext`'s decision loop between my RED and GREEN steps** by the parallel Wave 2 agent. My GREEN edits layered on top cleanly — the `runAfterInsert(groupJid, decisionId).catch(() => {})` line lives AFTER my `insertTripDecision(...)` call, so both plans' concerns compose. Not a deviation because the plan's env notes explicitly flagged Wave 2 parallelism.
- **Parallel commits (`2b771b2`, `87f585e`, `709e2c8`, `403b130`) landed between my RED and GREEN.** My GREEN commit builds on top of them. Expected under Wave 2 file-disjoint parallelism.

---

**Total deviations:** 1 auto-fixed (Rule 1 bug in the test harness mock setup).
**Impact on plan:** Local correctness fix that kept the accuracy suite meaningful. No scope creep, no architectural change.

## Issues Encountered

- **Working-tree reverts visible mid-session:** between test runs, `tripContextManager.ts` showed the pre-51-02 state at two different points (before my edits, even though my Edit tool calls had succeeded). Tracing it via `git reflog` showed new parallel commits (51-03, 51-04) landing in the same window. Those commits touched the same file (`runAfterInsert` wiring). My edits had been committed earlier (`ae78be6`), then the parallel agent's commits re-applied the RED-state version of the schema (since they were working off a checkout that didn't have my GREEN changes). Resolved by re-applying my Task-2 edits on top of their latest HEAD and committing immediately.
- **Pre-existing `tsc` rootDir warnings on `cli/*.ts`** reproduce on every run. Out of scope — logged in Plan 51-01 `deferred-items.md`.

## User Setup Required

None — no external service configuration needed. The accuracy test requires `GEMINI_API_KEY` to exercise the real classifier; without it, the suite skips that block and still validates schema shape + persistence wiring.

## Next Phase Readiness

- **Plan 51-03 (conflict detector) already wired:** its `runAfterInsert(groupJid, decisionId)` hook is live inside the decision loop I extended. When it fires now, the row it reads back has full v2.1 metadata — `costAmount`, `costCurrency`, `category`, `proposedBy` — so the conflict graph has everything it needs.
- **Plan 51-04 (self-report commands) already wired:** its `handleSelfReportCommand` sits in the pipeline AHEAD of `addToTripContextDebounce`, so `!pref` / `!budget` / `!dates` never pollute the classifier buffer. `origin='self_reported'` on `insertTripDecision` is the complement of my `origin='inferred'`, so MEM2-04's full origin-label matrix is covered across both plans.
- **Plan 51-05 (auto-archive cron) unblocked:** classifier-produced rows now carry the full set of `trip_decisions` columns the archive flow reads (already exercised by 51-01's tests).
- **Dashboard (55): per-person + per-category burn rollups** can now pull `proposed_by` + `category` + `cost_amount` from any row produced post-deploy. Pre-deploy rows will have nulls on these columns; dashboard should fall back to type/value strings for those.

## Self-Check

- `src/groups/__tests__/tripClassifier.fixtures.ts` — FOUND (213 lines, 10 fixtures)
- `src/groups/__tests__/tripClassifier.test.ts` — FOUND (vi.importActual mock, accuracy + persistence + schema suites)
- `src/groups/tripContextManager.ts` — FOUND (5 exports: hasTravelSignal, addToTripContextDebounce, TripClassifierSchema, classifyBatch, processTripContext; resolveProposerJid used at the decision-insert site)
- Commit `ae78be6` (Task 1 RED) — FOUND in `git log`
- Commit `19e60aa` (Task 2 GREEN) — FOUND in `git log`
- Accuracy run: `passed 10/10. Failed: ` (i.e., empty failures list) — ≥0.8 threshold met
- Persistence mock run: 3 passed | 1 skipped (without API key) / 4 passed (with API key) — deterministic across both modes
- `npx tsc --noEmit` — pre-existing `cli/*.ts` rootDir warnings only, no new errors

## Self-Check: PASSED

---
*Phase: 51-richer-trip-memory*
*Completed: 2026-04-23*

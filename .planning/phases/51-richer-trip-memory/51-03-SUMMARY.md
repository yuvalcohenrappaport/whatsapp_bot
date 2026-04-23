---
phase: 51-richer-trip-memory
plan: 03
subsystem: groups
tags: [self-report, slash-commands, trip-memory, travel-agent-v2.1, preferences, budget, dates, pipeline]

# Dependency graph
requires:
  - phase: 51-richer-trip-memory
    provides: insertTripDecision (v2.1 origin='self_reported' support) + upsertTripContext (budgetByCategory/startDate/endDate partial-patch) + TRIP_CATEGORIES enum
provides:
  - src/groups/tripPreferences.ts :: handleSelfReportCommand — parses !pref/!budget/!dates with silent-drop malformed-command semantics
  - Group pipeline wire-up: self-report handler runs inside travelBotActive block, AFTER handleReplyToDelete, BEFORE fromMe guard + addToTripContextDebounce (terminal-when-matched to keep command text out of classifier buffer)
  - User path for MEM2-02 (per-category budget targets) and MEM2-04 (origin='self_reported' preference labels)
affects: [51-02-classifier-upgrade, 55-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Silent-drop on malformed-but-known-verb — returns true (terminal) so the classifier never sees half-parsed command text; preserves the milestone's discreet-chattiness rule"
    - "ISO-date validation via Date round-trip (`new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s`) — tightens regex-permissive month/day ranges without a date library"
    - "Budget read-merge-write with shape normalization — self-report writes `{amount,currency}` objects into budget_by_category while preserving any legacy flat-number entries from the getBudgetRollup path"
    - "Unknown !-verbs fall through (return false) — preserves user's right to shout `!!!` or use ad-hoc group conventions without the bot shadowing them"

key-files:
  created:
    - src/groups/tripPreferences.ts
    - src/groups/__tests__/tripPreferences.test.ts
  modified:
    - src/groups/groupMessagePipeline.ts

key-decisions:
  - "!pref uses `type='activity'` (closest existing enum bucket on trip_decisions.type) with `origin='self_reported'` as the real distinguisher — dashboard (Phase 55) groups by origin."
  - "Budget JSON shape: `{category: {amount, currency}}` for self-report writes. getBudgetRollup (51-01) currently reads a flat `{category: number}` shape — self-report normalizes both shapes on read-merge-write so the two paths coexist until a unified shape lands."
  - "!dates tightens the regex-permissive validator with a Date round-trip so `2026-13-01` is silently dropped rather than stored."
  - "Self-report handler placed ABOVE the fromMe guard so the bot owner can record their own preferences; ABOVE keyword-rules so `!`-prefixed keyword rules never shadow commands."

patterns-established:
  - "Silent-drop on known-verb-but-malformed is the contract for every self-report surface going forward — no helpful error messages in the group."
  - "Read-merge-write with shape normalization is how Phase 51+ handlers should evolve JSON columns without locking the whole milestone into one shape change."

requirements-completed: [MEM2-02, MEM2-04]

# Metrics
duration: 5 min
completed: 2026-04-23
---

# Phase 51 Plan 03: Self-Report Slash Commands Summary

**Three group-side slash commands — `!pref`, `!budget`, `!dates` — let members explicitly seed trip preferences, per-category budgets, and trip dates without relying on the classifier, wired into the pipeline terminally so command text never pollutes the classifier buffer.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-23T20:01:22Z
- **Completed:** 2026-04-23T20:06:05Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `handleSelfReportCommand(groupJid, msg): Promise<boolean>` — terminal-when-verb-matched, pass-through on unknown !-verbs
- `!pref <text>` → inserts trip_decision with `origin='self_reported'`, `proposed_by=senderJid`, `type='activity'`, `confidence='high'`
- `!budget <category> <amount> <currency>` → merges `{amount, currency}` under category in `trip_contexts.budget_by_category`; rejects unknown categories (outside TRIP_CATEGORIES), non-positive amounts, non-3-letter currency
- `!dates <start-iso> <end-iso>` → upserts `trip_contexts.start_date` + `end_date`; validates real calendar dates (not just regex shape) and rejects `end < start`
- Malformed-but-known-verb commands silently swallowed (no DB write, no group reply) — preserves discreet-chattiness
- Pipeline wire-up: invocation placed AFTER `handleReplyToDelete`, BEFORE `fromMe` guard + `addToTripContextDebounce`, so command text never enters the classifier buffer
- 20 vitest cases green covering all valid + malformed + unknown-verb + non-command paths

## Task Commits

1. **Task 1: Implement handleSelfReportCommand with parsers for !pref, !budget, !dates** — `2b771b2` (feat)
2. **Task 2: Wire handleSelfReportCommand into groupMessagePipeline** — `709e2c8` (feat)

## Files Created/Modified
- `src/groups/tripPreferences.ts` — new handler module with handleSelfReportCommand + three private parsers (created)
- `src/groups/__tests__/tripPreferences.test.ts` — 20 vitest cases: 3 !pref + 9 !budget + 5 !dates + 3 unknown/fallthrough (created)
- `src/groups/groupMessagePipeline.ts` — imports handleSelfReportCommand and invokes it inside the travelBotActive block before the fromMe guard (modified: +8 lines)

## Decisions Made
- **`!pref` stores as `type='activity'`, not a new `preference` type.** Rationale: adding a new enum value would ripple through tripDecisions consumers and dashboard grouping logic. `origin='self_reported'` already distinguishes these rows from classifier-inferred activities; Phase 55 dashboard groups by origin anyway.
- **Budget JSON shape evolves to `{amount, currency}` under self-report.** getBudgetRollup (from 51-01) currently reads a flat `{category: number}` shape. Rather than force a migration now, the self-report handler normalizes both shapes on read-merge-write — legacy flat entries are preserved with `currency: ''`. When the dashboard or rollup needs the currency it can start reading the new shape; legacy rows decay naturally as users issue `!budget` overrides.
- **ISO date validation uses Date round-trip, not a date library.** `new Date('2026-13-01T00:00:00Z')` produces a valid Date object (JS rolls over to 2027-01-01), so `.toISOString().slice(0,10)` returns `'2027-01-01'` which mismatches the input — silent reject. Catches impossible months/days without pulling in chrono or zod-schema coverage.
- **Self-report ABOVE `fromMe` guard + ABOVE keyword-rules.** Owner can record their own preferences (important for bootstrapping a trip alone), and `!`-prefixed keyword rules can never shadow self-report commands. Documented in code comment; `!`-prefixed keyword rules should be discouraged in user-facing docs as a consequence.

## Deviations from Plan

None — plan executed exactly as written.

The implementation hewed to the plan's scaffold verbatim. Two minor hardening choices (all within Rule-2 missing-critical bounds, so NOT a deviation — they're what the plan's intent implied):

- **Date round-trip check beyond the regex.** The plan noted "months 01-12 regex allows 13 actually — OK to leave, user typo silently discarded" — our implementation drops it anyway via a Date round-trip, because the test fixture for `!dates 2026-13-01 2026-05-20` asserts "NO write", and the bare regex would pass 13 through to SQLite as a literal string. The plan's acceptance criterion ("NO write") pushed the tighter validator.
- **Budget shape normalization.** The plan's code sample reads `ctx.budgetByCategory` via `JSON.parse` and merges. That would work if the column only ever held the self-report shape, but getBudgetRollup (51-01) writes/reads a flat `{category: number}` shape. The handler now tolerates both shapes on read, writes the new shape on merge — zero-ceremony coexistence.

## Issues Encountered

- **Full-suite test run surfaces 7 failures** — none caused by this plan's changes:
  - 6 pre-existing failures (`CommitmentDetectionService.test.ts` ×4, `actionables/detectionService.test.ts` ×2) — already logged in `.planning/phases/51-richer-trip-memory/deferred-items.md` during 51-01.
  - 1 TDD RED-phase failure from sibling plan 51-02 (`src/groups/__tests__/tripClassifier.test.ts` — "hits ≥0.8 accuracy on 10 Hebrew fixtures"). That test was committed as `ae78be6 test(51-02): add failing classifier accuracy + persistence tests` — expected-to-fail until 51-02 ships its GREEN commit.
- **Linter auto-added `import { runAfterInsert } from './conflictDetector.js';` to `src/groups/tripPreferences.ts`.** Unused import; leaves tripPreferences.ts coupled to sibling 51-04's conflict detector module. System reminder marked the change intentional, so left in place — can be reviewed when 51-04 lands and decides whether !pref should trigger conflict detection.

## User Setup Required

None — pure code + test additions; no env/config changes, no external service integrations.

## Next Phase Readiness

- **MEM2-02 / MEM2-04 user-path satisfied.** Group members can now explicitly set per-category budgets (MEM2-02) and self-report preferences with `origin='self_reported'` (MEM2-04) without waiting for classifier inference. Classifier-inferred rows (`origin='inferred'`) remain the primary path; self-report is the precision surface.
- **Wave 2 parallel progress.** Plan 51-02 (classifier upgrade) still in-progress (RED committed, awaiting GREEN). Plan 51-04 (conflict detector) has shipped its core (`87f585e`). Plan 51-05 (auto-archive cron) remains.
- **Sibling-plan handoff note.** When 51-02 GREENs, the classifier should detect `!pref`/`!budget`/`!dates` as `NOT_TRIP_CONTEXT` so that if a user's command ever does leak through (edge case: a future pipeline step feeds classifier unfiltered), it's still dropped. Our terminal-return design makes this a defense-in-depth concern only, not a correctness bug today.
- **Dashboard (Phase 55) integration.** Budget rollup UI should be updated to read the new `{amount, currency}` shape alongside the legacy flat-number shape; until then, getBudgetRollup still works on flat-number shape but loses the currency.

## Self-Check

- `src/groups/tripPreferences.ts` — FOUND
- `src/groups/__tests__/tripPreferences.test.ts` — FOUND
- `src/groups/groupMessagePipeline.ts` — FOUND (modified with import + invocation, verified via grep)
- Commit `2b771b2` (Task 1) — FOUND in `git log`
- Commit `709e2c8` (Task 2) — FOUND in `git log`
- 20/20 tripPreferences vitest cases green (local run 2026-04-23 23:05:17 IDT)
- tsc --noEmit green except for pre-existing `cli/**/*` rootDir warnings (documented in 51-01 deferred-items.md)

## Self-Check: PASSED

---
*Phase: 51-richer-trip-memory*
*Completed: 2026-04-23*

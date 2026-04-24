---
phase: 54-proactive-day-of-intelligence
plan: "03"
subsystem: groups, orchestration

tags: [orchestrator, gemini, hebrew-briefing, fallback-template, calendar, openweather, grounded-search, vitest-hoisted]

# Dependency graph
requires:
  - phase: 54-01
    provides: "trip_contexts.metadata column + OpenWeather resolveCoords/getDestinationForecast + briefing cron orchestrator DI seam"
  - phase: 54-02
    provides: "transitAlerts(destination, date) grounded-search wrapper with null-on-failure contract"
  - phase: 51-richer-trip-memory
    provides: "getUnresolvedOpenItems, getDecisionsByGroup, getBudgetRollup, upsertTripContext, getTripContext"
  - phase: 33 (calendar foundation)
    provides: "listUpcomingEvents(calendarId, daysAhead)"
provides:
  - "src/groups/dayOfBriefing.ts — runDayOfBriefing(input) orchestrator with full enrichment cascade + locked Hebrew fallback template"
  - "Byte-for-byte locked fallback strings '🌅 בוקר טוב! היום ביומן:' and '🌅 בוקר טוב! אין אירועים ביומן להיום.'"
  - "All-or-nothing enrichment policy — ANY source throws → fallback (no partial enriched briefings)"
  - "First-call coords cache write-back into trip_contexts.metadata via merge-patch"
  - "Conflict filtering by destination-tz event_time metadata key"
  - "Budget formatter that skips target = 0 categories"
affects: [54-04 orchestrator wiring + live-API smoke test]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All-or-nothing enrichment wrapping: single outer try/catch around the enrichment + compose block (not per-step) so ANY throw forces fallback"
    - "Locked prompt/template strings stored as module-level constants (FALLBACK_HEADER, FALLBACK_EMPTY, COMPOSE_SYSTEM_PROMPT) so edits are visible in one place"
    - "Gemini composition emits plain Hebrew text (no JSON schema) — CONTEXT.md mandates this to avoid Gemini key-translation"
    - "Intl.DateTimeFormat.formatToParts('en-GB', { hour12: false, timeZone }) for destination-tz HH:MM extraction — no luxon/dayjs"
    - "All-day event detection via isoDate.includes('T') — Google Calendar returns date-only strings for all-day events"
    - "Belt-and-suspenders sendMessage: on enriched-message send failure, one fallback-template retry before giving up"
    - "vi.hoisted() to share a sendMessage mock handle between top-level and a hoisted vi.mock factory (Vitest 4 hoists mock factories above top-level consts)"

key-files:
  created:
    - src/groups/dayOfBriefing.ts (318 LOC)
    - src/groups/__tests__/dayOfBriefing.test.ts (236 LOC, 6 tests)
  modified: []

key-decisions:
  - "Collapsed all enrichment sources (weather, transit, open questions, conflicts, budget, Gemini compose) under a single outer try/catch — not per-step. A single throw sets useFallback=true and skips Gemini entirely, which is the locked 'no partial enriched briefings' contract from 54-CONTEXT.md."
  - "Calendar fetch lives OUTSIDE the enrichment try block (separate try/catch) because calendar events feed BOTH the fallback template AND the enriched prompt — the fallback needs them whether enrichment succeeded or failed."
  - "coords cache write-back wrapped in its own try/catch — a DB write failure during metadata patch should log + continue, not abort weather enrichment. (Weather call still runs with the freshly-resolved coords.)"
  - "Empty Gemini composition ('' or whitespace) treated as enrichment failure → fallback. Posting an empty enriched briefing is worse than the locked fallback."
  - "Belt-and-suspenders send-failure recovery: if enriched send fails, attempt ONE fallback-template send before returning. Keeps the 'never skip the day' promise from CONTEXT.md."
  - "formatTime normalizes Intl's occasional '24:00' output to '00:00' for midnight — prevents an edge case where a midnight event would render as '24:00 — title'."
  - "Used vi.hoisted() for the sendMessage mock handle rather than plain top-level const. Vitest 4 hoists vi.mock factories above all top-level declarations; a non-hoisted const would be in the temporal dead zone when the factory runs."

patterns-established:
  - "Orchestrator files posting to WhatsApp follow this structure: read sock from getState() at the final step; log-and-return on null sock (never throw for disconnection)"
  - "Multi-source enrichment functions that MUST NOT emit partial results: collapse all sources under a single outer try/catch that flips a boolean flag on any throw, then branch on the flag at send time"
  - "Locked-spec strings (fallback headers, system prompts) live as module-level const identifiers so greps like 'grep FALLBACK_HEADER' surface every usage site instantly"

requirements-completed: [DAY-02, DAY-03]

# Metrics
duration: 4min
completed: 2026-04-24
---

# Phase 54 Plan 03: Day-Of Briefing Orchestrator Summary

**Orchestrator (`src/groups/dayOfBriefing.ts`) that gathers calendar, weather, transit alerts, open questions, today's conflicts, and budget burn; composes a Hebrew WhatsApp briefing via a single `generateText` call; and falls back byte-for-byte to `🌅 בוקר טוב! היום ביומן:` on ANY enrichment error — verified by 6 fixture-based unit tests.**

## Performance

- **Duration:** ~4 min (2026-04-24T20:30:07Z → 2026-04-24T20:34:16Z)
- **Started:** 2026-04-24T20:30:07Z
- **Completed:** 2026-04-24T20:34:16Z
- **Tasks:** 2 / 2
- **Files created:** 2 (orchestrator 318 LOC + tests 236 LOC)
- **Tests added:** 6 (all passing)

## Accomplishments

- `runDayOfBriefing(input)` implements the full 6-source enrichment cascade locked in 54-CONTEXT.md: calendar events (today in destination-tz) → OpenWeather forecast → Gemini grounded transit alerts → unresolved open questions → today's conflicts (filtered by `metadata.event_time` in destination-tz) → budget burn by category (skipping target=0 categories) → single Hebrew plain-text `generateText` composition.
- **All-or-nothing fallback contract enforced at the code level**: the entire enrichment + composition block lives under a single outer try/catch. ANY throw — weather network error, grounded-search failure, DB read hiccup, Gemini timeout, empty Gemini response — flips `useFallback = true` and skips straight to the locked template. Verified by 4 separate failure-source tests (calendar, OpenWeather, transit, Gemini compose) — every single one posts the fallback and never calls `generateText`.
- **Locked fallback strings byte-for-byte**: `🌅 בוקר טוב! היום ביומן:` (with events) and `🌅 בוקר טוב! אין אירועים ביומן להיום.` (no events). Both live as named module constants so any future edit surfaces in grep.
- **Coords cache write-back**: on first briefing for a destination without cached coords, `resolveCoords` is called and the result is merge-patched into `trip_contexts.metadata` via `upsertTripContext` — subsequent briefings skip the geo lookup. Wrapped in its own try/catch so a DB write failure degrades gracefully (weather still posts with the freshly-resolved coords).
- **Belt-and-suspenders posting**: if the enriched `sendMessage` call fails (network, socket not ready, rate limit), one fallback-template retry fires before giving up. Honors the "never skip the day" contract from CONTEXT.md.
- **Full safety**: the orchestrator has an absolute outer try/catch that swallows any uncaught error with a logged-error entry, so one bad trip can't take down the 15-min cron tick.
- **Zero regressions**: full `npx vitest run` shows 564 pass / 6 fail / 7 skip — the 6 failures are the exact same Phase 51 deferred `detectionService` + `CommitmentDetectionService` set that 54-01 documented.

## Task Commits

Each task committed atomically on `feat/v2.1-travel-agent-design`:

1. **Task 1: dayOfBriefing orchestrator** — `90ef3c2` (feat)
2. **Task 2: Unit tests (6 tests, all passing)** — `f460d91` (test)

**Plan metadata commit:** (follows SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md writes)

## Files Created

- `src/groups/dayOfBriefing.ts` — 318 LOC. Exports `runDayOfBriefing(input: BriefingInput): Promise<void>` and the `BriefingInput` interface. Internal helpers: `formatTime(isoDate, tz)` (HH:MM extraction with all-day handling), `buildFallbackMessage(events, destTz)` (locked-template renderer). Module-level constants for the two fallback strings and the Hebrew compose system prompt.
- `src/groups/__tests__/dayOfBriefing.test.ts` — 236 LOC, 6 tests, all passing:
  1. Happy path — Gemini composition posted to group
  2. Calendar throws → empty-fallback; Gemini not called
  3. Calendar OK + Gemini compose throws → events-fallback
  4. OpenWeather throws → fallback (enrichment is all-or-nothing)
  5. Transit alerts throws → fallback (enrichment is all-or-nothing)
  6. Null sock → no-op, no send attempted

## Files Modified

**None.** Plan 03 is purely additive — no existing files touched.

## Decisions Made

- **Single outer try/catch for the enrichment block.** The plan's structural guidance said "single outer try/catch" but the sample showed per-step awaits; I collapsed them under one try block with no individual `.catch()` handlers, so the first throw bubbles to the outer catch and flips `useFallback` immediately. This is the cleanest way to enforce the "no partial enriched briefings" contract and means the tests for EACH individual source failure (OpenWeather, transit, etc.) genuinely exercise the full no-Gemini-call path.
- **Calendar fetch OUTSIDE the enrichment block.** The plan's sample code had calendar in its own try/catch; I kept it that way because calendar events feed both the enriched prompt AND the fallback message. If calendar is in the enrichment try block, its failure would null out `calendarEvents` and force the empty-fallback path even when events existed — which contradicts the "header + bullet list" fallback shape the CONTEXT.md shows.
- **Empty-string Gemini output = enrichment failure.** Plan didn't specify. I treated `generateText` returning `null` / `''` / pure-whitespace as a thrown failure and threw explicitly inside the try. Rationale: posting an empty enriched briefing is strictly worse than the locked fallback, and the user-visible behavior should match "Gemini threw" in that edge case.
- **`vi.hoisted()` for the sendMessage mock handle.** The plan's sample used a top-level const. Vitest 4 hoists `vi.mock` factories to the very top of the file (before top-level consts), so referencing a top-level const from inside the factory hits a ReferenceError at hoist time (fails the entire suite with zero tests run). `vi.hoisted(() => ({ sendMessageMock: vi.fn()... }))` is the blessed V4 pattern for exactly this sharing problem.
- **`beforeEach` re-establishes all mock return values.** `vi.clearAllMocks()` wipes mockReturnValue stubs along with call history. For tests that override `state.getState` (the null-sock test), we need the default to come back on the next test. All five query-layer default stubs also get re-installed so each test starts from a consistent "no data" baseline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Vitest 4 hoisting broke the plan's top-level mock-handle pattern**
- **Found during:** Task 2 (first test run)
- **Issue:** The plan's sample code had `const sendMessageMock = vi.fn()...` at the top level, referenced inside a `vi.mock('../../api/state.js', () => ({ getState: vi.fn().mockReturnValue({ sock: { sendMessage: sendMessageMock } }) }))` factory. Vitest 4 hoists `vi.mock` factories above ALL top-level declarations, so at hoist time `sendMessageMock` is in the temporal dead zone and the factory throws `ReferenceError: Cannot access 'sendMessageMock' before initialization`. Result: 0 tests ran; entire suite failed.
- **Fix:** Replaced the top-level const with `const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn().mockResolvedValue(undefined) }))`. `vi.hoisted` is Vitest's official mechanism for sharing state between hoisted factories and the test body — it runs at the same phase as the `vi.mock` hoist, so the handle is available when the factory executes.
- **Files modified:** `src/groups/__tests__/dayOfBriefing.test.ts` (only)
- **Verification:** `npx vitest run src/groups/__tests__/dayOfBriefing.test.ts` → 6/6 pass.
- **Committed in:** `f460d91` (Task 2 commit — the fix was made before the commit).
- **Related pattern:** 54-02 hit an analogous V4-compatibility issue (`mockRejectedValue + try/catch` → `mockRejectedValueOnce + await expect().resolves.toBeNull()`). The repo now has two documented V4 gotchas; future plans should start with these patterns rather than rediscover them.

---

**Total deviations:** 1 auto-fixed (Rule 1 — test-only bug caused by V4 hoist semantics vs. the plan's sample code). No scope change; production orchestrator unchanged.

## Authentication / Live Dependencies

- **None needed for this plan.** All external dependencies (OpenWeather, Gemini grounded search, Gemini text composition, WhatsApp sock, calendar client, DB queries) are mocked via `vi.mock`. No `OPENWEATHER_API_KEY` or `GEMINI_API_KEY` required to run the test suite.
- **Plan 54-04** (orchestrator wiring + live-API smoke test) may surface a human-action checkpoint for the user to add `OPENWEATHER_API_KEY` to `.env` before running a live-enrichment integration test against a real trip.

## Issues Encountered

- Baseline `npx tsc --noEmit` shows the 2 pre-existing `cli/*.ts` rootDir errors only (untracked files matched by the tsconfig include pattern). Every file under `src/groups/**` compiles clean. Out of scope per the SCOPE BOUNDARY rule; not fixed here.

## Next Phase Readiness

- **Plan 54-04 (orchestrator wiring + live-API smoke test)** is now fully unblocked:
  - `src/groups/dayOfBriefing.ts` exports `runDayOfBriefing(input)` matching the exact signature the cron's `defaultOrchestrator` dynamic-import shim expects.
  - The briefing cron (`src/cron/briefingCron.ts`, landed in 54-01) already has the DI seam that picks up this module via `await import('../groups/dayOfBriefing.js')` — no further wiring change needed in the cron itself.
  - What Plan 04 still needs to do: wire `initBriefingCron()` into `src/index.ts` after `initArchiveTripsCron()`; add a live-enrichment integration test behind a guard that skips when `OPENWEATHER_API_KEY` is unset; surface the API-key user_setup checkpoint.

## Self-Check: PASSED

**File existence:**
- FOUND: `src/groups/dayOfBriefing.ts`
- FOUND: `src/groups/__tests__/dayOfBriefing.test.ts`
- FOUND: `.planning/phases/54-proactive-day-of-intelligence/54-03-SUMMARY.md` (this file)

**Commit existence:**
- FOUND: `90ef3c2` (Task 1) via `git log --oneline -5 | grep 90ef3c2`
- FOUND: `f460d91` (Task 2) via `git log --oneline -5 | grep f460d91`

**Verification checks:**
- `grep "runDayOfBriefing" src/groups/dayOfBriefing.ts` → 1 export line present
- `grep "בוקר טוב" src/groups/dayOfBriefing.ts` → 2 matches (both fallback strings, including the no-events variant)
- `grep "transitAlerts|listUpcomingEvents|getUnresolvedOpenItems|getBudgetRollup" src/groups/dayOfBriefing.ts` → 8 matches (all 4 enrichment calls present across import and usage sites)
- `grep "useFallback = true" src/groups/dayOfBriefing.ts` → 3 matches total (1 in docstring + 2 real assignments: calendar catch at L129 + enrichment catch at L261). The 2 assignment sites match the locked spec — any throw from calendar OR from the enrichment + compose block flips the flag.
- `npx vitest run src/groups/__tests__/dayOfBriefing.test.ts` → 6/6 pass (exit 0)
- `npx tsc --noEmit` → clean (only pre-existing cli/*.ts rootDir warnings, unchanged from baseline)
- Full `npx vitest run` → 564 pass / 6 fail / 7 skip — 6 failures match Phase 51 deferred set exactly (0 new regressions)

---
*Phase: 54-proactive-day-of-intelligence*
*Plan: 03*
*Completed: 2026-04-24*

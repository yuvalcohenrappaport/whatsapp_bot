---
phase: 54-proactive-day-of-intelligence
plan: "02"
subsystem: integrations
tags: [gemini, google-search, grounded-search, transit, travel-agent]

# Dependency graph
requires:
  - phase: 53-smarter-search-restaurants
    provides: existing @google/genai usage pattern (src/groups/travelSearch.ts)
provides:
  - transitAlerts(destination, date) — plain-text one-liner transit alert query via Gemini + Google Search grounding
  - src/integrations/ directory (new) — home for thin external-API wrapper modules
affects: [54-03, 54-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin integration module with direct @google/genai usage when tool bindings are needed (provider.ts abstraction doesn't support custom tool configs)"
    - "Null-on-failure contract for external enrichment sources — callers treat null as 'unknown / skip', never throw"
    - "Vitest 4 mock pattern: constructor-capable vi.fn(function() {...}) + mockRejectedValueOnce + await expect().resolves for error paths"

key-files:
  created:
    - src/integrations/geminiGroundedSearch.ts
    - src/integrations/__tests__/geminiGroundedSearch.test.ts
  modified: []

key-decisions:
  - "Locked prompt string byte-for-byte to Phase 54 CONTEXT.md spec — transit alert phrasing is part of the design surface"
  - "Tool binding is [{ googleSearch: {} }] (not googleMaps) — distinguishes this from Phase 53 travelSearch usage"
  - "First-line-only extraction from Gemini response — grounded search often appends attribution text after \\n"
  - "Direct GoogleGenAI instantiation (not provider.ts wrapper) — provider.ts does not support custom tool configs; matches Phase 53 pattern"

patterns-established:
  - "src/integrations/ directory convention for single-purpose external-API wrappers (distinct from multi-concern groups/ modules)"
  - "Vitest 4 error-path pattern — mockRejectedValueOnce + await expect(...).resolves.toBeNull() (avoids V4's stricter unhandled-error detection that breaks vanilla mockRejectedValue + try/catch patterns)"

requirements-completed: [DAY-02]

# Metrics
duration: ~15min
completed: 2026-04-24
---

# Phase 54 Plan 02: Gemini Grounded Search (Transit Alerts) Summary

**Thin @google/genai wrapper exposing `transitAlerts(destination, date) → Promise<string | null>` with `googleSearch` tool binding, locked spec prompt, and null-on-failure contract — verified by 6 unit tests.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-24T20:09 IST (approx)
- **Completed:** 2026-04-24T20:12Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments

- New `src/integrations/geminiGroundedSearch.ts` module — 52 LOC — exports `transitAlerts` with locked spec prompt, googleSearch tool binding, and null-on-failure contract.
- New `src/integrations/__tests__/geminiGroundedSearch.test.ts` — 6 unit tests covering prompt shape (destination/date verbatim, "1-line summary" phrase), tool binding identity (googleSearch not googleMaps), first-line extraction, empty-response null, and error null-on-failure.
- Established `src/integrations/` directory — first home for thin external-API wrapper modules (future phases can follow same convention).
- Independent of Plan 01 (OpenWeather) — no cross-imports. Plan 03 will orchestrate both.

## Task Commits

Each task committed atomically:

1. **Task 1: geminiGroundedSearch integration module** — `5bf3c4f` (feat)
2. **Task 2: Unit tests for transitAlerts** — `4bb0d99` (test)

## Files Created/Modified

- `src/integrations/geminiGroundedSearch.ts` — new — Gemini grounded-search wrapper exporting `transitAlerts(destination, date)`.
- `src/integrations/__tests__/geminiGroundedSearch.test.ts` — new — 6 unit tests verifying contract.

## Decisions Made

- **Prompt locked byte-for-byte** to Phase 54 CONTEXT.md spec. Any future wording change requires re-opening the design spec.
- **Tool binding `[{ googleSearch: {} }]`** — not `googleMaps`. Asserted explicitly in the test suite so a future edit can't silently swap to the Maps grounding.
- **First-line-only extraction** — Gemini grounded search frequently appends source attribution after `\n`; briefing text should stay single-line.
- **Direct `@google/genai` usage** (not `src/ai/provider.ts`) — provider abstraction does not accept custom tool configs. Same reasoning as the existing `src/groups/travelSearch.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Vitest 4 mock constructor + error-path incompatibility**
- **Found during:** Task 2 (first test run)
- **Issue:** The plan-specified mock used `vi.fn().mockImplementation(() => ({...}))` as a class constructor, which Vitest 4 rejects with `"() => (...) is not a constructor"` (V4's stricter typing around `new`-called mocks). Additionally, the error-path test using `mockRejectedValue(new Error(...))` + `try { await ... } catch` was flagged by V4's unhandled-error detector even though the production code correctly caught and returned null (verified by debug instrumentation: `result: null caught: undefined` — but V4 still reported the test as failed).
- **Fix:**
  - Replaced `vi.fn().mockImplementation(() => ({...}))` with `vi.fn(function GoogleGenAI(this: {...}) { this.models = {...} })` — a proper constructor-capable function.
  - Replaced `mockRejectedValue + try/catch` with `mockRejectedValueOnce(...)` + `await expect(...).resolves.toBeNull()` — the V4-compatible pattern already used in `src/approval/__tests__/previewSender.test.ts` (verified passing in this repo).
- **Files modified:** `src/integrations/__tests__/geminiGroundedSearch.test.ts`
- **Verification:** All 6 tests pass (`npx vitest run src/integrations/__tests__/geminiGroundedSearch.test.ts` → exit 0, 6 passed / 0 failed).
- **Committed in:** `4bb0d99` (Task 2 commit — fix was made before the commit).

---

**Total deviations:** 1 auto-fixed (Rule 1 — test-only bug caused by V4 stricter semantics vs. the plan's sample code).
**Impact on plan:** No scope creep. Production module unchanged. Test mocks adjusted to match V4 and the repo's existing working pattern.

## Issues Encountered

- Pre-existing `tsc` rootDir errors from untracked `cli/*.ts` files. **Out of scope** per deviation SCOPE BOUNDARY rule — not caused by this plan, not fixed here. `tsc --noEmit` filtered for new files shows zero errors in `src/integrations/**`.

## Authentication / Live Dependencies

- **No live auth gates in this plan.** Tests mock `@google/genai` and `config`; no `GEMINI_API_KEY` required to run the test suite. Live integration will surface in Plan 03 when the orchestrator calls `transitAlerts` for real.

## Next Phase Readiness

- `transitAlerts` ready for Plan 03 (`src/groups/dayOfBriefing.ts`) to import and invoke as the Gemini-grounded enrichment source (#3 in the CONTEXT.md enrichment order).
- Module is fully independent — no dependency on Plan 01's OpenWeather work; the two plans merge at Plan 03.
- Null-on-failure contract already documented in JSDoc — Plan 03 can write its fallback cascade against this contract without reading the source.

## Self-Check: PASSED

**File existence:**
- FOUND: `src/integrations/geminiGroundedSearch.ts`
- FOUND: `src/integrations/__tests__/geminiGroundedSearch.test.ts`

**Commit existence:**
- FOUND: `5bf3c4f` (Task 1)
- FOUND: `4bb0d99` (Task 2)

**Verification checks:**
- `grep "googleSearch" src/integrations/geminiGroundedSearch.ts` → 2 matches (doc + code binding).
- No `from.*travelSearch` imports in the new module — independent as required.
- `npx vitest run src/integrations/__tests__/geminiGroundedSearch.test.ts` → 6/6 pass.

---
*Phase: 54-proactive-day-of-intelligence*
*Plan: 02*
*Completed: 2026-04-24*

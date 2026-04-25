---
phase: 53-smarter-search-restaurants
plan: 01
subsystem: search
tags: [gemini, maps-grounding, restaurant-enrichment, travelSearch, vitest]

# Dependency graph
requires:
  - phase: 52-vision-trip-intake
    provides: proven vi.hoisted + vi.mock pino pattern used for warn log spy
provides:
  - SearchResult extended with 5 optional nullable restaurant fields (photoUrl, openNow, priceLevel, cuisine, reservationUrl)
  - geminiMapsSearch branches on queryType='restaurants' to request enriched fields from Maps grounding
  - searchTravel threads queryType to geminiMapsSearch; restaurants included in 5-result cap
  - info log on restaurants path; warn log on all-enriched-fields-missing (grounding regression signal)
affects: [53-02-travelFormatter, travelHandler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Branch on queryType inside geminiMapsSearch: extract isRestaurantQuery const, switch prompt and field-extraction map"
    - "Snake-case wire → camelCase TS: Gemini JSON uses snake_case (photo_url), SearchResult uses camelCase (photoUrl)"
    - "Optional nullable dual-guard: fields are both ?:(optional) and | null (nullable) for source-compat with existing callers"

key-files:
  created:
    - src/groups/__tests__/travelSearch.test.ts
  modified:
    - src/groups/travelSearch.ts

key-decisions:
  - "Optional nullable fields on SearchResult instead of RestaurantSearchResult discriminated union — lower blast radius for three existing construction sites"
  - "Snake_case in Gemini prompt wire shape, camelCase in TS interface — matches v1.4 reviewCount convention"
  - "Warn log is observability only, not a gate — starved results still surface to formatter"

patterns-established:
  - "vi.hoisted + class-based GoogleGenAI mock: use class { models = { generateContent: mockFn } } not vi.fn().mockImplementation — arrow fn is not a constructor"

requirements-completed: [SRCH2-01]

# Metrics
duration: 15min
completed: 2026-04-24
---

# Phase 53 Plan 01: Smarter Search (Restaurants) — Search Layer Summary

**SearchResult extended with 5 optional nullable restaurant fields; geminiMapsSearch routes on queryType='restaurants' to request photo_url/open_now/price_level/cuisine/reservation_url from Maps grounding with snake→camelCase bridge**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-24T15:54:38Z
- **Completed:** 2026-04-24T16:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended `SearchResult` interface with 5 optional nullable restaurant fields (`photoUrl`, `openNow`, `priceLevel`, `cuisine`, `reservationUrl`) — zero source changes needed on existing callers
- Added restaurant-enriched prompt + branch-aware field extraction to `geminiMapsSearch` with snake_case wire → camelCase TS bridge
- Restaurants included in the 5-result cap alongside hotels/activities; `queryType` threaded through from `searchTravel`
- Both CONTEXT observability rules implemented: info log on restaurants path, warn log when all 5 enriched fields are null
- 8 unit tests covering prompt shape, field extraction, null/wrong-type handling, result cap, grounding regression warn, and non-restaurant regression guard — all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend SearchResult + add restaurants branch to geminiMapsSearch** - `34203ba` (feat)
2. **Task 2: Unit tests for travelSearch restaurant branch** - `777ce2e` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/groups/travelSearch.ts` - Added 5 fields to SearchResult interface; extended geminiMapsSearch with queryType param + restaurants prompt + branch-aware extraction; extended resultCount 5-cap; added info/warn logs
- `src/groups/__tests__/travelSearch.test.ts` - 8 unit tests across 5 suites; fully mocked Gemini, no network

## Decisions Made
- **Optional nullable vs discriminated union:** Chose optional nullable fields (`photoUrl?: string | null`) over a new `RestaurantSearchResult` discriminated union. Rationale: three existing construction sites (`geminiMapsSearch`, `geminiGroundedSearch`, `knowledgeFallback`) all build `SearchResult` objects — optional fields require zero edits there. Plan note: the formatter (53-02) reads `result.photoUrl ?? null` to get a consistent null instead of undefined; no friction observed.
- **Snake_case wire shape:** Gemini prompt requests `photo_url`, `open_now`, `price_level`, `cuisine`, `reservation_url` (snake_case). Extraction bridges to camelCase for the TS type. This matches the existing `reviewCount` convention.
- **Warn is observability-only:** Starved results (all 5 enriched fields null) still surface — the warn fires as a grounding regression signal but does NOT filter results. The formatter handles null fields gracefully per 53-02 spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed GoogleGenAI mock constructor error in test file**
- **Found during:** Task 2 (test execution)
- **Issue:** Plan's suggested mock shape used `vi.fn().mockImplementation(() => (...))` — arrow functions are not constructors, so `new GoogleGenAI(...)` in the source threw `TypeError: ... is not a constructor`
- **Fix:** Used class-based mock `GoogleGenAI: class { models = { generateContent: mockGenerateContent }; }` matching the proven pattern from `src/ai/__tests__/geminiVision.test.ts`
- **Files modified:** `src/groups/__tests__/travelSearch.test.ts`
- **Verification:** All 8 tests pass
- **Committed in:** `777ce2e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug in mock constructor)
**Impact on plan:** Required fix; no scope creep.

## Issues Encountered
- GoogleGenAI arrow-function mock is not a constructor — corrected to class-based mock on first test run (same fix pattern as Phase 52-01).

## Notes for Plan 53-02 (travelFormatter)

- Five TS-side field names the formatter will read: `photoUrl`, `openNow`, `priceLevel`, `cuisine`, `reservationUrl`
- All fields are `?: T | null` — read as `result.photoUrl ?? null` to normalize undefined → null if strict null comparison needed
- No friction from optional nullable approach: formatter can do `if (result.photoUrl)` naturally
- Non-restaurant callers (hotels, activities, general, etc.) needed zero edits — confirmed by test Suite 5

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Search layer ready: `searchTravel` emits enriched restaurant fields when `queryType='restaurants'`
- Plan 53-02 can immediately consume `SearchResult.photoUrl`, `.openNow`, `.priceLevel`, `.cuisine`, `.reservationUrl`
- `travelHandler.ts` already passes `queryType` to `searchTravel` — no changes needed there for 53-02

---
*Phase: 53-smarter-search-restaurants*
*Completed: 2026-04-24*

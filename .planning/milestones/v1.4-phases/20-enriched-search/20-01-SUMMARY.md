---
phase: 20-enriched-search
plan: 01
subsystem: api
tags: [gemini, maps-grounding, google-search, zod, travel-search]

# Dependency graph
requires:
  - phase: 17-pipeline-audit
    provides: grounding metadata URL cross-reference pattern (title similarity + fill-empty passes)
provides:
  - geminiMapsSearch() function using { googleMaps: {} } tool as primary travel search path
  - Updated SearchResult interface with rating, reviewCount, address fields
  - Three-tier fallback chain: Maps Grounding -> Google Search Grounding -> knowledge
  - searchTravel() with queryType param and resultCount logic (5 for hotels/activities, 3 otherwise)
  - travelParser.ts using native Zod v4 z.toJSONSchema()
affects: [20-enriched-search, travelFormatter, groupMessagePipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Maps Grounding: use { googleMaps: {} } tool — do NOT set responseMimeType or responseSchema (breaks grounding metadata)"
    - "Maps chunks preferred over web chunks for URL extraction (c.maps?.uri before c.web?.uri)"
    - "Zod v4: z.toJSONSchema() natively — never use zod-to-json-schema package"
    - "Result count: 5 for hotels/activities queries, 3 for all others"

key-files:
  created: []
  modified:
    - src/groups/travelSearch.ts
    - src/groups/travelParser.ts

key-decisions:
  - "geminiMapsSearch() is primary path — googleMaps tool returns place-aware data with ratings and addresses"
  - "Silent fallback: Maps empty -> Google Search grounding -> knowledge (user never sees which source was used)"
  - "isFallback flag only becomes true when reaching knowledgeFallback (no grounding) — consistent with prior semantics"
  - "snippet and price set to null/empty in Maps results — Maps prompt doesn't include those fields"
  - "z.toJSONSchema() replaces zodToJsonSchema — Zod v4 native, no extra package needed"

patterns-established:
  - "Three-tier search fallback: Maps Grounding (primary) -> Google Search Grounding (secondary) -> knowledge"
  - "URL cross-reference: prefer maps chunks, fall back to web chunks, apply same two-pass title+fill logic"

requirements-completed: [SRCH-01, SRCH-02]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 20 Plan 01: Enriched Search — Maps Grounding + SearchResult Upgrade Summary

**Gemini Maps Grounding as primary travel search path with rating/reviewCount/address fields in SearchResult, plus native Zod v4 z.toJSONSchema() in travelParser**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-02T17:54:06Z
- **Completed:** 2026-03-02T17:56:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `geminiMapsSearch()` using `{ googleMaps: {} }` tool as the new primary search path — returns place-aware data (ratings, addresses) that Google Search grounding cannot provide
- Updated `SearchResult` interface with `rating: number | null`, `reviewCount: number | null`, `address: string | null` fields; updated all three search functions (Maps, Google Search, knowledge) to return these fields
- Wired three-tier fallback chain in `searchTravel()`: Maps Grounding -> Google Search Grounding -> knowledge, with `queryType` param driving result count (5 for hotels/activities, 3 otherwise)
- Migrated `travelParser.ts` from broken `zod-to-json-schema` (silently broken with Zod v4) to native `z.toJSONSchema()` — removed both the `zod/v3` and `zod-to-json-schema` imports

## Task Commits

1. **Task 1: Add geminiMapsSearch() and update SearchResult type** - `3a025b7` (feat)
2. **Task 2: Migrate travelParser.ts to z.toJSONSchema()** - `1a3d320` (feat)

## Files Created/Modified

- `src/groups/travelSearch.ts` - Added `geminiMapsSearch()`, updated `SearchResult` interface, updated `searchTravel()` with `queryType` param and three-tier fallback
- `src/groups/travelParser.ts` - Replaced `zod/v3` + `zod-to-json-schema` imports with `import { z } from 'zod'` and `z.toJSONSchema()`

## Decisions Made

- Maps chunks are preferred over web chunks for URL extraction — `c.maps?.uri` checked first, fall back to `c.web?.uri` if no maps chunks
- `isFallback` flag only set to `true` when reaching `knowledgeFallback` — Maps and Google Search grounding both return `isFallback: false` (consistent with prior semantics)
- `snippet` and `price` set to `''` and `null` in Maps results — Maps prompt requests ratings/addresses, not snippets/prices

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript error in `cli/bot.ts` (file outside `rootDir`): unrelated to this plan, not introduced by these changes. No errors in `travelSearch.ts` or `travelParser.ts`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `SearchResult` now carries `rating`, `reviewCount`, `address` — ready for Phase 20 Plan 02 to use in `travelFormatter.ts` for compact one-liner display
- Three-tier fallback chain is in place — formatter can assume these fields may be null (Maps data not always complete)
- `queryType` is already forwarded to `searchTravel()` call sites — verify call sites pass it through

---
*Phase: 20-enriched-search*
*Completed: 2026-03-02*

---
phase: 18-trip-memory
plan: 03
subsystem: groups
tags: [trip-memory, history-search, gemini, fts5, recall, travelParser, travelHandler]

# Dependency graph
requires:
  - phase: 18-01
    provides: tripDecisions and tripContexts tables with getDecisionsByGroup, searchGroupMessages, getTripContext
  - phase: 18-02
    provides: trip context accumulator that populates the DB with decisions and context summaries
provides:
  - history_search queryType in TravelIntentSchema (travelParser.ts)
  - handleHistorySearch function: queries tripDecisions + FTS5, synthesizes answer via Gemini
  - Dispatch branch in handleTravelMention that routes history_search before web search
affects: [19-itinerary-builder, 21-travel-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - history_search queryType in Zod enum routes to recall path, never to web search
    - handleHistorySearch: getDecisionsByGroup + searchGroupMessages(FTS5) + generateText synthesis
    - Dispatch ordering: vague check -> history_search -> web search (prevents live search for recall)

key-files:
  created: []
  modified:
    - src/groups/travelParser.ts
    - src/groups/travelHandler.ts

key-decisions:
  - "history_search dispatch branch placed after vague check but before web search block -- recall questions skip searchTravel entirely"
  - "handleHistorySearch uses generateText (not generateJson) since the output is a natural language answer, not structured data"
  - "FTS5 search runs only when searchTerms are non-empty; empty query gracefully skips to decisions-only context"

requirements-completed: [MEM-02]

# Metrics
duration: 1min
completed: 2026-03-02
---

# Phase 18 Plan 03: History Search Handler Summary

**Conversation recall via history_search queryType: Gemini classifies recall questions, handleHistorySearch queries tripDecisions + FTS5 and synthesizes a natural language answer without triggering a live web search**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-02T16:18:45Z
- **Completed:** 2026-03-02T16:20:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `'history_search'` as seventh value in the `queryType` z.enum in `TravelIntentSchema` (travelParser.ts)
- Updated `parseTravelIntent` system instruction to teach Gemini when to classify recall questions (e.g., "what did we decide about the hotel?", "מה החלטנו על המלון?") as `history_search` with `isVague=false`
- Added imports for `getDecisionsByGroup`, `searchGroupMessages`, `getTripContext` (tripMemory.ts) and `generateText` (provider.ts) to travelHandler.ts
- Implemented `handleHistorySearch`: loads all trip decisions, fetches trip context, runs FTS5 search with sanitized terms, formats data as readable lists, calls Gemini `generateText` for synthesis, returns honest fallback if no data found
- Added dispatch branch in `handleTravelMention` after the vague check block and before the web search block — `history_search` returns `true` without calling `searchTravel`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add history_search queryType and system prompt to travelParser.ts** - `643e7fc` (feat)
2. **Task 2: Add handleHistorySearch and dispatch branch to travelHandler.ts** - `418bee8` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/groups/travelParser.ts` - Added `'history_search'` to queryType enum; updated systemInstruction with recall classification instructions
- `src/groups/travelHandler.ts` - Added tripMemory and generateText imports; added `handleHistorySearch` function with decision loading, FTS5 search, Gemini synthesis; added `history_search` dispatch branch in `handleTravelMention`

## Decisions Made

- Dispatch branch ordering was chosen carefully: after `isVague` check (so recall questions don't get flagged as vague), before `isTravelRelated && !isVague` web search block (so `searchTravel` is never called for recall).
- `generateText` was chosen over `generateJson` for the synthesis call — the output is a conversational answer, not structured data that needs validation.
- FTS5 search skips gracefully when `searchTerms` is empty, falling back to decisions-only context for Gemini. This prevents `searchGroupMessages` from receiving an empty sanitized query (which would return `[]` anyway, but avoids the DB call entirely).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript error in `cli/bot.ts` (outside rootDir) — confirmed pre-existing before this plan, out of scope per deviation rules. Only error shown by `tsc --noEmit`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 18 (Trip Memory) is now complete: DB schema + FTS5 (18-01), trip context accumulator (18-02), history search recall (18-03)
- Users can @mention the bot with recall questions and receive answers synthesized from stored trip decisions and chat history
- Phase 19 (itinerary builder) can call `getTripContext(groupJid)` for destination and dates
- Phase 21 (travel intelligence) can call `getUnresolvedOpenItems(groupJid)` for digest triggers

## Self-Check: PASSED

Files verified present:
- FOUND: src/groups/travelParser.ts (modified)
- FOUND: src/groups/travelHandler.ts (modified)

Commits verified present:
- FOUND: 643e7fc (feat: add history_search queryType and system prompt to travelParser.ts)
- FOUND: 418bee8 (feat: add handleHistorySearch and dispatch branch to travelHandler.ts)

---
*Phase: 18-trip-memory*
*Completed: 2026-03-02*

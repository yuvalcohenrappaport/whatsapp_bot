---
phase: 20-enriched-search
plan: 02
subsystem: groups
tags: [formatter, booking-labels, whatsapp, travel-search, queryType]

# Dependency graph
requires:
  - phase: 20-enriched-search
    plan: 01
    provides: SearchResult with rating/reviewCount/address fields, searchTravel() queryType param
provides:
  - Compact one-liner formatTravelResults() with rating, reviewCount, address display
  - BOOKING_DOMAINS allowlist and isBookingUrl() helper for booking URL detection
  - formatOneLiner() composing numbered result lines for WhatsApp
  - intent.queryType wired through travelHandler to searchTravel()
affects: [travelFormatter, travelHandler, groupMessagePipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One-liner format: 'N. Title [star rating (reviews)] [-- address] [-- URL]' with single-newline separation"
    - "Booking URLs: isBookingUrl() checks hostname against BOOKING_DOMAINS, falls back to string includes for malformed URLs"
    - "Review count: >= 1000 shown as 'N.NK', below shown as raw number"

key-files:
  created: []
  modified:
    - src/groups/travelFormatter.ts
    - src/groups/travelHandler.ts

key-decisions:
  - "Compact one-liner format replaces multi-line cards — keeps 5-6 results readable in WhatsApp"
  - "Shopping cart emoji prefix for booking domains — quick visual cue without verbose 'Book:' label"
  - "Single newline between results (not double) — maximizes density for WhatsApp readability"
  - "Null-safe field rendering — rating, reviewCount, address each shown only when non-null"

patterns-established:
  - "BOOKING_DOMAINS allowlist pattern for domain classification"
  - "formatOneLiner() composes fields conditionally with em-dash separators"

requirements-completed: [SRCH-02, SRCH-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 20 Plan 02: Enriched Search -- Compact Formatter + QueryType Wiring Summary

**Compact one-liner travel results with booking domain labels and intent.queryType wired to searchTravel**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-02T18:01:26Z
- **Completed:** 2026-03-02T18:03:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Rewrote `formatTravelResults()` from multi-line card format to compact one-liners: each result is a single line like `1. Hotel Name ⭐ 4.5 (2.1K) -- Eilat -- URL`
- Added `BOOKING_DOMAINS` allowlist (booking.com, airbnb.com, hotels.com, expedia.com, agoda.com) with `isBookingUrl()` helper that parses hostname, falling back to string includes for malformed URLs
- Added `formatReviewCount()` helper that renders counts >= 1000 as `N.NK` format (e.g., 2100 -> "2.1K")
- Added `formatOneLiner()` that conditionally includes rating, reviewCount, address, and URL with em-dash separators -- null fields are simply omitted
- Results now separated by single newlines (not double) for maximum WhatsApp density
- Wired `intent.queryType` as third argument to `searchTravel()` in travelHandler.ts -- hotels/activities queries now return 5 results, all others return 3

## Task Commits

1. **Task 1: Rewrite travelFormatter with compact one-liner format and booking labels** - `b1fa81f` (feat)
2. **Task 2: Wire intent.queryType to searchTravel in travelHandler** - `ca3b73d` (feat)

## Files Created/Modified

- `src/groups/travelFormatter.ts` - Replaced multi-line card body with BOOKING_DOMAINS, isBookingUrl(), formatReviewCount(), formatOneLiner(), and compact one-liner formatTravelResults()
- `src/groups/travelHandler.ts` - Added `intent.queryType` as third arg to `searchTravel()` call (line 327)

## Decisions Made

- Shopping cart emoji prefix for booking domains instead of verbose "Book:" text label -- more compact and visually distinctive in WhatsApp
- Single newline between result lines (not double) -- keeps the entire result block tight for 5-6 results
- Rating, reviewCount, and address are each conditionally rendered -- null/undefined fields simply absent from the line rather than showing placeholders
- formatHelpText() left completely unchanged -- no behavioral change to help responses

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript error in `cli/bot.ts` (file outside `rootDir`): unrelated to this plan, not introduced by these changes. Zero errors in travelFormatter.ts or travelHandler.ts.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Phase 20 (Enriched Search) is now complete -- all 2 plans done
- Travel search end-to-end: intent parsed -> queryType drives result count -> Maps Grounding returns rich data -> compact one-liner format with booking labels displayed
- Ready for Phase 21 (Travel Intelligence): open item digest and proactive suggestions

---
*Phase: 20-enriched-search*
*Completed: 2026-03-02*

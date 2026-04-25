---
phase: 56-google-places-geocoding
plan: 01
subsystem: database
tags: [sqlite, drizzle-orm, google-places, geocoding, schema-migration]

# Dependency graph
requires:
  - phase: 55-trip-dashboard-view
    provides: lat/lng columns on trip_decisions (migration 0024) used as geocoding targets
provides:
  - Migration 0025 with 4 new trip_decisions columns (place_id, canonical_address, lookup_status, place_metadata)
  - Drizzle schema placeId/canonicalAddress/lookupStatus/placeMetadata on tripDecisions table
  - LookupStatus type, GEOCODEABLE_TYPES Set, PlaceMetadata interface from tripMemory.ts
  - updateDecisionGeocode(id, status, result) helper in tripMemory.ts
  - GOOGLE_PLACES_API_KEY optional zod field in config.ts
affects: [56-02, 56-03, 56-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-written ALTER TABLE migration (0025) following 0024 precedent — no drizzle-kit generate"
    - "Optional API key in config.ts zod schema — server logs-and-skips when absent, no crash"
    - "updateDecisionGeocode placed next to updateDecisionConflicts for discoverability"

key-files:
  created:
    - drizzle/0025_places_geocoding.sql
  modified:
    - src/db/schema.ts
    - src/db/queries/tripMemory.ts
    - src/config.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "drizzle-kit migrate claims success but doesn't apply hand-written ALTER TABLE in this env; applied via better-sqlite3 node script (same fix as 51-01 precedent)"
  - "GEOCODEABLE_TYPES includes both 'hotel'+'lodging'+'accommodation' to cover schema enum variants — restaurant and activity also included"
  - "GOOGLE_PLACES_API_KEY is optional in config.ts so the server doesn't crash when the key isn't present yet"
  - "updateDecisionGeocode clears all geocoding columns (null) when result is null, matching no_match/skipped/error status semantics"

patterns-established:
  - "LookupStatus as typed union (not DB CHECK constraint) — matches type/category column conventions"
  - "PlaceMetadata serialized to JSON string in placeMetadata column — same pattern as conflictsWith and metadata"

requirements-completed: [MAPS-01, MAPS-02]

# Metrics
duration: 3min
completed: 2026-04-25
---

# Phase 56 Plan 01: Google Places Geocoding Foundation Summary

**SQLite migration 0025 + Drizzle schema + updateDecisionGeocode helper + GOOGLE_PLACES_API_KEY env var — full geocoding foundation for Phase 56 Plans 02-04**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-25T17:54:28Z
- **Completed:** 2026-04-25T17:57:42Z
- **Tasks:** 2
- **Files modified:** 4 (+ 1 new migration)

## Accomplishments
- Migration 0025 adds place_id, canonical_address, lookup_status (NOT NULL DEFAULT 'pending'), place_metadata to trip_decisions; all 22 existing rows backfilled to 'pending'
- Drizzle tripDecisions table extended with 4 typed columns (placeId, canonicalAddress, lookupStatus, placeMetadata)
- tripMemory.ts exports LookupStatus, GEOCODEABLE_TYPES, PlaceMetadata, updateDecisionGeocode — ready for Plan 02 Places client
- config.ts validates GOOGLE_PLACES_API_KEY as optional zod field; confirmed zero FE leak (dashboard grep clean)
- tripMemory 27/27 vitest green; tsc --noEmit passes (pre-existing cli rootDir warnings only)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0025 + extend Drizzle schema** - `4c7902d` (feat)
2. **Task 2: updateDecisionGeocode helper + GEOCODEABLE_TYPES + GOOGLE_PLACES_API_KEY** - `15caaf7` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `drizzle/0025_places_geocoding.sql` - Hand-written ALTER TABLE migration for 4 new geocoding columns
- `drizzle/meta/_journal.json` - Added idx 25 entry for the new migration
- `src/db/schema.ts` - Extended tripDecisions with placeId/canonicalAddress/lookupStatus/placeMetadata
- `src/db/queries/tripMemory.ts` - Added LookupStatus, GEOCODEABLE_TYPES, PlaceMetadata, updateDecisionGeocode
- `src/config.ts` - Added GOOGLE_PLACES_API_KEY optional zod field

## Decisions Made
- **drizzle-kit migrate workaround:** Tool claims success but doesn't apply hand-written ALTER TABLE in this project's env (same issue as 51-01). Applied via inline better-sqlite3 node script — idempotent, handles already-exists gracefully.
- **GEOCODEABLE_TYPES coverage:** Includes 'hotel', 'lodging', AND 'accommodation' because the trip_decisions schema type enum uses 'accommodation' while CONTEXT.md names 'hotel'. All three included to avoid missed lookups.
- **Optional API key:** GOOGLE_PLACES_API_KEY is z.string().optional() so the bot doesn't crash when the user hasn't set it yet; Plans 02-04 gate their logic on key presence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-kit migrate didn't apply hand-written ALTER TABLE statements**
- **Found during:** Task 1 verification (PRAGMA table_info showed no new columns)
- **Issue:** `npm run db:migrate` reported "migrations applied successfully" but the 4 columns were not present in the live DB
- **Fix:** Applied all 4 ALTER TABLE statements directly via better-sqlite3 inline node script with duplicate-column guard
- **Files modified:** None (data/bot.db only)
- **Verification:** sqlite3 PRAGMA table_info shows all 4 columns; COUNT(*) WHERE lookup_status='pending' = 22 = total row count
- **Committed in:** 4c7902d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — known env limitation, documented in 51-01 precedent)
**Impact on plan:** Essential for migration to take effect. No scope creep.

## Issues Encountered
- drizzle-kit migrate ENV limitation (same as 51-01 precedent) — resolved inline without impact to plan scope.

## User Setup Required
The plan's `user_setup` section specifies:
- **GOOGLE_PLACES_API_KEY** env var required for Phase 56 geocoding to run
- Source: GCP Console project 81921508668, enable "Places API (New)" then create API key
- Without the key, Plans 02-04 log-and-skip gracefully (server won't crash)

## Next Phase Readiness
- Plan 02 (Places API client) can now `import { updateDecisionGeocode, GEOCODEABLE_TYPES } from '../db/queries/tripMemory.js'` and `import { config } from '../config.js'` and implement the lookup without further schema work
- DB columns exist and all existing rows are in 'pending' state, ready for the backfill route (Plan 04)

---
*Phase: 56-google-places-geocoding*
*Completed: 2026-04-25*

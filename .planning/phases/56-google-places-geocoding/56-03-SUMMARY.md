---
phase: 56-google-places-geocoding
plan: 03
subsystem: api+dashboard
tags: [backfill, geocoding, fastify, react, zod, dashboard-ui]

# Dependency graph
requires:
  - phase: 56-01
    provides: updateDecisionGeocode, GEOCODEABLE_TYPES, LookupStatus, tripMemory helpers
  - phase: 56-02
    provides: geocodeDecision, runGeocodeAfterInsert in placesGeocode.ts
provides:
  - POST /api/trips/:groupJid/backfill-geocode JWT-gated route (trips.ts)
  - getDecisionsForBackfill(groupJid) exported from tripMemory.ts
  - BackfillGeocodeButton component (spinner + toast UX)
  - BackfillSummarySchema Zod schema in tripSchemas.ts
  - dashboard/src/api/trips.ts with backfillGeocode() client function
  - BackfillGeocodeButton wired into TripView next to ExportButton
affects: [56-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "inArray from drizzle-orm for multi-value WHERE IN filter"
    - "apiFetch + BackfillSummarySchema.parse for type-safe dashboard API call"
    - "readOnly prop guard: return null on archived trips (no DOM render)"

key-files:
  created:
    - dashboard/src/api/trips.ts
    - dashboard/src/components/trip/BackfillGeocodeButton.tsx
  modified:
    - src/db/queries/tripMemory.ts
    - src/api/routes/trips.ts
    - dashboard/src/api/tripSchemas.ts
    - dashboard/src/pages/TripView.tsx

key-decisions:
  - "BackfillSummarySchema.parse used in dashboard API client for type-safety (same Zod-on-response pattern as tripSchemas.ts schemas)"
  - "apiFetch used in trips.ts client (no raw fetch + JWT arg) — apiFetch reads JWT from localStorage, matching ExportButton pattern exactly"
  - "BackfillGeocodeButton returns null when readOnly — clean no-DOM guard instead of visibility CSS"

# Metrics
duration: ~8min
completed: 2026-04-25
---

# Phase 56 Plan 03: Backfill Route + Dashboard Button Summary

**On-demand geocoding backfill — JWT-gated POST route + getDecisionsForBackfill query + BackfillGeocodeButton with spinner/toast wired into TripView**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-04-25
- **Tasks:** 2
- **Files modified:** 4 modified + 2 created

## Accomplishments
- `getDecisionsForBackfill(groupJid)` exported from tripMemory.ts — returns non-archived, geocodeable-type rows with lookup_status in ('pending', 'error'); uses `inArray` from drizzle-orm
- `POST /api/trips/:groupJid/backfill-geocode`: JWT-gated, 200ms-paced sequential loop, returns `{ geocoded, no_match, error, skipped, total }`, 404 for unknown trips, 403 for archived trips, 412 if GOOGLE_PLACES_API_KEY not configured
- `BackfillSummarySchema` + `BackfillSummary` type added to `dashboard/src/api/tripSchemas.ts`
- `dashboard/src/api/trips.ts` created with `backfillGeocode(groupJid)` using `apiFetch` + schema validation
- `BackfillGeocodeButton` component: MapPinned icon, spinner during request, sonner toast on completion, hidden (return null) when readOnly
- `TripView.tsx` updated: BackfillGeocodeButton rendered adjacent to ExportButton in gap-2 flex row
- `npx tsc --noEmit` clean (pre-existing cli rootDir warnings only); `cd dashboard && npm run build` passes in 5.66s

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend — getDecisionsForBackfill + POST /backfill-geocode route** - `6ab8864` (feat)
2. **Task 2: Dashboard — BackfillGeocodeButton + API client + TripView wiring** - `7b3f44e` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/db/queries/tripMemory.ts` - Added inArray import + getDecisionsForBackfill export
- `src/api/routes/trips.ts` - Added imports (geocodeDecision, getDecisionsForBackfill, updateDecisionGeocode, config) + POST /backfill-geocode route
- `dashboard/src/api/tripSchemas.ts` - Added BackfillSummarySchema + BackfillSummary type
- `dashboard/src/api/trips.ts` - New file: backfillGeocode() dashboard API client
- `dashboard/src/components/trip/BackfillGeocodeButton.tsx` - New component: spinner, toast, readOnly guard
- `dashboard/src/pages/TripView.tsx` - Import + render BackfillGeocodeButton next to ExportButton

## Decisions Made
- **apiFetch pattern:** Used `apiFetch` (JWT auto-injected from localStorage) instead of raw fetch with explicit jwt arg — matches ExportButton's existing pattern exactly, no prop threading needed.
- **return null on readOnly:** BackfillGeocodeButton returns null instead of hidden/disabled — cleaner for consumers, the `readOnly` prop already carries the semantics.
- **BackfillSummarySchema.parse on response:** Validates the summary shape at the boundary so TypeScript callers get a typed object; if the backend shape drifts the parse throws with a clear error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] dashboard/src/api/trips.ts did not exist**
- **Found during:** Task 2 setup
- **Issue:** Plan says "If `dashboard/src/api/trips.ts` doesn't exist, follow the ExportButton.tsx API-call pattern" — the file was absent
- **Fix:** Created `dashboard/src/api/trips.ts` using `apiFetch` (as used in ExportButton) rather than raw fetch — keeps JWT injection centralized
- **Files modified:** dashboard/src/api/trips.ts (created)
- **Committed in:** 7b3f44e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (missing file — handled per plan's explicit fallback instruction)

## Verification Results
- `npx tsc --noEmit` — clean (pre-existing cli rootDir warnings only)
- `cd dashboard && npm run build` — tsc -b + vite build clean in 5.66s
- `grep -n 'BackfillGeocodeButton' dashboard/src/pages/TripView.tsx` — 2 lines (import + render)
- `grep -n 'backfill-geocode' src/api/routes/trips.ts` — 3 lines (comment, path, log)
- `grep -n 'setTimeout.*200' src/api/routes/trips.ts` — 1 line (200ms pace confirmed)

## Self-Check: PASSED
- `src/db/queries/tripMemory.ts` — FOUND (getDecisionsForBackfill at line 396)
- `src/api/routes/trips.ts` — FOUND (POST /api/trips/:groupJid/backfill-geocode route)
- `dashboard/src/api/trips.ts` — FOUND (backfillGeocode function)
- `dashboard/src/components/trip/BackfillGeocodeButton.tsx` — FOUND
- Commits 6ab8864 and 7b3f44e — FOUND in git log

## Next Phase Readiness
- Plan 04 (UI checkpoint) can exercise the full round-trip: open trip page, click Backfill Geocoding, verify spinner + toast, confirm lat/lng populated in DB
- The route is idempotent: second run returns total:0 (or only newly-error rows) since geocoded/no_match/skipped rows are filtered by getDecisionsForBackfill

---
*Phase: 56-google-places-geocoding*
*Completed: 2026-04-25*

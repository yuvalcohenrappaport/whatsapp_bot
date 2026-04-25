---
phase: 56-google-places-geocoding
plan: 04
subsystem: ui+api
tags: [react, zod, dashboard-ui, google-places, geocoding]

# Dependency graph
requires:
  - phase: 56-01
    provides: LookupStatus, placeMetadata column, GEOCODEABLE_TYPES
  - phase: 56-02
    provides: runGeocodeAfterInsert, geocodeDecision
  - phase: 56-03
    provides: BackfillGeocodeButton, POST /backfill-geocode route
provides:
  - TripDecisionSchema extended with placeId, canonicalAddress, lookupStatus, placeMetadata
  - PlaceMetadataSchema + parsePlaceMetadata safe parser in tripSchemas.ts
  - Inline rating · open_now · primaryType badge cluster on geocoded decision rows in DecisionsBoard
  - Muted "no match" pin hint on no_match rows in DecisionsBoard
  - place_id-based Google Maps URL (falls back to text search for non-geocoded rows)
  - Live UAT: all 10 checks passed by owner
affects: [57-drop-a-pin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "parsePlaceMetadata: defensive safeParse — any JSON/schema failure returns null, never crashes FE"
    - "Inline badge cluster added AFTER existing MapPin icon on the same flex row — additive, no existing layout restructured"
    - "place_id URL preference: d.placeId ? maps.google.com/maps/place/?q=place_id:<id> : text-search fallback"

key-files:
  created: []
  modified:
    - dashboard/src/api/tripSchemas.ts
    - dashboard/src/components/trip/DecisionsBoard.tsx

key-decisions:
  - "parsePlaceMetadata returns null on any failure (JSON parse error OR Zod schema mismatch) — FE never crashes on server-side schema drift"
  - "place_id URL used when available: opens the matched place card in Google Maps instead of a bare pin-only view (UAT feedback)"
  - "No-match hint is non-clickable — Phase 57 will wire the drop-a-pin click target; Phase 56 is append-only per CONTEXT.md locked decision"
  - "Mobile wrapping accepted: metadata badge cluster wraps to second line on narrow viewports, no truncate/overflow-hidden added per CONTEXT.md"

patterns-established:
  - "PlaceMetadataSchema + parsePlaceMetadata: the JSON-in-column + FE safe parser pattern for blobs (same as conflictsWith / metadata)"

requirements-completed: [MAPS-03]

# Metrics
duration: ~20min (Tasks 1-2 auto + Task 3 human-verify checkpoint)
completed: 2026-04-25
---

# Phase 56 Plan 04: Dashboard UI — Inline Places Metadata Summary

**TripDecisionSchema extended with 4 geocoding fields + PlaceMetadataSchema safe parser; DecisionsBoard renders rating · open_now · primaryType inline on geocoded rows and a muted "no match" hint on no_match rows; place_id-based Maps URL fixed mid-UAT**

## Performance

- **Duration:** ~20 min (Tasks 1-2 auto, Task 3 human-verify checkpoint, mid-UAT fix)
- **Completed:** 2026-04-25
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 2

## Accomplishments
- `TripDecisionSchema` in `dashboard/src/api/tripSchemas.ts` extended with `placeId`, `canonicalAddress`, `lookupStatus`, `placeMetadata` — aligns with Plan 01's migration 0025 columns
- `PlaceMetadataSchema` + `parsePlaceMetadata(raw)` exported — safe Zod safeParse wrapper, returns null on any JSON/schema failure so the FE is insulated from server-side schema drift
- 4 vitest cases cover the parser: null input, empty `{}` (defaults applied), unparseable JSON, and a full `{rating, openNow, types, primaryType}` object
- `DecisionsBoard.tsx` renders inline badge cluster (Star + rating, Circle + Open/Closed, primaryType) after the MapPin icon on geocoded rows; muted italic "no match" hint on no_match rows; all other rows render unchanged
- UAT 10/10 PASS by owner on live PM2 bot; mid-UAT fix applied: MapPin link now prefers `place_id` URL, opening the matched place card instead of a bare-coords pin view

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend TripDecisionSchema + add PlaceMetadataSchema** - `6beadb2` (feat)
2. **Task 2: Render inline metadata + no-match hint in DecisionsBoard** - `bc4461f` (feat)
3. **Task 3: UAT checkpoint — in-flight fix: prefer place_id for Google Maps link** - `d4aaef3` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `dashboard/src/api/tripSchemas.ts` — Extended TripDecisionSchema with 4 geocoding fields; added PlaceMetadataSchema, PlaceMetadata type, parsePlaceMetadata safe parser; added vitest cases
- `dashboard/src/components/trip/DecisionsBoard.tsx` — Imports parsePlaceMetadata, Star, Circle from lucide; renders inline badge cluster on geocoded rows; muted no-match hint on no_match rows; place_id-preferred Maps URL

## Decisions Made
- **parsePlaceMetadata null-safety:** Any failure path returns null — catches JSON.parse errors, Zod schema violations, and null input. The FE rendering gates on the result being non-null, so no badge cluster renders on bad/missing data.
- **place_id URL preference:** `d.placeId ? 'https://maps.google.com/maps/place/?q=place_id:...' : text-search fallback` — opens the exact matched place card in Google Maps (confirmed by UAT feedback that the raw-coords link was opening a pin-only view).
- **No-match hint non-clickable:** Phase 56 is append-only per CONTEXT.md locked decision. Phase 57 will wire the drop-a-pin click target.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed MapPin Google Maps link using raw coordinates on geocoded rows**
- **Found during:** Task 3 (End-to-end UAT checkpoint) — owner reported "the maps link doesn't match the correct geo match"
- **Issue:** The existing MapPin anchor used `?q=lat,lng` (raw-coordinates URL) even when `placeId` was available, which opens a bare pin-only view in Google Maps instead of the matched place card
- **Fix:** Updated the Maps URL construction in `DecisionsBoard.tsx` to prefer `place_id:` URL format when `d.placeId` is non-null; falls back to text-search (no-coords path) or coords (legacy path) otherwise
- **Files modified:** `dashboard/src/components/trip/DecisionsBoard.tsx`
- **Verification:** Owner tested the fix and confirmed "approved" — all 10 UAT checks pass
- **Committed in:** `d4aaef3` (mid-UAT fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 Bug — MapPin URL preference)
**Impact on plan:** Necessary for correct UX — the raw-coords URL was working but opened the wrong Maps view. Fix is additive (one ternary), no layout change.

## Issues Encountered
None — the MapPin URL issue was caught during UAT and fixed inline before final approval.

## User Setup Required
None — no new external service configuration. `GOOGLE_PLACES_API_KEY` and Places API (New) enablement were prerequisites from Plans 02-03.

## Next Phase Readiness
- Phase 56 is fully complete: all 4 plans shipped (foundation → Places client → backfill route → UI display)
- Phase 57 (Drop a Pin) can consume: `lookupStatus`, `placeId`, `canonicalAddress` are now visible in the dashboard schema and rendered in `DecisionsBoard`; the muted "no match" hint is the click target for Phase 57's autocomplete picker
- Requirement MAPS-03 complete (inline metadata display + no styling regression)

---
*Phase: 56-google-places-geocoding*
*Completed: 2026-04-25*

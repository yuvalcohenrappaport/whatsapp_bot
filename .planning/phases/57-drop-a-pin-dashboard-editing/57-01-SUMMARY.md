---
phase: 57-drop-a-pin-dashboard-editing
plan: 01
subsystem: integrations

tags: [google-places, autocomplete, place-details, zod, fastify, drizzle, sqlite, vitest, hebrew]

requires:
  - phase: 56-google-places-geocoding
    provides: GeocodeResult shape, PlaceMetadata type, X-Goog-Api-Key + X-Goog-FieldMask raw-fetch pattern, HEBREW_REGEX/detectLanguageCode pattern, tripDecisions geocoding columns (place_id/canonical_address/lat/lng/place_metadata/lookup_status)

provides:
  - autocompletePlaces(query, sessionToken, languageCode?) — up to 5 typed suggestions from Places API (New) Autocomplete REST
  - fetchPlaceDetails(placeId, sessionToken, languageCode?) — Place Details REST returning shape compatible with Phase 56 GeocodeResult
  - PlacesAutocompleteError typed error class (status carries through; 412 = missing API key, 0 = schema drift)
  - AutocompleteSuggestionSchema + PlaceDetailsResultSchema Zod schemas (consumed by Plan 03 dashboard schemas)
  - pinDecision(decisionId, groupJid, result) — discriminated-union write helper enforcing groupJid + archived guards
  - PinDecisionResult discriminated union — { ok: true } | { ok: false, reason: 'missing' | 'wrong-group' | 'archived' }

affects: [57-02-dashboard-routes, 57-03-dashboard-schemas-and-client, 57-04-dashboard-ui, 57-05-uat-and-polish]

tech-stack:
  added: []
  patterns:
    - Session-token call pair for Places API (New) — caller-supplied UUID threaded through every keystroke + final fetchPlaceDetails to close the billable session window
    - Discriminated-union DB write helpers for routes that need to map distinct guard failures to distinct HTTP status codes (anti-leak 404 vs D14-locked 403)
    - User-driven integrations throw on missing API key (vs Phase 56's fire-and-forget no-op) — picker UX exposes the gap immediately rather than silently dropping writes

key-files:
  created:
    - src/integrations/placesAutocomplete.ts
    - src/integrations/__tests__/placesAutocomplete.test.ts
  modified:
    - src/db/queries/tripMemory.ts (added pinDecision + PinDecisionResult after updateDecisionGeocode)
    - src/db/queries/__tests__/tripMemory.test.ts (added pinDecision describe block with 5 cases)

key-decisions:
  - Module redefines HEBREW_REGEX + detectLanguageCode locally rather than importing from placesGeocode.ts — keeps the two integration modules independent so Phase 58/59 don't have to thread a shared util
  - autocompletePlaces returns [] (not null) on zero results — easier UX hooks for "No matches" inline message
  - autocompletePlaces caps at 5 suggestions in the module layer regardless of API response length — picker contract is fixed
  - fetchPlaceDetails falls back to the requested placeId when the API omits id from the body — callers always have a stable id
  - pinDecision returns a discriminated union, NOT a boolean — flat boolean would force the route to either over-403 (existence leak across groups) or over-404 (D14 violation)
  - pinDecision skips the GEOCODEABLE_TYPES gate — the user can pin ANY decision row including types runGeocodeAfterInsert would have skipped (transit, shopping, flights)
  - pinDecision always writes lookup_status='geocoded' — explicit user pick has no no_match/error path
  - pinDecision is idempotent on overwrite — re-pinning the same place writes the same data, re-pinning a different place overwrites in place

patterns-established:
  - "Session-token Places API client: one UUID per picker open, threaded through autocomplete keystrokes + final fetchPlaceDetails"
  - "Discriminated-union DB write helpers for guard-failure → HTTP status mapping (Plan 02 will map missing/wrong-group → 404, archived → 403)"
  - "Defensive Zod parsing on every Places API response (every nested optional, never .strict()) — schema drift surfaces as PlacesAutocompleteError(status=0) rather than crashing the route"

requirements-completed: [DASH-TRIP-04]

duration: ~4min
completed: 2026-04-25
---

# Phase 57 Plan 01: Server-side Pin Editing Foundation Summary

**Places Autocomplete + Place Details REST client with session-token billing pattern, plus a discriminated-union pinDecision DB helper that lets the Plan 02 PATCH route map missing/wrong-group → 404 (anti-leak) and archived → 403 (per CONTEXT lock D14).**

## Performance

- **Duration:** ~4 minutes
- **Started:** 2026-04-25T20:41:36Z
- **Completed:** 2026-04-25T20:45:21Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)
- **Tests added:** 27 (22 placesAutocomplete + 5 pinDecision)

## Accomplishments

- New `src/integrations/placesAutocomplete.ts` exporting `autocompletePlaces`, `fetchPlaceDetails`, `PlacesAutocompleteError`, `AutocompleteSuggestionSchema`, `PlaceDetailsResultSchema`, `detectLanguageCode` — the session-token call pair Phase 56 explicitly deferred.
- New `pinDecision` helper in `tripMemory.ts` returning a discriminated union (`{ ok: true } | { ok: false, reason }`) so Plan 02's HTTP route can map distinct guard failures to distinct status codes without leaking row-existence across groups.
- 22 vitest cases for placesAutocomplete (happy paths, zero results, cap-at-5, HTTP errors, schema drift, missing API key 412, Hebrew detection, header shape, URL query string, placeId path encoding, missing structuredFormat fields, languageCode override).
- 5 new vitest cases for pinDecision (happy round-trip on transit type proving type-gate-skip, re-pin overwrite, missing row, wrong-group refusal, archived row refusal — each asserts the discriminated-union shape and verifies non-mutation on guard failures).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/integrations/placesAutocomplete.ts client module** — `480bf7c` (feat)
2. **Task 2: Add pinDecision helper to tripMemory.ts + tests** — `014d364` (feat)

**Plan metadata:** _(see final commit below)_ — `docs(57-01): complete server-side pin foundation plan`

## Files Created/Modified

- `src/integrations/placesAutocomplete.ts` *(created)* — Places Autocomplete + Place Details REST client with raw fetch, narrow X-Goog-FieldMask, defensive Zod parsing, Hebrew detection, typed error class.
- `src/integrations/__tests__/placesAutocomplete.test.ts` *(created)* — 22 vitest cases covering both functions, all error paths, all header/URL contract assertions.
- `src/db/queries/tripMemory.ts` *(modified)* — added `pinDecision` + `PinDecisionResult` after `updateDecisionGeocode`. Pre-reads the row for groupJid + archived guards; writes lookup_status='geocoded' + place_id + canonical_address + lat + lng + place_metadata in a single UPDATE.
- `src/db/queries/__tests__/tripMemory.test.ts` *(modified)* — added `pinDecision` describe block with 5 cases. All 32 tripMemory tests green.

## Decisions Made

- **Local HEBREW_REGEX redefinition** — chose to redefine the regex inside `placesAutocomplete.ts` rather than re-export from `placesGeocode.ts`. Keeps the two integration modules independent; future phases that only need autocomplete won't drag in the geocoding module.
- **Return [] not null on zero results** — easier UX hook in Plan 03's React picker for the "No matches" inline message.
- **Cap at 5 in the module layer** — fixed picker contract; the API may return more but the module enforces the UI cap so callers can't accidentally render 10 rows.
- **Discriminated-union return for pinDecision** — a boolean would force the route to either over-403 (leak that the row exists in another group) or over-404 (violate D14's "trip is archived" message). The discriminated union resolves this cleanly.
- **pinDecision skips GEOCODEABLE_TYPES gate** — the auto-geocoder skipped types like transit/shopping/flights, but the user can still want to pin those rows manually from the dashboard. The user-driven helper is intentionally less restrictive than the cron helper.
- **412 not 500 on missing API key** — pre-condition failure (config not set), not a runtime crash. Plan 02's route translates this directly to HTTP 412.
- **PlaceMetadata imported as `import type`** — TypeScript-only erased import means the test file doesn't need to mock the tripMemory module just to satisfy the type reference.

## Deviations from Plan

None - plan executed exactly as written. The plan's spec was complete enough that both modules were built in one pass with no auto-fix rules triggered.

## Issues Encountered

None - all 54 tests passed on first run, no tsc regressions, no schema drift, no missing imports.

## User Setup Required

None - no external service configuration required. The same `GOOGLE_PLACES_API_KEY` env var Phase 56 introduced is reused; no new secrets, no new GCP API enables.

## Next Phase Readiness

- **Plan 02 (HTTP routes)** can begin immediately — both functions and `pinDecision` are exported with the exact shapes Plan 02's spec calls for. The 412/404/403 status mapping has a clean source of truth (`PlacesAutocompleteError.status` for autocomplete failures; `PinDecisionResult.reason` for write-guard failures).
- **Plan 03 (dashboard schemas + client)** can begin immediately — `AutocompleteSuggestionSchema` and `PlaceDetailsResultSchema` are exported as Zod schemas the dashboard's `dashboard/src/api/*` layer can mirror.
- Plans 02 and 03 are independent of each other and can run in parallel after this Wave 1 plan completes.

---
*Phase: 57-drop-a-pin-dashboard-editing*
*Plan: 01*
*Completed: 2026-04-25*

## Self-Check: PASSED

- `src/integrations/placesAutocomplete.ts` — FOUND
- `src/integrations/__tests__/placesAutocomplete.test.ts` — FOUND
- `src/db/queries/tripMemory.ts` — pinDecision + PinDecisionResult exported (lines 404, 424)
- `src/db/queries/__tests__/tripMemory.test.ts` — pinDecision describe block present, 32/32 tests green
- Commit `480bf7c` (Task 1) — FOUND
- Commit `014d364` (Task 2) — FOUND
- `npx vitest run` (both files): 54 passed
- `npx tsc --noEmit`: no new errors in modified files

---
phase: 57-drop-a-pin-dashboard-editing
plan: 02
subsystem: api-routes

tags: [fastify, jwt, places-api, autocomplete, places-details, zod, vitest, sse, anti-leak]

requires:
  - phase: 57-drop-a-pin-dashboard-editing
    plan: 01
    provides: autocompletePlaces, fetchPlaceDetails, PlacesAutocompleteError, pinDecision, PinDecisionResult discriminated union

provides:
  - GET /api/trips/:groupJid/autocomplete-places — JWT-gated autocomplete proxy returning { suggestions: AutocompleteSuggestion[] }
  - GET /api/trips/:groupJid/place/:placeId — JWT-gated read-only place preview returning { placeId, lat, lng, canonicalAddress, metadata }
  - PATCH /api/trips/:groupJid/decisions/:id/pin — JWT-gated atomic pin write, body { placeId, sessionToken, languageCode? }, success body { decision: TripDecision }
  - PinDecisionBodySchema (Zod, inline in trips.ts)
  - D14 status code map (403 archived trip OR row, 404 missing OR cross-group, 412 missing API key, 502 upstream Places failure)

affects: [57-03-dashboard-schemas-and-client, 57-04-dashboard-ui, 57-05-uat-and-polish]

tech-stack:
  added: []
  patterns:
    - Inline Zod body schema for PATCH routes (PinDecisionBodySchema sibling of PatchBudgetSchema)
    - PlacesAutocompleteError instanceof discrimination for upstream-error → HTTP-status mapping (412/502 split)
    - PinDecisionResult discriminated-union → distinct HTTP statuses (anti-leak 404 for missing+wrong-group, D14 403 for archived rows)
    - Re-read bundle after pin write to return canonical row — SSE 3s tick fans the same row to other sessions via existing hashTripBundle (already includes lat/lng)
    - Read-only proxy routes (autocomplete + preview) skip the readOnly gate — only the pin write itself is archive-locked

key-files:
  created: []
  modified:
    - src/api/routes/trips.ts (added 3 routes + 1 Zod schema + 2 imports — 199 insertions, no edits to existing handlers)
    - src/api/routes/__tests__/trips.test.ts (added 3 describe blocks — 25 new vitest cases — 530 insertions, no edits to existing 34 cases)

key-decisions:
  - PATCH /pin returns ONLY the freshly-pinned decision row (not the full bundle) — useTrip's optimistic mutation already has a snapshot; it just needs the canonical row to confirm the write
  - Both GET routes (autocomplete + preview) return 404 (not 403) on archived trips — read-only proxies, no UX value in distinguishing
  - Bundle re-read via getTripBundle(groupJid).decisions.find(d => d.id === id) — slightly redundant given pinDecision already wrote the row, but it gives the route a single source of truth (the same projection useTrip will see on its next SSE tick)
  - Reused the existing `description: 'Decision not found'` error string for BOTH missing AND wrong-group cases — anti-leak rule: callers can't distinguish "doesn't exist anywhere" from "exists in another group"
  - Distinct error messages for trip-level vs row-level 403: 'Trip is archived' vs 'Decision is archived' — lets the dashboard surface a clear toast (e.g., "This trip was archived — open it from the archive view to read") vs the rare "this row was auto-archived by Phase 51's cron" case
  - Mocked placesGeocode.js (no-op) in trips.test.ts to prevent the real module from initializing on import — backfill route is unrelated to plan 57-02 but lives in the same router file
  - tripMemory mock in trips.test.ts now also exports updateDecisionGeocode + getDecisionsForBackfill (no-ops) so the backfill route can import without crashing — no test in this plan asserts against them, but they're imported eagerly by trips.ts

requirements-completed: [DASH-TRIP-04]

duration: ~4min
completed: 2026-04-25
---

# Phase 57 Plan 02: Server-side Pin HTTP Routes Summary

**Three JWT-gated trip-scoped routes wired against Plan 01's Places API client + pinDecision helper: search-as-you-type autocomplete, read-only place preview (D9 lock — picker hydrates lat/lng before Save), and PATCH /pin with the full D14 status code map.**

## Performance

- **Duration:** ~4 minutes (start 2026-04-25T20:49:07Z → end 2026-04-25T20:53:08Z)
- **Tasks:** 2
- **Files modified:** 2
- **Tests added:** 25 (cumulative file: 59/59 green)

## Accomplishments

- **GET `/api/trips/:groupJid/autocomplete-places`** — JWT-gated, 404 on unknown trip, 400 on missing/whitespace `q` or missing `sessionToken`, 412 on missing API key, 502 on upstream non-412 PlacesAutocompleteError. Forwards optional `languageCode=iw|en` query param to `autocompletePlaces`. Read-only — archived trips CAN search.
- **GET `/api/trips/:groupJid/place/:placeId`** — JWT-gated, returns the same `{ placeId, lat, lng, canonicalAddress, metadata }` shape PATCH /pin would write — but WITHOUT writing. The picker calls this immediately on Pick (before Save) so the optimistic update at Save time can carry real coords. This satisfies CONTEXT.md D9: "Optimistic update needs to cover the badge count too, not just the map pin."
- **PATCH `/api/trips/:groupJid/decisions/:id/pin`** — body `{ placeId, sessionToken, languageCode? }` parsed via `PinDecisionBodySchema`. fetchPlaceDetails first, then pinDecision. Maps PinDecisionResult → HTTP status per D14:
  - `{ ok: true }` → 200 + `{ decision }` (canonical row from re-read)
  - `{ ok: false, reason: 'missing' }` → 404 "Decision not found"
  - `{ ok: false, reason: 'wrong-group' }` → 404 "Decision not found" (anti-leak: same message)
  - `{ ok: false, reason: 'archived' }` → 403 "Decision is archived" (D14 — distinct from trip-level 403)
- 25 new vitest cases across 3 describe blocks (§12, §13, §14) — full coverage of auth, 400/403/404/412/502 mapping, languageCode forwarding, all three PinDecisionResult variants. No regressions to the 34 pre-existing cases.

## Task Commits

Each task was committed atomically:

1. **Task 1: Register the three routes in src/api/routes/trips.ts** — `d174c60` (feat)
2. **Task 2: Vitest coverage for the three routes** — `d8c58ab` (test)

**Plan metadata:** _(see final commit below)_ — `docs(57-02): complete server-side pin HTTP routes plan`

## Files Created/Modified

- `src/api/routes/trips.ts` *(modified, +199 lines)* — three new route handlers appended to the `tripsRoutes` plugin (after `POST /backfill-geocode`); added imports for `pinDecision`, `autocompletePlaces`, `fetchPlaceDetails`, `PlacesAutocompleteError`; added inline `PinDecisionBodySchema` (Zod) next to `PatchBudgetSchema`. Existing routes (GET /api/trips, GET /:groupJid, DELETE, restore, resolve, budget, SSE stream, export, backfill-geocode) untouched byte-for-byte.
- `src/api/routes/__tests__/trips.test.ts` *(modified, +530 lines)* — three new describe blocks (§12 autocomplete-places, §13 place preview, §14 PATCH /pin); three new module-level mocks (`mockAutocompletePlaces`, `mockFetchPlaceDetails`, `mockPinDecision`); two new `vi.mock` factories for `placesAutocomplete.js` (with a real `PlacesAutocompleteError` class) and `placesGeocode.js` (no-op for the backfill route); extended the existing tripMemory mock with `pinDecision`, `updateDecisionGeocode`, `getDecisionsForBackfill`. Existing 34 test cases unchanged.

## Decisions Made

- **PATCH /pin returns only the freshly-pinned decision row, not the full bundle** — useTrip's optimistic mutation already holds a snapshot of the bundle; it just needs the canonical row to drop into local state. The full bundle would force a redundant re-render of every other component subscribed to useTrip. The SSE 3s tick fans the same row out to *other* sessions automatically because hashTripBundle already projects `d.lat` and `d.lng`.
- **Read-only proxy routes (autocomplete + preview) do NOT 403 on archived trips** — these are pure search/preview, no DB write. A user reading an archived trip is allowed to type into the picker; only the Save (PATCH /pin) gets blocked. This matches CONTEXT.md `<specifics>` ("only the pin write itself is archive-locked").
- **404 + same message for missing AND wrong-group decisions** — anti-leak rule. Two callers, one with a valid groupJid and a fake decision id, one with a valid decision id and the wrong groupJid, must get identical responses. A distinct "wrong-group" status would let an attacker enumerate decision ids across groups.
- **Distinct messages for trip-level vs row-level 403** — `'Trip is archived'` (whole-trip readOnly) vs `'Decision is archived'` (Phase 51 daily auto-archive cron archived a single row inside an active trip). The dashboard surfaces these differently in the picker UX.
- **Bundle re-read via `getTripBundle(groupJid).decisions.find(d => d.id === id)`** rather than direct DB SELECT — gives the route the *same projection* useTrip will see on its next SSE tick. If the projection ever changes (e.g., we add a `pinUpdatedAt` field to TripBundle), this route automatically picks it up.
- **Mocked placesGeocode.js as a no-op in the test file** — the backfill route imports it eagerly. We don't assert against it in plan 57-02, but without the mock, the real module would attempt to read the API key on import and could noisy-warn during tests. No-op mock is cleanest.

## Deviations from Plan

None - plan executed exactly as written. The plan's spec was precise enough (status code map, mock factory, exact test case list) that both tasks landed in one pass with no auto-fix rules triggered. No architectural changes needed, no auth gates encountered.

The only minor planning-spec gap surfaced during execution: the test file's existing `vi.mock('../../../db/queries/tripMemory.js', ...)` factory had to be extended with TWO additional no-op exports (`updateDecisionGeocode`, `getDecisionsForBackfill`) — these are imported by the backfill route in trips.ts but the original 34 tests never exercised the backfill route, so the original factory didn't include them. Adding them is purely cosmetic — the backfill route is still not tested in this plan (out of scope; that's plan 56-03's responsibility).

## Issues Encountered

None - all 59 tests passed on first run after writing both files. Pre-existing tsc rootDir warnings on `cli/bot.ts` and `cli/commands/persona.ts` are NOT new (they existed before plan 57-02 began — verified in plan 57-01's tsc run too).

## User Setup Required

None - the routes use the same `GOOGLE_PLACES_API_KEY` env var Phase 56 introduced; no new secrets, no new GCP API enables, no new dependencies. The 412 status code from the Places client gives users a clear hint when the key is missing without crashing the route.

## Notes for Plan 03 (dashboard schemas + client)

These are the contract details Plan 03 should mirror in the dashboard's `dashboard/src/api/*.ts`:

### `GET /api/trips/:groupJid/autocomplete-places`
- **Query:** `q` (required, trimmed-non-empty), `sessionToken` (required, non-empty), `languageCode?` (`'iw' | 'en'`)
- **200:** `{ suggestions: AutocompleteSuggestion[] }` — array max length 5, each entry has `{ placeId, primaryText, secondaryText? }` (Plan 01's AutocompleteSuggestionSchema is the canonical shape)
- **400 / 404 / 412 / 502:** `{ error: string }` — caller should show "Search failed — retry" inline for 502, "API key missing — see admin" for 412

### `GET /api/trips/:groupJid/place/:placeId`
- **Path:** `placeId` is URL-encoded (path-segment encoding is sufficient — Plan 01's fetchPlaceDetails handles encoding)
- **Query:** `sessionToken` (required), `languageCode?`
- **200:** `{ placeId, lat: number|null, lng: number|null, canonicalAddress: string|null, metadata }` — `metadata` is `{ rating, userRatingCount, openNow, types, primaryType, displayName }` per Plan 01's PlaceDetailsResultSchema
- Plan 03's `fetchPlacePreview` should parse this through the same `PlaceDetailsResultSchema` (Plan 01 exports it for cross-module reuse)

### `PATCH /api/trips/:groupJid/decisions/:id/pin`
- **Body:** `{ placeId: string, sessionToken: string, languageCode?: 'iw'|'en' }` — all three fields validated by `PinDecisionBodySchema`
- **200:** `{ decision: TripDecision }` — drop directly into useTrip's bundle.decisions; the SSE 3s tick will broadcast it to other sessions automatically (hashTripBundle already includes lat/lng)
- **403 + `'Trip is archived'`** vs **403 + `'Decision is archived'`** — Plan 04's UI should surface these distinctly (the row-level case is rare — only happens if Phase 51's daily cron archives a single row while the picker is open)
- **404 + `'Decision not found'`** — same message for missing OR cross-group; the dashboard should treat both as a stale-snapshot error (refresh useTrip)

## Notes for Plan 04 (dashboard UI)

- The optimistic-update payload at Save time is `(decision-snapshot, fetchPlacePreview-result)` → merged into `useTrip` before PATCH /pin fires. Because GET /place/:placeId already returned the lat/lng, `offMapCount` decrements in the same React tick — D9 lock satisfied.
- On PATCH /pin success, replace the optimistic row with `body.decision` (canonical). On non-200, revert via the snapshot. The SSE 3s tick will reconcile other sessions automatically.

## Notes for Plan 05 (UAT)

- Manual smoke test: open picker → type → pick → save → see Hebrew autocomplete (set Accept-Language to `he` or just type Hebrew). Backend automatically detects Hebrew when `languageCode` query is omitted (Plan 01's `detectLanguageCode` is called from the module layer).
- 412 manual repro: `unset GOOGLE_PLACES_API_KEY && pm2 restart whatsapp-bot && type-into-picker` → expect "API key missing" toast.

---
*Phase: 57-drop-a-pin-dashboard-editing*
*Plan: 02*
*Completed: 2026-04-25*

## Self-Check: PASSED

- `src/api/routes/trips.ts` — FOUND (3 routes registered, imports added, PinDecisionBodySchema present, archived-decision → 403 mapping at line ~657)
- `src/api/routes/__tests__/trips.test.ts` — FOUND (describe blocks §12, §13, §14 present; 59/59 tests green)
- `.planning/phases/57-drop-a-pin-dashboard-editing/57-02-SUMMARY.md` — FOUND
- Commit `d174c60` (Task 1: routes) — FOUND
- Commit `d8c58ab` (Task 2: tests) — FOUND
- `npx vitest run src/api/routes/__tests__/trips.test.ts` — 59 passed
- `npx tsc --noEmit` — no new errors (only pre-existing `cli/*.ts` rootDir warnings, present before plan 57-02 began)

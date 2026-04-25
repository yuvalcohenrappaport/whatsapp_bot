---
phase: 55-trip-dashboard-view
plan: 04
subsystem: ui
tags: [react, leaflet, openstreetmap, vitest, sse, optimistic-updates, soft-delete]

requires:
  - phase: 55-03
    provides: useTrip hook, TripBundle schema, SSE stream, three mutations (deleteDecision, resolveQuestion, updateBudget)
  - phase: 55-02
    provides: trip API routes, soft-delete pattern, JWT-gated endpoints

provides:
  - Six-section trip dashboard view (Header → Timeline → Map → DecisionsBoard → OpenQuestions → BudgetBar)
  - Restore soft-deleted decisions (POST /api/trips/:groupJid/decisions/:id/restore + UI Restore button)
  - Google Maps links on every decision row and in Leaflet popup bodies
  - 28 vitest cases covering all trip routes (6 new restore cases)

affects: [55-05-google-doc-export, any future trip dashboard work]

tech-stack:
  added: []
  patterns:
    - Optimistic mutation with snapshot revert pattern (4th mutation: restoreDecision mirrors deleteDecision)
    - Anti-leak 404 pattern on route existence checks (id + groupJid WHERE clause)
    - Idempotent restore: DB helper guards with status='deleted' in WHERE, returns changes count
    - Google Maps URL selection: coords → `?q=lat,lng`, no coords → text search via `query=` param

key-files:
  created: []
  modified:
    - src/db/queries/tripMemory.ts
    - src/api/routes/trips.ts
    - src/api/routes/__tests__/trips.test.ts
    - dashboard/src/hooks/useTrip.ts
    - dashboard/src/components/trip/DecisionsBoard.tsx
    - dashboard/src/components/trip/TripMap.tsx
    - dashboard/src/pages/TripView.tsx

key-decisions:
  - "restoreDecision DB helper uses AND status='deleted' in WHERE so it is idempotent without extra reads"
  - "Restore button only shown when showDeleted toggle is on AND row is deleted AND not readOnly — avoids clutter in normal view"
  - "Google Maps text-search fallback uses encodeURIComponent(d.value) so decision titles with special chars work"
  - "TripMap popups: coords always available (map only shows decisions with lat/lng), so always use direct ?q= form there"
  - "DecisionsBoard rows: dual logic (coords → direct link, no coords → text search) since board shows all decisions"

patterns-established:
  - "4th optimistic mutation pattern: same snapshot/revert/toast shape as deleteDecision — future mutations should mirror this"
  - "Restore route mirrors DELETE route exactly: same auth gate order, same anti-leak 404, same idempotent 204"

requirements-completed: [DASH-TRIP-01, DASH-TRIP-02]

duration: 35min
completed: 2026-04-25
---

# Phase 55 Plan 04: Trip Dashboard View Summary

**Full CONTEXT-ordered trip detail UI plus two scope additions from UAT: soft-delete restore (backend route + optimistic mutation + Restore button) and Google Maps links on every decision row and popup**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-25T13:04:00Z
- **Completed:** 2026-04-25T13:07:00Z (scope adds) + SUMMARY at 16:06Z
- **Tasks:** Task 1 + Task 2 (dashboard UI) shipped in prior session; Task 3 (UAT) approved; scope adds executed now
- **Files modified:** 7

## Accomplishments

- Restore soft-deleted decisions end-to-end: `restoreDecision(id, groupJid)` DB helper (idempotent, guards with `status='deleted'` in WHERE), `POST /api/trips/:groupJid/decisions/:id/restore` route (JWT-gated, 403 archived, 404 anti-leak, 204 idempotent), `restoreDecision` optimistic mutation in `useTrip`, Restore button (Undo2 icon) in `DecisionsBoard` visible only when "Show deleted" is on
- Google Maps links on every decision: MapPin icon inline with title in DecisionsBoard rows (coords → direct `?q=lat,lng`, no coords → text search), "Open in Google Maps" link in Leaflet popup bodies (always direct `?q=` since popups only render for decisions with coords)
- 28 vitest cases passing (6 new: auth, happy path 204, idempotent, 403 archived, 404 unknown, 404 wrong group anti-leak)

## Task Commits

1. **Backend restore (helper + route + 6 tests)** - `8ad7d8e` (feat(55-04))
2. **Frontend restore + Google Maps links** - `c5d538d` (feat(55-04))

## Files Created/Modified

- `src/db/queries/tripMemory.ts` — added `restoreDecision(decisionId, groupJid)` export
- `src/api/routes/trips.ts` — added `POST /api/trips/:groupJid/decisions/:id/restore` route + import
- `src/api/routes/__tests__/trips.test.ts` — added `mockRestoreDecision` mock + test group 10 (6 cases)
- `dashboard/src/hooks/useTrip.ts` — added `restoreDecision` mutation to `UseTripResult` interface + implementation + return
- `dashboard/src/components/trip/DecisionsBoard.tsx` — `onRestoreDecision` prop, Restore button on deleted rows, MapPin Google Maps link inline with each decision title
- `dashboard/src/components/trip/TripMap.tsx` — "Open in Google Maps" `<a>` link inside each Leaflet popup
- `dashboard/src/pages/TripView.tsx` — passes `onRestoreDecision={mutations.restoreDecision}` to DecisionsBoard

## Decisions Made

- Restore button only visible when `showDeleted` is true AND `isDeleted` AND `!readOnly` — avoids showing restore affordance in the normal view where deleted rows are hidden
- DB helper guards with `status='deleted'` in WHERE clause so calling restore on an already-active row is a true DB no-op (changes: 0) without needing a pre-read
- TripMap popups use only the `?q=lat,lng` form because popups only render for decisions that passed the `lat != null && lng != null` filter
- DecisionsBoard rows support both URL forms: coords → `?q=lat,lng`, no coords → `search/?api=1&query=` text search

## Deviations from Plan

None — these were explicit scope additions requested by the user during UAT. Both adds were within the scope of Plan 04 files.

## Issues Encountered

None. Build clean first pass.

## Next Phase Readiness

- Trip dashboard view is production-ready including restore and Maps links
- Google Doc export (Plan 05) is unblocked — it reads `bundle.decisions.filter(d => d.status === 'active')` which already excludes deleted rows correctly

---
*Phase: 55-trip-dashboard-view*
*Completed: 2026-04-25*

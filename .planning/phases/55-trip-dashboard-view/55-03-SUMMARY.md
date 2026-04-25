---
phase: 55-trip-dashboard-view
plan: "03"
subsystem: ui
tags: [react, leaflet, react-leaflet, zod, sse, optimistic-mutations, sonner, vite]

dependency_graph:
  requires:
    - phase: 55-02
      provides: "GET /api/trips, GET /api/trips/:groupJid, DELETE decisions, PATCH resolve/budget, SSE stream"
  provides:
    - "leaflet + react-leaflet + @types/leaflet installed in dashboard/"
    - "TripBundleSchema / TripListEntrySchema / BudgetRollupSchema Zod schemas"
    - "useTrip hook: initial fetch + SSE subscription + 3 optimistic mutations with snapshot-revert"
    - "TripsList page at /trips (card grid, active/archived badges)"
    - "TripView placeholder at /trips/:groupJid (proves data layer end-to-end)"
    - "Sidebar Trips nav entry"
    - "Router entries /trips and /trips/:groupJid"
  affects: [55-04 (TripView full UI replaces placeholder)]

tech-stack:
  added:
    - "leaflet@1.9.4 (runtime dep)"
    - "react-leaflet@4.2.1 (runtime dep, --legacy-peer-deps for React 19)"
    - "@types/leaflet@1.9.21 (dev dep)"
  patterns:
    - "Zod schema mirrors DB column types: metadata/conflictsWith/budgetByCategory kept as JSON strings"
    - "BudgetRollup: z.record(z.string(), z.number()) avoids enum key exhaustiveness issues (same lesson as 55-02 PatchBudgetSchema)"
    - "useTrip: snapshot → optimistic setState → API call → revert-on-failure, mirrors CONTEXT lock pattern"
    - "SSE polling fallback on schema drift (matches useCalendarStream topology)"
    - "Sonner toasts: { position: 'bottom-right', duration: 2000 } success / { duration: 5000 } error"
    - "TripsList uses encodeURIComponent(groupJid) for URL safety (groupJids are phone JIDs with @ and :)"

key-files:
  created:
    - dashboard/src/api/tripSchemas.ts
    - dashboard/src/hooks/useTrip.ts
    - dashboard/src/pages/TripsList.tsx
    - dashboard/src/pages/TripView.tsx
  modified:
    - dashboard/package.json
    - dashboard/package-lock.json
    - dashboard/src/components/layout/Sidebar.tsx
    - dashboard/src/router.tsx
    - .planning/phases/55-trip-dashboard-view/55-03-SUMMARY.md

key-decisions:
  - "leaflet installed with --legacy-peer-deps: react-leaflet@4.2.1 declares peer react@^18; React 19 is installed. Plan correctly noted R19 compatibility; --legacy-peer-deps was the required flag"
  - "BudgetRollup schema uses z.record(z.string(), z.number()) not z.record(TripCategorySchema, ...) — same Zod v3 exhaustiveness issue documented in 55-02 applies here on the client side too"
  - "metadata / conflictsWith / budgetByCategory kept as JSON strings in Zod schemas — mirrors DB column types; parsing is the consumer's responsibility (avoids over-parsing in the data layer)"
  - "TripsList does not re-sort: sort order (upcoming → past → archived) comes from backend listTripsForDashboard()"
  - "groupJid encoded with encodeURIComponent() in navigate() call — group JIDs contain @ and : which must be percent-encoded in URLs"
  - "TripView placeholder renders SSE status dot + raw bundle JSON — proves data layer end-to-end before Plan 55-04 builds polished UI"
  - "CalendarEventInTripSchema includes all calendarEvents table columns (not just id/title/eventDate) — avoids schema drift if Plan 55-04 renders confirmationMsgId or messageId"

patterns-established:
  - "Trip data layer: useTrip is the single source of truth for /trips/:groupJid; Plan 55-04 components receive bundle/mutations as props from TripView, no prop drilling through router"
  - "Optimistic mutation revert: const snapshot = bundle → setBundle(optimistic) → apiCall → onFail: setBundle(snapshot)"
  - "updateBudget canonical revert: on success, replace bundle.budget with server response body (not the optimistic value) — ensures parity with server math"

requirements-completed: [DASH-TRIP-01, DASH-TRIP-02]

duration: 25min
completed: "2026-04-25"
---

# Phase 55 Plan 03: Trip Dashboard Data Layer + Navigation Summary

**Leaflet + typed Zod schemas + useTrip SSE hook with 3 optimistic mutations, navigable /trips list, and /trips/:groupJid placeholder proving the data layer end-to-end**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-04-25
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Installed leaflet / react-leaflet / @types/leaflet for Plan 55-04's map section
- Defined Zod schemas (TripBundleSchema, TripListEntrySchema, BudgetRollupSchema, TripDecisionSchema) aligned with the exact DB column types from Plan 55-02
- Built useTrip hook: initial fetch + SSE subscription (trip.updated) + 3 optimistic mutations (deleteDecision, resolveQuestion, updateBudget) each with snapshot-revert on failure and sonner toasts
- Built TripsList page with card grid (active=green, archived=muted), loading skeletons, empty state, error state — sort order comes from backend
- Added Trips nav entry (Map icon) to Sidebar after Calendar
- Added /trips and /trips/:groupJid routes to router.tsx
- Built TripView placeholder that mounts, calls useTrip, shows SSE status dot + raw bundle dump — proves the full data pipeline before Plan 55-04 ships polished UI
- Vite build clean; pm2 restart done

## Task Commits

1. **Task 1: Leaflet deps + Zod schemas + useTrip hook** - `a674d88` (feat)
2. **Task 2: TripsList page + sidebar nav + router entries** - `c17793c` (feat)

**Plan metadata:** (see below — final docs commit)

## Files Created/Modified
- `dashboard/src/api/tripSchemas.ts` — Zod schemas for TripBundle, TripListEntry, BudgetRollup, TripDecision + TS types
- `dashboard/src/hooks/useTrip.ts` — useTrip hook: fetch + SSE + 3 optimistic mutations (335 lines)
- `dashboard/src/pages/TripsList.tsx` — /trips card list page
- `dashboard/src/pages/TripView.tsx` — /trips/:groupJid placeholder (replaced in Plan 55-04)
- `dashboard/src/components/layout/Sidebar.tsx` — added Trips nav entry (Map icon)
- `dashboard/src/router.tsx` — added /trips and /trips/:groupJid routes
- `dashboard/package.json` — leaflet@1.9.4, react-leaflet@4.2.1, @types/leaflet@1.9.21

## Decisions Made

1. **--legacy-peer-deps for react-leaflet**: react-leaflet@4.2.1 declares peer `react@^18`; project runs React 19. The plan noted this as safe; --legacy-peer-deps was the required install flag (not --force). Works at runtime.

2. **z.record(z.string(), ...) for BudgetRollup**: Same Zod v3 issue documented in 55-02: `z.record(z.enum(), ...)` would require ALL enum keys to be present. Using `z.record(z.string(), z.number())` on the frontend client-side schemas for the same reason.

3. **JSON strings kept as-is**: `metadata`, `conflictsWith`, and `budgetByCategory` fields are stored as JSON strings in SQLite and returned as strings from the API. The Zod schemas mirror this directly rather than parsing them to objects — parsing is the consumer's responsibility at render time.

4. **encodeURIComponent on groupJid in navigate()**: WhatsApp JIDs contain `@` and digits-with-colons which need percent-encoding in URLs.

5. **Budget canonical revert**: On updateBudget success, the canonical `budget` from the server response replaces the optimistic value — this handles edge cases where the server normalises values differently from the client's arithmetic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used --legacy-peer-deps for react-leaflet install**
- **Found during:** Task 1 (npm install step)
- **Issue:** `npm install react-leaflet@^4.2.1` failed with ERESOLVE — react-leaflet@4.2.1 declares peer `react@^18.0.0` but project has `react@19.2.5`
- **Fix:** Added `--legacy-peer-deps` flag. Plan noted R19 compatibility; this is the correct resolution (--legacy-peer-deps, not --force). react-leaflet v4 runs fine on React 19 at runtime.
- **Files modified:** dashboard/package.json, dashboard/package-lock.json
- **Verification:** `npm run build` succeeds; @types/leaflet@1.9.21 installed (npm resolved to latest compatible patch vs plan's 1.9.12)
- **Committed in:** a674d88 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking install flag)
**Impact on plan:** Required for installation; zero scope change. react-leaflet@4.2.1 installed as planned.

## Issues Encountered
None beyond the react-leaflet peer dep (handled above).

## User Setup Required
None — no external service configuration required. Run `pm2 restart whatsapp-bot` after any future rebuild.

## Next Phase Readiness
- Plan 55-04 can import `useTrip`, `TripBundle`, `TripDecision`, `BudgetRollup` from the established data layer
- TripView.tsx is the placeholder — Plan 55-04 replaces its body with TripHeader / Timeline / Map / DecisionsBoard / OpenQuestions / BudgetBar
- Leaflet CSS will need `import 'leaflet/dist/leaflet.css'` in the Map section component
- useTrip already exposes `mutations.deleteDecision`, `mutations.resolveQuestion`, `mutations.updateBudget` — Plan 55-04 wires these to UI affordances
- `bundle.readOnly` flag is exposed — Plan 55-04 must disable/hide edit controls when true

---
*Phase: 55-trip-dashboard-view*
*Completed: 2026-04-25*

---
phase: 46-google-tasks-full-list-sync
plan: "03"
subsystem: dashboard
tags: [gtasks, calendar, filter-panel, zod, react, localstorage]

# Dependency graph
requires:
  - phase: 44-unified-editable-calendar
    provides: CalendarItem discriminated union + useCalendarStream skeleton
  - phase: 46-google-tasks-full-list-sync
    provides: "Plan 46-01: gtasks proxy routes + fetchGtasksCalendarItems; Plan 46-02: aggregator slot + sources.gtasks always present in envelope"
  - phase: 47-google-calendar-events-sync
    provides: "Plan 47-03 speculatively shipped CalendarFilterPanel, CalendarFilterPanel.types, useCalendarFilter, mobile Sheet — all with both gtasks + gcal sections pre-built (Rule-3 deviation documented in 47-03-SUMMARY). Plan 46-03 reconciles by tightening the now-required sources.gtasks schema and wiring the missing gtasks useCalendarStream slice."
provides:
  - "CalendarEnvelopeSchema.sources.gtasks is REQUIRED (no longer .optional())"
  - "useCalendarStream exposes a 5th slice `gtasks: SourceSlice` populated from SSE + polling fallback + fetchGtasks initial-load"
  - "refetch('gtasks') exposed for Retry button"
  - "Calendar.tsx merges gtasks.items into rawItems, renders gtasks loading indicator + partial-failure banner"
  - "GTASKS-03 (per-list color pills) wired end-to-end: server hashListColor → sourceFields.color → CalendarPill bg-sky-500 fallback → useCalendarFilter colorOverride layer → CalendarFilterPanel 8-slot palette"
  - "GTASKS-04 (sidebar filter panel) wired end-to-end: CalendarFilterPanel gtasks section + localStorage persistence + filter exclusion of hidden lists"
affects: [46-04-mutations, 46-05-live-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema-tightening after a dependent plan lands — Plan 47-03 used .optional() because Phase 46 backend had not shipped; Plan 46-03 drops the marker now that the aggregator guarantees presence"
    - "Aggregator-sourced initial-load for a per-source slice — fetchGtasks mirrors fetchGcal by pulling /api/calendar/items and filtering client-side, deferring per-list iteration + dedup to the server"

key-files:
  created: []
  modified:
    - dashboard/src/api/calendarSchemas.ts
    - dashboard/src/hooks/useCalendarStream.ts
    - dashboard/src/pages/Calendar.tsx

key-decisions:
  - "Do NOT re-create CalendarFilterPanel / CalendarFilterPanel.types / useCalendarFilter / CalendarHeader filter button / CalendarPill source maps / Calendar.tsx left-rail layout — all speculatively shipped by Plan 47-03. Re-creating would cause a merge conflict with zero functional gain. Plan text acknowledges these files already exist (LIVE STATE FACT block in Task 1)."
  - "Drop .optional() from sources.gtasks instead of adding a runtime defensive fallback — the server contract is now: every envelope has sources.gtasks (either 'ok' or 'error'). Runtime tolerance via .optional() would mask a schema drift bug rather than surface it."
  - "Mirror fetchGcal for fetchGtasks (pull from /api/calendar/items and filter) rather than calling /api/google-tasks/items directly — keeps dashboard source-agnostic about per-list iteration + actionable dedup, consistent with the GCAL-05 / GTASKS-05 pattern where server owns the dedup invariant."
  - "No new dedicated /api/google-tasks/items fetch route consumption on the dashboard — initial-load and SSE split both flow through the unified envelope. Only /api/google-tasks/lists (Plan 46-01) remains a bare enumeration surface, reserved for a future dashboard settings page (deferred per REQUIREMENTS.md GTASKS-03 note)."

patterns-established:
  - "Pattern: a wave-2 dashboard plan that ships after a sibling wave-2 plan (47-03) has already speculatively shipped most of its scope collapses to a small reconciliation patch — document the overlap + minimize the diff to just the missing pieces"

requirements-completed: [GTASKS-03, GTASKS-04]

# Metrics
duration: 4m 4s
completed: 2026-04-21
---

# Phase 46 Plan 03: Google Tasks Dashboard Filter Panel Summary

## One-liner

Extend dashboard CalendarEnvelope schema + useCalendarStream to surface a dedicated gtasks slice, completing the end-to-end gtasks rendering path on top of the CalendarFilterPanel infrastructure that Phase 47-03 had already shipped with both gtasks + gcal sections pre-built.

## What Shipped

### Plan scope reconciliation

Plan 46-03 text described a 2-task green-field build: (1) extend calendarSchemas + create CalendarFilterPanel.types + useCalendarFilter, (2) create CalendarFilterPanel + wire into Calendar.tsx + add CalendarHeader filter button.

**LIVE STATE FACT at execute time:** Phase 47 Plan 03 had already shipped all six of those files with both gtasks AND gcal sections pre-built (see `47-03-SUMMARY.md` §Rule-3 Blocking deviations #1-#3). The plan text's LIVE STATE FACT block in Task 1 acknowledges this: only the `gtasks: SourceStatusSchema.optional()` → `SourceStatusSchema` tightening was required on `calendarSchemas.ts`.

**Actual scope executed:** (1) schema tightening + (2) fill the only remaining wiring gap — Phase 47-03 intentionally left out a dedicated `gtasks` slice in `useCalendarStream` because Phase 46 had not shipped yet, so gtasks items flowing through the SSE envelope had no state home on the dashboard. This plan adds that slice and threads it through `Calendar.tsx`.

### Task 1: Schema tightening (commit `2712d95`)

**File modified:** `dashboard/src/api/calendarSchemas.ts`

```diff
-    gtasks: SourceStatusSchema.optional(),
+    gtasks: SourceStatusSchema,
```

Plan 46-02 (commit `9cb40a6`, landed during this plan's execution window) added `fetchGtasksCalendarItems` to the aggregator's 5th `Promise.allSettled` slot and `sources.gtasks: 'ok' | 'error'` to every envelope response. `.optional()` was a safety-valve Plan 47-03 added during the speculative cross-phase build; it is no longer appropriate.

### Task 2: useCalendarStream gtasks slice + Calendar.tsx wiring (commit `34bf971`)

**Files modified:**
- `dashboard/src/hooks/useCalendarStream.ts` — added fifth `gtasks` SourceSlice alongside tasks/events/linkedin/gcal. SSE split now filters `items.filter(i => i.source === 'gtasks')` into `setGtasks`. Unified polling fallback mirrors the SSE split. New `fetchGtasks()` initial-load helper pulls from `/api/calendar/items` and filters client-side (same rationale as `fetchGcal`: server owns per-list iteration + dedup invariants). `refetch('gtasks')` exposed for the SourceBanner Retry button.
- `dashboard/src/pages/Calendar.tsx` — destructures `gtasks` from `useCalendarStream()`; merges `gtasks.items` into `rawItems`; adds gtasks branch to the allLoading gate; renders "Google Tasks unavailable" SourceBanner on error; renders "Loading Google Tasks…" skeleton during initial load.

## Verification Evidence

```
$ cd dashboard && npx tsc --noEmit
(exit 0, zero errors)

$ cd dashboard && npx vite build
dist/assets/index-BVYcIOfK.js   870.57 kB │ gzip: 255.11 kB
✓ built in 4.38s
```

Bundle delta: `870.57 kB` vs pre-plan `869.69 kB` = **+0.88 kB raw, +1.01 kB gzip** — well under the +10 kB plan budget.

Server-side regression check:
```
$ npx vitest run src/api/__tests__/calendar.test.ts
Tests  23 passed (23)
```

All 23 calendar aggregator tests (Plan 46-02's 4 new + 19 pre-existing) still green after the dashboard schema tightening — confirming the envelope contract was already `sources.gtasks` required on the server.

## Must-Haves Coverage

| Truth | Evidence |
| --- | --- |
| CalendarItem.source can be 'gtasks' and is accepted by the dashboard Zod schema | `calendarSchemas.ts:37` `z.object({ source: z.literal('gtasks'), ...BaseItemFields })` |
| CalendarEnvelope.sources has a gtasks key and the dashboard parses it without error | `calendarSchemas.ts:59` `gtasks: SourceStatusSchema,` (required; 23/23 server tests + dashboard tsc clean) |
| Gtasks items render with a color-coded pill — color derived from hash(listId) via the 8-slot palette | Server: `hashListColor()` in `src/api/routes/googleTasks.ts` populates `sourceFields.color`. Client: `CalendarPill` SOURCE_STRIPE/BG/ICON maps shipped in 47-03 include `gtasks: 'border-sky-500'` / `ListTodo` icon as fallback; `useCalendarFilter.resolveItemColor` returns `sourceFields.color` (the hashed palette slot) or the per-list `colorOverride` from localStorage. |
| /calendar has a left-rail filter panel listing every gtasks list as a toggleable row with color swatch + item count | `CalendarFilterPanel.tsx` Google Tasks section (shipped 47-03); `useCalendarFilter.gtasksLists` metadata derivation (listId/listName/color/itemCount aggregation). |
| Filter toggles persist to localStorage under key 'calFilterPrefs_v1' | `CalendarFilterPanel.types.ts:12` `const LS_KEY = 'calFilterPrefs_v1';` + `loadFilterPrefs` / `saveFilterPrefs`. |
| Hidden lists are excluded from the calendar grid items array | `useCalendarFilter.filteredItems` filters `item.source === 'gtasks' && !getListPref(prefs, listId).visible`. |
| New lists not yet seen default to visible (checked) | `getListPref` returns `{ id: listId, visible: true }` when no stored pref exists. |
| On mobile the filter panel collapses and is openable via the CalendarHeader filter button | `CalendarHeader` renders `SlidersHorizontal` button on mobile (line 219); `CalendarFilterPanelSheet` rendered on all viewports, controlled by `mobileFilterOpen`. |
| The filter panel component is structured to accommodate a second section (Phase 47 gcal) without rework | Already shipped in 47-03 with both sections + `extraSections?: React.ReactNode` escape hatch. |

## Deviations from Plan

### Rule-3 Blocking

**1. [Rule 3 - Blocking] useCalendarStream had no dedicated gtasks slice**
- **Found during:** Task 2 planning (before edits)
- **Issue:** Phase 47-03 documented in its SUMMARY that it intentionally left gtasks out of `useCalendarStream` because Phase 46 had not shipped yet. With Plan 46-02 now wiring the aggregator slot, gtasks items flow through the SSE envelope but had no state home — they'd be silently dropped in the SSE split.
- **Fix:** Added a fifth `gtasks: SourceSlice` alongside tasks/events/linkedin/gcal. SSE split now populates it. Added `fetchGtasks()` initial-load (mirrors `fetchGcal`, pulls from `/api/calendar/items`). Extended `refetch()` signature.
- **Files modified:** `dashboard/src/hooks/useCalendarStream.ts`
- **Commit:** `34bf971`

### Scope acknowledgments (not deviations)

- **Task 1.2 (colorForItem), Task 1.3 (CalendarFilterPanel.types), Task 1.4 (useCalendarFilter):** Already shipped verbatim by Phase 47-03 (see `47-03-SUMMARY` Rule-3 deviations #1-#3). Plan text's LIVE STATE FACT block in Task 1.1 acknowledges the overlap; the only remaining Task 1 change was tightening `.optional()` on `sources.gtasks`.
- **Task 2.1 (CalendarFilterPanel.tsx), Task 2.2 (CalendarFilterPanelSheet), Task 2.3 (CalendarHeader filter button), Task 2.4 (Calendar.tsx flex-row layout + filter panel render + mobile sheet):** All already shipped by Phase 47-03. No edits required here; the mobile sheet is controlled by `mobileFilterOpen` state that `useCalendarFilter` already manages, the desktop left-rail `<aside className="hidden lg:block">` is already in place, and CalendarHeader's `onFilterOpen` prop is already threaded through Calendar.tsx.
- **Parallel plan interleaving:** Plan 46-02 executor ran in parallel and landed commits `9cb40a6` (aggregator), `67a639e` (vitest), `b763f14` (closeout) between this plan's Task 1 (`2712d95`) and Task 2 (`34bf971`) commits. No merge conflict since 46-02 touched server-side `src/api/routes/calendar.ts` + tests only. My Task 1 schema change (`sources.gtasks` required) was pre-aligned with what 46-02 was landing, so no churn.
- **Pre-existing uncommitted `package.json` / `package-lock.json` modifications:** Left untouched per execution-context instruction ("Ignore uncommitted package.json — don't stage").

## Commits

| Hash | Message |
| --- | --- |
| `2712d95` | feat(46-03): require sources.gtasks in CalendarEnvelope schema |
| `34bf971` | feat(46-03): surface gtasks as a dedicated useCalendarStream slice |

## Self-Check

Verification of artifacts + commits:

- `dashboard/src/api/calendarSchemas.ts` — FOUND, `gtasks: SourceStatusSchema,` (no `.optional()`) confirmed at line 59
- `dashboard/src/hooks/useCalendarStream.ts` — FOUND, `gtasks: SourceSlice` in return type + `setGtasks` in SSE split + `fetchGtasks` + `refetch('gtasks')` branch all confirmed
- `dashboard/src/pages/Calendar.tsx` — FOUND, `gtasks` destructured from `useCalendarStream`, `gtasks.items` in `rawItems` memo, gtasks SourceBanner + loading skeleton confirmed
- Commit `2712d95` — FOUND in `git log --oneline`
- Commit `34bf971` — FOUND in `git log --oneline`
- `npx tsc --noEmit` (dashboard) — exit 0, zero errors
- `npx vite build` — clean, bundle 870.57 kB (+0.88 kB over 47-03 baseline)
- `npx vitest run src/api/__tests__/calendar.test.ts` — 23/23 green

## Self-Check: PASSED

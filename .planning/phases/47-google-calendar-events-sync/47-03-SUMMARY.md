---
phase: 47-google-calendar-events-sync
plan: "03"
subsystem: dashboard-calendar
tags:
  - google-calendar
  - dashboard
  - filter-panel
  - read-only
  - gtasks-dashboard-backfill
requires:
  - "47-01: server projection with sourceFields.readOnly + calendarId/calendarName/color/htmlLink"
  - "47-02: CalendarEnvelope.sources.gcal + unified aggregator with gcal items"
provides:
  - "CalendarFilterPanel: unified left-rail + mobile sheet with Google Tasks + Google Calendar sections"
  - "useCalendarFilter hook: per-source toggle + colorOverride + displayName override, localStorage-backed"
  - "useCalendarStream.gcal slice: fourth source surfaced from the unified envelope"
  - "CalendarPill readOnly gate: no drag + no inline edit + no hover Trash2 for gcal items"
  - "PillActionSheet gcal branch: Reschedule/Edit/Delete suppressed; 'Open in Google Calendar' link added"
affects:
  - "dashboard/src/pages/Calendar.tsx — now renders filter panel + filters rawItems through useCalendarFilter; gcal loading/error banners + refetch"
  - "dashboard/src/components/calendar/CalendarHeader.tsx — optional onFilterOpen prop + mobile-facing filter button"
tech-stack:
  added: []
  patterns:
    - "Single localStorage key (calFilterPrefs_v1) carrying multiple source sections with forward-compat loader"
    - "Source-level readOnly gate on CalendarPill — one predicate drives draggable/onDragStart/onDragEnd/cursor/inline-edit/hover-delete"
    - "Native <input type=\"checkbox\"> instead of a new shadcn primitive for a two-section panel (keep-it-simple)"
    - "Gcal initial load via /api/calendar/items unified aggregator (avoids duplicating window logic on the client)"
key-files:
  created:
    - dashboard/src/components/calendar/CalendarFilterPanel.types.ts
    - dashboard/src/components/calendar/CalendarFilterPanel.tsx
    - dashboard/src/hooks/useCalendarFilter.ts
  modified:
    - dashboard/src/api/calendarSchemas.ts
    - dashboard/src/components/calendar/colorForItem.ts
    - dashboard/src/hooks/useCalendarStream.ts
    - dashboard/src/components/calendar/CalendarHeader.tsx
    - dashboard/src/pages/Calendar.tsx
    - dashboard/src/components/calendar/CalendarPill.tsx
    - dashboard/src/components/calendar/PillActionSheet.tsx
decisions:
  - "Absorbed Phase 46 Plan 03 scaffolding into this plan (Rule-3 deviation, matching 47-02's deferred-gtasks pattern): CalendarFilterPanel.tsx, CalendarFilterPanel.types.ts, and useCalendarFilter.ts did not exist because Phase 46 was never executed. Built them with both gtasks + gcal sections from day one rather than stub-and-backfill."
  - "CalendarEnvelope.sources.gtasks is declared OPTIONAL in the Zod schema, sources.gcal is REQUIRED. This matches 47-02's actual backend shape (gcal present, gtasks absent until Phase 46 ships)."
  - "useCalendarStream exposes gcal as a fourth slice but NOT gtasks. Gtasks items still flow through if the server includes them in the envelope, but there is no dedicated slice/refetch until Phase 46."
  - "Used native <input type=\"checkbox\"> instead of installing a shadcn Checkbox primitive — dashboard/ui/ does not ship one and a two-section panel does not justify adding a new dependency."
  - "Read-only predicate is source==='gcal' OR sourceFields.readOnly===true so the server-side readOnly flag from 47-01 stays authoritative even if a future source opts in."
metrics:
  duration: "5m 54s"
  tasks: 3
  files-changed: 10
  bundle-delta: "+0.76 kB gzip (<10 kB budget)"
  completed: "2026-04-21"
requirements:
  - GCAL-04
  - GCAL-06
---

# Phase 47 Plan 03: Dashboard Filter Panel + Gcal Read-Only Pills Summary

**One-liner:** Built the dashboard filter scaffolding (left-rail panel + mobile sheet) with Google Tasks AND Google Calendar sections backed by a single `calFilterPrefs_v1` localStorage key, surfaced the gcal slice through `useCalendarStream`, and enforced read-only behavior on gcal pills (no drag, no inline edit, no delete, no reschedule via long-press — just a view-only "Open in Google Calendar" link).

## What Was Built

### Task 1 — Schemas + filter types + `useCalendarFilter` hook

- **`dashboard/src/api/calendarSchemas.ts`** — extended `CalendarItemSchema` discriminated union to accept both `'gtasks'` and `'gcal'`; extended `CalendarEnvelopeSchema.sources` with `gcal` (required) and `gtasks` (optional). Optional-gtasks matches the reality that 47-02 only added `gcal` to the backend envelope; if Phase 46 eventually ships, the schema already accepts its key.
- **`dashboard/src/components/calendar/colorForItem.ts`** — added `gtasks: 'bg-sky-500'` and `gcal: 'bg-rose-500'` to `SOURCE_DOT_COLOR` as fallbacks (real color comes from `sourceFields.color`).
- **`dashboard/src/components/calendar/CalendarFilterPanel.types.ts` (new)** — `FilterPrefs = { gtasksLists, gcalCalendars }` with `loadFilterPrefs` doing forward-compat field-by-field parse (missing sections → `[]`), `saveFilterPrefs` wrapped in try/catch for quota/private-mode safety, and symmetric helpers per source (`getListPref/setListVisible/setListColorOverride` + `getCalendarPref/setCalendarVisible/setCalendarColorOverride`).
- **`dashboard/src/hooks/useCalendarFilter.ts` (new)** — returns `{ prefs, gtasksLists, gcalCalendars, filteredItems, resolveItemColor, toggleList, overrideListColor, toggleCalendar, overrideCalendarColor, mobileFilterOpen, setMobileFilterOpen }`. `filteredItems` filters gtasks + gcal by visibility; `resolveItemColor` respects per-list/per-calendar `colorOverride` then falls back to `sourceFields.color` then the palette fallback.
- **`dashboard/src/hooks/useCalendarStream.ts`** — added a fourth slice `gcal: SourceSlice` with dedicated initial-load handler that pulls from the unified aggregator and filters by `source==='gcal'`; SSE `calendar.updated` handler + polling fallback both split a `gcal` slice out of the envelope; `refetch('gcal')` works like the other three.

Commit: `ee30fbe` — `feat(47-03): extend schemas + filter types + useCalendarFilter hook for gcal + gtasks`

### Task 2 — `CalendarFilterPanel` component + Calendar.tsx wiring

- **`dashboard/src/components/calendar/CalendarFilterPanel.tsx` (new)** — two named exports:
  - `CalendarFilterPanel` — the panel body with Google Tasks and Google Calendar sections. Each row uses a generic `FilterRow` subcomponent (native `<input type="checkbox">`, color swatch, label, item count, gear-popover with palette + displayName override).
  - `CalendarFilterPanelSheet` — wraps the panel in the existing `ui/sheet.tsx` primitive for mobile.
- **`dashboard/src/components/calendar/CalendarHeader.tsx`** — new optional `onFilterOpen?: () => void` prop; when provided, renders a `SlidersHorizontal` button on the mobile layout and a below-lg fallback button on desktop.
- **`dashboard/src/pages/Calendar.tsx`** — destructures `gcal` from `useCalendarStream`; merges gcal items into `rawItems`; runs `allItems` through `useCalendarFilter`; passes `filteredItems` to every view + empty-state + arrival-flash; renders desktop left-rail panel + mobile sheet; adds gcal loading + error banners with `refetch('gcal')`; wraps layout in `flex flex-col lg:flex-row` so the panel sits beside the grid on desktop.

Commit: `13238bd` — `feat(47-03): add CalendarFilterPanel + wire into Calendar page`

### Task 3 — Read-only pill enforcement (GCAL-06)

- **`dashboard/src/components/calendar/CalendarPill.tsx`** — added `isReadOnly = item.source === 'gcal' || sourceFields.readOnly === true`; gated `draggable` + `onDragStart` + `onDragEnd` + cursor class + inline-title click + hover-Trash2 icon on `!isReadOnly`. Also backfilled `SOURCE_STRIPE/BG/ICON/ICON_COLOR` maps with `gtasks` (ListTodo, sky) + `gcal` (CalendarClock, rose) entries so the pill renders a consistent visual for the two new sources.
- **`dashboard/src/components/calendar/PillActionSheet.tsx`** — added `isGcal` guard; Reschedule / Edit title / Delete buttons suppressed for gcal; when `htmlLink` is present on a gcal item, shows a single "Open in Google Calendar" anchor styled as a Button (opens in new tab); Cancel stays.

Commit: `6219310` — `feat(47-03): enforce read-only pill behavior for gcal items (GCAL-06)`

## Decisions Made

1. **Absorbed Phase 46 Plan 03 scaffolding into this plan.** `CalendarFilterPanel.tsx`, `CalendarFilterPanel.types.ts`, and `useCalendarFilter.ts` did not exist because Phase 46 was never executed (only planned). Plan 47-03 frontmatter expected them to exist. I built them with both gtasks + gcal sections from day one rather than stubbing them. When Phase 46 eventually runs, its Plan 03 becomes a no-op for these files and ships naturally. This mirrors the 47-02 approach where that plan adapted to Phase 46's absence on the backend.

2. **`sources.gtasks` is OPTIONAL in the Zod schema; `sources.gcal` is REQUIRED.** The backend (47-02 summary) confirmed it ships `sources: { tasks, events, linkedin, gcal }` — no gtasks key. Marking gtasks optional means the dashboard parses today's envelope without drift while remaining ready for Phase 46.

3. **`useCalendarStream` gained a `gcal` slice but NOT a gtasks slice.** Gtasks items still get filtered through by `useCalendarFilter` if the server ever includes them in the envelope, but the dashboard doesn't expose a dedicated `gtasks: SourceSlice` or `refetch('gtasks')` until Phase 46 ships a backend source for it. Keeps the surface minimal.

4. **Native `<input type="checkbox">` over a new shadcn Checkbox primitive.** `dashboard/src/components/ui/` does not include `checkbox.tsx`. Adding a radix/shadcn checkbox just for a two-section filter panel is over-engineering for the user's stated "keep it simple" preference. Native with `accent-foreground` blends cleanly with the existing palette.

5. **Read-only predicate checks source first, flag second.** `isReadOnly = item.source === 'gcal' || sourceFields.readOnly === true`. The OR means a server-emitted `readOnly: true` on a non-gcal source (future hook for, e.g., synced holidays) also works without re-touching the pill. The plan's guidance matched this pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Phase 46 Plan 03 dashboard scaffolding absent**

- **Found during:** Task 1 setup (attempting to read `CalendarFilterPanel.tsx`, `CalendarFilterPanel.types.ts`, `useCalendarFilter.ts`)
- **Issue:** The plan described extending these three files; they did not exist because Phase 46 was only planned, not executed.
- **Fix:** Created them from scratch with both the Phase 46 gtasks section and the Phase 47 gcal section in a single pass. When Phase 46 eventually runs, its Plan 03 diff is a no-op for these files. Documented in Decision 1.
- **Files created:** `CalendarFilterPanel.tsx`, `CalendarFilterPanel.types.ts`, `useCalendarFilter.ts`
- **Commit:** `ee30fbe` (types + hook) and `13238bd` (panel component + wiring)

**2. [Rule 3 - Blocking] `useCalendarStream` did not surface gcal items**

- **Found during:** Task 2 planning (how does `allItems` in Calendar.tsx receive gcal items?)
- **Issue:** `useCalendarStream` only exposed tasks/events/linkedin slices. Gcal items in the SSE envelope were filtered out and never reached `allItems`, which would make the filter panel's Google Calendar section always empty.
- **Fix:** Added a fourth `gcal: SourceSlice` with initial-load via the unified aggregator (`/api/calendar/items` → filter `source==='gcal'`), SSE split-out, polling fallback split-out, and `refetch('gcal')`. Matches the pattern of the existing three slices.
- **Files modified:** `useCalendarStream.ts`
- **Commit:** `ee30fbe`

**3. [Rule 3 - Blocking] `CalendarPill`'s SOURCE_* visual maps missing gtasks/gcal**

- **Found during:** Task 3 (updating `draggable`)
- **Issue:** `SOURCE_STRIPE`, `SOURCE_BG`, `SOURCE_ICON`, `SOURCE_ICON_COLOR` only had keys for `task/event/linkedin`. Rendering a gcal pill would return `undefined` for every visual class, producing a broken pill.
- **Fix:** Added `gtasks` (ListTodo, sky) and `gcal` (CalendarClock, rose) entries. Both serve as fallbacks — `sourceFields.color` (hashed server-side) takes precedence when present for stripe/bg color.
- **Files modified:** `CalendarPill.tsx`
- **Commit:** `6219310`

### Authentication Gates

None — this is a pure dashboard plan; no external auth surface touched.

## Verification

```bash
cd /home/yuval/whatsapp-bot/dashboard
npx tsc --noEmit
# → exit 0, zero errors

npx vite build
# → ✓ 2105 modules transformed; 869.69 kB bundle (+0.76 kB gzip over pre-plan)
#   Node-18 warning pre-existing in the toolchain; does not block build.

grep -n "'gcal'" dashboard/src/api/calendarSchemas.ts
# → line 38: z.object({ source: z.literal('gcal'), ...BaseItemFields }),

grep -n "gcalCalendars" dashboard/src/hooks/useCalendarFilter.ts
# → 3 hits (type, useMemo derivation, return shape)

grep -n "Google Calendar" dashboard/src/components/calendar/CalendarFilterPanel.tsx
# → multiple hits; section header at line 188

grep -n "readOnly\|source === 'gcal'" dashboard/src/components/calendar/CalendarPill.tsx
# → line 140: item.source === 'gcal' || sourceFields.readOnly === true
```

## Success Criteria (from PLAN)

- [x] `calendarSchemas.ts` accepts `source='gcal'` and `sources.gcal` in `CalendarEnvelope`
- [x] `CalendarFilterPanel` renders a "Google Calendar" section with per-calendar toggle + color swatch + count + gear override
- [x] Filter prefs persist to localStorage under `calFilterPrefs_v1` with a `gcalCalendars[]` array
- [x] Legacy prefs (Phase 46 blobs without `gcalCalendars`) load cleanly — `loadFilterPrefs` fills in missing sections with `[]`
- [x] `filteredItems` excludes items from hidden gcal calendars
- [x] Gcal pills are non-draggable (`draggable={false}` on desktop, no-op on mobile)
- [x] Gcal pill inline title click does not open the editor
- [x] `PillActionSheet` on gcal pills hides Reschedule/Edit/Delete/Complete; shows "Open in Google Calendar" when `htmlLink` present
- [x] tsc clean, vite build clean

## Commits

- `ee30fbe` — `feat(47-03): extend schemas + filter types + useCalendarFilter hook for gcal + gtasks`
- `13238bd` — `feat(47-03): add CalendarFilterPanel + wire into Calendar page`
- `6219310` — `feat(47-03): enforce read-only pill behavior for gcal items (GCAL-06)`

## Self-Check: PASSED

- FOUND: `.planning/phases/47-google-calendar-events-sync/47-03-SUMMARY.md`
- FOUND: `dashboard/src/api/calendarSchemas.ts`
- FOUND: `dashboard/src/components/calendar/colorForItem.ts`
- FOUND: `dashboard/src/components/calendar/CalendarFilterPanel.types.ts`
- FOUND: `dashboard/src/components/calendar/CalendarFilterPanel.tsx`
- FOUND: `dashboard/src/hooks/useCalendarFilter.ts`
- FOUND: `dashboard/src/hooks/useCalendarStream.ts`
- FOUND: `dashboard/src/components/calendar/CalendarHeader.tsx`
- FOUND: `dashboard/src/pages/Calendar.tsx`
- FOUND: `dashboard/src/components/calendar/CalendarPill.tsx`
- FOUND: `dashboard/src/components/calendar/PillActionSheet.tsx`
- FOUND commit: `ee30fbe`
- FOUND commit: `13238bd`
- FOUND commit: `6219310`

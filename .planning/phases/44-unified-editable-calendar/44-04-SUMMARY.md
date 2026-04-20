---
phase: 44-unified-editable-calendar
plan: "04"
subsystem: dashboard-ui
tags: [calendar, react, zod, sse, ist, tailwind, week-view, month-view, day-view]

requires:
  - phase: 44-03
    provides: "GET /api/calendar/items, GET /api/calendar/stream, GET /api/actionables/with-due-dates, GET /api/personal-calendar/events/window, GET /api/linkedin/posts/scheduled, CalendarItem discriminated union, CalendarEnvelope"

provides:
  - "GET /calendar — week-view calendar page (React, read-only)"
  - "CalendarItemSchema + CalendarEnvelopeSchema (Zod) in dashboard/src/api/calendarSchemas.ts"
  - "useCalendarStream hook: per-source parallel initial-load + unified SSE + polling fallback"
  - "IST helpers module: formatIstAbsolute/Time/DateShort, startOfIstWeek, addIstDays, istTodayAtMs, istDayStartMs, sameIstDay"
  - "CalendarPill: reusable pill with 3px stripe + icon + RTL/LTR + arrival flash"
  - "MonthView: 7x6 grid, 3 items/day cap, +N dialog"
  - "WeekView: 7-col timed grid, all-day row, current-time line"
  - "DayView: single-column timed view, hour labels, current-time line"
  - "CalendarHeader: nav + Today + view switcher + reconnecting badge"
  - "Sidebar Calendar entry → /calendar (between Events and Reminders)"

affects:
  - 44-05-calendar-interactions
  - 44-06-integration-verification

tech-stack:
  added: []
  patterns:
    - "Per-source parallel initial-load: three independent useEffect + apiFetch calls, each resolves independently"
    - "Unified SSE opened after first source resolves; splits envelope back into three source slices"
    - "Polling fallback to /api/calendar/items on SSE schema drift (10s)"
    - "Discriminated union CalendarItemSchema on source: task|event|linkedin"
    - "IST helpers via toLocaleString('en-GB', {timeZone: 'Asia/Jerusalem'}) + regex reformat"
    - "Custom CSS-grid calendar (no FullCalendar) — ~24 kB bundle delta vs ~300 kB for FullCalendar"
    - "Arrival flash hook mirrors useActionableArrivalFlash pattern (300ms amber)"

key-files:
  created:
    - path: dashboard/src/api/calendarSchemas.ts
      lines: 58
      description: "Zod schemas: CalendarItemSchema discriminated union + CalendarEnvelopeSchema + PerSourceResponseSchema"
    - path: dashboard/src/hooks/useCalendarStream.ts
      lines: 274
      description: "Per-source parallel initial-load + unified SSE (calendar.updated) + polling fallback; exposes refetch(source)"
    - path: dashboard/src/lib/ist.ts
      lines: 168
      description: "IST-locked date helpers: formatIstAbsolute, formatIstTime, formatIstDateShort, startOfIstWeek, addIstDays, istTodayAtMs, istDayStartMs, sameIstDay"
    - path: dashboard/src/pages/Calendar.tsx
      lines: 254
      description: "Calendar page: header + per-source loading banners + partial-failure banners + view routing"
    - path: dashboard/src/components/calendar/CalendarHeader.tsx
      lines: 174
      description: "Nav: title + Today + prev/next + view-aware date label + view switcher tabs + reconnecting badge"
    - path: dashboard/src/components/calendar/MonthView.tsx
      lines: 188
      description: "7x6 grid, max 3 items/day, +N more dialog (shadcn Dialog)"
    - path: dashboard/src/components/calendar/WeekView.tsx
      lines: 358
      description: "7-col timed grid (48px/hr), all-day row, current-time red line, horizontal overflow stacking"
    - path: dashboard/src/components/calendar/DayView.tsx
      lines: 202
      description: "Single-column 24hr grid, hour labels, current-time line, all-day row"
    - path: dashboard/src/components/calendar/CalendarPill.tsx
      lines: 109
      description: "Reusable pill: 3px left border stripe, leading icon, dir-aware, compact/full, amber flash, past-item opacity"
  modified:
    - path: dashboard/src/components/layout/Sidebar.tsx
      description: "Added CalendarDays icon import + Calendar nav entry between Events and Reminders"
    - path: dashboard/src/router.tsx
      description: "Added Calendar import + { path: 'calendar', element: <Calendar /> } route after events"

key-decisions:
  - "Custom CSS-grid calendar (no library): bundle delta +24 kB vs FullCalendar's ~300 kB; RTL-per-item and custom stripe patterns are trivial in CSS, would require patching in any calendar library"
  - "Per-source parallel initial-load: three independent effects, each resolves independently — CONTEXT §5 'no waiting for slowest'"
  - "SSE opened after first source resolves (not all three): minimizes time-to-live-update; per-source slices replaced atomically on each calendar.updated frame"
  - "Retry buttons on partial-failure banners are functional (reset slice to loading, re-fire apiFetch); SSE self-heals within ~3s anyway"
  - "Empty state is muted text only — no celebratory illustration per CONTEXT §Empty state"

requirements-completed: [SC1, SC6, SC7]

duration: ~35min
completed: 2026-04-20
---

# Phase 44 Plan 04: Calendar UI Foundation Summary

**Custom CSS-grid calendar page at /calendar — three sources (tasks/events/linkedin) rendered in parallel with IST timestamps, RTL/LTR per pill, month/week/day views, SSE live updates, and partial-failure banners; zero mutation code**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-04-20
- **Tasks:** 2
- **Files created:** 9 (+ 2 modified)

## Accomplishments

### Task 1: Schemas + SSE hook + IST helpers

- `calendarSchemas.ts` (58 lines): `CalendarItemSchema` discriminated union (`source: 'task'|'event'|'linkedin'`) matching Plan 44-03's server shape exactly; `CalendarEnvelopeSchema` with per-source status; `PerSourceResponseSchema` for initial-load fetches
- `ist.ts` (168 lines): 8 IST-locked helpers using `toLocaleString('en-GB', {timeZone: 'Asia/Jerusalem'})` + regex reformat; no date library
- `useCalendarStream.ts` (274 lines): Phase 1 fires three independent `apiFetch` calls against Plan 44-03 per-source routes; Phase 2 opens unified SSE after first source resolves; polling fallback at 10s; `refetch(source)` exposed for Retry buttons

### Task 2: Page shell + views + pill + sidebar + router

- `CalendarPill.tsx` (109 lines): `border-emerald-500` / `border-indigo-500` / `border-violet-500` stripes; `CheckCircle2` / `Calendar` / `Linkedin` icons; `dir=rtl` when `language==='he'`; amber 300ms flash; `opacity-70 cursor-not-allowed` for past items
- `CalendarHeader.tsx` (174 lines): view-aware date label (month/week/day formats); Today + prev/next navigation; shadcn Tabs view switcher; amber "Reconnecting…" badge
- `MonthView.tsx` (188 lines): 42-cell grid starting Sunday; `sameIstDay` filter per cell; max 3 pills then "+N more" → shadcn Dialog
- `WeekView.tsx` (358 lines): 7 columns, all-day row, 24hr timed grid at 48px/hr, absolute-positioned items, current-time red line with dot, horizontal slot stacking up to 3 columns
- `DayView.tsx` (202 lines): single-column with hour labels, full-detail items, current-time line when viewing today
- `Calendar.tsx` (254 lines): per-source loading banners (disappear independently as each resolves); partial-failure banners with functional Retry; arrival flash hook inline; `SkeletonCalendar` shown only when ALL three sources still loading; muted empty state
- Sidebar: `CalendarDays` icon added, entry between Events and Reminders
- Router: `{ path: 'calendar', element: <Calendar /> }` after events route

## Task Commits

| # | Commit | Description |
|---|--------|-------------|
| 1 | `0bc3123` | feat(dashboard): calendar zod schemas + IST helpers |
| 2 | `934d157` | feat(dashboard): Calendar page + views + pill + sidebar wiring |
| 3 | `f6a5f42` | feat(dashboard): add Calendar nav entry to sidebar |
| 4 | `68d3a4f` | feat(dashboard): router entry for /calendar |

## Vite Bundle Delta

| | Size |
|---|---|
| Before (44-03) | 792,242 bytes |
| After (44-04) | 816,335 bytes |
| **Delta** | **+24,093 bytes (+24 kB)** |

Well within the 60 kB target. Custom CSS-grid approach vs FullCalendar (~300 kB) saved ~276 kB.

## Manual Browser Testing

**Not possible from server context** — no browser available. Verification was done via:
1. `npx tsc --noEmit` — zero errors
2. `npx vite build` — succeeds, 816 kB bundle

Live smoke test deferred to Plan 44-06 owner walkthrough (verification step #1–7 in the plan).

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

### Design choices within discretion

1. **Loading banners vs in-place skeleton pills:** Used top-of-calendar loading status banners ("Loading tasks…" / "Loading events…" / "Loading LinkedIn…") rather than in-place skeleton pills per source. The plan noted "top-of-calendar banner strip is acceptable if skeleton pills are preferred". Each banner disappears independently as its source resolves — CONTEXT §5 "no waiting for slowest" satisfied. A `SkeletonCalendar` grid is shown only when ALL sources are still loading.

2. **Week view overflow:** Items in the same time slot are stacked horizontally (up to 3 columns) with a "+N" badge on the last visible item that opens an overflow dialog. This matches the plan spec exactly.

3. **IST approximation:** `startOfIstWeek` and `addIstDays` use `new Date(year, month, day)` local-time construction as the approximation (same approach FullCalendar uses). DST transitions cause ±1h visual shift twice/year — accepted per plan.

## Hand-off Note for Plan 44-05

**Rendering is complete. Plan 44-05 layers interaction on top.**

Callbacks currently no-ops in Calendar.tsx:
- `onDaySlotClick` (MonthView) → wire create popover
- `onSlotClick` (WeekView, DayView) → wire create popover
- `onOpenItem` (all views) → wire item detail/edit dialog

CalendarPill carries `past={item.start < Date.now()}` → `opacity-70 cursor-not-allowed` class. Plan 44-05 should use this to gate drag operations.

`.planning/` docs added via `git add -f` in the docs commit.

## Self-Check

Files verified:
- `dashboard/src/api/calendarSchemas.ts` — FOUND
- `dashboard/src/hooks/useCalendarStream.ts` — FOUND
- `dashboard/src/lib/ist.ts` — FOUND
- `dashboard/src/pages/Calendar.tsx` — FOUND
- `dashboard/src/components/calendar/CalendarHeader.tsx` — FOUND
- `dashboard/src/components/calendar/MonthView.tsx` — FOUND
- `dashboard/src/components/calendar/WeekView.tsx` — FOUND
- `dashboard/src/components/calendar/DayView.tsx` — FOUND
- `dashboard/src/components/calendar/CalendarPill.tsx` — FOUND
- `dashboard/src/components/layout/Sidebar.tsx` (modified) — FOUND
- `dashboard/src/router.tsx` (modified) — FOUND

Commits verified in git log:
- `0bc3123` — FOUND
- `934d157` — FOUND
- `f6a5f42` — FOUND
- `68d3a4f` — FOUND

## Self-Check: PASSED

---
*Phase: 44-unified-editable-calendar*
*Completed: 2026-04-20*

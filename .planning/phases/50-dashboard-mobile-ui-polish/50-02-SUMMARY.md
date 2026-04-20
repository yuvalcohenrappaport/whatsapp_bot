---
phase: 50-dashboard-mobile-ui-polish
plan: 02
subsystem: ui
tags: [react, vitest, tailwindcss, mobile, hooks, calendar, typescript, pointer-events]

# Dependency graph
requires:
  - phase: 50-dashboard-mobile-ui-polish
    provides: useViewport hook (isMobile flag) and vitest infrastructure from plan 50-01
  - phase: 44-linkedin-post-calendar-view
    provides: Calendar.tsx + all calendar components (MonthView, WeekView, DayView, CalendarHeader, CalendarPill) being extended here
provides:
  - useCalendarViewMode() hook — viewport-aware view resolver with per-viewport localStorage persistence (mobile/desktop keys)
  - useHorizontalSwipe() hook — pointer-events swipe detector with 60px threshold + 30px drift cap
  - MonthDotsView component — phone-only read-only month dot-grid, 3 props
  - colorForItem.ts — shared source→dot-color utility (prevents palette duplication)
  - Calendar.tsx view router — replaces hardcoded 'week' state with useCalendarViewMode; phone gets day/3day/dots; desktop gets month/week/day
  - CalendarHeader extended to accept availableViews + CalendarView including 3day/dots
affects: [50-03, 50-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useCalendarViewMode reads isMobile from useViewport; per-viewport localStorage keys prevent mobile/desktop preference collision
    - useHorizontalSwipe attaches to a container ref via pointer events; mouse pointers skipped to avoid hijacking desktop drag-DnD
    - 3-day view implemented as three stacked DayViews in a horizontally-scrollable flex row (cheaper than a new mode prop on DayView)
    - MonthDotsView accepts only 3 props by design (not MonthView's 16) — read-only phone variant; colorForItem.ts shared util prevents palette duplication

key-files:
  created:
    - dashboard/src/hooks/useCalendarViewMode.ts
    - dashboard/src/hooks/useHorizontalSwipe.ts
    - dashboard/src/hooks/__tests__/useCalendarViewMode.test.ts
    - dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts
    - dashboard/src/components/calendar/MonthDotsView.tsx
    - dashboard/src/components/calendar/colorForItem.ts
  modified:
    - dashboard/src/pages/Calendar.tsx (view state replaced, swipe + MonthDotsView + 3day wired)
    - dashboard/src/components/calendar/CalendarHeader.tsx (availableViews prop, extended CalendarView type)

key-decisions:
  - "3-day implemented as three stacked DayViews in scrollable flex row — cheaper than adding a mode prop to DayView (would require DayView refactor), and 3-day is phone-only so the scroll approach is acceptable"
  - "colorForItem.ts extracted as a shared util so CalendarPill and MonthDotsView share the same source→color palette without duplication"
  - "CalendarView type moved to useCalendarViewMode.ts and re-exported from CalendarHeader so existing CalendarHeader importers still work without change"
  - "useHorizontalSwipe callbacks use functional setCursorMs((ms) => addIstDays(ms, n)) to avoid stale closure on cursorMs"

patterns-established:
  - "useCalendarViewMode() — single hook for calendar view routing; import from @/hooks/useCalendarViewMode"
  - "useHorizontalSwipe(ref, opts) — reusable swipe detector for any container ref; attach on phone only"
  - "MonthDotsView 3-prop pattern — read-only phone view intentionally drops all drag/edit/delete handlers"

requirements-completed: [MOBILE-02]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 50 Plan 02: Calendar View Router + MonthDotsView + Swipe Gesture Summary

**Viewport-aware calendar view router (day/3day/dots on phone, month/week/day on desktop) with per-viewport localStorage persistence, phone-only MonthDotsView dot grid, and useHorizontalSwipe hook for swipe-to-navigate on DayView**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-20T18:59:50Z
- **Completed:** 2026-04-20T19:04:32Z
- **Tasks:** 2 (3 atomic commits)
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- useCalendarViewMode hook: phone defaults to 'day', desktop to 'week'; two scoped localStorage keys (calendar-view-mode-mobile, calendar-view-mode-desktop) prevent cross-viewport preference collision
- useHorizontalSwipe hook: pointer-events detector respecting 60px threshold + 30px vertical drift cap; mouse pointers skipped to preserve desktop drag-DnD
- MonthDotsView: read-only 7-col dot grid, up to 3 colored dots per day (from shared colorForItem.ts palette) + +N overflow badge, tap-day → onSelectDay callback
- Calendar.tsx view router wired: phone gets day/3day/dots toggle; desktop gets month/week/day (unchanged); DayView wrapped in dayContainerRef for swipe; 3-day as three scrollable DayViews
- 10/10 new hook tests green; 14/14 total dashboard tests green

## Task Commits

1. **Task 1: Hooks + tests** - `cdc2179` (feat)
2. **Task 2a: MonthDotsView component** - `c31da3d` (feat)
3. **Task 2b: Calendar.tsx view router + swipe wire-up** - `44c3dda` (feat)

## Files Created/Modified

- `dashboard/src/hooks/useCalendarViewMode.ts` — viewport-aware view resolver with localStorage persistence
- `dashboard/src/hooks/useHorizontalSwipe.ts` — pointer-events swipe hook (60px/30px thresholds)
- `dashboard/src/hooks/__tests__/useCalendarViewMode.test.ts` — 5 vitest cases
- `dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts` — 5 vitest cases
- `dashboard/src/components/calendar/MonthDotsView.tsx` — phone-only read-only dot-grid month view
- `dashboard/src/components/calendar/colorForItem.ts` — shared source→dot-color utility
- `dashboard/src/pages/Calendar.tsx` — view state replaced + swipe + MonthDotsView + 3day wired (~50 lines delta)
- `dashboard/src/components/calendar/CalendarHeader.tsx` — availableViews prop + extended CalendarView type

## Bundle Size

- **Baseline (Plan 50-01):** 848.71 kB JS / 98.73 kB CSS (gzip: 249.67 kB / 16.47 kB)
- **Final (Plan 50-02):** 852.69 kB JS / 99.71 kB CSS (gzip: 250.90 kB / 16.63 kB)
- **Delta:** +3.98 kB JS / +0.98 kB CSS — within expected range for two hooks + MonthDotsView component

## Verification Evidence

```
✓ npx vitest run useCalendarViewMode.test.ts useHorizontalSwipe.test.ts — 10/10 passing
✓ npx vitest run (all) — 14/14 passing (10 new + 4 from 50-01)
✓ npx vite build — succeeds, 852.69 kB JS
✓ grep MOBILE_KEY/DESKTOP_KEY useCalendarViewMode.ts — both keys distinct (calendar-view-mode-mobile / calendar-view-mode-desktop)
✓ grep "pointerType === 'mouse'" useHorizontalSwipe.ts — mouse skip present
✓ grep useCalendarViewMode/MonthDotsView/useHorizontalSwipe Calendar.tsx — 3 matches each
✓ grep addIstDays Calendar.tsx — 3 matches (swipe handlers + 3day offsets)
✓ grep focusDate/setFocusDate Calendar.tsx — ZERO matches (state is cursorMs)
✓ grep availableViews Calendar.tsx — wired to CalendarHeader
```

## Decisions Made

- **3-day implementation:** Three stacked DayViews in a horizontally-scrollable flex row. DayView doesn't have a mode prop (adding one would require a DayView refactor). The three-wrapper approach is minimal and phone-only, so horizontal scroll is acceptable. Plan 50-03 will style this with fixed-width columns.
- **colorForItem.ts shared util:** Extracted from CalendarPill's inline SOURCE_* maps so MonthDotsView can reuse the same palette without copy-paste. Both files import from colorForItem.ts.
- **CalendarView type location:** Moved to useCalendarViewMode.ts (the canonical view-state hook) and re-exported from CalendarHeader. Existing importers of `type CalendarView` from CalendarHeader continue to work.
- **useHorizontalSwipe callbacks as functional updates:** `setCursorMs((ms) => addIstDays(ms, n))` avoids stale closure on `cursorMs` inside the swipe callbacks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added afterEach import to useHorizontalSwipe test**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** `afterEach` was used without being imported from vitest (globals are enabled but explicit imports are preferred to avoid TS6304 errors)
- **Fix:** Added `afterEach` to the vitest import statement
- **Files modified:** dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts
- **Verification:** tsc -b no longer errors on the test file
- **Committed in:** `cdc2179` (part of Task 1 commit)

**2. [Rule 1 - Bug] Removed unused CalendarView type import from Calendar.tsx**
- **Found during:** Task 2 (TypeScript check after Calendar.tsx edits)
- **Issue:** `type CalendarView` was imported from CalendarHeader but is no longer needed in Calendar.tsx — the hook returns the typed view directly
- **Fix:** Changed `import { CalendarHeader, type CalendarView }` to `import { CalendarHeader }`
- **Files modified:** dashboard/src/pages/Calendar.tsx
- **Verification:** tsc -b no longer reports TS6133 for CalendarView in Calendar.tsx
- **Committed in:** `44c3dda`

---

**Total deviations:** 2 auto-fixed (both Rule 1 - unused import cleanup)
**Impact on plan:** Cleanup only, no scope change.

## Issues Encountered

None — plan executed as specified. All pre-existing TypeScript errors (CreateItemPopover, MonthView, WeekView, KeywordRuleFormDialog) are out-of-scope per deviation scope boundary rules.

## User Setup Required

None - no external service configuration required.

## Hand-off Notes

### For Plan 50-03 (Calendar Components Responsive Pass)

- **CalendarHeader** now receives `availableViews` from `useCalendarViewMode()` — the responsive pass should style the toggle as a 3-segment pill on phone using whatever the filtered list contains. The `VIEW_LABELS` map in CalendarHeader provides the display text for each view value.
- **3-day view** is a horizontally-scrollable flex row with three `min-w-0 flex-1` DayView containers. Plan 50-03 should give these columns a fixed width (e.g., `min-w-[80vw]`) so each day panel takes most of the screen and swipe-scrolling reveals the next.
- **MonthDotsView** cell sizing uses `aspect-square` — on very narrow phones the dot area may be tight. Plan 50-03 should verify cell size is readable at 375px width.

### For Plan 50-04 (Long-press Action Sheet)

- **DayView** now has a `dayContainerRef` (the outer `<div ref={dayContainerRef}>`) — the long-press hook from Plan 50-04 will attach to items inside DayView, not to the container.
- **Swipe vs long-press non-overlap:** `useHorizontalSwipe` requires ≥60px movement to fire; `useLongPress` should cancel on >8px movement (CONTEXT lock). The two are non-overlapping in dx on a real device, but Plan 50-04 should verify this on a physical device — devtools emulation may not replicate the timing differences.

## Self-Check

- [x] dashboard/src/hooks/useCalendarViewMode.ts — FOUND
- [x] dashboard/src/hooks/useHorizontalSwipe.ts — FOUND
- [x] dashboard/src/hooks/__tests__/useCalendarViewMode.test.ts — FOUND
- [x] dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts — FOUND
- [x] dashboard/src/components/calendar/MonthDotsView.tsx — FOUND
- [x] dashboard/src/components/calendar/colorForItem.ts — FOUND
- [x] cdc2179 — FOUND (feat(50-02): useCalendarViewMode + useHorizontalSwipe hooks)
- [x] c31da3d — FOUND (feat(50-02): MonthDotsView phone-only month component)
- [x] 44c3dda — FOUND (feat(50-02): wire view router + swipe gesture into Calendar.tsx)

## Self-Check: PASSED

---
*Phase: 50-dashboard-mobile-ui-polish*
*Completed: 2026-04-20*

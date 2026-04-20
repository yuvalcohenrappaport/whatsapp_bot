---
phase: 50-dashboard-mobile-ui-polish
plan: 03
subsystem: ui
tags: [react, tailwindcss, mobile, calendar, typescript, radix-ui, dialog, popover, safe-area]

# Dependency graph
requires:
  - phase: 50-dashboard-mobile-ui-polish
    provides: useViewport hook (isMobile flag) from plan 50-01
  - phase: 50-dashboard-mobile-ui-polish
    provides: availableViews prop + CalendarView type extension from plan 50-02
  - phase: 44-linkedin-post-calendar-view
    provides: CalendarHeader, CalendarPill, DayView, DayOverflowPopover, CreateItemPopover, InlineTitleEdit, WeekView (base components)
provides:
  - CalendarHeader mobile compact row (prev/next + truncated date label + ViewTogglePillMobile 3-segment pill)
  - CalendarPill mobile tweaks (min-h-7, no tooltip title, draggable disabled on phone, source color accent bar preserved)
  - DayView mobile layout (ROW_H 64px, grid-click disabled, floating + New FAB with safe-area inset)
  - DayOverflowPopover mobile bottom-sheet branch (Dialog fixed bottom-0 + rounded-t-2xl) vs desktop Popover
  - CreateItemPopover mobile bottom-sheet branch (Dialog) vs desktop Popover; form extracted to CreateItemForm
  - InlineTitleEdit mobile bottom-sheet dialog (Dialog) vs desktop inline input
  - WeekView desktop-only comment (no functional change — view router already filters it on phone)
affects: [50-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isMobile ? mobile-layout : desktop-layout — uniform branch pattern across all 6 components"
    - "Dialog bottom-sheet: DialogContent className override with fixed bottom-0 left-0 right-0 top-auto + translate-x/y-0 + rounded-b-none rounded-t-2xl"
    - "FAB pattern: fixed z-30 right-4 size-14 rounded-full, bottom calc(env(safe-area-inset-bottom)+1rem)"
    - "ViewTogglePillMobile: inline subcomponent rendering availableViews as h-10 segments in bg-muted rounded-full pill"
    - "Form extraction: CreateItemForm pulled out of CreateItemPopover so both Dialog and Popover branches share identical form state/handlers"

key-files:
  created: []
  modified:
    - dashboard/src/components/calendar/CalendarHeader.tsx
    - dashboard/src/components/calendar/CalendarPill.tsx
    - dashboard/src/components/calendar/DayView.tsx
    - dashboard/src/components/calendar/DayOverflowPopover.tsx
    - dashboard/src/components/calendar/CreateItemPopover.tsx
    - dashboard/src/components/calendar/InlineTitleEdit.tsx
    - dashboard/src/components/calendar/WeekView.tsx

key-decisions:
  - "ViewTogglePillMobile as inline subcomponent in CalendarHeader — keeps it co-located with the mobile branch; no separate file needed"
  - "buildDateLabelShort helper for phone — avoids rendering full date strings (e.g. 'April 2026' → 'Apr 2026') in the compact header row"
  - "ROW_H passed as param to topPx/heightPx/computeDropTargetMs — single source of truth, no conditional math scattered across DayView"
  - "CreateItemForm extracted from CreateItemPopover — shares form state/handlers between Dialog (phone) and Popover (desktop) without duplication; form logic is unchanged"
  - "DayOverflowPopover open/onOpenChange props added — phone branch needs controlled state to open dialog from the trigger span; desktop Popover works without them (uncontrolled fallback)"
  - "InlineTitleEdit: isMobile → Dialog immediately (no overlap detection) — plan heuristic is 'any overlap risk on phone is enough to switch'; simplest correct implementation"
  - "WeekView: comment-only change — view router already prevents phone mounting; no fixed widths found to fix"

patterns-established:
  - "Bottom-sheet Dialog pattern: fixed bottom-0 left-0 right-0 top-auto + translate overrides + rounded-t-2xl — reuse for any future mobile overlay"
  - "CalendarPill is Plan 50-04 ready: isMobile guard already present; long-press handler attaches inside that branch without touching desktop drag logic"

requirements-completed: [MOBILE-03]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 50 Plan 03: Calendar Components Responsive Pass Summary

**Six calendar components (CalendarHeader, CalendarPill, DayView, DayOverflowPopover, CreateItemPopover, InlineTitleEdit) each get an isMobile branch: compact single-row header with 3-segment pill, 28px min-height pills with no tooltip, 64px hour rows with a floating +New FAB, and bottom-sheet Dialogs replacing popovers on phone**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-20T19:07:08Z
- **Completed:** 2026-04-20T19:12:24Z
- **Tasks:** 2 (4 atomic commits)
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- CalendarHeader: single compact row on phone (prev/next buttons, truncated date, ViewTogglePillMobile with 3-segment h-10 pill driven by availableViews from Plan 50-02); desktop layout unchanged
- CalendarPill: min-h-7 (28px), no tooltip title on mobile (suppressed to prevent tap blocking), draggable disabled on mobile, source color accent bar preserved; desktop pill byte-identical
- DayView: ROW_H_MOBILE=64px (up from 48px) for touch comfort; grid-click disabled on mobile; floating +New FAB (size-14, fixed z-30, safe-area-inset-bottom aware) opens same create flow via onSlotClick; desktop drag-drop unchanged
- DayOverflowPopover + CreateItemPopover + InlineTitleEdit: isMobile ? Dialog (bottom-sheet: fixed bottom-0, rounded-t-2xl, slide-in-from-bottom, safe-area pb) : existing Popover; form contents and mutation handlers identical in both branches
- WeekView: desktop-only comment added; no code change (view router already prevents phone mounting)
- 14/14 vitest tests still green; vite build succeeds

## Task Commits

1. **Task 1a: CalendarHeader** - `087f2c1` (feat)
2. **Task 1b: CalendarPill + DayView** - `9c4d795` (feat)
3. **Task 2a: DayOverflowPopover + CreateItemPopover + InlineTitleEdit** - `0dce2b9` (feat)
4. **Task 2b: WeekView cleanup** - `63ccc2a` (chore)

## Files Created/Modified

- `dashboard/src/components/calendar/CalendarHeader.tsx` — +102 lines: ViewTogglePillMobile subcomponent, buildDateLabelShort helper, isMobile branch
- `dashboard/src/components/calendar/CalendarPill.tsx` — +2 import lines + mobile-class logic; title suppress; draggable guard
- `dashboard/src/components/calendar/DayView.tsx` — ROW_H_DESKTOP/MOBILE split; topPx/heightPx/computeDropTargetMs accept rowH; FAB element added (~+50 lines)
- `dashboard/src/components/calendar/DayOverflowPopover.tsx` — isMobile Dialog bottom-sheet branch; open/onOpenChange props added; shared body variable
- `dashboard/src/components/calendar/CreateItemPopover.tsx` — CreateItemForm extracted; isMobile Dialog bottom-sheet; formatIstTime unused import removed (pre-existing error resolved)
- `dashboard/src/components/calendar/InlineTitleEdit.tsx` — isMobile Dialog branch; Button import added; desktop inline unchanged
- `dashboard/src/components/calendar/WeekView.tsx` — +5 lines comment only

## Bundle Size

- **Baseline (Plan 50-02):** 852.69 kB JS / 99.71 kB CSS (gzip: 250.90 kB / 16.63 kB)
- **Final (Plan 50-03):** 856.63 kB JS / 100.41 kB CSS (gzip: 251.61 kB / 16.75 kB)
- **Delta:** +3.94 kB JS / +0.70 kB CSS — within expected range for 6 components gaining Dialog imports + isMobile branches

## Verification Evidence

```
✓ npx tsc -b — zero new errors (pre-existing errors in MonthView/WeekView/KeywordRuleFormDialog/Calendar.tsx unchanged; CreateItemPopover formatIstTime error resolved as side effect)
✓ npx vite build — succeeds, 856.63 kB JS
✓ npx vitest run — 14/14 passing (no regressions)
✓ grep -c "useViewport" CalendarHeader.tsx CalendarPill.tsx DayView.tsx — 2 each (import + usage)
✓ grep -n "env(safe-area-inset-bottom)" DayView.tsx — FAB respects safe area (line 325)
✓ grep -l "isMobile" DayOverflowPopover.tsx CreateItemPopover.tsx InlineTitleEdit.tsx — all three
✓ grep -n "fixed bottom-0\|bottom-0 left-0 right-0" — bottom-sheet positioning in all three
```

## Decisions Made

- **ViewTogglePillMobile inline in CalendarHeader:** Co-located with the mobile branch — small enough (15 lines) that a separate file adds overhead without benefit. The `VIEW_LABELS` map abbreviates '3day' to '3D' for pill segment fit.
- **buildDateLabelShort for phone:** Full labels like "Tue 20 Apr 2026" clip on 375px width; the short helper returns "20 Apr" for day/3day, "Apr 2026" for month/dots.
- **ROW_H as param:** topPx, heightPx, computeDropTargetMs all accept rowH so the correct height is threaded through without conditional logic at call sites.
- **CreateItemForm extraction:** Both Dialog (phone) and Popover (desktop) branches need identical form state, validation, and mutation calls. Extracting to `CreateItemForm` is DRY and keeps each branch thin (only the wrapper changes).
- **DayOverflowPopover open/onOpenChange props:** The phone trigger (a `<span>` wrapping the calendar grid's "+N more" button) needs controlled state to open the Dialog; the desktop Popover works uncontrolled. Props are optional to avoid breaking existing callers.
- **InlineTitleEdit always-Dialog on mobile:** The plan heuristic is "any overlap risk on phone is enough to switch" — implementing overlap detection would be more complex and fragile than the constant isMobile branch.
- **WeekView: comment only:** Grep found no fixed pixel widths (no `min-w-[...px]` or `w-[...px]` patterns). The view router from Plan 50-02 is the correct guard; adding a runtime width check in WeekView would duplicate logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed pre-existing unused imports in CreateItemPopover.tsx**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** `formatIstTime` and unused `d` variable were pre-existing TS6133 errors; they happened to be in CreateItemPopover which was being rewritten. Removing them was part of the file rewrite, not a targeted fix.
- **Fix:** Dropped `formatIstTime` import (not used in new structure); extracted `buildTargetMs` no longer uses a stray `d` variable.
- **Files modified:** dashboard/src/components/calendar/CreateItemPopover.tsx
- **Committed in:** `0dce2b9`

---

**Total deviations:** 1 auto-fixed (Rule 1 — resolved as natural consequence of file rewrite)
**Impact on plan:** No scope change; pre-existing TS errors reduced by 2.

## Issues Encountered

None — plan executed as specified. All remaining pre-existing TypeScript errors (MonthView, WeekView.ts:102 itemStartMs, KeywordRuleFormDialog, Calendar.tsx line 44/419) are out-of-scope per deviation scope boundary rules and unchanged from before this plan.

## User Setup Required

None - no external service configuration required.

## Hand-off Notes

### For Plan 50-04 (Long-press Action Sheet)

- **CalendarPill** now has an `isMobile` guard wrapping the draggable attribute. Plan 50-04's long-press handler should attach INSIDE the isMobile branch alongside the tap handler — this keeps desktop drag-DnD completely untouched. The pill's tap handler (onOpenDetails) currently opens the detail/edit affordance; long-press is ADDITIVE, not replacing the tap.
- **DayView FAB** opens create via `onSlotClick(cursorMs, nextHour, 0)` — Plan 50-04 does not need to modify the FAB; it should add long-press on timed items (CalendarPill within DayView's timedItems map).
- **Bottom-sheet pattern established:** Use `DialogContent className="fixed bottom-0 left-0 right-0 top-auto translate-x-0 translate-y-0 max-w-none rounded-b-none rounded-t-2xl"` for any new mobile overlay — same pattern used in all three popovers here.
- **DayOverflowPopover** now accepts `open`/`onOpenChange` for controlled mode — if Plan 50-04 needs to programmatically open it (e.g., from a long-press), these props are ready.

### Confirmation: Desktop Phase 44 behavior intact

- CalendarHeader desktop branch is byte-identical to Plan 50-02 output; the isMobile branch exits early before the desktop JSX.
- CalendarPill: draggable still `!past && !ghost` on desktop (isMobile is false); tooltip title still set on desktop; SOURCE_STRIPE/SOURCE_BG/onDragStart/onDragEnd all intact.
- DayView: ROW_H_DESKTOP=48 (unchanged); computeDropTargetMs/topPx/heightPx behave identically at rowH=48; onSlotClick fires on grid click on desktop.
- DayOverflowPopover, CreateItemPopover: desktop Popover branch is structurally identical to Plan 44-05 output.
- InlineTitleEdit: desktop branch is the original inline input exactly; blur → commit behavior preserved.

### Confirmation: .planning/ docs committed with git add -f

Docs committed via gsd-tools.cjs commit command (handles -f automatically for .planning/).

## Self-Check

- [x] dashboard/src/components/calendar/CalendarHeader.tsx — FOUND
- [x] dashboard/src/components/calendar/CalendarPill.tsx — FOUND
- [x] dashboard/src/components/calendar/DayView.tsx — FOUND
- [x] dashboard/src/components/calendar/DayOverflowPopover.tsx — FOUND
- [x] dashboard/src/components/calendar/CreateItemPopover.tsx — FOUND
- [x] dashboard/src/components/calendar/InlineTitleEdit.tsx — FOUND
- [x] dashboard/src/components/calendar/WeekView.tsx — FOUND
- [x] 087f2c1 — FOUND (feat(50-03): CalendarHeader phone layout)
- [x] 9c4d795 — FOUND (feat(50-03): CalendarPill + DayView phone layout)
- [x] 0dce2b9 — FOUND (feat(50-03): bottom-sheet branch for DayOverflowPopover + CreateItemPopover + InlineTitleEdit)
- [x] 63ccc2a — FOUND (chore(50-03): WeekView responsive cleanup)

## Self-Check: PASSED

---
*Phase: 50-dashboard-mobile-ui-polish*
*Completed: 2026-04-20*

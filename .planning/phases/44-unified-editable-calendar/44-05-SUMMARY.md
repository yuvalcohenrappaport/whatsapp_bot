---
phase: 44-unified-editable-calendar
plan: "05"
subsystem: dashboard-ui
tags: [calendar, drag-and-drop, inline-edit, create-popover, shadcn, react, optimistic-ui]

requires:
  - phase: 44-04
    provides: "CalendarPill, WeekView, MonthView, DayView, useCalendarStream, CalendarItem discriminated union, IST helpers"
  - phase: 44-01
    provides: "PATCH /api/actionables/:id {fireAt}, POST /api/personal-calendar/events"
  - phase: 44-02
    provides: "PATCH /api/personal-calendar/events/:id, POST /api/linkedin/posts/:id/reschedule"

provides:
  - "SC2: drag-to-reschedule for all three sources via correct endpoints"
  - "SC3: inline title edit (Enter/blur=commit, Esc=cancel) for all three sources"
  - "SC4: empty-slot click opens CreateItemPopover; task+event create directly; LinkedIn navigates to queue"
  - "SC5: body-click opens EditPostDialog (LinkedIn) or lightweight calendar-local dialog (task/event)"
  - "CalendarDragGhost: portal-rendered ghost with live IST timestamp caption"
  - "useCalendarMutations: useRescheduleMutation + useInlineEditMutation + useCreateMutation"
  - "Optimistic override layer in Calendar.tsx: pills move instantly on drop"
  - "Undo toast (5s) on every successful reschedule"
  - "LinkedIn snap-slot toast when server advances to next Tue/Wed/Thu slot"
  - "Past-item drag disabled (cursor:not-allowed)"

affects:
  - 44-06-integration-verification

tech-stack:
  added:
    - "shadcn popover primitive (via radix-ui meta-package already in deps)"
  patterns:
    - "HTML5 drag API with setDragImage(transparent1x1PNG, 0, 0) to suppress native ghost"
    - "Portal-rendered CalendarDragGhost via useSyncExternalStore + module-level state (no new dep)"
    - "Optimistic override map merged onto allItems before passing to views"
    - "InlineTitleEdit embedded in CalendarPill via editingId prop — no extra DOM layer"
    - "Calendar-local lightweight dialogs for task/event (SC5 narrowing — see Decisions)"
    - "LinkedIn create-navigate concession: navigates to /linkedin/queue, no direct POST"

key-files:
  created:
    - path: dashboard/src/components/ui/popover.tsx
      lines: 87
      description: "shadcn popover primitive via 'npx shadcn add popover'; uses radix-ui meta-pkg"
    - path: dashboard/src/hooks/useCalendarMutations.ts
      lines: 298
      description: "useRescheduleMutation + useInlineEditMutation + useCreateMutation + useNavigateToLinkedInCreate; optimistic + undo + error toasts"
    - path: dashboard/src/components/calendar/CalendarDragGhost.tsx
      lines: 144
      description: "Portal ghost: module-level GhostState + useSyncExternalStore; CalendarDragGhost component + useCalendarDragGhost hook; createPortal to document.body"
    - path: dashboard/src/components/calendar/InlineTitleEdit.tsx
      lines: 83
      description: "Reusable inline input: auto-focus+select, Enter/blur=commit, Esc=cancel, empty-title guard"
    - path: dashboard/src/components/calendar/DayOverflowPopover.tsx
      lines: 67
      description: "Popover listing all items for a day sorted by start; replaces shadcn Dialog for MonthView +N more"
    - path: dashboard/src/components/calendar/CreateItemPopover.tsx
      lines: 385
      description: "Type chips (Task/Event/LinkedIn), title, start time, duration (Event), location (Event), contact picker (Task); LinkedIn create navigates to queue"
  modified:
    - path: dashboard/src/components/calendar/CalendarPill.tsx
      lines: 184
      description: "Added: draggable + setDragImage(transparent PNG), ghost mode, draggingId opacity-40, editingId renders InlineTitleEdit, title-click vs body-click split"
    - path: dashboard/src/components/calendar/WeekView.tsx
      lines: 409
      description: "Drop zones on each day column, 15-min snap, DragOver updates ghost caption; editingId/onTitleCommit/onTitleCancel threading"
    - path: dashboard/src/components/calendar/DayView.tsx
      lines: 291
      description: "Drop zone on grid, 15-min snap; editingId threading"
    - path: dashboard/src/components/calendar/MonthView.tsx
      lines: 237
      description: "Drop zones per cell, whole-day snap + time-of-day preservation; DayOverflowPopover replaces Dialog"
    - path: dashboard/src/pages/Calendar.tsx
      lines: 652
      description: "Optimistic overrides map, inlineTitles map, draggingId state, ghost hook, create popover, task/event local edit dialogs, EditPostDialog for LinkedIn"

key-decisions:
  - "SC5 narrowing: task/event body-click opens calendar-local dialog (title+date+time); NOT page-level dialogs because Tasks.tsx+Events.tsx have no full-edit dialogs as of Phase 43. LinkedIn body-click uses existing EditPostDialog from Phase 36 (literal SC5 for LinkedIn). Owner sign-off required at 44-06 walkthrough."
  - "LinkedIn create-navigate concession: pm-authority has no public 'create approved post at scheduled_at' endpoint. LinkedIn chip in CreateItemPopover navigates to /linkedin/queue?intent=create instead of POSTing. Documented in hook + popover comments."
  - "InlineTitleEdit embedded in CalendarPill via editingId prop: avoids a floating overlay layer, keeps the edit input exactly where the title text was, natural z-order."
  - "CalendarDragGhost state as module-level let + useSyncExternalStore: zero new deps, avoids React Context prop-drilling through 4 levels of view hierarchy."
  - "DayOverflowPopover replaces shadcn Dialog for MonthView +N more: popover anchors near the clicked button, Dialog was modal and felt heavy for this use case."

requirements-completed: [SC2, SC3, SC4, SC5]

duration: ~75min
completed: 2026-04-20
---

# Phase 44 Plan 05: Calendar Interactions Summary

**Full interaction layer on top of the read-only calendar: drag-to-reschedule with portal ghost + live IST timestamp, inline title edit, create-from-empty-slot popover, and source-specific edit dialogs; optimistic updates throughout**

## Performance

- **Duration:** ~75 min
- **Completed:** 2026-04-20
- **Tasks:** 2 (each with sub-tasks)
- **Files created:** 6 (+ 5 modified)

## Accomplishments

### Task 1: Popover primitive + mutation hook family

- `popover.tsx` (87 lines): shadcn component installed via `npx shadcn@latest add popover`; uses `radix-ui` meta-package already in deps
- `useCalendarMutations.ts` (298 lines):
  - `useRescheduleMutation`: routes PATCH/POST per source; optimistic callback; on success: LinkedIn snap-slot toast if server moved time >60s, then undo toast with 5s action; on error: rollback + red toast
  - `useInlineEditMutation`: PATCH task (field: `task`), PATCH event (field: `title`), POST linkedin `/edit`; optimistic title update; confirm toast
  - `useCreateMutation`: POST `/api/actionables` (task) or POST `/api/personal-calendar/events` (event); no LinkedIn POST (navigation instead)
  - `useNavigateToLinkedInCreate`: concession helper that calls `navigate('/linkedin/queue?intent=create')`

### Task 2: Interactive components + pill/view wiring

- `InlineTitleEdit.tsx` (83 lines): single-file focused editor, committed/ref prevents double-commit on Enter+blur
- `DayOverflowPopover.tsx` (67 lines): shadcn Popover wrapping sorted CalendarPill list
- `CalendarDragGhost.tsx` (144 lines): module-level `GhostState`, `useSyncExternalStore` subscription, `createPortal(…, document.body)`, renders a `<CalendarPill ghost />` clone + `formatIstAbsolute` caption
- `CreateItemPopover.tsx` (385 lines): full create flow with type-chip color coding, time input pre-fill, contact Select (task), duration (event), location (event); LinkedIn branch navigates not POSTs

**Pill + view wiring:**
- `CalendarPill.tsx`: `setDragImage(TRANSPARENT_PNG, 0, 0)` on drag start; `draggingId === item.id` → `opacity-40`; `editingId === item.id` → renders `InlineTitleEdit` in place of title span; title span click `stopPropagation` + calls `onTitleClick`
- `WeekView.tsx` + `DayView.tsx`: `onDragOver` calls `ghost.move(x,y)` + `ghost.setTarget(computedMs)` and `e.preventDefault()`; `onDrop` reads dataTransfer payload, computes 15-min snap target, fires `reschedule.mutate`
- `MonthView.tsx`: `onDrop` computes whole-day target via `preserveTimeOfDay()` (splices item's hour+minute onto target date); `DayOverflowPopover` replaces shadcn Dialog
- `Calendar.tsx`: `overrides: Map<string, number>` merged onto `allItems` in `useMemo`; `inlineTitles: Map<string, string>` for optimistic title display; `TaskEditDialog` + `EventEditDialog` (calendar-local, lightweight); `EditPostDialog` for LinkedIn body-click

## Task Commits

| # | Commit | Description |
|---|--------|-------------|
| 1 | `aa6b60e` | feat(44-05): popover primitive + calendar mutation hook family |
| 2 | `7984b9c` | feat(44-05): create + inline edit + day-overflow + drag ghost components |
| 3 | `4a2a549` | feat(44-05): wire drag/drop + click + inline edit into pill and views |

## Vite Bundle Delta

| | Size |
|---|---|
| Before (44-04) | 816,335 bytes |
| After (44-05) | 841,220 bytes |
| **Delta** | **+24,885 bytes (+25 kB)** |

Well within the 30 kB target.

## Manual Browser Testing

**Not possible from server context** — no browser available. Verification was done via:
1. `npx tsc --noEmit` — zero errors
2. `npx vite build` — succeeds, 841 kB bundle

Live smoke test deferred to Plan 44-06 owner walkthrough (items 1–8 in the plan verification section).

## Deviations from Plan

### Design Choices Within Discretion

**1. SC5 narrowing: calendar-local dialogs for task/event**

As documented in the plan's Scope Note and CONTEXT.md addendum: Tasks.tsx and Events.tsx have no full-edit dialogs as of Phase 43. Rather than expand scope, `Calendar.tsx` provides inline `TaskEditDialog` and `EventEditDialog` components (title + date + time fields, ~80 lines each). LinkedIn continues to use `EditPostDialog` from Phase 36 (literal SC5 for LinkedIn).

This narrowing requires owner sign-off at 44-06 walkthrough (check #10 surfaces it explicitly).

**2. LinkedIn create-navigate concession**

pm-authority has no public "create approved post at scheduled_at" endpoint. Selecting "LinkedIn post" in CreateItemPopover closes the popover and navigates to `/linkedin/queue?intent=create`. Documented inline in `useCalendarMutations.ts` and `CreateItemPopover.tsx`.

**3. DayOverflowPopover replaces shadcn Dialog for MonthView +N more**

Plan 44-04 used a shadcn Dialog for the +N more overflow. Plan 44-05 introduced `DayOverflowPopover` (a Popover, not Dialog) since it anchors near the button and feels lighter than a modal. This is a UX improvement over the original spec.

**4. Module-level state for CalendarDragGhost**

Plan suggested "module-level `let` + `useSyncExternalStore`" OR "thin Context in Calendar.tsx". Chose the module-level approach — zero prop-drilling, no React tree involvement, cleaner separation from the component hierarchy.

**5. shadcn popover uses radix-ui meta-package**

The installed `popover.tsx` imports from `radix-ui` (meta-package) not `@radix-ui/react-popover` directly. Both are equivalent; `radix-ui` re-exports all Radix packages. The plan noted "adds `@radix-ui/react-popover`" but `radix-ui@1.4.3` was already in deps, so the shadcn CLI correctly used the existing resolution.

## Hand-off Note for Plan 44-06

**Calendar is feature-complete. Plan 44-06 is PM2 restart + owner walk-through.**

What to verify at walk-through:
1. Drag a timed event in WeekView — ghost follows pointer with live IST timestamp, drops to new cell, undo toast appears
2. Drag a task cross-day in WeekView — time-of-day preserved
3. Drag a LinkedIn post to a non-posting day — server snaps to next Tue/Wed/Thu, snap toast appears
4. Click a title → InlineTitleEdit appears, Enter commits, Esc reverts
5. Click empty slot → CreateItemPopover opens, Task chip default, title + time pre-filled
6. Save a new task from the popover → actionable created, pill appears
7. Click +N more on a busy month-view day → DayOverflowPopover shows all items
8. Click a LinkedIn pill body → EditPostDialog opens with bilingual tabs
9. Click a task pill body → TaskEditDialog opens with title + date + time
10. **SC5 narrowing sign-off**: confirm calendar-local task/event dialogs are acceptable vs requiring full page-level dialogs on Tasks.tsx/Events.tsx first

PM2 restart: `pm2 restart whatsapp-bot` on the server to pick up the new dashboard bundle.

`.planning/` docs added via `git add -f`.

## Self-Check

Files verified:
- `dashboard/src/components/ui/popover.tsx` — FOUND
- `dashboard/src/hooks/useCalendarMutations.ts` — FOUND
- `dashboard/src/components/calendar/CalendarDragGhost.tsx` — FOUND
- `dashboard/src/components/calendar/InlineTitleEdit.tsx` — FOUND
- `dashboard/src/components/calendar/DayOverflowPopover.tsx` — FOUND
- `dashboard/src/components/calendar/CreateItemPopover.tsx` — FOUND
- `dashboard/src/components/calendar/CalendarPill.tsx` (modified) — FOUND
- `dashboard/src/components/calendar/WeekView.tsx` (modified) — FOUND
- `dashboard/src/components/calendar/DayView.tsx` (modified) — FOUND
- `dashboard/src/components/calendar/MonthView.tsx` (modified) — FOUND
- `dashboard/src/pages/Calendar.tsx` (modified) — FOUND

Commits verified:
- `aa6b60e` — FOUND
- `7984b9c` — FOUND
- `4a2a549` — FOUND

## Self-Check: PASSED

---
*Phase: 44-unified-editable-calendar*
*Completed: 2026-04-20*

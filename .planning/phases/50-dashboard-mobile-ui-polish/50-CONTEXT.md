# Phase 50 — Dashboard Mobile UI Polish — CONTEXT

**Milestone:** v2.0 Dashboard UX Polish (seed)
**Status:** Planning — design approved 2026-04-20, awaiting plan generation via `/gsd:plan-phase 50`
**Design spec:** `docs/superpowers/specs/2026-04-20-dashboard-mobile-ui-design.md` (single source of truth — read this first)

## One-line summary

Make the dashboard first-class on a phone (≤768px). Calendar is the showcase fix (680 lines, zero responsive code today); a shared set of mobile primitives uplifts every other page in one pass.

## Why now

Yuval flagged mobile unusability after Phase 45 shipped (2026-04-20). Calendar (Phase 44) was built desktop-only; Overview / PendingTasks / Drafts have patchy responsive coverage (~55 responsive class occurrences across 20 files, but 9 calendar components have zero). Mobile is the current primary friction point on the dashboard — not a feature gap, a presentation gap.

## Scope

**In scope:**
- Global mobile primitives — tap targets, iOS auto-zoom kill, safe-area insets, `<StickyActionBar>`, `useViewport()` hook (extending existing `useIsMobile()`)
- Calendar mobile strategy — DayView default on phone with horizontal swipe prev/next, 3-Day scrollable, `MonthDotsView` replacing MonthView on phone, WeekView desktop-only
- Calendar components responsive pass — CalendarHeader, CalendarPill, DayView, DayOverflowPopover, CreateItemPopover, InlineTitleEdit (+ WeekView minor)
- Long-press → action sheet replaces touch drag-and-drop on phone (desktop drag preserved); `useLongPress` + `<PillActionSheet>`; reschedule via native `<input type="datetime-local">` + existing `useCalendarMutations.reschedule()`
- Daily-driver page polish — Overview, PendingTasks, Drafts
- Live verification against PM2 bot on a real phone

**Out of scope:**
- LinkedIn multi-pane workflow pages (`LinkedInLessonSelection`, `LinkedInVariantFinalization`, `LinkedInQueue`) — future polish phase within v2.0
- Tablet-specific layouts (769–1024px stays at desktop layout)
- Reduced-motion or haptic-preference UI
- Any backend change — presentation-layer only
- Any new feature — polish only

## Locks (must hold through planning + execution)

- **Breakpoint:** `md:` = 768px. Everything below = phone layout.
- **Default calendar view on phone:** DayView.
- **MonthView on phone:** replaced by read-only `MonthDotsView` (dot grid, tap day → DayView).
- **Touch drag-and-drop:** removed on phone. Desktop drag stays.
- **Reschedule picker on phone:** native `<input type="datetime-local">`. No date-picker library.
- **Reschedule mutation:** reuses existing `useCalendarMutations.reschedule()` — no new API, no new error handling.
- **No backend changes.**
- **Haptic feedback:** `navigator.vibrate(10)` if available; silent no-op if not. No user preference UI.

## Success criteria (from ROADMAP)

1. Global primitives shipped: 44px tap-target floor, ≥16px input font, safe-area insets, `<StickyActionBar>`, `useViewport()`
2. Calendar phone view: DayView default + swipe prev/next, 3-Day scrollable, MonthDotsView replaces MonthView; WeekView desktop-only
3. Calendar components responsive: header, pill, DayView, DayOverflowPopover, CreateItemPopover, InlineTitleEdit adapt to ≤768px
4. Long-press → action sheet replaces touch drag-and-drop on phone; desktop drag preserved
5. Overview / PendingTasks / Drafts audited for mobile crowding; stacked columns, full-width textareas, sticky action bars where appropriate
6. Live walkthrough on a real phone passes against PM2 bot

## Planned plans (~6)

See design spec §Architecture. Rough cut:

1. **50-01** — Global mobile primitives (hooks, utilities, shadcn ui tweaks, AppLayout)
2. **50-02** — Calendar view router + `MonthDotsView` + swipe gesture
3. **50-03** — Calendar components responsive pass
4. **50-04** — Long-press action sheet + reschedule path
5. **50-05** — Daily-driver page polish (Overview, PendingTasks, Drafts)
6. **50-06** — Live verification (autonomous: false)

Planner will confirm exact breakdown, dependencies, wave grouping, and requirement IDs during `/gsd:plan-phase 50`.

## Files likely touched

See design spec §File inventory. ~11 new files + ~16 modified. All under `dashboard/src/` — no backend, no pm-authority work.

## Requirements

TBD — define via `/gsd:discuss-phase 50` or let `/gsd:plan-phase 50` propose IDs (e.g., `MOBILE-01..06`) which then get inserted into REQUIREMENTS.md.

## Dependencies

- Phase 45 (Dashboard Pending-Tasks Write Actions) — complete. `PendingActionableCard` pattern established, will be adjusted in 50-05.
- Phase 44 (Unified Editable Calendar) — complete. `useCalendarMutations` reused for mobile reschedule path.
- No upstream (pm-authority) changes needed.

## Risks / watch-outs

- **Swipe vs scroll conflict** on DayView — handwritten `useHorizontalSwipe` must require <30px vertical drift to fire, so vertical scroll isn't hijacked. Test on real touch device, not just devtools emulation.
- **Long-press false positives** during scroll — `useLongPress` cancels on >8px movement, but edge-case test on mid-scroll pill tap.
- **iOS safe-area insets** — only landed on notched devices; verify on at least one notched device in Plan 50-06. Non-notched devices get 0 padding, which is correct.
- **`datetime-local` input quirks** — iOS returns local time, no timezone; confirm the reschedule path interprets it in IST (the bot's canonical timezone) and not UTC.
- **Calendar.tsx size (680 lines)** — view router introduction may justify a small extraction; planner decides. Don't over-refactor during a mobile-polish phase.

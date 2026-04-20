# Dashboard Mobile UI — Design

**Date:** 2026-04-20
**Status:** Approved for planning
**Target breakpoint:** ≤768px (Tailwind `md:` cutoff) = phone layout. 769px and above keep the current desktop layout.
**Project:** whatsapp-bot dashboard (React 19 + Tailwind 4 + shadcn/ui)

## Goal

The dashboard is first-class usable on a phone. The Calendar is the showcase fix (currently 680 lines with zero responsive code); a shared set of global mobile primitives uplifts every other page in one pass.

## Non-goals

- LinkedIn multi-pane workflow pages (`LinkedInLessonSelection`, `LinkedInVariantFinalization`, `LinkedInQueue`) — future polish, not in this phase
- Tablet-specific layouts (769–1024px stays at desktop layout for now; revisit later)
- Reduced-motion or haptic-preference UI
- Two-way Google Tasks sync or any feature addition — this is a presentation-layer phase only

## Architecture

Five implementation plans, executed in dependency order:

### Plan 1 — Global mobile primitives

**Touches:** `dashboard/src/index.css`, `dashboard/src/hooks/useViewport.ts` (new), shared shadcn primitives in `dashboard/src/components/ui/` (Button, Input, Textarea), `dashboard/src/components/layout/AppLayout.tsx`, `dashboard/src/components/ui/StickyActionBar.tsx` (new).

**What it adds:**
- **Tap target floor** — audit `h-8` / `h-9` on interactive elements; promote to `h-10 md:h-9` where reachable on mobile. Enforced by an ESLint-free convention (documented in the new component) — no runtime check.
- **iOS auto-zoom kill** — all `<Input>` and `<Textarea>` primitives get `text-base md:text-sm` so the computed font-size is ≥16px on phones (iOS zooms into inputs below 16px).
- **Safe-area insets** — `AppLayout` applies `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]` so content doesn't collide with the iOS home bar / notch.
- **`<StickyActionBar>`** — a small component that pins a child bar to the bottom on mobile with safe-area padding, transparent on desktop. Used by forms with a primary CTA.
- **`useViewport()` hook** — returns `{ isMobile, isTablet, isDesktop }` by wrapping the existing `useIsMobile()` and adding a tablet breakpoint. Stays backward compatible: `useIsMobile()` continues to work.

**Why this goes first:** Plans 2–5 depend on these primitives.

### Plan 2 — Calendar mobile strategy + view router

**Touches:** `dashboard/src/pages/Calendar.tsx`, `dashboard/src/hooks/useCalendarViewMode.ts` (new), `dashboard/src/components/calendar/MonthDotsView.tsx` (new).

**What it adds:**
- **View mode resolver** — `useCalendarViewMode()` returns the effective view: on mobile, defaults to `day`; on desktop, reads user preference (localStorage) then falls back to `month`. Manual view toggle still available on both.
- **Mobile view set** — on phone, view switcher exposes **Day**, **3-Day**, **Month-dots**. Full `MonthView` and `WeekView` are desktop-only (they assume ≥7 visible columns).
- **`MonthDotsView`** — new phone-only component: 7-col grid, each day shows up to 3 colored dots (source-stable hash → palette, same rule as existing `CalendarPill`) plus a `+N` overflow count. Tap a day → swap to `DayView` for that date. Read-only (no drag, no inline create).
- **Swipe gesture** — native pointer events on `DayView` (and `3-Day` sub-view) for prev/next. Threshold: 60px horizontal with <30px vertical drift. No gesture library — handwritten, 30-40 LOC, lives in a dedicated `useHorizontalSwipe(ref, {onLeft, onRight})` hook.
- **View preference persistence** — already lives in localStorage; no change, just a new mobile-scoped key so mobile default doesn't clobber the desktop's remembered `month`.

**Why this matters:** Calendar is the biggest broken surface. These changes make it usable, not pretty — Plan 3 does the polish.

### Plan 3 — Calendar components responsive pass

**Touches:** `CalendarHeader.tsx`, `CalendarPill.tsx`, `DayView.tsx`, `DayOverflowPopover.tsx`, `CreateItemPopover.tsx`, `WeekView.tsx` (minor), `InlineTitleEdit.tsx`.

**What it adds:**
- **`CalendarHeader`** — collapses title + date picker + view toggle into a single compact row on mobile; title truncates with ellipsis; view toggle becomes a 3-segment pill (Day / 3-Day / Dots).
- **`CalendarPill`** — min-height 28px on mobile, no hover tooltip (tap opens detail sheet instead), vertical stacking on dense days, source color remains the left accent bar.
- **`DayView`** — full-width single column on mobile, larger hour rows (64px), floating "+ New item" FAB (56×56, bottom-right, safe-area-inset aware).
- **`DayOverflowPopover` & `CreateItemPopover`** — switch from Radix Popover to **Radix Dialog in full-screen-sheet mode** on mobile (`isMobile ? Dialog : Popover`). This gives a dismissable bottom sheet that doesn't clip against the viewport edge like a popover does at narrow widths.
- **`InlineTitleEdit`** — stays inline on desktop, promotes to the same bottom sheet on mobile when it would otherwise overlap.

### Plan 4 — Long-press → action sheet for reschedule

**Touches:** `CalendarPill.tsx`, `dashboard/src/components/calendar/PillActionSheet.tsx` (new), `dashboard/src/hooks/useLongPress.ts` (new), `dashboard/src/hooks/useCalendarMutations.ts` (existing — no change to the mutation layer, just a new caller).

**What it adds:**
- **Drop touch drag-and-drop entirely on mobile** — desktop retains drag; on mobile, `isMobile ? omit-draggable : draggable`. This avoids the scroll-hijack and fat-finger failure modes of touch-drag.
- **`useLongPress(handler, { ms: 500 })`** — pointer-events-based long-press detector with cancel-on-move (>8px drift). Lives as a general hook so other surfaces (`PendingActionableCard` etc.) can adopt it later.
- **`<PillActionSheet>`** — Radix Dialog in bottom-sheet style triggered by long-press. Actions: **Reschedule** (opens a date/time picker pre-set to the item's current slot) / **Edit title** (opens `InlineTitleEdit` in sheet mode) / **Delete** (confirm) / **Cancel**. Haptic feedback via `navigator.vibrate(10)` if the API is available — silent no-op if not.
- **Reschedule picker** — uses a native `<input type="datetime-local">` (simplest, accessible, zero JS dependency), then calls the existing `useCalendarMutations.reschedule(id, newDate)` — same mutation hook drag-and-drop uses, so backend contract and error handling are unchanged.

### Plan 5 — Daily-driver page polish

**Touches:** `dashboard/src/pages/Overview.tsx`, `dashboard/src/pages/PendingTasks.tsx`, `dashboard/src/pages/Drafts.tsx`, plus their per-page card components.

**What it adds:**
- **Overview** — 2-col metric grid collapses to 1-col on mobile; each tile grows tap area + larger icon; metric-tile text scales down one step on very narrow screens (<375px) to avoid wrap.
- **PendingTasks** — the `PendingActionableCard` already stacks reasonably (shipped in 45-03); this plan audits per-card horizontal crowding, makes the inline edit textarea full-width on mobile, ensures the 3-button row doesn't wrap at 320px.
- **Drafts** — same card pattern as PendingTasks; adds `<StickyActionBar>` for the "Send all" / "Regenerate" primary actions where applicable.

### Plan 6 — Live verification (autonomous: false)

**Touches:** no source files. Produces `.planning/phases/XX-dashboard-mobile-ui/XX-06-SUMMARY.md` with the walkthrough log.

**What it covers:**
- Manual pass against the live PM2 bot on a real phone (Tailscale URL from Yuval's device)
- Checklist: calendar swipe prev/next, month-dots tap-to-day, long-press pill → action sheet → reschedule, pending tasks approve/reject/edit on phone, iOS zoom-on-focus test on inputs, safe-area-inset verification on notched device
- Roadmap / STATE / REQUIREMENTS closeout

## Data flow

No backend changes. All changes are presentation-layer. The reschedule path on mobile still calls the existing `useCalendarMutations.reschedule()` mutation, which goes to the same Phase 44 PATCH route that desktop drag-and-drop uses. Calendar item fetch / SSE stream is untouched.

## Error handling

- Swipe gesture failure (e.g., gesture interpreted as scroll): caller falls back to the visible prev/next buttons in `CalendarHeader` — no error surfaced.
- Long-press accidentally fired during scroll: `useLongPress` cancels on >8px movement, so the sheet never opens from an ambiguous gesture.
- Reschedule mutation failure: action sheet closes, original mutation hook's existing error toast fires ("Couldn't reschedule — try again").
- `navigator.vibrate` missing: silent no-op via feature check.
- Safe-area insets unsupported (desktop / older browsers): `env()` falls back to 0 naturally.

## Testing

- **Unit (vitest):** `useViewport`, `useLongPress`, `useHorizontalSwipe`, `useCalendarViewMode` — each gets tests for happy path + edge cases (no touch API, rapid double-fire, viewport transition during render).
- **Component:** `MonthDotsView` renders correct dot counts and handles tap-to-day; `PillActionSheet` wires action callbacks.
- **Visual / manual:** live walkthrough in Plan 6 is the final gate.

## File inventory

**New files (11):**
- `dashboard/src/hooks/useViewport.ts`
- `dashboard/src/hooks/useLongPress.ts`
- `dashboard/src/hooks/useHorizontalSwipe.ts`
- `dashboard/src/hooks/useCalendarViewMode.ts`
- `dashboard/src/components/ui/StickyActionBar.tsx`
- `dashboard/src/components/calendar/MonthDotsView.tsx`
- `dashboard/src/components/calendar/PillActionSheet.tsx`
- `dashboard/src/hooks/__tests__/useViewport.test.ts`
- `dashboard/src/hooks/__tests__/useLongPress.test.ts`
- `dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts`
- `dashboard/src/hooks/__tests__/useCalendarViewMode.test.ts`

**Modified files (~16):**
- `dashboard/src/index.css` (safe-area utilities)
- `dashboard/src/components/ui/{button,input,textarea}.tsx` (3)
- `dashboard/src/components/layout/AppLayout.tsx`
- `dashboard/src/pages/{Calendar,Overview,PendingTasks,Drafts}.tsx` (4)
- `dashboard/src/components/calendar/{CalendarHeader,CalendarPill,DayView,DayOverflowPopover,CreateItemPopover,InlineTitleEdit,WeekView}.tsx` (7)

## Plan count estimate

**6 plans** (5 implementation + 1 verification). Plan 6 is autonomous:false and blocks phase close until Yuval approves the live walkthrough.

## Open questions (none blocking)

- Should `useIsMobile` eventually delegate to `useViewport` to reduce duplicate breakpoint logic? → yes, but as a follow-up cleanup commit after Plan 1 — not a gate.
- Tablet layout: will any daily driver look worse in tablet's 768–1024 gap? → Overview's 2-col grid may feel sparse; accept for now, revisit if Yuval reports it.

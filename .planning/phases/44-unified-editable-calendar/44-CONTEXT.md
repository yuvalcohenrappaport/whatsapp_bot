# Phase 44: Unified Editable Calendar (Tasks + Events + LinkedIn) - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning (decisions delegated to Claude per owner "you decide all")

<domain>
## Phase Boundary

A new `/calendar` dashboard route rendering an editable calendar view that overlays three source-of-truth data sets on one timeline:

1. **Approved actionables / Google Tasks** — rows from `actionables` WHERE `status IN ('approved', 'fired')` AND `todoTaskId IS NOT NULL`. Persist-edits go to Google Tasks via the existing tasks service.
2. **Personal events** — rows from the `personal_events` table (already shipped). Persist-edits go back to that table.
3. **LinkedIn scheduled posts** — queried from the pm-authority service via the existing `/api/linkedin/*` proxy. Persist-edits go to pm-authority's schedule API.

Calendar is both a viewing surface and an editing entry point. Week view is default per ROADMAP SC#7. Minimal mutations are supported (drag-reschedule, inline title edit, quick-create); the full edit dialog from each source's dedicated page is opened for anything beyond that, keeping the calendar page from becoming a parallel edit surface.

</domain>

<decisions>
## Implementation Decisions

### 1. Visual differentiation of the three sources

- **Color-coded left border stripe** on every pill (3px, matching the Phase 37 LinkedIn queue pattern):
  - Tasks: **emerald-500** (matches approved-actionables badge from Phase 43)
  - Events: **indigo-500** (calendar-classic)
  - LinkedIn posts: **violet-500** (matches Phase 37 purple/indigo pills)
- **Per-source leading icon** inside the pill (before title):
  - Task: checkmark-in-circle
  - Event: calendar
  - LinkedIn post: LinkedIn "in" mark
- **Per-item RTL/LTR mirroring by detected language** — same rule as Phase 43 `/pending-tasks`. Hebrew items render RTL end-to-end; English LTR. No blanket direction + language badge.
- **LinkedIn bilingual posts:** show the Hebrew title by default on the calendar pill. English available via hover-tooltip or click-through to full dialog. (Matches the "Build in Public" Hebrew-first publish cadence.)
- **Sidebar nav:** New top-level "Calendar" entry in the dashboard sidebar (not nested).
- **Route path:** `/calendar` (plain).

### 2. Time placement & view mechanics

- **All-day row at the top of each day** (week/day view) for untimed items — tasks that only have a due-date with no time drop here. Events with explicit all-day flag also go here.
- **Timed grid below** — events with start+end, LinkedIn posts at their scheduled slot.
- **LinkedIn posts** sit at their pm-authority-assigned timestamp (typically Tue/Wed/Thu 06:30 IDT, but trust the upstream field — don't hardcode).
- **Month view item shape:** compact one-line pill, full title with ellipsis truncation, 3px color stripe preserved, icon preserved.
- **Month view density cap:** max **3 items visible per day**, with `+N more` pill at the bottom of the cell. Clicking `+N more` opens a per-day popover listing all items for that day.
- **Default view:** **Week view** (per ROADMAP SC#7).
- **Default week composition:** full 7-day week, first day of week **Sunday** (Israeli convention).
- **Business-week toggle:** NOT included (deferred — see below).
- **"Today" button:** in the calendar header, next to view toggle. Jumps to today + scrolls to current time in week/day view.
- **Current-time indicator:** red horizontal line on today's column in week/day view (standard calendar UX).
- **Timezone:** IST locked end-to-end. Matches Phase 43 PendingTasks absolute-IST convention. Do NOT fall back to browser-local tz.
- **Navigation:** forward/back arrows for week/month/day; arbitrary navigation (no hard limit). Keyboard shortcuts `←` / `→` optional if cheap.

### 3. Drag-to-reschedule UX

- **Snap granularity:** **15-minute snap** in week/day view. Month view snaps to whole day (no time change).
- **Mid-drag feedback:** origin pill fades to 40% opacity; a ghost pill follows the pointer; the ghost displays the live target timestamp as inline caption (e.g. "Tue 2026-04-21 14:30").
- **Commit on drop:** **immediate optimistic persist**. Pill moves instantly, source-of-truth write fires in background. On error, roll back + red toast "Couldn't reschedule: {reason}".
- **Cross-view drag:** NOT supported in v1. Drag works only within the current view's grid.
- **Cross-day drag behavior (week/month):** item keeps its original time-of-day; only the date changes. If the item is untimed (task with no time), it stays untimed.
- **Undo:** 5-second toast `Moved "{title}". [Undo]` after every successful drop. Clicking Undo reverts the persist and the pill visually.
- **LinkedIn posts special-case:** pm-authority constrains posts to the Tue/Wed/Thu 06:30 slot cadence. Dragging a LinkedIn post to any other day snaps it to the **next valid upstream slot** with a brief "snap" animation and an inline caption like `Moved to next available slot: Thu 2026-04-23 06:30`. Dragging onto the same-day different time is a no-op (snap back to origin).
- **Drag-disabled items:** past-dated items (anything with scheduled time before `now`). Hovering shows cursor:not-allowed.

### 4. Create-from-empty-slot flow

- **Empty-slot click** → **inline popover** anchored to the clicked slot (NOT a full modal).
- **Popover contents (top to bottom):**
  1. Type chips: **Task / Event / LinkedIn post** — color-coded to match the item stripes. Default selection: **Task**.
  2. Title input, auto-focused.
  3. Start time pre-filled from the clicked slot, editable as `HH:mm` in IST.
  4. Duration field — smart default per type:
     - Task: no duration (untimed); set a due-time only
     - Event: 1 hour
     - LinkedIn post: locked to next available upstream slot, editable only to "none / next slot"
  5. Contact picker — shown ONLY for Task type (since tasks carry `sourceContactName`). Optional field; can be left blank.
  6. **"More options…"** link at bottom — opens the full existing dialog for the selected type (reusing Tasks / Events / LinkedInQueue dialogs), pre-filling everything the popover captured.
- **Commit:** Enter saves, Esc cancels. On save, popover closes; new pill appears in the slot with the **300ms amber arrival flash** (consistent with Phase 37 + Phase 43).
- **Validation:** title required. Same client-side rules as the full dialogs. Server-side errors surface as red inline text below the Save button.

### 5. Overflow, density & loading states

- **Month view overflow:** max 3 items visible per day → `+N more` pill at the bottom. Clicking opens a scrollable per-day popover listing every item for that day.
- **Week view overflow:** items in the same time slot stack horizontally side-by-side (narrow columns) up to 3; beyond 3 → a `+N` badge on the rightmost column that opens a same-day popover.
- **Day view:** vertical stack with full-detail cards, no truncation.
- **Empty day styling:** subtle — just the date number in muted color. Empty-slot click still opens the create popover.
- **Loading states:** per-source skeleton shimmer. **Each source loads independently** — events render as soon as events fetch completes, tasks when tasks fetch completes, etc. No waiting for slowest.
- **Partial failure** (one source errors, others succeed): compact warning banner at the top of the calendar: `⚠ Google Tasks unavailable [Retry]` (or whichever source failed). Other sources render normally. Banner auto-dismisses on next successful fetch of that source.
- **Complete failure** (all sources down): full-width error banner, skeleton grid behind, `Retry` button.
- **SSE disconnect:** "Reconnecting…" amber badge in the calendar header (mirror Phase 43 PendingTasks pattern).
- **Empty state** (no items in the visible range across all sources): neutral message `Nothing scheduled here. Click any slot to create.` — no celebratory illustration.

### Claude's Discretion (YOU DECIDE)

- **Calendar rendering library** — FullCalendar, react-big-calendar, custom CSS-grid, or extending an existing dashboard primitive. Pick based on: bundle-size impact, RTL-per-item support, drag + inline-edit + popover hooks, TypeScript types. Avoid pulling in a library heavier than necessary; dashboard bundle is currently ~792 kB.
- **Data-fetch topology** — one unified `/api/calendar/*` proxy endpoint that aggregates all three sources, vs three independent hooks (`useActionables`, `usePersonalEvents`, `useLinkedInPosts`) composed on the client. Make a call based on how much transform each source needs.
- **SSE channel** — extend the existing `/api/actionables/stream` from Phase 43 to also emit personal-events and linkedin-posts updates, vs open a new `/api/calendar/stream` channel that multiplexes, vs keep three separate streams. Pick whichever minimizes reconnect churn and Zod-schema duplication.
- **Drag library** — dnd-kit vs whatever the chosen calendar lib provides natively. If the lib handles it, use the lib.
- **Zod schema shape** — discriminated union on `source: 'task' | 'event' | 'linkedin'` is the obvious pattern; confirm it works with the render layer.
- **Inline title edit implementation** — single-click vs double-click to enter edit mode, blur-to-commit vs Enter-to-commit. Pick consistent with how other dashboard surfaces do it (e.g. the LinkedInQueue `EditPostDialog`).
- **Per-day popover for `+N more`** — reuse dashboard's existing popover primitive if one exists; otherwise lightweight Radix/headlessui popover.
- **Color palette tokens** — reuse existing Tailwind emerald/indigo/violet tokens; don't introduce new palette variables.

</decisions>

<specifics>
## Specific References

- **Phase 37 LinkedIn queue pattern (purple/indigo pills + 4px left stripes + 300ms amber arrival flash)** — match this visual language for calendar pills. Files: `dashboard/src/pages/LinkedInQueue.tsx`, `dashboard/src/hooks/useNewArrivalFlash.ts`.
- **Phase 43 PendingTasks pattern (per-row RTL mirroring, absolute IST timestamps, "Reconnecting…" SSE badge, read-only footer tip)** — calendar inherits the RTL rule and IST convention. Files: `dashboard/src/pages/PendingTasks.tsx`, `dashboard/src/hooks/useActionablesStream.ts`.
- **Existing edit dialogs** to reuse from "More options…":
  - Tasks: Tasks.tsx dialog (if one exists — confirm; may need to create a proper full-edit dialog before or during Phase 44)
  - Events: Events.tsx dialog
  - LinkedIn posts: `dashboard/src/components/linkedin/EditPostDialog.tsx` (Phase 36)
- **Data sources (current shape):**
  - `src/db/queries/actionables.ts` — `getApprovedActionablesWithDueDate()` or similar will likely need to be added to expose tasks-with-due-dates for the calendar source.
  - `src/db/queries/personalEvents.ts` (confirm name) — personal events already have start/end.
  - pm-authority HTTP `/v1/posts?status=APPROVED&has_scheduled_at` + whatsapp-bot `/api/linkedin/*` proxy — scheduled LinkedIn posts.
- **Timezone canonical format:** `YYYY-MM-DD HH:mm` in IST via `toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem' })` + regex (same helper as `dashboard/src/pages/PendingTasks.tsx` `formatIstAbsolute`).
- **Amber arrival flash:** 300ms, mirror the hook from Phase 43 (`useActionableArrivalFlash`) — a third sibling hook or a generalized `useCalendarItemArrivalFlash` is fine.

</specifics>

<deferred>
## Deferred Ideas (NOT in Phase 44)

- **Business-week toggle** (5-day Sun-Thu view) — can be added later as a header toggle.
- **Cross-view drag** (month → day within a single gesture) — v2 nice-to-have.
- **Google Calendar two-way sync** — a separate phase; Phase 44 only persists to our own source-of-truths.
- **iCal / .ics export** — deferred.
- **Recurring event *creation* from calendar** — the calendar *shows* recurring instances rendered by the event store, but creating a recurrence rule stays in the full Events dialog. Quick-create popover creates single-instance items only.
- **Keyboard-driven calendar navigation (j/k/h/l, g/t etc.)** — nice-to-have; skip v1 unless library gives it for free.
- **Attendee / invitee support on events** — personal_events is owner-only; no invitee model.
- **Calendar printing / PDF export** — not needed.
- **Time-blocking / focus mode** — not a calendar-design concern.
- **Multi-select + bulk reschedule** — v2.

</deferred>

---

## Scope Note: SC5 narrowing (added 2026-04-20 during plan revision)

ROADMAP SC5 reads: "Body-click opens the full edit dialog (existing Tasks/Events/LinkedIn dialogs) — calendar is an entry point, not parallel edit surface". At plan-revision time (Phase 44 plans 01-06 already written + committed), a cross-check of Tasks.tsx and Events.tsx showed NEITHER page has a full-edit dialog today (as of Phase 43). Only LinkedIn has one: `dashboard/src/components/linkedin/EditPostDialog.tsx` from Phase 36.

**Decision (needs owner sign-off at 44-06 walkthrough):** Plan 44-05 provides lightweight **calendar-local** dialogs for task + event body-clicks (inline shadcn `Dialog` with title + reschedule date picker for tasks; title + eventDate + location for events). LinkedIn body-click continues to use the existing EditPostDialog.

**Rationale:** Expanding Phase 44 scope to first build page-level dialogs on Tasks.tsx/Events.tsx — along with their own SCs and verification — would be a separate sub-phase. The calendar-local dialogs deliver the SC5 user-visible behavior (body-click opens a full editable surface for every source) without that detour.

**Alternative if owner rejects narrowing:** Open a follow-up phase before closing Phase 44: build full edit dialogs on Tasks.tsx + Events.tsx at page-level, then have the calendar delegate to those instead of its own local dialogs. This would push v1.8 closure.

Check 10 of the 44-06 owner walkthrough explicitly surfaces this question for sign-off.

---

*Phase: 44-unified-editable-calendar*
*Context gathered: 2026-04-20*
*Method: owner delegated all design decisions to Claude ("you decide all. i trust you with it")*
*Revision (2026-04-20): SC5 scope narrowing documented after checker warning surfaced the Tasks/Events dialog gap*

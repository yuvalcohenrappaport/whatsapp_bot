# Phase 46: Google Tasks Full-List Sync — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Every Google Tasks list the owner maintains (not just the one configured for bot-driven task sync) appears in the dashboard `/calendar` surface, with its own color stripe and a sidebar filter to toggle visibility per list. De-duplicate gtasks items against `actionables` rows that already mirror them.

The **unified sidebar filter surface** shipped here is the mechanism Phase 47 (gcal) will extend. Design decisions for the filter must accommodate a second source group in Phase 47 without rework.

</domain>

<decisions>
## Implementation Decisions

### Sidebar filter UX
- **Location:** Left rail panel inside `/calendar` page (not the AppSidebar). Collapsible on phone via a button in CalendarHeader (respects Phase 50's mobile-first pattern).
- **New-list default:** ON. Newly-discovered lists render immediately. Owner can hide after the fact. Matches the "every list I maintain" phase goal.
- **Filter scope:** ONE unified surface for ALL calendar sources — Google Tasks (expandable list), Google Calendar (Phase 47 will add a section here), Actionables, Personal Events, LinkedIn. Phase 47 does not create a second filter surface; it adds a section to this one.
- **Per-list metadata in the panel:**
  - Color swatch (solid dot or stripe matching the pill's source color)
  - Count of items in the current view window (re-counted on view or date change)
  - Last-synced timestamp (e.g., "Synced 2m ago"; source-level, not per-list, is acceptable if easier)
  - Rename + color override affordance (gear icon per list; opens an inline popover) — display-only, no writeback to Google Tasks

### Per-list color strategy
- **Assignment:** `hash(listId) → palette slot`. List ID is stable; renames don't shift color.
- **Palette:** Reuse the Phase 44 source-color palette used by `CalendarPill` — no new palette.
- **Override persistence:** `localStorage` only, per browser. Override keys scoped by `listId`. No backend table, no writeback to Google Tasks. Color + display-name override stored side-by-side.
- **Collisions:** Accept. Palette slots are shared across all sources (8ish slots). Owner can use the color override to break specific collisions. No collision-avoiding assignment algorithm.

### Dedup edge cases (against `actionables` via `todoTaskId`)
- **Live actionable (`approved`) with matching `todoTaskId`:** Actionable row renders, gtasks payload drops the duplicate. (SC#5 as written.)
- **Rejected / expired actionable with matching `todoTaskId`:** Gtasks row renders. (Rejected/expired actionables never pushed to Google Tasks — the matching gtasks item came from somewhere else, e.g., manual Google Tasks UI creation. Let it render.) In practice this case requires an actionable that was approved-then-rejected or similar — should be rare, but handle it deterministically.
- **Enriched title ≠ gtasks title:** Actionable version wins silently. No badge, no dual display. Gtasks payload for the deduped item is dropped entirely.
- **Completed gtasks (`status='completed'`):** Hidden from calendar entirely. No crossed-out rendering, no grace period. Completed = done.
- **Undated gtasks (no `due` field):** Skipped. Calendar is a time-based surface; undated items belong in the Google Tasks UI. No "undated" counter in the sidebar for this phase.

### Gtasks pill behavior (mutable, not read-only)
- **Drag-to-reschedule:** Mutable. New proxy route `/api/google-tasks/items/:taskId/reschedule?listId=<listId>` (listId required because Google Tasks API is list-scoped). Calls `PATCH /tasks/v1/lists/{listId}/tasks/{taskId}` with a new `due` field.
- **Inline title edit:** Mutable. Same route family, or dedicated `/edit` sibling.
- **Delete:** Mutable. `DELETE /api/google-tasks/items/:taskId?listId=<listId>` → `DELETE /tasks/v1/lists/{listId}/tasks/{taskId}`. Soft undo via the existing Phase 44 undo toast.
- **Long-press action sheet (Phase 50 `PillActionSheet`):** Attaches to gtasks pills. Actions: Reschedule, Edit title, **Complete (mark done)**, Delete. "Complete" is gtasks-specific — flips `status=needsAction → completed` via PATCH; pill disappears per the Hidden-completed rule above.
- **Mirrored-item edit ownership:** If the gtasks pill has a matching actionable (live or otherwise), edits route through the actionable layer — reuse the Phase 45 `approvalHandler` edit path so the actionable row rewrites, then the existing mirror/sync logic re-pushes to Google Tasks. Keeps actionable + gtasks titles consistent. For items with **no** actionable, edits write directly to Google Tasks via the proxy route.

### Source-of-truth contract
- **CalendarItem shape (gtasks):** `{ id: gtasks taskId, source: 'gtasks', listId, title, due (ms since epoch), color (from hash+override), sourceColor, listName, raw: { etag, updated } }` — etag/updated retained for future optimistic-concurrency checks, not consumed this phase.
- **API contract:**
  - `GET /api/google-tasks/lists` → `{ lists: [{ id, name, etag, updated }] }`
  - `GET /api/google-tasks/items?from=<ms>&to=<ms>` → `{ items: CalendarItem[] }` — server-side handles per-list iteration + window filter + dedup-against-actionables
  - Aggregator (`/api/calendar/items`, Phase 44) pulls from this and merges with other sources; per-source failure isolation via try/catch per source.
- **SSE updates (Phase 44 stream):** gtasks source contributes events when items change; polling cadence TBD by research (Google Tasks API supports ETags but not webhooks for consumer accounts).

### Claude's Discretion
- Exact palette slot count (8/10/12) if research finds reuse-friction with Phase 44's palette
- Polling cadence for gtasks (vs actionables) in the aggregator
- Whether the filter panel uses a Radix Accordion, a plain collapsible section, or a tree component — as long as it's extensible for Phase 47
- localStorage key naming scheme for override prefs (but: must be forward-compatible with Phase 47 gcal overrides under the same prefix)
- Whether `last-synced` timestamp shows per-source or per-list (per-source is fine)
- Exact behavior of the gear-icon override popover (component choice, dismissal, keyboard handling)

</decisions>

<specifics>
## Specific Ideas

- The filter panel is one surface — Phase 47 must land an added section there, not create a new panel.
- Mobile behavior: the left-rail panel collapses into a drawer opened from the CalendarHeader filter button. Reuse the Phase 50 bottom-sheet Dialog pattern on phone if the drawer pattern doesn't fit.
- "Complete" as a dedicated long-press action is a gtasks-only affordance — actionables / events / linkedin pills don't get it.
- Google Tasks list ID > list name for color hashing — rename must not reshuffle colors.
- Dedup is enforced SERVER-SIDE in the gtasks aggregator, not client-side — the client should never receive both the actionable row and the gtasks row for the same todoTaskId.

</specifics>

<deferred>
## Deferred Ideas

- **Rename / color override writeback to Google Tasks API** — Google Tasks API doesn't expose list color publicly; even if it did, localStorage-only is sufficient for now. Revisit if multi-device parity becomes an issue.
- **Per-list sync freshness** (last-synced per list vs per-source) — can be tightened in a v2.0 polish phase if the per-source timestamp turns out to be insufficient.
- **Undated gtasks surfacing** ("N undated" counter in sidebar or a dedicated backlog section) — Phase 51+ polish.
- **Collision-avoiding color assignment** (deterministic least-used-slot picker) — revisit only if collision complaints surface.
- **"Show both titles" for drift cases** — deferred; silent actionable-wins is the phase behavior.
- **Grace-period for completed items** (crossed-out until EOD) — deferred; strict-hide for now.
- **Dual-write rescheduling that also updates the actionable row** — deferred; edit-path routing through actionables handles the mutation unity for mirrored items; drag-reschedule on mirrored items will need its own decision, expected to follow the same actionable-first rule.
- **Undo re-create for gtasks delete** — when a gtasks pill is deleted via the trash icon, the Phase 44 undo toast fires but cannot re-create the item (no POST /api/google-tasks/items endpoint). Re-create endpoint and true undo are deferred; the undo toast shows a warning "Undo not available for Google Tasks items" instead of attempting a network call.

</deferred>

---

*Phase: 46-google-tasks-full-list-sync*
*Context gathered: 2026-04-20*

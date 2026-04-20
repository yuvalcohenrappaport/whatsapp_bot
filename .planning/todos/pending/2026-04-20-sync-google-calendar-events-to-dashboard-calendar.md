---
created: 2026-04-20T16:05:00.000Z
title: Sync Google Calendar events into dashboard calendar (not just bot-detected ones)
area: ui
files:
  - src/calendar/personalCalendarService.ts
  - src/api/routes/calendar.ts
  - dashboard/src/api/calendarSchemas.ts
  - dashboard/src/hooks/useCalendarStream.ts
  - dashboard/src/pages/Calendar.tsx
  - dashboard/src/components/calendar/CalendarPill.tsx
---

## Problem

Today the dashboard calendar surfaces `event` rows only for `personal_pending_events` — events the bot detected from WhatsApp chats. But the owner's Google Calendar has many manually-added events (work meetings, personal appointments) that never flowed through the bot. Those are invisible on the dashboard calendar.

User ask: pull events from **all** of the owner's Google Calendars, render them on the unified calendar with their own color/source variant, and de-dup against `personal_pending_events` so bot-created + manually-added events don't double-show.

## Solution

TBD. Likely:

1. **Backend**
   - Extend `personalCalendarService.ts` with `listCalendars()` (calendar.calendarList.list) and `listEvents(calendarId, from, to)` — covering all calendars the owner has read access to.
   - New endpoint `GET /api/google-calendar/events?from=<ms>&to=<ms>` returns `CalendarItem[]` with `source: 'gcal'` and `sourceFields: { calendarId, calendarName, colorId }`.
   - De-dup: if a gcal event's `id` matches a row in `personal_pending_events.calendar_event_id`, drop it from the gcal payload — prefer the bot-owned row (richer metadata, editable through the bot's pipeline).
   - Merge gcal into `/api/calendar/items` aggregator and into the SSE hash.

2. **Frontend**
   - New source variant `gcal` on CalendarItem discriminated union. Color per calendar (Google's colorId palette or a hash-to-palette if colorId absent).
   - Calendar pill stripe + icon for gcal (candidates: CalendarDays Lucide icon, sky-500 stripe).
   - Same sidebar filter mechanism as the Google Tasks feature — per-source checkbox with color swatch, persisted to localStorage.
   - Read-only in v1.9 — drag/inline-edit/delete DISABLED for gcal pills. Editing Google Calendar events directly from the dashboard would require round-tripping writes to the Google API with optimistic-retry semantics; defer to a later milestone.

3. **Open questions to settle at plan time**
   - Which calendars to include — all subscribed, or only calendars the owner owns? (Default: only calendars with `accessRole: 'owner' | 'writer'`.)
   - All-day events — these have `start.date` not `start.dateTime`; need isAllDay handling.
   - Recurring events — `tasks.events.list` with `singleEvents: true` expands instances. Use that to avoid rendering base recurrence rows.
   - De-dup collision: a `personal_pending_events` row with `status != 'approved'` may not yet have a `calendar_event_id`. De-dup MUST handle `calendarEventId IS NULL` rows gracefully (no false positives).

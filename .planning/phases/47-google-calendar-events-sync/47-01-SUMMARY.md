---
phase: 47-google-calendar-events-sync
plan: "01"
subsystem: dashboard-calendar
tags:
  - google-calendar
  - dashboard
  - backend
  - read-only-sync
requires:
  - personalCalendarService.getOAuth2Client (existing)
  - personal_pending_events table (existing)
provides:
  - listOwnerCalendars + listEventsInWindow helpers
  - GET /api/google-calendar/calendars
  - GET /api/google-calendar/events
  - fetchGcalCalendarItems (for Plan 47-02 aggregator)
  - getLinkedCalendarEventIds dedup query
affects:
  - src/api/routes/calendar.ts (CalendarSource type extended)
  - src/api/server.ts (route registration)
tech-stack:
  added:
    - "(none — reuses existing googleapis + google-auth-library)"
  patterns:
    - "Reuse personalCalendarService.getOAuth2Client() — scope auth/calendar is a superset of calendar.readonly, no re-consent needed"
    - "Promise.allSettled for per-calendar isolation"
    - "singleEvents: true for recurring expansion (GCAL-02)"
    - "End-exclusive → inclusive mapping for all-day events (-1 ms)"
    - "djb2 hash for stable per-calendar color classes"
    - "Graceful degradation: gcal_unavailable code on service errors"
key-files:
  created:
    - src/calendar/gcalService.ts
    - src/api/routes/googleCalendar.ts
    - src/api/__tests__/googleCalendar.test.ts
  modified:
    - src/db/queries/personalPendingEvents.ts
    - src/api/routes/calendar.ts
    - src/api/server.ts
decisions:
  - "Register googleCalendarRoutes after linkedinRoutes (Phase 46 googleTasksRoutes not yet implemented — plan assumed it would be, so we slotted in the last-route position)"
  - "Copy parseWindow inline in googleCalendar.ts (matches Plan 46-01's pattern of keeping the routes file self-contained)"
  - "Hebrew detection via literal char-class /[֐-׿]/ (matches plan-provided regex; covers U+0590–U+05FF)"
metrics:
  duration: 3m57s
  tasks: 2
  files-changed: 6
  tests: 10
  completed: 2026-04-20
requirements:
  - GCAL-01
  - GCAL-02
  - GCAL-05
---

# Phase 47 Plan 01: Google Calendar Read Layer Summary

Read-only Google Calendar integration: service helper (`listOwnerCalendars` + `listEventsInWindow` with singleEvents recurrence expansion and all-day end-exclusive → inclusive mapping) plus two JWT-gated Fastify routes (`/api/google-calendar/calendars`, `/api/google-calendar/events`) with server-side dedup against approved `personal_pending_events.calendar_event_id` — ships GCAL-01, GCAL-02, GCAL-05.

## What Was Built

### 1. `src/calendar/gcalService.ts` (new)

- `listOwnerCalendars()` — enumerates every calendar the owner has access to and filters to `accessRole` in `owner`/`writer`. Returns `GcalCalendarMeta[]` with id, name, accessRole, colorId, primary flag, and a stable derived color class.
- `listEventsInWindow(fromMs, toMs)` — fetches events across all owned/writable calendars within the window:
  - Expands recurring events via `singleEvents: true` (GCAL-02)
  - Parses all-day `start.date`/`end.date` as midnight `+03:00` (Asia/Jerusalem) and subtracts 1 ms from the end so Google's exclusive end does not bleed into the next day
  - Uses `Promise.allSettled` so one bad calendar does not abort the full fetch
  - Paginates via `nextPageToken`
  - Window-clips events whose recurring span crosses the boundary
- `hashCalendarColor(calendarId)` — djb2 over the calendar id; palette of 8 tailwind bg classes. Stable across renames because Google's calendar id is stable.
- Reuses the existing OAuth2 client — scope `auth/calendar` is a superset of `calendar.readonly`, so no re-consent is needed.

### 2. `src/db/queries/personalPendingEvents.ts` (extended)

- Added `getLinkedCalendarEventIds(fromMs, toMs): Set<string>` — returns the set of Google Calendar event ids linked to approved personal events in the window. Used by the route to drop duplicates (the bot-owned row wins since it is richer + editable).
- Added `isNotNull` to the drizzle-orm imports.

### 3. `src/api/routes/googleCalendar.ts` (new)

Two JWT-gated Fastify routes:

- `GET /api/google-calendar/calendars` — returns `{ calendars: GcalCalendarMeta[] }`. On error: 503 + `{ error: 'gcal_unavailable' }`.
- `GET /api/google-calendar/events?from=<ms>&to=<ms>` — returns `{ items: CalendarItem[] }` with `source: 'gcal'`. On error: graceful 200 + `{ items: [], error: 'gcal_unavailable' }` so the aggregator's partial-failure logic stays uniform across sources.

Exported `fetchGcalCalendarItems(fromMs, toMs)` helper for the Plan 47-02 unified aggregator to call directly (no HTTP hop).

Projection sets `sourceFields.readOnly = true` (GCAL-06) plus `calendarId`, `calendarName`, `colorId`, `color`, `sourceColor`, `htmlLink`, `etag`. Hebrew title → `language: 'he'`.

### 4. `src/api/routes/calendar.ts` (extended)

- `CalendarSource` union extended: `'task' | 'event' | 'linkedin' | 'gtasks' | 'gcal'`. Plan 47-02 will extend `CalendarEnvelope.sources` and the aggregator; this is the prerequisite type change so `projectGcalItem` compiles against the shared `CalendarItem` type.

### 5. `src/api/server.ts` (extended)

- Registers `googleCalendarRoutes` after `linkedinRoutes`.

### 6. `src/api/__tests__/googleCalendar.test.ts` (new, 10 cases)

1. `/calendars` without JWT → 401
2. `/calendars` with JWT → 200 + `{ calendars }` with owner/writer filter
3. `/calendars` — 503 + `gcal_unavailable` when `listOwnerCalendars` throws
4. `/events` without JWT → 401
5. `/events` with JWT → items mapped with `source='gcal'`
6. `/events` — dedup drops events whose id is in `getLinkedCalendarEventIds` set
7. `/events` — all-day: `isAllDay=true`, end preserved from service (-1 ms already applied)
8. `/events` — Hebrew title → `language='he'`
9. `/events` — `sourceFields` carries `calendarId`, `calendarName`, `colorId`, `color`, `sourceColor`, `readOnly=true`, `htmlLink`
10. `/events` — graceful: 200 + `{ items: [], error: 'gcal_unavailable' }` when `listEventsInWindow` throws

Config mock avoids the real Zod env pipeline under `NODE_ENV=test`; `fastify.authenticate` and `fastify.jwt.verify` are decorated in-test (same pattern as `calendar.test.ts`).

## Verification

- `NODE_ENV=development npx vitest run src/api/__tests__/googleCalendar.test.ts` — **10/10 pass** (Node 22 via nvm)
- `npx tsc --noEmit` — **zero new errors** (only pre-existing `cli/**/*.ts` rootDir errors from unrelated untracked files — logged to deferred-items.md)
- `grep -n "googleCalendarRoutes" src/api/server.ts` — confirms import + register
- `grep -n "listOwnerCalendars|listEventsInWindow|GcalCalendarItem" src/calendar/gcalService.ts` — confirms exports
- `grep -n "getLinkedCalendarEventIds" src/db/queries/personalPendingEvents.ts` — confirms export
- `grep -n "'gcal'" src/api/routes/calendar.ts` — confirms type extension

## Commits

| Task | Commit  | Message                                                              |
| ---- | ------- | -------------------------------------------------------------------- |
| 1    | 119eb4c | feat(47-01): add gcalService + dedup query helper                    |
| 2    | 36a511b | feat(47-01): add /api/google-calendar/\* routes + vitest suite       |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Node 18 → Node 22 for vitest**

- **Found during:** Task 2 verification
- **Issue:** System `/usr/bin/node` is v18.19.1 but vitest 4 (via rolldown) imports `styleText` from `node:util` which is a Node 22 addition. Running `npx vitest` failed with `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`.
- **Fix:** Activated Node 22 via nvm (`nvm use 22`) — no project change needed. Noted that the project's existing `.planning` docs already flag Node 20 pinning on the server (Node 20 also lacks `styleText`, so deployment likely runs under `nvm use 22` or an upgraded Node). This is a tooling-env issue, not a plan scope issue.
- **Files modified:** (none)
- **Commit:** (none — env activation only)

**2. [Rule 3 - Blocking] Route registration position**

- **Found during:** Task 2
- **Issue:** Plan says to register `googleCalendarRoutes` "after `googleTasksRoutes` which Plan 46-01 added" — but Phase 46 is not yet implemented in this project (no `googleTasks.ts` route exists).
- **Fix:** Registered after `linkedinRoutes` (currently the last route in `server.ts`). Equivalent effect: last-registered non-static route. Phase 46 can slot in before this one later without conflict.
- **Files modified:** `src/api/server.ts`
- **Commit:** 36a511b

### Pre-existing Issues (out of scope — not fixed)

**Pre-existing `cli/**/*.ts` rootDir errors**

- `cli/bot.ts` and `cli/commands/persona.ts` are untracked in git (not part of this plan's scope) and trigger `TS6059: File is not under 'rootDir'` errors. These are orthogonal to Phase 47 and are already present on the branch tip before any Plan 47-01 work.
- Logged in `.planning/phases/47-google-calendar-events-sync/deferred-items.md`.

## Authentication Gates

None encountered. The plan explicitly noted that the existing OAuth `auth/calendar` scope is a superset of `calendar.readonly`, so no OAuth re-consent is needed — tests pass without hitting any real Google endpoint.

## Self-Check: PASSED

- `src/calendar/gcalService.ts` — FOUND
- `src/api/routes/googleCalendar.ts` — FOUND
- `src/api/__tests__/googleCalendar.test.ts` — FOUND
- Commit `119eb4c` — FOUND
- Commit `36a511b` — FOUND
- 10/10 vitest green
- tsc clean (excluding pre-existing cli/ issues)

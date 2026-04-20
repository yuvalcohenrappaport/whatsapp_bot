---
phase: 44-unified-editable-calendar
plan: "02"
subsystem: backend-mutations
tags: [api, google-tasks, google-calendar, vitest, drizzle, sqlite]
dependency-graph:
  requires: []
  provides:
    - "PATCH /api/actionables/:id"
    - "POST /api/actionables"
    - "PATCH /api/personal-calendar/events/:id"
    - "POST /api/personal-calendar/events"
    - updateTodoTask helper
    - updatePersonalCalendarEvent helper
    - calendar_event_id column on personal_pending_events
  affects:
    - Plan 44-03 (unified calendar proxy write path routes here for task/event pills)
    - Plan 44-04/05 (dashboard calendar can now call these mutation endpoints)
tech-stack:
  added: []
  patterns:
    - "Best-effort Google API mirroring (local write first, upstream fire-and-forget)"
    - "JWT-gated PATCH/POST Fastify routes with inline runtime body validation"
    - "vitest with vi.mock for external service isolation"
key-files:
  created:
    - path: src/api/__tests__/calendarMutations.test.ts
      description: 10-case vitest suite for all 4 new routes
    - path: drizzle/0020_add_calendar_event_id_to_personal_events.sql
      description: Migration adding calendar_event_id TEXT column
  modified:
    - path: src/db/queries/actionables.ts
      description: Added updateActionableFireAt + createApprovedActionable
    - path: src/db/queries/personalPendingEvents.ts
      description: Added updatePersonalPendingEventFields + linkCalendarEventId + insertApprovedPersonalEvent
    - path: src/db/schema.ts
      description: Added calendarEventId text column to personalPendingEvents table
    - path: src/todo/todoService.ts
      description: Added updateTodoTask (best-effort Tasks API patch)
    - path: src/calendar/personalCalendarService.ts
      description: Added updatePersonalCalendarEvent (best-effort Calendar API patch)
    - path: src/api/routes/actionables.ts
      description: Added PATCH /api/actionables/:id + POST /api/actionables routes
    - path: src/api/routes/personalCalendar.ts
      description: Added PATCH /api/personal-calendar/events/:id + POST /api/personal-calendar/events; approve handler now persists calendarEventId
decisions:
  - "Used raw sqlite3 ALTER TABLE for migration (no drizzle-kit push in package.json scripts)"
  - "linkCalendarEventId added as dedicated function (cleaner than extending updatePersonalPendingEventFields)"
  - "updatePersonalPendingEventFields accepts calendarEventId in patch shape for completeness"
  - "Best-effort pattern: local DB write always succeeds; Google API failures logged-and-swallowed, never 500"
  - "POST /api/personal-calendar/events inserts local row first, then creates Google Calendar event (calendarEventId linked on success)"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-20"
  tasks: 2
  files: 8
---

# Phase 44 Plan 02: Calendar Mutation Backend Summary

Two-source mutation surface for tasks and personal events: 4 new JWT-gated Fastify routes (PATCH+POST for actionables, PATCH+POST for personal events) wired to Google Tasks and Google Calendar via best-effort mirror helpers, backed by 10 passing vitest cases.

## Commits

| Hash | Message |
|------|---------|
| 69cde7a | feat(44-02): add query helpers and Google service update helpers |
| 8f2ba21 | feat(44-02): PATCH + POST actionables + personal-calendar/events routes |
| 85e1731 | test(44-02): vitest for new calendar mutation routes |

## vitest Results

10/10 green — `npx vitest run src/api/__tests__/calendarMutations.test.ts`

```
Test Files  1 passed (1)
     Tests  10 passed (10)
  Duration  524ms
```

## Migration Proof

Migration applied via:
```
sqlite3 data/bot.db "ALTER TABLE personal_pending_events ADD COLUMN calendar_event_id TEXT;"
```

Schema verification:
```
sqlite3 data/bot.db ".schema personal_pending_events" | grep calendar_event_id
# → , content_hash TEXT, is_all_day INTEGER NOT NULL DEFAULT 0, calendar_event_id TEXT)
```

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written, with the following minor clarifications:

1. **calendarEventId in updatePersonalPendingEventFields**: The plan called for `linkCalendarEventId` as a dedicated function (which was implemented) AND the patch function was extended to also accept `calendarEventId` for completeness — allows future callers to set it via the general updater if needed.

2. **updateTodoTask implementation**: The existing `todoService.ts` uses `getOAuth2Client()` + `google.tasks()` pattern (not a `getGoogleAuth()` helper as the plan template showed). The implementation mirrors the actual codebase pattern: `getTasksClient()` which internally calls `getOAuth2Client()`.

3. **updatePersonalCalendarEvent implementation**: Uses the module-level `calendarClient` variable (already initialized) rather than constructing a new `google.calendar()` instance, consistent with the existing service's pattern.

## Hand-off Note for Plan 44-03

The backend write paths for task + event pills are live:
- `PATCH /api/actionables/:id` — drag-reschedule (fireAt) + inline title edit (task) for task pills
- `POST /api/actionables` — create-from-empty-slot for task type
- `PATCH /api/personal-calendar/events/:id` — drag-reschedule (eventDate) + inline title edit for event pills
- `POST /api/personal-calendar/events` — create-from-empty-slot for event type

The unified calendar proxy (Plan 44-03) should route task/event pill writes to these endpoints. LinkedIn pill writes continue to route to `/api/linkedin/*` (Plan 44-01).

## Self-Check: PASSED

All 8 files exist on disk. All 3 commits found in git log.

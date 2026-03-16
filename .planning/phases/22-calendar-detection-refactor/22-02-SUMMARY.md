---
phase: 22-calendar-detection-refactor
plan: 02
subsystem: calendar
tags: [oauth2, personal-calendar, api, infrastructure]
dependency_graph:
  requires: []
  provides: [personalCalendarService, personalPendingEvents-table, personal-calendar-api]
  affects: [src/index.ts, src/api/server.ts, src/config.ts]
tech_stack:
  added: []
  patterns: [oauth2-flow, settings-based-token-storage, graceful-degradation]
key_files:
  created:
    - src/calendar/personalCalendarService.ts
    - src/db/queries/personalPendingEvents.ts
    - src/api/routes/personalCalendar.ts
    - drizzle/0013_personal_pending_events.sql
  modified:
    - src/config.ts
    - src/db/schema.ts
    - src/index.ts
    - src/api/server.ts
    - drizzle/meta/_journal.json
decisions:
  - Stored OAuth refresh token in settings table (same pattern as other config)
  - Manual migration file instead of drizzle-kit generate (interactive prompt conflict with existing schema changes)
  - Auth callback route unauthenticated since Google redirects to it directly
metrics:
  duration: 4m
  completed: 2026-03-16
requirements:
  - CAL-05
---

# Phase 22 Plan 02: Personal Calendar OAuth Infrastructure Summary

OAuth2-based personal Google Calendar service with settings-stored refresh tokens, pending events table (no TTL per locked decision), and 8 API routes for auth flow + event management.

## What Was Built

### personalCalendarService.ts
- OAuth2Client initialization from env vars with graceful degradation
- Token refresh listener that auto-persists new refresh tokens
- Full lifecycle: consent URL generation, callback code exchange, event creation
- Auth error handling: clears stored token on 401/invalid_grant
- Calendar listing for user selection, selected calendar stored in settings

### personal_pending_events table
- Stores detected events pending user approval
- Fields: source chat/sender info, event details (title, date, location, description, url), status (pending/approved/rejected), notification message ID
- Indexes on status and notification_msg_id for query performance
- No TTL column (locked architecture decision)

### API Routes (8 endpoints)
1. `GET /api/auth/google` -- OAuth consent URL (503 if not configured)
2. `GET /api/auth/google/callback` -- Google redirect handler (no JWT)
3. `GET /api/personal-calendar/status` -- connected/configured/calendarId
4. `GET /api/personal-calendar/calendars` -- list user calendars
5. `POST /api/personal-calendar/select` -- pick target calendar
6. `GET /api/personal-calendar/pending` -- list pending events
7. `POST /api/personal-calendar/pending/:id/approve` -- approve + create event
8. `POST /api/personal-calendar/pending/:id/reject` -- reject event

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Manual migration instead of drizzle-kit generate**
- **Found during:** Task 1
- **Issue:** `npx drizzle-kit generate` entered interactive mode asking about existing schema changes (travel_bot_active column rename), blocking execution
- **Fix:** Wrote migration SQL manually following existing pattern, updated journal entry
- **Files modified:** drizzle/0013_personal_pending_events.sql, drizzle/meta/_journal.json

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Personal calendar DB table and service module | f9a117b | personalCalendarService.ts, schema.ts, personalPendingEvents.ts, config.ts |
| 2 | Personal calendar API routes | 93206da | personalCalendar.ts, server.ts |

## Self-Check: PASSED

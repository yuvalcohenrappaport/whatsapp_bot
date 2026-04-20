---
phase: 44-unified-editable-calendar
plan: "03"
subsystem: api
tags: [calendar, sse, fastify, drizzle, sqlite, vitest, linkedin, pm-authority]

requires:
  - phase: 44-01
    provides: callUpstream, PostSchema, pm-authority /v1/posts?status=APPROVED, mapUpstreamErrorToReply
  - phase: 44-02
    provides: getCalendarActionables (query layer), getApprovedEventsBetween (query layer)

provides:
  - "GET /api/calendar/items — unified CalendarEnvelope (tasks+events+linkedin) with partial-failure handling"
  - "GET /api/calendar/stream — SSE channel emitting calendar.updated every 3s on hash change"
  - "GET /api/actionables/with-due-dates — per-source window-scoped task CalendarItems"
  - "GET /api/personal-calendar/events/window — per-source window-scoped event CalendarItems"
  - "GET /api/linkedin/posts/scheduled — per-source window-scoped linkedin CalendarItems"
  - "CalendarItem discriminated union type (source: task|event|linkedin)"
  - "CalendarEnvelope type with per-source status tracking"
  - "hashCalendarEnvelope helper for SSE change-detection"
  - "getCalendarActionables(fromMs, toMs) in src/db/queries/actionables.ts"
  - "getApprovedEventsBetween(fromMs, toMs) in src/db/queries/personalPendingEvents.ts"

affects:
  - 44-04-dashboard-calendar-ui
  - 44-05-calendar-interactions
  - 44-06-integration-verification

tech-stack:
  added: []
  patterns:
    - "Promise.allSettled for partial-failure aggregation across three data sources"
    - "Shared parseWindow() helper enforcing 7d-back/60d-forward defaults + 120d max span on all routes"
    - "Per-source projection helpers (projectTasks, projectEvents, projectLinkedin) reused by both unified + per-source routes"
    - "SSE pattern: hash-poll + heartbeat loop (mirrors /api/actionables/stream from Plan 43-01)"
    - "/api/personal-calendar/events/window sub-path used because base path occupied by status-filtered list"

key-files:
  created:
    - path: src/api/routes/calendar.ts
      description: "Fastify plugin with 5 routes: unified REST+SSE + 3 per-source window-scoped GETs (336 lines)"
    - path: src/api/__tests__/calendar.test.ts
      description: "15-case vitest suite covering auth-gating, window clamping, partial failure, per-source routes, hash stability"
  modified:
    - path: src/db/queries/actionables.ts
      description: "Added getCalendarActionables(fromMs, toMs) + isNotNull/gte/lte imports"
    - path: src/db/queries/personalPendingEvents.ts
      description: "Added getApprovedEventsBetween(fromMs, toMs)"
    - path: src/api/server.ts
      description: "Registered calendarRoutes after actionablesRoutes"

key-decisions:
  - "Option A hybrid: /api/calendar/items aggregator for SSE (hash-able unified payload); three per-source GETs for dashboard initial-load to render each source on its own timeline (no waiting for slowest)"
  - "Per-source personal events route registered as /api/personal-calendar/events/window — base path /api/personal-calendar/events already occupied by status-filtered list endpoint in personalCalendar.ts route 6"
  - "LinkedIn 'scheduled_at' filter applied in projectLinkedin() — posts fetched with ?status=APPROVED from pm-authority may include posts outside the window; we filter by scheduled_at in the window clamp range"
  - "image_urn mapped from p.image?.url (not a bare URN) — pm-authority PostDTO has image.url, not image_urn directly"

requirements-completed: [SC1, SC6]

duration: ~15min
completed: 2026-04-20
---

# Phase 44 Plan 03: Unified Calendar Read + SSE Surface Summary

**Five-route Fastify calendar plugin with unified REST+SSE aggregator and three per-source window-scoped endpoints, backed by Promise.allSettled partial-failure handling and 15/15 vitest green**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-20T10:03:00Z
- **Completed:** 2026-04-20T10:28:53Z
- **Tasks:** 2
- **Files modified:** 5 (+ 2 created)

## Accomplishments

- Two new query-layer helpers: `getCalendarActionables(fromMs, toMs)` and `getApprovedEventsBetween(fromMs, toMs)` in existing query files
- `src/api/routes/calendar.ts` (336 lines) registers 5 routes: unified REST `/api/calendar/items`, SSE `/api/calendar/stream`, and three per-source GETs (`/api/actionables/with-due-dates`, `/api/personal-calendar/events/window`, `/api/linkedin/posts/scheduled`)
- Aggregator uses `Promise.allSettled` — LinkedIn failure leaves tasks+events intact with `sources.linkedin='error'`
- `hashCalendarEnvelope()` exported for SSE change-detection; mirrors `/api/actionables/stream` hash-poll pattern exactly
- 15/15 vitest green covering auth-gating, window clamp, partial failure envelope, per-source endpoints, hash stability

## Task Commits

1. **feat(db): add calendar window queries** — `6130ee0`
2. **feat(api): GET /api/calendar/items + /api/calendar/stream plugin** — `4424eaf`
3. **feat(api): register calendarRoutes in server.ts** — `d44de71`
4. **test(api): calendar plugin vitest coverage** — `26260cf`

## Files Created/Modified

- `src/db/queries/actionables.ts` — Added `getCalendarActionables` + drizzle `isNotNull/gte/lte` imports
- `src/db/queries/personalPendingEvents.ts` — Added `getApprovedEventsBetween`
- `src/api/routes/calendar.ts` (336 lines, **created**) — Full calendar plugin
- `src/api/server.ts` — Registered `calendarRoutes` after `actionablesRoutes`
- `src/api/__tests__/calendar.test.ts` (415 lines, **created**) — 15-case vitest suite

## vitest Results

15/15 green — `npx vitest run src/api/__tests__/calendar.test.ts`

```
Test Files  1 passed (1)
     Tests  15 passed (15)
  Duration  473ms
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Per-source events route registered as `/window` sub-path**
- **Found during:** Task 1 (checking existing routes)
- **Issue:** Plan noted "If the existing list route already occupies that path with different semantics, register as `/api/personal-calendar/events/window` instead". Confirmed: `personalCalendar.ts` route 6 already registers `GET /api/personal-calendar/events` with `?status=` query semantics — Fastify would treat both as the same route with overlapping querystring use, causing confusion.
- **Fix:** Registered as `/api/personal-calendar/events/window` (the plan's own suggested alternative)
- **Files modified:** `src/api/routes/calendar.ts`
- **Verification:** Route accessible at `/api/personal-calendar/events/window`, distinct from existing status-filter route; test 9 green
- **Committed in:** 4424eaf (plugin commit)

---

**Total deviations:** 1 auto-handled (plan's pre-specified fallback path applied)
**Impact on plan:** No scope change. Dashboard (Plan 44-04) should use `/api/personal-calendar/events/window` for the window-scoped initial load.

## REST + SSE Contract (for Plan 44-04)

**CalendarItem shape:**
```ts
{
  source: 'task' | 'event' | 'linkedin';
  id: string;
  title: string;          // enrichedTitle ?? task for tasks; Hebrew-first for LinkedIn
  start: number;          // unix ms
  end: number | null;     // null for point-in-time items (tasks, LinkedIn posts)
  isAllDay: boolean;
  language: 'he' | 'en' | 'mixed';
  sourceFields: {         // source-specific extras
    // task:    status, todoTaskId, enrichedNote, sourceContactName
    // event:   location, description, calendarEventId
    // linkedin: status, content, content_he, image_urn
  };
}
```

**CalendarEnvelope shape:**
```ts
{
  items: CalendarItem[];   // sorted by start asc
  sources: { tasks: 'ok'|'error'; events: 'ok'|'error'; linkedin: 'ok'|'error' };
}
```

**Per-source routes** return `{ items: CalendarItem[] }` — no `sources` envelope.

**Window params** (all routes): `?from=<ms>&to=<ms>`, defaults 7d back / 60d forward, max 120d span.

**SSE:** `/api/calendar/stream?token=<jwt>`, event name `calendar.updated`, payload is full `CalendarEnvelope`.

## Hand-off Note for Plan 44-04

- REST + SSE contract frozen. Dashboard Zod schemas must mirror `CalendarItem` discriminated union and `CalendarEnvelope`.
- Dashboard initial-load fires 3 per-source GETs in parallel (renders each source on its own timeline, no waiting for slowest).
- Per-source events path is `/api/personal-calendar/events/window` (not `/events` — that path has different semantics).
- SSE reconnect badge (amber animate-pulse "Reconnecting...") should mirror Phase 43 PendingTasks pattern.

## Self-Check: PASSED

All 5 created/modified files exist. All 4 commits found in git log.

---
*Phase: 44-unified-editable-calendar*
*Completed: 2026-04-20*

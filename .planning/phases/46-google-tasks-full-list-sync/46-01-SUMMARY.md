---
phase: 46-google-tasks-full-list-sync
plan: "01"
subsystem: api
tags: [google-tasks, fastify, jwt, vitest, calendar, dedup]

# Dependency graph
requires:
  - phase: 44-unified-editable-calendar
    provides: CalendarItem discriminated union + CalendarSource='gtasks' slot
  - phase: 47-google-calendar-events-sync
    provides: Reference shape for googleCalendar.ts (hashCalendarColor palette, per-source error envelope, fetchGcal* aggregator-helper pattern)
provides:
  - "GET /api/google-tasks/lists — enumerates every task list owner has access to (JWT-gated, 503 on gtasks failure)"
  - "GET /api/google-tasks/items?from&to — CalendarItem[] with source='gtasks' across all lists in window"
  - "todoService.getAllTaskLists() + getTaskItemsInWindow() — server-side enumeration with per-list error isolation"
  - "actionables.getApprovedActionableTodoTaskIds() — live-actionable dedup set for the gtasks aggregator"
  - "actionables.getActionableByTodoTaskId() — reverse-lookup for Plan 46-04 mutation routing"
  - "fetchGtasksCalendarItems() — internal helper for Plan 46-02 aggregator to reuse projection + dedup"
  - "hashListColor() — djb2 over listId → stable 8-slot Tailwind palette match with hashCalendarColor"
affects: [46-02-aggregator, 46-03-filter-panel, 46-04-mutations, 46-05-live-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-list Promise.allSettled error isolation — bad list does not abort the batch (mirrors gcalService.listEventsInWindow)"
    - "Graceful 200 {items:[], error:'gtasks_unavailable'} on upstream throw for /items (aggregator-uniform)"
    - "503 gtasks_unavailable on upstream throw for /lists (bare resource, no aggregator uniformity needed)"
    - "Shared 8-slot Tailwind palette + djb2 hash for per-source color assignment (gtasks + gcal match)"
    - "Server-side dedup via Set<todoTaskId> intersection — actionable row wins, gtasks payload drops"

key-files:
  created:
    - src/api/routes/googleTasks.ts
    - src/api/__tests__/googleTasks.test.ts
  modified:
    - src/todo/todoService.ts
    - src/api/server.ts
    - src/db/queries/actionables.ts

key-decisions:
  - "Graceful partial-failure asymmetric between /lists (503) and /items (200 envelope) — /items participates in the Plan 46-02 allSettled aggregator, /lists is a standalone enumeration surface"
  - "GtasksCalendarItem kept as todoService-native shape; projection to CalendarItem happens at the route boundary (mirrors gcalService → googleCalendar.ts split)"
  - "Dedup scope narrowed to approved actionables (not rejected/expired) per CONTEXT §Dedup edge cases — manual Google Tasks UI entries with the same id still render"
  - "parseWindow helper copied inline (10 lines) from calendar.ts rather than imported — avoids a circular-ish import chain and keeps the route file self-contained"
  - "Hebrew detection uses unicode range [\\u0590-\\u05FF] consistent with projectEvents / projectGcalItem"

patterns-established:
  - "Pattern: per-source proxy route file with two JWT-gated endpoints (/{source}/lists + /{source}/items) and one exported fetch{Source}CalendarItems() helper for the aggregator — gtasks matches gcal exactly"
  - "Pattern: shared 8-slot Tailwind palette (bg-emerald/sky/violet/amber/rose/teal/orange/fuchsia-500) indexed via djb2 hash over a stable Google id → consistent visuals across gtasks lists + gcal calendars"

requirements-completed: [GTASKS-01]

# Metrics
duration: 12m
completed: 2026-04-21
---

# Phase 46 Plan 01: Google Tasks Full-List Sync Backend Summary

**Two JWT-gated proxy routes (/api/google-tasks/lists + /items) exposing every owner Google Tasks list to the dashboard with per-list color hash, server-side actionable dedup, and aggregator-uniform partial-failure envelope.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-21T10:23:00Z (approx — first Read)
- **Completed:** 2026-04-21T10:34:28Z (Task 2 commit time)
- **Tasks:** 2 (both atomic)
- **Files modified:** 5 (2 created + 3 modified)

## Accomplishments

- `src/todo/todoService.ts` gained `getAllTaskLists()` (caps at Google's 100-list maxResults, filters out malformed entries with no id) and `getTaskItemsInWindow(from, to)` (per-list Promise.allSettled iteration with window clip + status=completed filter + undated drop + RFC 3339 → unix ms parsing with NaN guard).
- `src/api/routes/googleTasks.ts` registers two JWT-gated routes: `/lists` maps `title → name` at the projection boundary, `/items` projects `GtasksCalendarItem → CalendarItem` with `source='gtasks'`, `language` detected via `/[\u0590-\u05FF]/`, `sourceFields` carrying `listId`, `listName`, `color`, `sourceColor`, `etag`, `updated`. Both routes fail gracefully — /lists returns 503, /items returns aggregator-uniform 200 envelope.
- `src/db/queries/actionables.ts` gained `getApprovedActionableTodoTaskIds(from, to)` (live-actionable dedup set) + `getActionableByTodoTaskId(id)` (reverse-lookup for Plan 46-04 mutation routing).
- `fetchGtasksCalendarItems()` exported from the route file so Plan 46-02's aggregator can reuse projection + dedup without going through HTTP — mirrors the `fetchGcalCalendarItems()` pattern established in Phase 47 Plan 01.
- 10/10 vitest green in ~400ms covering: auth gating ×2, mapped lists payload, 503 on throw, CalendarItem projection (source/start/end/isAllDay/language/sourceFields/color/sourceColor assertions), todoTaskId dedup, completed/out-of-window pass-through, Hebrew language detection, gtasks_unavailable envelope.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend todoService with getAllTaskLists + getTaskItemsInWindow** — `d7217ae` (feat)
2. **Task 2: Build /api/google-tasks/lists + /items routes + vitest** — `a8794de` (feat)

**Plan metadata:** (to be stamped in final docs commit)

## Files Created/Modified

- **Created** `src/api/routes/googleTasks.ts` — 164 lines. Fastify plugin with `/lists` + `/items` routes, `hashListColor()` exported helper, inline `parseWindow()` (copied from calendar.ts for isolation), `projectGtasksItem()` projection, `fetchGtasksCalendarItems()` aggregator helper.
- **Created** `src/api/__tests__/googleTasks.test.ts` — 300 lines. vi.mock stubs for todoService + actionables + config; fastify.inject() harness with stubbed authenticate + jwt decorators; 10 cases across two describe blocks.
- **Modified** `src/todo/todoService.ts` — +103 lines. Added `GtasksCalendarItem` type export, `getAllTaskLists()`, `getTaskItemsInWindow()` with per-list allSettled + per-task NaN/status/window filters. Existing exports untouched.
- **Modified** `src/api/server.ts` — +2 lines. `googleTasksRoutes` import + `fastify.register` after `googleCalendarRoutes`.
- **Modified** `src/db/queries/actionables.ts` — +47 lines. `getApprovedActionableTodoTaskIds()` + `getActionableByTodoTaskId()`. Existing exports untouched.

## Decisions Made

- **/lists 503 vs /items 200 envelope asymmetry** — intentional. The Plan 46-02 aggregator wraps `fetchGtasksCalendarItems()` in `Promise.allSettled`, so /items returning `{items:[], error:'gtasks_unavailable'}` with status 200 keeps the envelope's `sources.gtasks='error'` marker logic uniform across all sources. /lists has no aggregator peer — a 503 directly signals to the sidebar filter panel that the list inventory couldn't be fetched.
- **Hebrew detection range** — `[\u0590-\u05FF]` matches existing projectEvents + projectGcalItem convention (gcalService uses `/[֐-׿]/` literal; same codepoints). Kept escape form for readability.
- **Dedup set type** — `Set<string>` returned from the DB helper rather than an array, so the O(1) `.has(id)` check scales to large backlogs without hoisting into a Map on the route side.

## Deviations from Plan

None — plan executed exactly as written. Two tiny mechanical choices inside Task 1:

1. `getAllTaskLists()` filters out entries with `!l.id` before mapping (one-line safety net; the Google Tasks API spec guarantees `id` for list entries but TS nullability forces the `l.id!` assertion — the pre-filter eliminates the assertion without behavioral change).
2. `getTaskItemsInWindow()` adds a `Number.isFinite(dueMs)` guard after `new Date(t.due).getTime()` — defensive against malformed RFC 3339 values in the wild. Plan didn't specify but the cost is zero and it prevents a NaN leak into downstream comparisons.

Both are cosmetic robustness additions, not scope changes.

## Issues Encountered

None. vitest green on first run, tsc clean (pre-existing `cli/` rootDir noise unchanged).

## Self-Check

**Files claimed to be created:**
- `src/api/routes/googleTasks.ts` — FOUND (164 lines)
- `src/api/__tests__/googleTasks.test.ts` — FOUND (300 lines)

**Files claimed to be modified:**
- `src/todo/todoService.ts` — VERIFIED via grep (`getAllTaskLists`, `getTaskItemsInWindow`, `GtasksCalendarItem` present at lines 140/156/183)
- `src/api/server.ts` — VERIFIED via grep (`googleTasksRoutes` import line 21, register line 59)
- `src/db/queries/actionables.ts` — VERIFIED via grep (`getApprovedActionableTodoTaskIds` line 300, `getActionableByTodoTaskId` line 326)

**Commits claimed to exist:**
- `d7217ae` Task 1 — FOUND in git log
- `a8794de` Task 2 — FOUND in git log

**Verification commands:**
- `NODE_ENV=development npx vitest run src/api/__tests__/googleTasks.test.ts` → 10/10 passed in ~400ms
- `npx tsc --noEmit` → zero new errors (pre-existing cli/ rootDir noise tolerated per STATE convention)

## Self-Check: PASSED

## User Setup Required

None — no external service configuration required. Uses the existing Google Tasks OAuth scope already configured for `todoService.createTodoTask`.

## Next Phase Readiness

- **Plan 46-02 (aggregator):** `fetchGtasksCalendarItems()` is exported and ready for Promise.allSettled inclusion in `calendar.ts`'s `fetchCalendarWindow`. Pattern matches `fetchGcalCalendarItems()` 1:1 — the 46-02 plan will add a fifth slot (tasks + events + linkedin + gcal + **gtasks**) to `allSettled` and a `gtasks: SourceStatus` field to `CalendarEnvelope.sources`. The `gtasks` slot in the union was already provisioned in Phase 44 — `CalendarSource = 'task' | 'event' | 'linkedin' | 'gtasks' | 'gcal'`.
- **Plan 46-03 (filter panel):** `/api/google-tasks/lists` response shape `{ lists: Array<{ id, name, etag, updated }> }` is the contract the sidebar filter panel consumes. Phase 47-03's `CalendarFilterPanel.tsx` already speculatively built a `gtasksLists` section wired to the same `localStorage` prefs key (`calFilterPrefs_v1`) — Plan 46-03 will wire it to a real hook instead of placeholder data.
- **Plan 46-04 (mutations):** `getActionableByTodoTaskId()` is exported for mutation routing — gtasks edits on a mirrored item will detect the actionable and route through the Phase 45 `approvalHandler` edit path rather than directly to Google Tasks (CONTEXT §Mirrored-item edit ownership).
- **Plan 46-05 (live verify):** PM2 restart required before curl smoke because the new routes need the running bot's OAuth context. Config file at `src/config.ts` already supports `GOOGLE_TASKS_*` env via the existing `personalCalendarService.getOAuth2Client()`.

**Live curl smoke (for plan 46-05 reference):**
```bash
# against deployed server:
curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/google-tasks/lists
curl -H "Authorization: Bearer $JWT" "http://localhost:3000/api/google-tasks/items?from=0&to=9999999999999"
```

---
*Phase: 46-google-tasks-full-list-sync*
*Completed: 2026-04-21*

---
phase: 55-trip-dashboard-view
plan: "02"
subsystem: api-routes
tags: [fastify, sse, jwt, soft-delete, trips, dashboard]
dependency_graph:
  requires: [softDeleteDecision, updateBudgetByCategory, listTripsForDashboard, getTripBundle, resolveOpenItem]
  provides: [GET /api/trips, GET /api/trips/:groupJid, DELETE /api/trips/:groupJid/decisions/:id, PATCH /api/trips/:groupJid/questions/:id/resolve, PATCH /api/trips/:groupJid/budget, GET /api/trips/:groupJid/stream]
  affects: [dashboard frontend plans 03+04, src/api/server.ts]
tech_stack:
  added: []
  patterns: [SSE poll+hash-diff+heartbeat (mirrors actionables.ts/calendar.ts), Zod body validation with refine for partial record, Fastify inject() test pattern with stubbed authenticate+jwt]
key_files:
  created:
    - src/api/routes/trips.ts
    - src/api/routes/__tests__/trips.test.ts
    - .planning/phases/55-trip-dashboard-view/55-02-SUMMARY.md
  modified:
    - src/api/server.ts
decisions:
  - "PatchBudgetSchema uses z.record(z.string, z.number) + .refine() instead of z.record(z.enum, z.number) — Zod v3 z.record(z.enum) requires ALL enum keys to be present, breaking partial updates"
  - "isReadOnly check is inline via getTripBundle().readOnly instead of a separate helper function — avoids a second DB call since getTripBundle is needed anyway for the 404 check"
  - "drizzle-orm mock in tests uses vi.mock('drizzle-orm') with stub and()/eq() — mock paths must resolve relative to the test file not the route file (../../../db/... not ../../db/...)"
metrics:
  duration_minutes: 22
  completed_date: "2026-04-25"
  tasks_completed: 2
  files_modified: 4
---

# Phase 55 Plan 02: Trip Dashboard API Routes Summary

Six Fastify routes under `/api/trips/*` — two reads, three JWT-gated writes with archived-trip 403 guard, and one SSE channel. All backed by the Phase 55-01 query helpers.

## Route Handlers

### GET /api/trips
- **Auth:** `onRequest: [fastify.authenticate]` (Bearer JWT)
- **Response:** `{ trips: TripListEntry[] }` — via `listTripsForDashboard()`, sorted upcoming-first → past → archived

### GET /api/trips/:groupJid
- **Auth:** Bearer JWT
- **Response:** `TripBundle` (or `404` if group not found anywhere)
- **readOnly: true** when context came from `trip_archive` (cron-archived trip)

### DELETE /api/trips/:groupJid/decisions/:id
- **Auth:** Bearer JWT
- **Guard:** 403 if `bundle.readOnly === true` (archived trip)
- **Existence check:** `WHERE id=? AND group_jid=?` — returns 404 if no match (anti-leak: cross-group id lookup also returns 404)
- **Idempotent:** calls `softDeleteDecision(id)` unconditionally; already-deleted rows still return 204

### PATCH /api/trips/:groupJid/questions/:id/resolve
- **Auth:** Bearer JWT
- **Guard:** 403 if archived
- **Existence check:** `WHERE id=? AND group_jid=? AND type='open_question'`
- **Idempotent:** calls `resolveOpenItem(id)` unconditionally; already-resolved rows return 204

### PATCH /api/trips/:groupJid/budget
- **Auth:** Bearer JWT
- **Guard:** 403 if archived
- **Body:** `Partial<Record<TripCategory, number>>` — validated via `PatchBudgetSchema`
- **Validation:** `z.record(z.string(), z.number().finite().nonnegative()).refine(keys ⊆ TRIP_CATEGORIES)`
- **Response:** `{ budget: BudgetRollup }` — canonical state after merge (supports FE optimistic-update revert)

### GET /api/trips/:groupJid/stream
- **Auth:** `?token=<jwt>` query param — manually verified via `fastify.jwt.verify(token)` (EventSource can't set headers, mirrors actionables.ts)
- **SSE headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- **Poll interval:** 3s (`POLL_INTERVAL_MS = 3_000`)
- **Heartbeat interval:** 15s (`HEARTBEAT_INTERVAL_MS = 15_000`) — keeps reverse proxies alive
- **Event:** `event: trip.updated\ndata: <JSON bundle>\n\n` emitted iff `hashTripBundle(bundle) !== lastHash`
- **Hash projection** (fields that change → SSE fires):
  - decisions: `[id, status, resolved, costAmount, category, lat, lng]`
  - openQuestions: `[id, resolved]`
  - budget: `targets`, `spent` (per-category)
  - calendarEvents: `[id, eventDate, title]`
  - `readOnly` flag
- **First poll** fires immediately after connection to seed client state
- **Close cleanup:** `request.raw.on('close')` clears both intervals

## server.ts Registration

```ts
import tripsRoutes from './routes/trips.js';
// ...
await fastify.register(googleTasksRoutes);
await fastify.register(tripsRoutes);
// 5. Static file serving (last — catch-all for SPA)
await fastify.register(staticPlugin);
```

## Idempotency Proofs

| Route | Already-handled state | Result |
|-------|-----------------------|--------|
| DELETE decisions | status='deleted' row still in DB | 204 (softDeleteDecision is a no-op SET) |
| PATCH questions/:id/resolve | resolved=true already | 204 (resolveOpenItem is a no-op SET) |

## Test Coverage

**File:** `src/api/routes/__tests__/trips.test.ts`
**Run:** `npx vitest run src/api/routes/__tests__/trips.test.ts`
**Result:** 22 passed, 0 failed

| Group | Tests |
|-------|-------|
| 1. Auth gate | 3 |
| 2. GET /api/trips | 1 |
| 3. GET /api/trips/:groupJid | 3 |
| 4. DELETE decisions | 4 |
| 5. PATCH resolve | 2 |
| 6. PATCH budget | 3 |
| 7. Archived 403 | 1 |
| 8. Soft-delete propagation | 1 |
| 9. hashTripBundle unit | 4 |
| **Total** | **22** |

**Pattern:** Mock-based (vi.mock for DB queries, stubbed fastify.authenticate + fastify.jwt). SSE tested via `hashTripBundle` unit tests (same reasoning as actionables.test.ts — inject() buffers body, SSE never ends).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod v3 z.record(z.enum) incompatibility**
- **Found during:** Task 1 implementation, exposed by Task 2 test failures
- **Issue:** The plan specified `z.record(z.enum(TRIP_CATEGORIES), z.number().finite().nonnegative())` — in Zod v3 this requires ALL enum keys to be present. A partial budget patch like `{ food: 300 }` would always fail validation (missing 6 other required keys).
- **Fix:** Changed to `z.record(z.string(), z.number().finite().nonnegative()).refine(keys ⊆ TRIP_CATEGORIES)` — correctly validates a partial update.
- **Files modified:** `src/api/routes/trips.ts`
- **Commit:** 8abe368

**2. [Rule 3 - Blocking] Fixed vi.mock path resolution**
- **Found during:** Task 2 (all non-auth tests returning 500)
- **Issue:** Mock paths in `src/api/routes/__tests__/trips.test.ts` used `../../db/...` (relative to route file) instead of `../../../db/...` (correct path relative to test file). Vitest resolves mock paths relative to the TEST file, not the module being mocked.
- **Fix:** Updated all 3 mock paths to `../../../db/...`
- **Files modified:** `src/api/routes/__tests__/trips.test.ts`
- **Commit:** 8abe368

## Commits

| Hash | Message |
|------|---------|
| fa072f4 | feat(55-02): implement /api/trips routes (read + writes + SSE stream) |
| 8abe368 | test(55-02): vitest coverage for /api/trips routes (22 tests) |

## Self-Check: PASSED

- [x] `src/api/routes/trips.ts` exists (≥ 200 lines)
- [x] `src/api/server.ts` has 2 tripsRoutes references (import + register)
- [x] 6 route handlers (`grep -c "fastify.get|fastify.patch|fastify.delete"` = 6)
- [x] `>= 6` auth gates (7 total — 5 onRequest + 1 SSE manual verify + 1 count)
- [x] `npx tsc --noEmit` clean (no new errors beyond pre-existing cli/ rootDir)
- [x] `npx vitest run src/api/routes/__tests__/trips.test.ts` — 22/22 passed
- [x] SSE registered before staticPlugin in server.ts
- [x] Commits fa072f4 and 8abe368 exist in git log

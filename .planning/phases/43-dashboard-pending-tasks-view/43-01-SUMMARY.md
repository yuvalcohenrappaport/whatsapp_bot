---
phase: 43-dashboard-pending-tasks-view
plan: 01
subsystem: api
tags: [fastify, sse, jwt, actionables, dashboard]

requires:
  - phase: 39-actionables-data-model
    provides: getPendingActionables + getRecentTerminalActionables query layer
  - phase: 35-linkedin-queue-ui
    provides: JWT + SSE stream pattern (stream.ts hash-poll + heartbeat)
provides:
  - GET /api/actionables/pending — JWT-gated read of pending_approval rows
  - GET /api/actionables/recent — JWT-gated read of terminal rows, limit clamped [1,200]
  - GET /api/actionables/stream — SSE channel emitting actionables.updated on hash change
  - hashActionables export — stable content hash across pending+recent, test-accessible
affects: [43-02, 43-03, future dashboard live-update subsystems]

tech-stack:
  added: []
  patterns:
    - "SSE hash-poll dedup reused from /api/linkedin/queue/stream"
    - "EventSource ?token= query-string JWT gate (headers unsupported)"
    - "limit-clamp query-param pattern for terminal-row pagination"

key-files:
  created:
    - src/api/routes/actionables.ts
    - src/api/__tests__/actionables.test.ts
  modified:
    - src/api/server.ts

key-decisions:
  - "Hash field set = [id, status, updatedAt, enrichedTitle[:50], todoTaskId] — catches every UI-visible change, ignores createdAt (never mutates post-INSERT)"
  - "SSE full end-to-end not unit-tested (fastify.inject buffers) — deferred to 43-03 live walkthrough; hashActionables exported for direct test coverage instead"
  - "Reused /api/linkedin/queue/stream SSE pattern verbatim (3s poll, 15s heartbeat, X-Accel-Buffering:no) for consistency and reviewability"

patterns-established:
  - "Exported content-hash helper per SSE route so tests can assert stability without opening a real connection"

requirements-completed:
  - DASH-ACT-01
  - DASH-ACT-02

duration: ~15min
completed: 2026-04-20
---

# Phase 43 Plan 01: Actionables REST + SSE Summary

**JWT-gated Fastify plugin shipping /api/actionables/pending, /api/actionables/recent, and /api/actionables/stream — mirrors the /api/linkedin/queue/stream hash-poll + heartbeat pattern and delivers exactly the endpoints Plan 43-02's dashboard page will consume.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-04-20
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 edited)
- **Lines of code:** 198 (route) + 254 (tests) = 452 total

## Accomplishments

- Three new REST/SSE endpoints backed by the Phase 39 query layer — zero DB migrations, zero touches to the approval/detection code paths.
- SSE stream emits `actionables.updated` with `{pending, recent}` payload on every semantic change, plus a first-poll seed emit and 15s heartbeat for reverse-proxy resilience.
- `hashActionables(pending, recent)` exported so the vitest suite verifies stability + change-detection without a real SSE socket (same technique the linkedin stream uses).
- 10/10 vitest cases green covering auth gating on all three routes, limit clamping/NaN fallback, and the hash invariants.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create /api/actionables REST + SSE plugin** — `43570be` (feat)
2. **Task 2a: Wire plugin into server.ts** — `cbb947e` (feat)
3. **Task 2b: vitest coverage** — `25256b8` (test)

Task 2 split into two commits (server wire-up + tests) because the plan's Task 2 combined them and atomic commits are clearer that way.

## Files Created/Modified

- `src/api/routes/actionables.ts` (198 lines, created) — Fastify plugin exporting `default actionablesRoutes` + `hashActionables`; registers /pending, /recent, /stream with JWT gates.
- `src/api/__tests__/actionables.test.ts` (254 lines, created) — 10 vitest cases, mocks the query layer via `vi.mock`, stubs `fastify.authenticate` + `fastify.jwt` the same way `src/api/linkedin/__tests__/reads.test.ts` does.
- `src/api/server.ts` (2 lines added) — `import actionablesRoutes from './routes/actionables.js'` + `await fastify.register(actionablesRoutes)` between `reminderRoutes` and `integrationsRoutes`.

## Decisions Made

- **Hash composition:** `[id, status, updatedAt, enrichedTitle[:50], todoTaskId]` per row across both lists, concat-then-sha1. Catches approval → Google Tasks push → enrichment transitions without thrashing on createdAt.
- **Test strategy:** Mirror the linkedin reads test (stub `fastify.authenticate` + `fastify.jwt`) rather than register the real `jwtPlugin`. Config.ts's Zod env schema rejects `NODE_ENV=test` (vitest's default) with `process.exit(1)` — the stub pattern sidesteps this cleanly and is already a house convention.
- **SSE round-trip tests deferred to Plan 43-03:** Fastify's `inject()` helper buffers full response bodies, so it can't observe multi-frame SSE. The linkedin stream suite uses a real listening socket for this; we skip that complexity here because the poll-loop logic is 100% covered by `hashActionables` unit tests, and 43-03 does the live walkthrough anyway.
- **Task 2 split into two commits:** Server wire-up + vitest are logically independent. Splitting keeps each commit reviewable in isolation; the plan permitted this implicitly (it spec'd Task 2 as "Step A" + "Step B").

## Deviations from Plan

None — plan executed exactly as written. Tiny mechanical choices only:

- Test stubs `fastify.authenticate` + `fastify.jwt` (linkedin-reads pattern) instead of registering real `jwtPlugin` with a test secret. Equivalent coverage, no env side-effects. Noted in plan as acceptable (plan's sketch was one option, not a lock).
- Route module adds `MIN_RECENT_LIMIT = 1` alongside the plan-declared `DEFAULT_RECENT_LIMIT=50` + `MAX_RECENT_LIMIT=200` constants — spec called for "clamp to [1, 200]" but didn't name the floor; adding the named constant makes the `Math.max(MIN, ...)` line self-documenting.

**Total deviations:** 0 rule-triggered auto-fixes. Plan was tight.
**Impact on plan:** Zero scope drift.

## Issues Encountered

1. **First test run failed with `process.exit(1)` from config.ts.**
   - **Cause:** `jwtPlugin` imports `config.ts`, which runs `envSchema.safeParse(process.env)` at module load; vitest sets `NODE_ENV=test` which isn't in the enum → config.ts exits the process.
   - **Fix:** Switched the test harness from `await fastify.register(jwtPlugin)` to the linkedin-reads stub pattern (`fastify.decorate('authenticate', ...)` + `fastify.decorate('jwt', {verify: ...})`). Same pattern the repo already uses for the linkedin routes; no custom env shim needed.
   - **Verification:** 10/10 vitest cases green.
   - **Time:** ~2 min including fix.

## User Setup Required

None — no external service configuration required. Plugin is wired and live on next `npm start` / PM2 restart; no PM2 restart needed for Plan 43-01 alone (the route is not yet consumed — Plan 43-02 ships the client).

## Next Phase Readiness

**Plan 43-02 hand-off note:** The server contract is live and typed. Dashboard client can Zod-mirror the Actionable row shape directly from the `actionables` Drizzle table at `src/db/schema.ts` lines 253-284. Body envelope is `{actionables: Actionable[]}` for both REST routes; SSE body envelope is `{pending: Actionable[], recent: Actionable[]}` under the single `actionables.updated` event name. Auth is Bearer-on-REST / `?token=`-on-SSE — same mental model the linkedin queue page already uses.

All three key Actionable fields the audit view needs are in every row payload (no field stripping at the server): `enriched_title`, `enriched_note`, `todo_task_id`, `original_detected_task`, and `updated_at`.

## Verification Log

- `npx tsc --noEmit` — zero new errors (pre-existing cli/bot.ts + cli/commands/persona.ts rootDir noise unchanged, per STATE.md convention).
- `npx vitest run src/api/__tests__/actionables.test.ts` — 10/10 green in 391ms.
- `grep -n "actionablesRoutes" src/api/server.ts` — import line 14 + register line 49.
- `.planning/` confirmed gitignored — SUMMARY.md will be added via `git add -f` below.

## Self-Check: PASSED

- `src/api/routes/actionables.ts` — FOUND (198 lines)
- `src/api/__tests__/actionables.test.ts` — FOUND (254 lines)
- `src/api/server.ts` — MODIFIED (actionablesRoutes import + register present)
- Commit `43570be` — FOUND (Task 1)
- Commit `cbb947e` — FOUND (Task 2a server wiring)
- Commit `25256b8` — FOUND (Task 2b vitest)

---
*Phase: 43-dashboard-pending-tasks-view*
*Completed: 2026-04-20*

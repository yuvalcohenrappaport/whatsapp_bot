---
phase: 35-linkedin-queue-read-side-ui
plan: 02
subsystem: api
tags: [sse, fastify, linkedin, jwt, server-sent-events, pm-authority, zod, sha1, eventsource]

# Dependency graph
requires:
  - phase: 34-fastify-proxy-layer
    provides: callUpstream helper + PostSchema mirror + linkedin Fastify plugin slot
  - phase: 35-linkedin-queue-read-side-ui/35-01
    provides: PostAnalyticsSchema + optional analytics field on PostSchema (consumed transparently by the stream)
provides:
  - GET /api/linkedin/queue/stream SSE endpoint (JWT query-string auth)
  - Server-side 3s polling loop against /v1/posts with sha1 content-hash dedup
  - 15s heartbeat comment lines to keep idle SSE connections alive through proxies
  - Stream-specific registerStreamRoutes(fastify) module sibling to reads.ts/writes.ts
  - Exported hashPosts(posts) utility for stable content hashing
affects:
  - 35-03 (queue card feed — the SSE contract this emits is what the client will consume, but 35-03 can ship as polling and upgrade later)
  - 35-04 (SSE client wiring — will call sseUrl('/api/linkedin/queue/stream'))

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EventSource JWT-in-query-string auth mirroring src/api/routes/status.ts (fastify.jwt.verify(token ?? '') manual gate, no onRequest hook because browsers can't set headers on EventSource)"
    - "Server-side fan-out polling: one 3s upstream fetch feeds N connected clients off a single loop, avoiding per-client pm-authority pressure"
    - "Stable content hash via sha1 over a 6-field subset ([id, status, content[0:100], variants.length, lesson_candidates.length, image.url]) — catches every UI-visible change while ignoring drift in analytics/timestamps"
    - "Error swallow-and-retry in SSE polling loop: upstream failures never terminate the stream; client sees last-known-good state + continued heartbeats until upstream recovers"
    - "Real http.get + fastify.listen(0) test harness for multi-frame SSE — fastify.inject() buffers the whole response and can't observe streaming output"

key-files:
  created:
    - src/api/linkedin/routes/stream.ts
    - src/api/linkedin/__tests__/stream.test.ts
  modified:
    - src/api/routes/linkedin.ts

key-decisions:
  - "JWT gate via manual fastify.jwt.verify(token) on the query-string token — exact mirror of /api/status/stream, no onRequest hook"
  - "3s poll interval = 3s fetch timeout: same tier prevents pileup if pm-authority ever slows below that threshold; a stuck call aborts exactly at the next tick boundary"
  - "Hash on content.slice(0,100) not full content: typo fixes beyond char 100 don't re-emit (wouldn't be visible on the card preview anyway), saves bandwidth"
  - "First poll fires immediately (void pollOnce()), not after setInterval's first 3s tick — seeds client state without a ~3s hole on connect"
  - "Closed flag checked before every write: prevents race where an in-flight fetch resolves after the client disconnect handler has already fired"
  - "X-Accel-Buffering: no header — cheap nginx defense even though current deploy doesn't front with nginx"

patterns-established:
  - "SSE test harness: real fastify.listen({port:0}) + node:http.get with a maxMs timeout wrapper that resolves the buffered body on destroy — works for both short JSON (401) and streaming (200 event-stream) responses"
  - "registerXxxRoutes module pattern extended for a third slot (stream) alongside reads/writes in the linkedin Fastify plugin"

requirements-completed: [LIN-06]

# Metrics
duration: ~15 min
completed: 2026-04-14
---

# Phase 35 Plan 02: LinkedIn Queue SSE Stream Summary

**Server-sent-events endpoint at /api/linkedin/queue/stream with a 3s polling loop, sha1 content-hash dedup, and 15s heartbeat — one fan-out loop feeds N dashboard clients off a single pm-authority call**

## Performance

- **Duration:** ~15 min (mostly the 34s wall-clock test run)
- **Tasks:** 3 (all auto, no checkpoints)
- **Files created:** 2
- **Files modified:** 1
- **Test count:** 73 → 84 (+11)

## Accomplishments
- `GET /api/linkedin/queue/stream` live with JWT query-string auth mirroring the existing `/api/status/stream` pattern
- Server-side poll-and-hash loop emits `event: queue.updated` only when the stable 6-field hash of the non-terminal post list changes
- 15s heartbeat comment lines keep idle connections alive through middleboxes
- Upstream errors are logged and swallowed — the stream survives pm-authority restarts, schema drift, and transient network hiccups
- Client disconnect cleanly clears both intervals (no leaked timers)
- Full linkedin vitest suite still green: 84/84 (was 73)

## Task Commits

1. **Task 1: Create stream.ts with SSE loop + hashPosts** — `9300c8f` (feat)
2. **Task 2: Wire registerStreamRoutes into linkedin plugin** — `68b2e1c` (feat)
3. **Task 3: Pin 11 vitest cases for the stream route** — `562436c` (test)

## Files Created/Modified
- `src/api/linkedin/routes/stream.ts` - NEW: 156 lines — full SSE handler, hashPosts helper, 3s poll loop, 15s heartbeat, per-connection cleanup
- `src/api/linkedin/__tests__/stream.test.ts` - NEW: 318 lines — 2 JWT gate tests + 5 SSE emission tests + 4 hashPosts unit tests (11 total)
- `src/api/routes/linkedin.ts` - MODIFIED: added import + `await registerStreamRoutes(fastify)` after the write-side registration

## Decisions Made
- **Test harness with real sockets, not fastify.inject():** `inject()` buffers the whole response so it can't observe intermediate SSE frames. A real `fastify.listen({port:0})` + `http.get` with a `maxMs` timeout works for both streaming (200) and short (401) responses.
- **Plan said 82 tests total, actual is 84:** I landed 11 new tests (2 JWT + 5 SSE emission + 4 hashPosts) vs plan's described 11 — the "82" number in plan text was a stale arithmetic (73 + 9) that didn't match the plan's own 2+5+4=11 test enumeration. Went with the enumeration.
- **Stub `fastify.jwt` via direct property assignment** rather than `fastify.decorate('jwt', ...)`: the decorate API complains when the name collides with a built-in plugin registration pattern. Direct property assignment on an un-decorated `fastify` instance is a cleaner test-only escape hatch and doesn't affect production code.

## Deviations from Plan

None — plan executed as written. The only minor tweak was the test-harness decorator approach noted above (plan suggested `fastify.decorate('jwt', ...)`, I used direct property assignment because it's simpler and the same thing at runtime).

## Issues Encountered
- **Test runtime ~34s:** The dedup, re-emit, recovery, and heartbeat tests have real wall-clock waits (5.5s × 3 + 16s) because the SSE polling loop uses real Node intervals and vitest's fake timers can't drive the http stack end-to-end. Plan explicitly flagged this as an accepted tradeoff.

## Parallel Execution Note

Plan 35-03 ran concurrently in wave 2. Files are fully disjoint: this plan only touched `src/api/**`, plan 35-03 only touched `dashboard/src/**`. Verified post-execution via `git diff --stat HEAD~3 HEAD` on the 3 commits from this plan — zero `dashboard/` files touched.

## Next Phase Readiness
- **35-03 (running in parallel):** Can ship as polling and upgrade to SSE in 35-04 — contract is now stable: `event: queue.updated\ndata: {"posts":[...]}`
- **35-04 (SSE client wiring):** Has everything it needs — the stream exists, JWT auth works via `sseUrl('/api/linkedin/queue/stream')`, the event shape is pinned
- **Live verification deferred to 35-04:** PM2 whatsapp-bot does NOT need restart in this plan. Once 35-04 wires the client and 35-04's executor restarts PM2, a single `curl -N http://localhost:<port>/api/linkedin/queue/stream?token=<jwt>` will confirm the first `queue.updated` frame within 1s and a `: ping` within 15s.

## Self-Check: PASSED

- `src/api/linkedin/routes/stream.ts` — FOUND
- `src/api/linkedin/__tests__/stream.test.ts` — FOUND
- `src/api/routes/linkedin.ts` — FOUND (modified)
- `.planning/phases/35-linkedin-queue-read-side-ui/35-02-SUMMARY.md` — FOUND
- Commit `9300c8f` (Task 1) — FOUND
- Commit `68b2e1c` (Task 2) — FOUND
- Commit `562436c` (Task 3) — FOUND

---
*Phase: 35-linkedin-queue-read-side-ui*
*Plan: 02*
*Completed: 2026-04-14*

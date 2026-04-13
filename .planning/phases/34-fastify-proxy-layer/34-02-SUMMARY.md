---
phase: 34-fastify-proxy-layer
plan: 02
subsystem: api
tags: [fastify, zod, proxy, pm-authority, linkedin, streaming, vitest]

requires:
  - phase: 34-fastify-proxy-layer
    plan: 01
    provides: "Zod schemas, callUpstream/streamUpstream client, error mapper, Fastify linkedinRoutes plugin scaffold"

provides:
  - "GET /api/linkedin/posts — list posts with single + multi-status filter, PostSchema[] response validation"
  - "GET /api/linkedin/posts/:id — single post fetch with PostSchema validation"
  - "GET /api/linkedin/posts/:id/image — binary image stream with upstream Content-Type/Length preserved"
  - "GET /api/linkedin/posts/:id/lesson-candidates/:cid/image — lesson-candidate image stream"
  - "GET /api/linkedin/jobs/:jobId — job polling with JobSchema validation"
  - "registerReadRoutes(fastify) — single entry point wired from src/api/routes/linkedin.ts"

affects:
  - 34-03-write-endpoints
  - 34-04-pm2-rollout
  - 35-queue-dashboard-ui
  - 36-post-detail-ui
  - 37-post-mutations-ui

tech-stack:
  added: []
  patterns:
    - "Readable.fromWeb(upstream.body) pattern to bridge undici Web ReadableStream to Node Readable — Fastify 5 accepts Node streams via reply.send(stream)"
    - "encodeURIComponent on every path param before upstream interpolation — prevents path traversal if a caller smuggles special characters into an id"
    - "Image route timeout tier 30s vs 3s for JSON reads — cold reads from fal.ai-generated files can be slow; JSON reads should stay snappy"
    - "Image 404s still route through mapUpstreamErrorToReply so the dashboard gets a JSON error envelope (not binary garbage) when a post has no image yet"
    - "registerReadRoutes is a plain async function, not a Fastify plugin — called inline from the existing linkedinRoutes plugin so Plan 34-03 can append its own registerWriteRoutes the same way"

key-files:
  created:
    - src/api/linkedin/routes/reads.ts
    - src/api/linkedin/__tests__/reads.test.ts
  modified:
    - src/api/routes/linkedin.ts

key-decisions:
  - "Use a sub-file (src/api/linkedin/routes/reads.ts) rather than extending routes/linkedin.ts directly — keeps the plugin file small and gives Plan 34-03 a symmetric src/api/linkedin/routes/writes.ts slot. The plugin file now just wires registerReadRoutes (and, soon, registerWriteRoutes) into the existing JWT-guarded plugin."
  - "Single timeout tier constant per class (JSON_READ_TIMEOUT_MS=3000, IMAGE_STREAM_TIMEOUT_MS=30000) at the top of reads.ts — makes the timeout contract visible at-a-glance and easy for Plan 34-04's live integration test to verify"
  - "List posts response schema is z.array(PostSchema) constructed as a module constant (PostArraySchema) rather than inline — the array wrapper is re-used if Plan 34-03 needs it for bulk endpoints and avoids rebuilding the schema per request"
  - "registerReadRoutes does NOT re-register the plugin (no fastify.register(...)) — it's called directly inside the existing linkedinRoutes plugin body so all routes share the same JWT decorator and lifecycle"
  - "Path params on image routes are encodeURIComponent-escaped even though Fastify's router already strips literal slashes. Defense-in-depth: if pm-authority ever switches to a router that accepts unencoded slashes we won't have a path-traversal regression"
  - "sendBinaryStream helper centralizes the Readable.fromWeb + header-forwarding logic so Route 3 and Route 4 share one implementation — avoids a subtle drift if only one is updated later"
  - "Auth-gate test uses a SECOND buildTestServer with a rejecting authenticate decorator in its own describe block — keeping it separate from the happy-path server keeps the 12 other tests clean and proves that a 401 short-circuits BEFORE any upstream fetch happens"

patterns-established:
  - "sub-file layout under src/api/linkedin/routes/ — reads.ts is the first; Plan 34-03 adds writes.ts alongside it"
  - "registerXxxRoutes(fastify) plain function pattern — plugin file calls each in sequence after the health route, keeping mount order deterministic"
  - "Binary pass-through via Readable.fromWeb — same shape will be re-used if Plan 34-03's replace-image endpoint ever needs to stream a response body"

requirements-completed: [LIN-02]

duration: ~20min
completed: 2026-04-13
---

# Phase 34 Plan 02: Read Routes Summary

**5 JWT-protected GET routes under `/api/linkedin/*` that forward to pm-authority with Zod response validation, verbatim error passthrough, and zero-buffer image streaming via `Readable.fromWeb(upstream.body)`.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1
- **Tests added:** 13 — all green

## Accomplishments

- **5 read routes live** under the existing `/api/linkedin/*` plugin:
  - `GET /posts` (with `?status=X` and repeated `?status=X&status=Y` multi-status filter)
  - `GET /posts/:id`
  - `GET /posts/:id/image` (binary stream)
  - `GET /posts/:id/lesson-candidates/:cid/image` (binary stream)
  - `GET /jobs/:jobId`
- **Schema-first**: every JSON route declares its upstream `responseSchema` (`z.array(PostSchema)`, `PostSchema`, `JobSchema`); a mismatch becomes a 500 `INTERNAL_ERROR` envelope with the Zod `issues` attached — satisfies Phase 34 SC#2.
- **Verbatim error pass-through**: all upstream HTTP errors (`mapUpstreamErrorToReply`) forward `status + body` unchanged. Live smoke test confirmed 404 envelopes from pm-authority (`{"error":{"code":"NOT_FOUND","message":"post ... not found","details":{"post_id":"..."}}}`) arrive at the proxy client byte-for-byte — Phase 34 SC#3.
- **Image streaming without buffering**: `Readable.fromWeb(upstream.body as any)` bridges undici's Web `ReadableStream` → Node `Readable`, which Fastify 5 accepts via `reply.send(stream)`. Upstream `content-type` and `content-length` are forwarded so the dashboard can render progressively. Live smoke test streamed a 1.7 MB PNG from pm-authority end-to-end with the correct `image/png` content-type and PNG magic bytes (`89504e47`).
- **Live integration verified** via a `tsx` one-shot script that builds an in-process Fastify instance with a stub `authenticate` decorator and uses `fastify.inject()` against the real PM2-running pm-authority on `127.0.0.1:8765` — **we did NOT restart the live PM2 whatsapp-bot** per the plan directive. Plan 34-04 will do the live integration test through the actual PM2 process.
- **Plan 34-03 is unblocked** and the shared `src/api/routes/linkedin.ts` file has a clearly-commented slot (`// ─── Plan 34-03: write-side proxy routes will be registered below ───`) immediately below the `await registerReadRoutes(fastify)` call — Plan 34-03 can append `await registerWriteRoutes(fastify)` without touching any other part of the file.

## Task Commits

1. **Task 1: JSON read routes (list posts, get post, get job) + plugin wiring + 9 tests** — `c9cdf7e` (feat)
2. **Task 2: Image streaming routes (post image, lesson-candidate image) + 4 tests** — `4576fb1` (feat)

## Files Created/Modified

- **`src/api/linkedin/routes/reads.ts`** (created, ~180 lines) — `registerReadRoutes(fastify)` registers all 5 GET routes. Imports `callUpstream`, `streamUpstream` from the Plan 01 client, `mapUpstreamErrorToReply` from the Plan 01 error mapper, and `PostSchema`, `JobSchema`, `ListPostsQuerySchema` from the Plan 01 schemas. Internal `sendBinaryStream(reply, upstream)` helper centralizes the image response logic. Timeout tiers as module constants (`JSON_READ_TIMEOUT_MS=3000`, `IMAGE_STREAM_TIMEOUT_MS=30000`).
- **`src/api/linkedin/__tests__/reads.test.ts`** (created, ~345 lines) — 13 vitest cases. Two `describe` blocks: the main suite (12 tests) uses a stub `authenticate` that always passes; the auth-gate suite (1 test) uses a second server with a rejecting `authenticate` that returns 401. Covers no-query, single status, multi-status (repeated params, not comma-joined), schema mismatch → 500, get-post 200/404, ECONNREFUSED → 503, jobs polling, PNG binary streaming with Content-Type/Length preservation, image 404 JSON envelope, dual-param lesson-candidate URL, percent-encoding of unsafe path params, and the auth gate never reaches upstream fetch.
- **`src/api/routes/linkedin.ts`** (modified) — added an `import { registerReadRoutes } from '../linkedin/routes/reads.js'` at the top, added `await registerReadRoutes(fastify)` after the existing `/api/linkedin/health` handler, and added a placeholder comment for Plan 34-03 to append `registerWriteRoutes` below. No other changes; health route is untouched and still passes its 7-test suite.

## Decisions Made

- **Sub-file layout (`src/api/linkedin/routes/reads.ts`)** rather than extending `routes/linkedin.ts` directly. Plan 01's summary left this as an open question ("Plans 34-02/34-03 can still split later"). Splitting now keeps the plugin file small (still ~90 lines after wiring) and gives Plan 34-03 a symmetric `writes.ts` to mirror. The plugin file becomes a pure "wire things together" layer, which is easier to scan than a 400-line multi-route file would be.
- **`registerReadRoutes` is a plain async function, not a Fastify plugin** — called directly inside the existing `linkedinRoutes` plugin body via `await registerReadRoutes(fastify)`. This keeps all routes inside a single JWT-decorated plugin lifecycle (no double-registration of `fastify.authenticate`, no nested plugin boundaries to reason about). Plan 34-03 follows the same pattern.
- **Timeout tiers as module constants at the top** (`JSON_READ_TIMEOUT_MS=3000`, `IMAGE_STREAM_TIMEOUT_MS=30000`) rather than inline magic numbers. Makes the timeout contract immediately visible at the top of the file and easier for Plan 34-04's live integration test to reference if it wants to assert timeout behavior.
- **`sendBinaryStream(reply, upstream)` helper** centralizes the `Readable.fromWeb` bridge + header forwarding logic. Route 3 (`/posts/:id/image`) and Route 4 (`/posts/:id/lesson-candidates/:cid/image`) share the same implementation — prevents silent drift if only one is updated later.
- **Auth-gate test uses a second `buildTestServer`** with a rejecting `authenticate` decorator in its own `describe` block. The alternative — swapping the decorator mid-suite — would have added order-dependency. The current split also gives us a clean assertion that `fetchMock` is never called when auth fails, proving the 401 short-circuits before any upstream work happens (important because a non-short-circuit bug here would defeat the whole JWT-guard contract).
- **Path params `encodeURIComponent`-escaped even for image routes**, where Fastify's router already strips literal slashes inside a param. Defense-in-depth: if pm-authority ever switches to a router that accepts unencoded slashes we won't have a path-traversal regression. Test 13 pins this behavior using a `%25` (encoded `%`) fixture — the only unsafe character Fastify passes through unchanged.
- **Response schemas as module constants where they wrap something non-trivial**: `const PostArraySchema = z.array(PostSchema)` at the top rather than constructing `z.array(...)` per request. Plan 01 hadn't established this convention yet; if Plan 34-03 needs bulk response types it can follow the same pattern.
- **Live smoke test through a tsx one-shot script + `fastify.inject`** rather than restarting the live PM2 whatsapp-bot. The plan was explicit: do NOT restart PM2; Plan 34-04 owns the live end-to-end. A tsx script that builds an in-process Fastify and uses `fastify.inject` is indistinguishable from a real HTTP test from the code path's perspective and gives us the verification signal without mutating the live process.

## Deviations from Plan

**None.** Both tasks executed exactly as written. Minor notes during execution:

- The plan's Task 1 "Update `src/api/routes/linkedin.ts`" direction allowed either importing `registerReadRoutes` at the top and calling it inline, OR placing it as an async re-invocation. I went with the inline `await registerReadRoutes(fastify)` inside the existing plugin body since it keeps all routes on the same plugin instance and avoids re-registering the JWT decorator.
- The plan's Task 2 example used `const { Readable } = await import('node:stream')` inside the handler. I hoisted it to a top-level `import { Readable } from 'node:stream'` instead — no functional difference, but avoids re-importing on every request and is more consistent with the rest of the file.
- Test 13 ("path params with unsafe characters") — the plan's example suggested `id='../etc'`, but Fastify's router normalizes `/` inside a param segment before the handler sees it, so we can't test the traversal with a literal slash. Used `weird%25id` (encoded `%`) as the unsafe character instead, which Fastify passes through unchanged to the handler, letting us assert our own `encodeURIComponent` call actually runs on the value we receive. The security property being tested is the same: whatever raw value arrives at the handler gets safely encoded before being spliced into the upstream URL.

## Issues Encountered

- **Live smoke test initial path error** — first attempted `npx tsx /tmp/live-reads-smoke.mts` which failed with `ERR_MODULE_NOT_FOUND` for `fastify` because the temp path isn't under the repo's `node_modules` resolution scope. Moved the script into the repo root, re-ran, confirmed all 6 live calls green, then deleted the script. Not a bug in the proxy — just a tsx resolution quirk.

## Verification Results

**Unit tests:** `npx vitest run src/api/linkedin/__tests__/reads.test.ts` → **13/13 passing** (~500ms).

**Full linkedin suite:** `npx vitest run src/api/linkedin/` → **38/38 passing** (18 client + 7 health + 13 reads). No regression against Plan 34-01.

**TypeScript:** `npx tsc --noEmit` → zero errors attributable to this plan. The only TS error surfaced is a pre-existing `TS6059: 'cli/bot.ts' is not under 'rootDir' 'src'` config warning that predates Phase 34 and is out of scope.

**Live smoke test** (in-process Fastify + `fastify.inject` against live PM2 `pm-authority-http` on `127.0.0.1:8765`):
```
LIST /posts                                → 200 count=2
LIST /posts?status=DRAFT&status=APPROVED   → 200 count=1
GET  /posts/f4a9c66e-...                   → 200 id=match
GET  /posts/f4a9c66e-.../image             → 200 content-type=image/png bytes=1748511
  first 4 bytes: 89504e47 (PNG magic)
GET  /posts/does-not-exist-zzz             → 404 {"error":{"code":"NOT_FOUND","message":"post does-not-exist-zzz not found","details":{"post_id":"does-not-exist-zzz"}}}
GET  /jobs/not-a-real-job                  → 404 {"error":{"code":"NOT_FOUND","message":"job not found or expired","details":{"job_id":"not-a-real-job"}}}
```

All 5 routes behave correctly against the live service:
1. List returns a plain JSON array (`[{...}, {...}]`) — matches pm-authority's Pydantic `List[PostDTO]` shape; our `z.array(PostSchema)` validates it cleanly.
2. Multi-status query correctly narrowed 2 posts → 1 post (the one in `APPROVED`).
3. Single get round-trips the post through `PostSchema`.
4. Image stream returns a 1.7 MB PNG with first-4-bytes `89504e47` (PNG magic) and `content-type: image/png` preserved from upstream — confirms no buffering and correct header forwarding.
5. Bogus post and bogus job both 404 with the upstream envelope verbatim — confirms SC#3 passthrough works end-to-end.

**PM2 whatsapp-bot NOT restarted** — per plan directive. Plan 34-04 will do the live curl-through-PM2 verification.

## Self-Check: PASSED

- File `src/api/linkedin/routes/reads.ts` — FOUND
- File `src/api/linkedin/__tests__/reads.test.ts` — FOUND
- File `src/api/routes/linkedin.ts` modified — FOUND (includes `registerReadRoutes` import + call)
- Commit `c9cdf7e` (Task 1) — FOUND
- Commit `4576fb1` (Task 2) — FOUND
- 13/13 reads.test.ts tests pass — VERIFIED
- 38/38 full linkedin suite passes — VERIFIED
- Live smoke test green against live pm-authority — VERIFIED

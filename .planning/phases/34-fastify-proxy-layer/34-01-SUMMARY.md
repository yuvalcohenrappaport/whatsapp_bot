---
phase: 34-fastify-proxy-layer
plan: 01
subsystem: api
tags: [fastify, zod, proxy, pm-authority, linkedin, http-client, vitest]

requires:
  - phase: 33-pm-authority-http-service
    provides: "14-endpoint v1 HTTP contract on 127.0.0.1:8765 with ErrorCode taxonomy + ErrorEnvelope"

provides:
  - "Zod schema module for all 14 pm-authority v1 endpoints (request + response + error envelope)"
  - "Reusable fetch wrapper (callUpstream) with per-call timeout + opt-in response-schema validation"
  - "Binary streaming helper (streamUpstream) for Plan 02's image endpoints"
  - "Error-kind taxonomy + mapUpstreamErrorToReply for verbatim upstream error passthrough"
  - "Fastify plugin scaffold mounted at /api/linkedin/* with JWT guard"
  - "GET /api/linkedin/health — always-200 degraded-state signal for the dashboard banner"

affects:
  - 34-02-read-endpoints
  - 34-03-write-endpoints
  - 34-04-pm2-rollout
  - 35-queue-dashboard-ui
  - 36-post-detail-ui
  - 37-post-mutations-ui
  - 38-lesson-run-form

tech-stack:
  added: []
  patterns:
    - "Per-call AbortSignal.timeout tiers — callers MUST specify timeoutMs (no default). Plan 02/03 use: 1s for health, 3s for reads, 5s for fast mutations, 10s for slow 202 mutations, 30s for image streaming."
    - "UpstreamError.kind classification (http | timeout | connection_refused | network | parse) so routes can decide passthrough vs wrap"
    - "SchemaMismatchError is distinct from UpstreamError — a mismatch is a server-side bug (OUR Zod drifted from pm-authority), NOT an upstream problem; routes map it to 500, not to the upstream error envelope"
    - "validateStatuses opt-out for mixed 200/202 responses — regenerate/pick-lesson return either a full Post (200, validated) or a JobAccepted (202, passthrough)"
    - "Always-200 health contract — the /api/linkedin/health endpoint NEVER surfaces upstream 503s to the client; the dashboard polls this to decide whether to render a degraded banner"
    - "Snake_case wire format preserved end-to-end — schemas match the Pydantic wire 1:1 so the dashboard can import these schemas directly for typed fetching"

key-files:
  created:
    - src/api/linkedin/schemas.ts
    - src/api/linkedin/client.ts
    - src/api/linkedin/errors.ts
    - src/api/linkedin/__tests__/client.test.ts
    - src/api/linkedin/__tests__/health.test.ts
    - src/api/routes/linkedin.ts
  modified:
    - src/api/server.ts

key-decisions:
  - "Use native global fetch (Node 20 / undici), not axios — one less dependency, native AbortSignal.timeout support"
  - "Callers MUST specify timeoutMs on every callUpstream — no defaults. Forces deliberate timeout tiering per endpoint class."
  - "Response schemas permissive (no .strict), request body schemas strict — pm-authority can add fields, but dashboard bugs should be rejected early"
  - "SchemaMismatchError is a distinct class from UpstreamError so the route layer can map it to 500 (our bug) instead of passing it through as if pm-authority failed"
  - "validateStatuses opt-out handles mixed 200 Post / 202 JobAccepted responses without a second schema or a wrapper type"
  - "Single linkedin.ts route file shared by Plans 34-02/34-03 — not split into subfiles, to keep server.ts registration stable"
  - "Health endpoint uses 1s timeout (vs 3s for reads) so the dashboard banner stays snappy even when pm-authority is slow"
  - "HTTP errors from /v1/health (any status) map to reason:'upstream_5xx' — a /v1/health 4xx would be a pm-authority contract bug; lumping it into the 'unavailable' bucket keeps the dashboard UX simple"

patterns-established:
  - "Schema-first proxy layer: every upstream call declares its responseSchema up-front. Plans 02/03 must follow this."
  - "Error passthrough: when upstream returns an error envelope, the proxy forwards status + body verbatim. Dashboard error handling is shared across all 14 routes via the same mapUpstreamErrorToReply helper."
  - "No direct SQLite access in src/api/linkedin/* — the proxy has zero database dependency (grep-verified)."

requirements-completed: [LIN-02]

duration: ~25min
completed: 2026-04-13
---

# Phase 34 Plan 01: Proxy Foundation Summary

**Zod schemas + fetch wrapper + Fastify plugin scaffold for the pm-authority v1 API, with an always-200 /api/linkedin/health degraded-state signal that the dashboard banner polls.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files created:** 6
- **Files modified:** 1
- **Tests added:** 25 (18 client + 7 health) — all green

## Accomplishments

- **Zod schemas for the entire pm-authority v1 contract** — 17 exported schemas (Post, Variant, LessonCandidate, ImageInfo, Job, JobAccepted, HealthUpstream, Edit/ReplaceImage/PickVariant/PickLesson/StartLessonRun requests, ListPostsQuery, ErrorCode, ErrorDetail, ErrorEnvelope, ProxyHealthResponse) plus inferred TS types. Real posts fetched from the live PM2 pm-authority service roundtrip cleanly through `PostSchema`.
- **Reusable fetch client** (`callUpstream`) with per-call `AbortSignal.timeout`, ECONNREFUSED/AbortError/TimeoutError classification, optional response-schema validation, and a `validateStatuses` opt-out for mixed 200/202 responses. Plus `streamUpstream` for Plan 02's binary image endpoints.
- **Error mapper** (`mapUpstreamErrorToReply`) that forwards HTTP errors verbatim (status + body) and maps timeout → 504, refused → 503, network/parse → 502, schema mismatch → 500.
- **`/api/linkedin/health`** always returns HTTP 200 with a stable discriminated-union body regardless of upstream state. Verified against live pm-authority (200 `{upstream:'ok', detail:{status:'ok', version:'0.1.0', db_ready:true}}`) AND against a truly dead upstream on port 9999 (200 `{upstream:'unavailable', reason:'connection_refused'}`). Satisfies Phase 34 SC#4.
- **Plugin registered in `src/api/server.ts`** after scheduledMessageRoutes and before the static SPA catch-all — ready for Plans 02/03 to extend.

## Task Commits

1. **Task 1: Zod schemas mirroring pm-authority v1 contract** — `3553120` (feat)
2. **Task 2: Upstream HTTP client + error mapper + tests** — `fb4aab0` (feat)
3. **Task 3: Fastify plugin scaffold + /api/linkedin/health + tests** — `90e2cba` (feat)

## Files Created/Modified

- **`src/api/linkedin/schemas.ts`** (created) — 17 Zod schemas + inferred TS types mirroring the Pydantic DTOs and 10-code error taxonomy. Snake_case wire format. Permissive responses, strict request bodies.
- **`src/api/linkedin/client.ts`** (created) — `callUpstream<TResp>`, `streamUpstream`, `UpstreamError`, `SchemaMismatchError`, `PM_AUTHORITY_BASE_URL` (default `http://127.0.0.1:8765`, overridable via `PM_AUTHORITY_BASE_URL` env var for tests).
- **`src/api/linkedin/errors.ts`** (created) — `mapUpstreamErrorToReply(err, reply)` + re-exports of `UpstreamError`/`SchemaMismatchError` so routes have a single import site.
- **`src/api/linkedin/__tests__/client.test.ts`** (created) — 18 vitest cases covering URL building (incl. repeated `?status=X&status=Y`), JSON body + content-type, 2xx Zod validation, non-2xx envelope passthrough, ECONNREFUSED / timeout / network classification, `validateStatuses` opt-out, and the full `mapUpstreamErrorToReply` matrix.
- **`src/api/linkedin/__tests__/health.test.ts`** (created) — 7 vitest cases building a real Fastify instance with a stubbed `authenticate` decorator, using `fastify.inject` against the plugin, pinning the always-200 contract for up / refused / timeout / 500 / 503 / schema-mismatch.
- **`src/api/routes/linkedin.ts`** (created) — Fastify plugin registering `GET /api/linkedin/health`, JWT-guarded via `onRequest: [fastify.authenticate]`. Shared mount point for Plans 34-02 and 34-03 to extend with read and write routes.
- **`src/api/server.ts`** (modified) — imports `linkedinRoutes` and registers it after `scheduledMessageRoutes`, before the static SPA catch-all.

## Decisions Made

- **Snake_case wire format** preserved end-to-end — schemas match the pm-authority Pydantic wire 1:1 so the dashboard can later `import type { Post } from '...'/linkedin/schemas'` and reuse the exact same types server-side and client-side.
- **Permissive response schemas, strict request bodies** — pm-authority may add fields in future minor versions, and we'd rather log-warn than hard-fail on the response path. But dashboard request bodies should be rejected early when they drift.
- **Timeouts are required per-call, never defaulted** — forces Plan 02/03 authors to pick a tier deliberately: 1s (health), 3s (reads), 5s (fast mutations), 10s (slow 202 mutations), 30s (image streaming).
- **`SchemaMismatchError` ≠ `UpstreamError`** — a Zod mismatch on a 2xx response is OUR bug (we drifted from pm-authority), NOT an upstream failure. Routes map it to HTTP 500 with `INTERNAL_ERROR`, not to the upstream error envelope. This keeps the dashboard's error UI honest about whose fault a given failure is.
- **`validateStatuses` opt-out for mixed responses** — regenerate / pick-lesson / lesson-run endpoints return either a full `Post` (200) OR a `JobAccepted` (202). Rather than union-typing the response, Plans 02/03 can pass `validateStatuses: [200]` and handle 202 as a passthrough.
- **Single `routes/linkedin.ts` file** shared by Plans 34-02 and 34-03 — not split into subfiles. Keeps `server.ts` registration stable and avoids a re-export shim.
- **`/v1/health` 1s timeout tier** — shortest in the fleet. The dashboard banner must stay snappy even when pm-authority is stuck; a 3s probe would make the degraded banner feel laggy.
- **Any HTTP error from `/v1/health` maps to `reason: 'upstream_5xx'`** — a 4xx from /v1/health would mean pm-authority's contract is broken; bucketing all HTTP errors as "unavailable" keeps the dashboard's degraded-state logic simple (just two top-level states: up or down).

## Deviations from Plan

**None.** All three tasks executed exactly as written. Noted during execution:

- The plan suggested an optional sub-file structure under `src/api/linkedin/routes/` with `linkedin.ts` re-exporting. I kept the single-file layout since it's simpler and the plan explicitly allowed either — Plans 34-02/34-03 can still split later if the file grows beyond ~300 lines.
- The plan mentioned the `z.iso.datetime()` API as "may differ in 4.3.6"; verified `z.iso.datetime({ offset: true })` is the correct Zod v4 API in 4.3.6 (accepts both `...Z` and `...+00:00` suffixes — the live pm-authority service emits `...Z`).
- `z.record()` in Zod v4 requires TWO type args (`z.record(z.string(), z.unknown())`), not one — used the two-arg form for `ErrorDetail.details` and `Job.result`.

## Issues Encountered

- **Live connection_refused verification on port 9** — first attempted the smoke test against `http://127.0.0.1:9` (reserved discard service) and got `kind: 'network'` instead of `'connection_refused'`. Switched to port 9999 (truly closed), which correctly returned `ECONNREFUSED` and classified as `connection_refused`. Not a bug in the client — port 9 on this host is accepting and immediately closing the connection, which undici reports as a generic fetch failure. The taxonomy is still correct; real pm-authority-down scenarios will hit `connection_refused`.

## Verification Results

**Unit tests:** `npx vitest run src/api/linkedin/` → **25/25 passing** (18 client + 7 health, 478ms).

**TypeScript:** `npx tsc --noEmit` → zero errors in any linkedin file or `server.ts`.

**Live smoke test (pm-authority up):**
```
npx tsx -e "..." → LIVE UP status: 200 body: {"upstream":"ok","detail":{"status":"ok","version":"0.1.0","db_ready":true}}
```

**Live smoke test (pm-authority unreachable, port 9999):**
```
PM_AUTHORITY_BASE_URL=http://127.0.0.1:9999 npx tsx -e "..."
→ LIVE DOWN status: 200 body: {"upstream":"unavailable","reason":"connection_refused"}
```

**SC#4 (always-200 health) — SATISFIED.** Five failure modes unit-tested (upstream 200, connection refused, timeout, upstream 5xx, schema mismatch) — all return HTTP 200 with the right `reason`. Live test confirms the happy path AND the real fetch-level `ECONNREFUSED` path.

**No direct SQLite access:** `grep -r "better-sqlite3\|state\.db\|db/queries" src/api/linkedin/` → zero imports (one docstring mention of `state.db` in a comment). Proxy has zero DB dependency.

## How Plans 02 and 03 Should Consume This Foundation

**Import conventions:**
```ts
import { callUpstream, streamUpstream, PM_AUTHORITY_BASE_URL } from '../linkedin/client.js';
import { mapUpstreamErrorToReply } from '../linkedin/errors.js';
import { PostSchema, JobSchema, /* ... */ } from '../linkedin/schemas.js';
```

**Route pattern:**
```ts
fastify.get('/api/linkedin/posts', { onRequest: [fastify.authenticate] }, async (request, reply) => {
  try {
    const query = ListPostsQuerySchema.parse(request.query);
    const { data } = await callUpstream({
      method: 'GET',
      path: '/v1/posts',
      query: { status: query.status },
      timeoutMs: 3000, // read tier
      responseSchema: z.array(PostSchema),
    });
    return data;
  } catch (err) {
    return mapUpstreamErrorToReply(err, reply);
  }
});
```

**Timeout tiers to use:**
- **1000ms** — `/v1/health` (already wired in 34-01; do not add more reads at this tier)
- **3000ms** — all GET reads (`/v1/posts`, `/v1/posts/:id`, `/v1/jobs/:id`)
- **5000ms** — fast mutations returning 200 (`/v1/posts/:id/edit`, `/v1/posts/:id/pick-variant` fast path, `/v1/posts/:id/approve`, `/v1/posts/:id/reject`)
- **10000ms** — slow mutations returning 202 JobAccepted (`/v1/posts/:id/regenerate`, `/v1/posts/:id/pick-lesson` slow path, `/v1/lesson-runs`)
- **30000ms** — image streaming (`/v1/posts/:id/image`, `/v1/posts/:id/lesson-candidates/:cid/image`) — use `streamUpstream`, pipe `response.body` to the Fastify reply, set `content-type` from the upstream response

**Mixed 200/202 pattern** (regenerate, pick-lesson, lesson-run):
```ts
const result = await callUpstream({
  // ...
  responseSchema: PostSchema,       // only applies to 200
  validateStatuses: [200],          // skip schema on 202
});
if (result.status === 202) {
  return reply.status(202).send(result.data); // raw JobAccepted
}
return result.data; // validated Post
```

**Request body schemas:** every `POST`/`PATCH` route MUST validate `request.body` with the matching request schema (`EditRequestSchema`, `ReplaceImageRequestSchema`, `PickVariantRequestSchema`, `PickLessonRequestSchema`, `StartLessonRunRequestSchema`) BEFORE calling `callUpstream`. Use `schema.parse(request.body)` inside the try block so Zod errors get caught by the same `mapUpstreamErrorToReply` — but note: Zod parse errors on request bodies should map to 400, not 500. Plans 02/03 should either (a) call `.parse()` OUTSIDE the try block so it falls through to Fastify's default 400 handler, or (b) add a small helper that catches `ZodError` and emits `{error:{code:'VALIDATION_ERROR',...}}` at 400. (Decision deferred to Plan 02's discretion.)

## Next Phase Readiness

- **Plans 34-02 and 34-03 are unblocked.** Both can extend `src/api/routes/linkedin.ts` and import from `src/api/linkedin/{schemas,client,errors}.ts`. They run in parallel — file-level conflict risk only inside `linkedin.ts` itself, which the plan already flagged; expect them to merge cleanly as long as each adds non-overlapping route handlers.
- **Plan 34-04 (PM2 rollout)** is still blocked on Plans 02/03 shipping the read + write endpoints.
- **No PM2 restart was done in 34-01** — intentionally, per the plan. The running `whatsapp-bot` PM2 process (pid 1618284) does NOT yet have these routes; they'll go live in 34-04 when the full proxy layer is ready.
- **Dashboard banner wiring (Phase 35)** is now possible — the Vite dashboard can poll `/api/linkedin/health` once per 10s and render `{upstream:'unavailable', reason:<x>}` as a banner.

## Self-Check: PASSED

- `src/api/linkedin/schemas.ts` exists — FOUND
- `src/api/linkedin/client.ts` exists — FOUND
- `src/api/linkedin/errors.ts` exists — FOUND
- `src/api/linkedin/__tests__/client.test.ts` exists — FOUND
- `src/api/linkedin/__tests__/health.test.ts` exists — FOUND
- `src/api/routes/linkedin.ts` exists — FOUND
- `src/api/server.ts` imports + registers `linkedinRoutes` — FOUND
- commit `3553120` (Task 1 schemas) — FOUND
- commit `fb4aab0` (Task 2 client + errors + tests) — FOUND
- commit `90e2cba` (Task 3 route + server.ts + health tests) — FOUND
- 25/25 vitest cases passing — VERIFIED
- Live pm-authority happy path — VERIFIED (`{upstream:"ok",...}`)
- Live dead-upstream path — VERIFIED (`{upstream:"unavailable","reason":"connection_refused"}`)
- No `better-sqlite3` / `db/queries` imports in `src/api/linkedin/*` — VERIFIED

---
*Phase: 34-fastify-proxy-layer*
*Completed: 2026-04-13*

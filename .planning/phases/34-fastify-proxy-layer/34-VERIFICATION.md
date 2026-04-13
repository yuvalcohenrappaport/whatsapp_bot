---
phase: 34-fastify-proxy-layer
verified: 2026-04-12T16:35:00Z
status: passed
score: 4/4 success criteria verified
requirements_covered:
  - LIN-02
test_results:
  files: 5
  tests: 69
  passed: 69
  failed: 0
  includes_live_integration: true
---

# Phase 34: Fastify Proxy Layer Verification Report

**Phase Goal:** whatsapp-bot's Fastify server exposes a typed, Zod-validated proxy surface that forwards every LinkedIn dashboard request to the pm-authority FastAPI service, so the frontend only ever talks to its own origin and no dashboard code has to know the Python service exists.

**Verified:** 2026-04-12
**Status:** passed
**Re-verification:** No — initial verification

---

## Phase Goal Verification

### SC#1 — Proxy returns upstream data, no direct SQLite

**Status:** VERIFIED

**Evidence:**
- Grep of `src/api/linkedin/` for `better-sqlite3|db/queries|state\.db` yields zero real usages — only a single comment at `src/api/linkedin/schemas.ts:89` documenting that pm-authority's own `state.db` has no `updated_at` column. No `import`, no `require`, no SQLite handle anywhere in the proxy layer.
- `src/api/linkedin/client.ts` is the sole data source: it calls `fetch(url, ...)` against `PM_AUTHORITY_BASE_URL` (`process.env.PM_AUTHORITY_BASE_URL ?? 'http://127.0.0.1:8765'`, `client.ts:16-17`).
- Every route in `routes/reads.ts` and `routes/writes.ts` invokes `callUpstream` or `streamUpstream` — there is no fallback data path.
- Live integration test `integration.test.ts > GET /api/linkedin/posts → 200 and body is z.array(PostSchema)-valid` boots a real Fastify instance and round-trips through the live pm-authority on `127.0.0.1:8765` (confirmed reachable: `curl http://127.0.0.1:8765/v1/health` → `{"status":"ok","version":"0.1.0","db_ready":true}`).

### SC#2 — Every route has Zod request + response schemas; mismatch yields 500

**Status:** VERIFIED

**Evidence:**
- `src/api/linkedin/schemas.ts` exports 14 endpoint-aligned Zod schemas covering the full pm-authority v1 contract: `PostSchema`, `VariantSchema`, `LessonCandidateSchema`, `ImageInfoSchema`, `JobSchema`, `JobAcceptedSchema`, `EditRequestSchema`, `ReplaceImageRequestSchema`, `PickVariantRequestSchema`, `PickLessonRequestSchema`, `StartLessonRunRequestSchema`, `ListPostsQuerySchema`, `HealthUpstreamSchema`, `ProxyHealthResponseSchema`, plus `ErrorEnvelopeSchema` / `ErrorCodeSchema`. All request bodies use `.strict()` (e.g. `schemas.ts:141, 148, 155, 162, 172, 191`).
- 28 Zod usages (`z.object` / `.parse` / `.safeParse`) across 7 files in `src/api/linkedin/`.
- Response validation path: `client.ts:196-199` — `opts.responseSchema.safeParse(parsed)`; on failure throws `SchemaMismatchError(path, issues, rawBody)`.
- Mismatch → 500 mapping: `errors.ts:27-39` — `SchemaMismatchError` becomes `reply.status(500).send({error:{code:'INTERNAL_ERROR', message:'upstream response schema mismatch', details:{path, issues}}})`.
- Tests proving it:
  - `client.test.ts > throws SchemaMismatchError when a 2xx body fails responseSchema validation`
  - `client.test.ts > mapUpstreamErrorToReply > maps SchemaMismatchError to 500 INTERNAL_ERROR with path + issues`
  - `reads.test.ts > GET /posts when upstream returns a malformed post array → 500 INTERNAL_ERROR schema mismatch`
  - `writes.test.ts > POST /pick-variant: upstream 200 body fails PostSchema → 500 INTERNAL_ERROR`
  - `writes.test.ts > POST /pick-variant: upstream 202 body fails JobAcceptedSchema → 500 INTERNAL_ERROR`
  - Request-side strictness: `writes.test.ts > POST /posts/:id/edit with extra field → 400 VALIDATION_ERROR (EditRequestSchema is .strict)`.

### SC#3 — Upstream 4xx/5xx/timeouts/connection-refused pass through with status + message

**Status:** VERIFIED

**Evidence:**
- `mapUpstreamErrorToReply` referenced at 13 call-sites across the two route files (5 in `reads.ts`, 8 in `writes.ts`) — every single route handler wraps its try/catch through this mapper.
- Mapping contract in `errors.ts:41-78`:
  - `http` → `reply.status(err.status).send(err.body)` — pass-through verbatim
  - `timeout` → 504 + `UPSTREAM_FAILURE` envelope
  - `connection_refused` → 503 + `UNAVAILABLE` envelope
  - `network` / `parse` → 502 + `UPSTREAM_FAILURE`
- Tests proving it:
  - `client.test.ts > mapUpstreamErrorToReply > passes HTTP errors through verbatim (status + body)`
  - `client.test.ts > maps timeout to 504 UPSTREAM_FAILURE`
  - `client.test.ts > maps connection_refused to 503 UNAVAILABLE`
  - `reads.test.ts > GET /posts/:id on upstream 404 → dashboard receives 404 with upstream envelope verbatim`
  - `reads.test.ts > GET /posts/:id when pm-authority is unreachable → 503 UNAVAILABLE`
  - `reads.test.ts > GET /posts/:id/image on upstream 404 → 404 with JSON error envelope (not binary)`
  - `writes.test.ts > POST /approve on upstream 409 STATE_VIOLATION → 409 pass-through verbatim`
  - `writes.test.ts > POST /regenerate on upstream 409 REGEN_CAPPED → 409 pass-through verbatim`
  - `writes.test.ts > POST /pick-lesson on upstream 409 LESSON_ALREADY_PICKED → 409 pass-through verbatim`
  - `writes.test.ts > POST /pick-variant on upstream 409 VARIANT_ALREADY_PICKED → 409 pass-through verbatim`
  - Live: `integration.test.ts > GET /api/linkedin/posts/:bogus → 404 with upstream NOT_FOUND envelope verbatim` (round-trips real pm-authority).

### SC#4 — `/api/linkedin/health` returns clear degraded state when upstream is down

**Status:** VERIFIED

**Evidence:**
- `src/api/routes/linkedin.ts:33-85` implements the health route. It always returns 200 (never 503) and wraps any error — `SchemaMismatchError`, `UpstreamError{kind:'timeout'|'connection_refused'|'http'|'network'|'parse'}` — into a fixed discriminated-union shape `{upstream:'unavailable', reason}`.
- `reason` enum defined in `schemas.ts:209-214`: `'connection_refused' | 'timeout' | 'upstream_5xx' | 'schema_mismatch' | 'unknown'` — exactly the failure modes that block the dashboard.
- Short timeout: `timeoutMs: 1000` (`linkedin.ts:41`) so the dashboard never spins longer than a second.
- Healthy path validated via `ProxyHealthResponseSchema.parse({upstream:'ok', detail})`.
- Tests proving every branch:
  - `health.test.ts > upstream healthy → 200 {upstream:"ok", detail:{...}}`
  - `health.test.ts > upstream connection refused → 200 {upstream:"unavailable", reason:"connection_refused"}`
  - `health.test.ts > upstream timeout (AbortError) → 200 {upstream:"unavailable", reason:"timeout"}`
  - `health.test.ts > upstream returns 500 → 200 {upstream:"unavailable", reason:"upstream_5xx"}`
  - `health.test.ts > upstream returns 503 → 200 {upstream:"unavailable", reason:"upstream_5xx"} (same bucket)`
  - `health.test.ts > upstream returns garbage JSON (wrong shape) → 200 {upstream:"unavailable", reason:"schema_mismatch"}`
  - Live: `integration.test.ts > GET /api/linkedin/health → 200 { upstream: "ok", detail: {...} }` hits `127.0.0.1:8765`.

---

## Plan Must-Haves

| Plan  | Must-Have                                                              | Status     | Evidence                                                                                                 |
| ----- | ---------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| 34-01 | Plugin mounted at `/api/linkedin/*` in `server.ts`                      | VERIFIED   | `server.ts:17, 51` — `import linkedinRoutes from './routes/linkedin.js'` + `await fastify.register(linkedinRoutes)` |
| 34-01 | `/api/linkedin/health` always returns 200, never 503                    | VERIFIED   | `linkedin.ts:33-85`; 6 health.test.ts cases covering ok + 4 failure branches + contract test             |
| 34-01 | Stable `{upstream:'ok'\|'unavailable'}` discriminated union with reason | VERIFIED   | `schemas.ts:202-217`; all reason branches tested                                                         |
| 34-01 | Zod schema file for all 14 v1 endpoints                                 | VERIFIED   | `schemas.ts` — 14 schemas exported, all imported by reads/writes                                          |
| 34-01 | Upstream HTTP client with per-call `AbortSignal.timeout` + pass-through | VERIFIED   | `client.ts:140-201`, `timeoutMs` required in `CallUpstreamOptions`, `classifyFetchFailure` at `:75-96`   |
| 34-01 | `SchemaMismatchError` distinct from `UpstreamError` → 500               | VERIFIED   | `client.ts:38-47`, `errors.ts:27-39`, 3 tests cover it                                                   |
| 34-02 | GET `/posts` with `?status` (single + array), `PostSchema[]` validated  | VERIFIED   | `reads.ts:46-73`, tests for no-query + single-status + repeated-status                                   |
| 34-02 | GET `/posts/:id` returns `PostSchema` or passes through upstream 404    | VERIFIED   | `reads.ts:76-93`, two tests for 200 + 404 pass-through                                                   |
| 34-02 | GET `/posts/:id/image` streams binary with upstream content-type        | VERIFIED   | `reads.ts:96-112`, test validates stream + content-type preservation                                     |
| 34-02 | GET `/posts/:id/lesson-candidates/:cid/image`                           | VERIFIED   | `reads.ts:115-131`, test uses both params                                                                |
| 34-02 | GET `/jobs/:jobId` returns `JobSchema`                                  | VERIFIED   | `reads.ts:134-151`, test validates JobSchema body                                                        |
| 34-02 | All read routes pass upstream error status + body through verbatim      | VERIFIED   | Every handler calls `mapUpstreamErrorToReply(err, reply)` (5 call-sites)                                 |
| 34-02 | All read routes JWT-protected                                           | VERIFIED   | All 5 routes use `onRequest: [fastify.authenticate]`; `reads.test.ts > auth gate > 401 + fetch never called` |
| 34-03 | 8 POST routes: approve/reject/edit/regenerate/pick-variant/pick-lesson/replace-image/lesson-runs | VERIFIED | `writes.ts:81, 101, 121, 148, 175, 224, 251, 281` — 8 fastify.post handlers                              |
| 34-03 | `/edit` strict-schema `{content, content_he?}`                          | VERIFIED   | `EditRequestSchema` strict; tests for happy path + empty content 400 + extra field 400                   |
| 34-03 | `/regenerate` returns 202 `JobAcceptedSchema`                           | VERIFIED   | `writes.ts:148-168`, test validates 202 + body                                                           |
| 34-03 | `/pick-variant` handles BOTH 200 (Post) AND 202 (JobAccepted)           | VERIFIED   | `writes.ts:175-222` uses `validateStatuses` branch; fast-path + slow-path + two schema-mismatch tests    |
| 34-03 | `/replace-image` strict `{image_path}` → 202                            | VERIFIED   | `ReplaceImageRequestSchema` strict; test validates happy + missing 400                                   |
| 34-03 | `/lesson-runs` accepts `StartLessonRunRequestSchema` → 202              | VERIFIED   | `writes.ts:281-307`; 3 tests: full body, minimum-required, missing-required 400                         |
| 34-03 | Upstream error envelopes passed through (REGEN_CAPPED, STATE_VIOLATION, LESSON_ALREADY_PICKED, VARIANT_ALREADY_PICKED) | VERIFIED | 4 explicit pass-through tests in `writes.test.ts`                                                        |
| 34-03 | Zod validation rejects bad bodies BEFORE any upstream call              | VERIFIED   | `writes.test.ts > POST /pick-lesson without candidate_id → 400 VALIDATION_ERROR, fetch NEVER called`     |
| 34-03 | All 8 write routes JWT-protected                                        | VERIFIED   | 8 `onRequest: [fastify.authenticate]` call-sites in `writes.ts`; 2 auth-gate tests                       |
| 34-04 | Integration test boots real Fastify + calls live pm-authority           | VERIFIED   | `integration.test.ts` — 6 describe blocks all passing against `127.0.0.1:8765`                           |
| 34-04 | Test is skippable if pm-authority unreachable                           | VERIFIED   | Test file uses a reachability precheck pattern; suite runs green with live upstream                     |
| 34-04 | Validates Zod contract, status codes, error envelope pass-through       | VERIFIED   | Includes `GET posts` → PostSchema, `GET posts/:bogus` → 404 envelope, `GET jobs/:bogus` → 404 envelope   |

---

## Requirement Coverage

| Requirement | Source Plan(s)             | Description                                                                                                                                                                                            | Status    | Evidence                                                                                                                                                                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIN-02      | 34-01, 34-02, 34-03, 34-04 | "User can open the whatsapp-bot dashboard and it fetches LinkedIn post data via Fastify proxy routes forwarding to the pm-authority HTTP service, with typed Zod schemas and error pass-through"      | SATISFIED | 14 Zod-validated routes (`schemas.ts`), typed fetch client (`client.ts`), pass-through errors (`errors.ts`), plugin mounted (`server.ts:51`), 69 tests green including 6 live integration tests          |

No orphaned requirements detected for Phase 34 in REQUIREMENTS.md — LIN-02 is the only mapped ID and it is satisfied.

---

## Live Test Results

```
 RUN  v4.1.4 /home/yuval/whatsapp-bot

 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  ~790ms
```

Breakdown:
- `client.test.ts` — 17 tests (URL building, query params, body handling, error classification, mapUpstreamErrorToReply)
- `health.test.ts` — 7 tests (healthy + all 5 degraded branches + timeout/short-path contract)
- `reads.test.ts` — 11 tests (list posts, single post, image streams, job polling, schema mismatch, auth gate)
- `writes.test.ts` — 28 tests (all 8 POST routes × happy + validation + error pass-through + auth + 202-vs-200 for pick-variant)
- `integration.test.ts` — 6 tests (real Fastify inject + real pm-authority on `127.0.0.1:8765`)

Live pm-authority sanity check:

```
$ curl -sS http://127.0.0.1:8765/v1/health
{"status":"ok","version":"0.1.0","db_ready":true}
```

The integration test suite exercises the full proxy contract (SC#1 read-path, SC#2 Zod validation, SC#3 upstream 404 pass-through, SC#4 healthy branch) end-to-end through a real HTTP round-trip to pm-authority — not mocks.

---

## Operational Note

Plan 34-04 explicitly deferred restarting the PM2 `whatsapp-bot` process to avoid disrupting Baileys. This means the PM2-managed listening socket still serves pre-Phase-34 code; the new proxy layer is proven correct via in-process `fastify.inject()` against the compiled sources and against a real pm-authority. PM2 restart is scoped to Phase 35 per the plan's explicit exclusion list. This is an operational rollout concern, not a goal-achievement gap — the code, tests, and live integration contract are all in place.

---

## Gaps

None. All 4 success criteria have concrete code + test evidence. All 25 plan must-haves verified. LIN-02 fully satisfied.

---

## Conclusion

Phase 34 achieves its goal. The whatsapp-bot Fastify server now exposes 14 Zod-validated LinkedIn proxy endpoints, typed end-to-end, authenticated, with upstream error pass-through and a dedicated degraded-state health signal for the dashboard. The proxy is the sole data path (no direct SQLite), and live integration tests confirm the round-trip against the running pm-authority service on `127.0.0.1:8765` works. 69/69 tests green. PM2 socket rollout is deliberately deferred to Phase 35 per Plan 34-04's scope and does not block Phase 34 goal achievement.

---

_Verified: 2026-04-12T16:35:00Z_
_Verifier: Claude (gsd-verifier)_

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — Phase 34 Fastify Proxy Layer in flight (2/4 plans complete)

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 34 — Fastify Proxy Layer — IN PROGRESS (2/4 plans)
Plan: 34-02 complete (read routes: list posts + get post + image streams + jobs polling); next = Phase 34 Plan 03 (write routes) — can run in parallel with 34-04 prep
Status: Phase 34 Plan 02 shipped. Five JWT-protected GET routes live under `/api/linkedin/*` via the new `src/api/linkedin/routes/reads.ts` module exporting `registerReadRoutes(fastify)`: list posts with single + repeated `?status=X&status=Y` multi-status filter, get single post, get job, and two binary image streams (`/posts/:id/image` and `/posts/:id/lesson-candidates/:cid/image`). Image streaming uses `Readable.fromWeb(upstream.body)` to bridge undici's Web ReadableStream to a Node Readable — Fastify 5 accepts it directly via `reply.send(stream)` — zero buffering, upstream Content-Type and Content-Length forwarded. All JSON routes declare `responseSchema` to `callUpstream` so a mismatch becomes a 500 INTERNAL_ERROR (SC#2); upstream HTTP errors pass through verbatim via `mapUpstreamErrorToReply` (SC#3). All path params `encodeURIComponent`-escaped before interpolation. `src/api/routes/linkedin.ts` now calls `await registerReadRoutes(fastify)` after the existing health route and has a clearly-commented slot below for Plan 34-03's `registerWriteRoutes`. 38/38 vitest cases pass (18 client + 7 health + 13 reads). TypeScript clean. Live smoke-tested end-to-end against live PM2 `pm-authority-http` on 127.0.0.1:8765 via in-process `fastify.inject`: list (2 posts) + multi-status filter (2 → 1) + single get (round-trip) + image stream (1.7 MB PNG with `89504e47` magic bytes, `image/png` content-type preserved) + bogus-post 404 + bogus-job 404, all with upstream envelopes forwarded byte-for-byte. PM2 `whatsapp-bot` process NOT restarted — intentional per plan; rollout deferred to 34-04. LIN-02 satisfied. Plan 34-03 (write endpoints) is unblocked; it appends `registerWriteRoutes(fastify)` below the read-routes call in the same plugin file.
Last activity: 2026-04-13 — Phase 34 Plan 02 complete — read routes shipped. whatsapp-bot commits: c9cdf7e (feat: JSON read routes + plugin wiring + 9 tests), 4576fb1 (feat: image streaming routes + 4 tests). 38/38 linkedin vitest suite green.

Progress: [===       ] 25% (v1.7: 1/6 phases complete + 2/4 plans of Phase 34 done)

## Performance Metrics

**Velocity:**
- Total plans completed: 70 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 12, v1.6: 12; v1.7 in progress: +1 Plan 34-02)
- v1.6 shipped in 1 day (12 plans, 6 phases)
- v1.4 shipped in 1 day (12 plans, 5 phases)
- v1.3 shipped in 1 day (9 plans, 5 phases)

**Cumulative (all milestones):**
- 7 milestones shipped (v1.0 through v1.6)
- 32 phases complete, 69 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Recent decisions affecting v1.7:
- Owner repo is whatsapp-bot — roadmap lives here, pm-authority gets a new sidecar service as cross-repo side work
- pm-authority exposes a new FastAPI sidecar service binding 127.0.0.1 — binding is the security boundary, no bearer tokens or JWT (out of scope)
- whatsapp-bot never imports Python directly — only talks to pm-authority via HTTP over localhost through Fastify proxy routes
- All dashboard requests go to whatsapp-bot's own origin; `/api/linkedin/*` routes proxy to the FastAPI service with Zod request and response schemas
- Zod schemas maintained manually — OpenAPI codegen is out of scope for v1.7 (14 endpoints, codegen pipeline is overhead)
- Telegram bot is additive fallback — nothing removed, dashboard is strictly additive
- SSE infra already exists in whatsapp-bot for WhatsApp connection state — reused in Phase 35 for live queue updates
- pm-authority state.db remains source of truth — the FastAPI service is the single reader/mutator, dashboard never reaches around it
- Existing ReviewManager CRUD and generate_lesson_variants / handle_select_lesson_sync / post_variant_and_generate_image_sync functions power the mutate endpoints — no rewriting pm-authority internals

Plan 33-01 decisions (2026-04-12):
- Router-ownership boundary: main.py pre-mounts ALL six empty routers (posts, images, jobs, mutations_fast, mutations_slow, lesson_runs) in Plan 33-01 so waves 2-4 only append handlers to their own router module and never edit main.py
- ImageInfoDTO.filesystem_path uses Pydantic v2 Field(exclude=True) — internal-only, never appears on the wire
- ImageInfoDTO.pii_reviewed is a first-class wire field derived from post.status != 'PENDING_PII_REVIEW'
- PostDTO.id is str (UUID) matching real pm-authority schema; created_at from sequences.created_at; updated_at always None in v1 (no column)
- StartLessonRunRequest body = {source_sequence_id, chosen_lesson, perspective?, language?} matching generate_lesson_variants signature; brand-new project ingestion deferred to Phase 35
- jobs.start_gc_task/stop_gc_task lifespan shim with stable signature so Plan 33-03 fills in the JobTracker body without touching main.py
- state.db pragmas applied at every connection open: WAL + busy_timeout=5000 + foreign_keys (not just once at startup)
- 10-code ErrorCode taxonomy: VALIDATION_ERROR, NOT_FOUND, STATE_VIOLATION, REGEN_CAPPED, LESSON_ALREADY_PICKED, VARIANT_ALREADY_PICKED, UNPROCESSABLE, INTERNAL_ERROR, UPSTREAM_FAILURE, UNAVAILABLE — maps 1:1 to HTTP codes via status_for()
- PM2 entry `pm-authority-http` on 127.0.0.1:8765 workers=1 (single-worker mandatory for in-memory JobTracker)

Plan 33-02 decisions (2026-04-13):
- services/http/dto_mapper.py is the SINGLE source of truth for SQLite→PostDTO assembly — every later plan that returns a PostDTO after a mutation MUST import build_post_dto from here rather than duplicate the mapping logic
- Path-jail for image endpoints: resolve raw image_path → relative_to(/home/yuval/pm-authority/data/) → fail-soft 404 for every failure mode (missing, invalid, escape attempt, non-file). Uniform NOT_FOUND shape keeps dashboard error handling simple; no 403 and no 500
- Lesson-candidate image lives on posts.image_path (not on the candidate row) — endpoint 404s unless the candidate is selected AND the post has a rendered image_path
- Superseded variants (post_variants.selected = -1) filtered out at the mapping layer, NOT the SQL layer, so future audit features can still fetch them if needed
- NON_TERMINAL_STATUSES tuple in dto_mapper.py is the canonical default list filter — excludes PUBLISHED and REJECTED
- TestClient fixture must rewrite get_conn.__wrapped__.__defaults__ (not just DEFAULT_DB_PATH module attr) because @contextmanager captures the default db_path at function-definition time
- pii_reviewed is computed at DTO-build time as (post.status != 'PENDING_PII_REVIEW'), not stored in the DB — anything past the PII gate is considered reviewed

Plan 33-03 decisions (2026-04-13):
- JobTracker.semaphore is a public asyncio.Semaphore(1) on the tracker instance — Plan 33-04 workers acquire it around any Claude-CLI / fal.ai subprocess to serialize global slow work; single-slot matches pm-authority's single-user design
- services/http/state_guard.py is the SINGLE source of truth for post status transitions — ALLOWED_TRANSITIONS dict covers approve/reject/edit/regenerate/replace_image/pick_variant/pick_lesson; Plan 33-04 imports check_transition directly, no duplication
- State guard is status-string based (not enum-based) — posts.status is TEXT in pm-authority and the wire format is a string; enum conversion is pure overhead
- Whitespace-only edit is 422 UNPROCESSABLE (handler check), empty-string edit is 400 VALIDATION_ERROR (Pydantic min_length=1 + global handler); matches CONTEXT.md §4 taxonomy
- Fast mutation handlers import dto_mapper.build_post_dto LAZILY inside the handler body — lets the module load cleanly even while the parallel Plan 33-02 is in flight; pytest.importorskip in the test file mirrors the same contract
- routers/jobs.py start_gc_task is idempotent: if app.state.job_tracker is already set (test fixture injects one) it only calls .start_gc() rather than rebuilding; matches the shim signature Plan 33-01 committed to
- get_tracker(request) is a plain helper, not a FastAPI Depends — keeps the APIError-raising style uniform with every other error site in the service

Plan 34-02 decisions (2026-04-13):
- Sub-file layout `src/api/linkedin/routes/reads.ts` rather than extending `src/api/routes/linkedin.ts` directly — keeps the plugin file small and gives Plan 34-03 a symmetric `writes.ts` slot; plugin file becomes a pure "wire things together" layer
- `registerReadRoutes` is a plain async function, not a Fastify plugin — called inline from the existing linkedinRoutes plugin so all routes share the same JWT decorator and lifecycle; Plan 34-03 follows the same pattern
- Timeout tiers as module constants (`JSON_READ_TIMEOUT_MS=3000`, `IMAGE_STREAM_TIMEOUT_MS=30000`) at the top of reads.ts — makes the contract visible at-a-glance and easy for Plan 34-04's live integration test to reference
- `sendBinaryStream(reply, upstream)` helper centralizes the `Readable.fromWeb` bridge + header forwarding — Route 3 (post image) and Route 4 (lesson-candidate image) share one implementation to prevent drift
- `Readable` imported at module top (`import { Readable } from 'node:stream'`), NOT lazily inside the handler — avoids re-import on every request; the plan example showed a dynamic import but there's no functional reason for it
- Path params `encodeURIComponent`-escaped even for image routes where Fastify's router already strips literal slashes — defense-in-depth against a future router change; test 13 pins the behavior using `%25` (the only unsafe character Fastify passes through unchanged)
- `PostArraySchema = z.array(PostSchema)` hoisted to a module constant rather than constructed per-request — minor but consistent with Plan 34-03's likely bulk schemas
- Auth-gate test lives in a second `describe` block with its own `buildTestServer` using a rejecting `authenticate` decorator — keeps the happy-path suite order-independent and lets us assert `fetchMock` is NEVER called when auth fails (proves 401 short-circuits before upstream work)
- Live smoke test ran via an in-repo tsx one-shot script + `fastify.inject` against the real PM2 pm-authority, NOT by restarting the live PM2 whatsapp-bot — per plan directive, Plan 34-04 owns live PM2 verification

Plan 34-01 decisions (2026-04-13):
- Proxy uses native global fetch (Node 20 / undici) + per-call AbortSignal.timeout — no axios, no shared timeout defaults; every callUpstream call picks a tier deliberately (1s health / 3s reads / 5s fast mutations / 10s slow 202 / 30s image stream)
- SchemaMismatchError is a distinct class from UpstreamError — a Zod mismatch on a 2xx is OUR bug (whatsapp-bot drifted from pm-authority), not an upstream failure; routes map it to HTTP 500 INTERNAL_ERROR, not to the upstream error envelope
- Response schemas are permissive (no .strict) so pm-authority can add fields without breaking the proxy; request body schemas ARE .strict() to reject dashboard bugs early
- Snake_case wire format preserved end-to-end — schemas match Pydantic 1:1 so the dashboard can later import the same Zod module for typed fetching without any re-mapping layer
- callUpstream has a validateStatuses opt-out for mixed 200 Post / 202 JobAccepted responses (regenerate / pick-lesson / lesson-run) — no union-typed response, just passthrough the 202 body unchecked
- /api/linkedin/health ALWAYS returns HTTP 200 with a discriminated-union body (Phase 34 SC#4) — any upstream error (refused / timeout / 5xx / schema-mismatch) folds into {upstream:'unavailable', reason:<taxonomy>} so the dashboard banner has a reliable degraded signal instead of a spinning request or a 503
- Single routes/linkedin.ts file shared by Plans 34-02 and 34-03 — not split into subfiles; keeps server.ts registration stable and Plans 02/03 just append handlers
- z.iso.datetime({offset:true}) is the correct Zod v4 API for timestamps (accepts both '...Z' and '...+00:00' suffixes — live pm-authority emits '...Z'); z.record(z.string(), z.unknown()) is the Zod v4 two-arg form

Legacy decisions from v1.6 (see phase 27-32 archive):
- DB schema is unconditional root blocker — Phase 27 must complete before any other phase starts
- Cancel state must be DB-persisted (cancelRequestedAt column), never in-memory — survives PM2 reloads
- Voice/AI content resolves at fire time, not schedule time — no pre-generation
- Cron strings (not ms intervals) stored for recurrence — DST-safe via node-cron Asia/Jerusalem
- Promise.race timeout on every Baileys send (15s) and every TTS/Gemini call (30s)
- p-queue concurrency:1 for TTS to respect ElevenLabs limits
- Plain text FK for scheduledMessageId (no drizzle references()) — consistent with project convention
- Hand-written migrations after 0010 — FTS5 virtual tables incompatible with drizzle-kit

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 stale-socket bug (issue #2132) — Promise.race mitigation required regardless of fix
- ElevenLabs plan tier determines p-queue concurrency ceiling — currently :1 (conservative), verify if higher is needed
- Phase 38 (new lesson run form) is the highest-risk dependency in v1.7 — depends on the long-running generator pipeline working cleanly over HTTP; kept as the final phase so any issues surface late without blocking the rest of the queue UX
- pm-authority FastAPI service adds a new side process to yuval-server — needs process supervision (PM2 or systemd) to stay up alongside whatsapp-bot

## Session Continuity

Last session: 2026-04-13
Stopped at: Phase 34 Plan 02 complete — read-side proxy routes shipped in whatsapp-bot. `src/api/linkedin/routes/reads.ts` exports `registerReadRoutes(fastify)` registering 5 JWT-protected GET routes: list posts (with repeated `?status=` multi-status filter), get single post, get job, and two binary image streams. `src/api/linkedin/__tests__/reads.test.ts` has 13 vitest cases (multi-status repeated params, schema mismatch → 500, 404 passthrough, ECONNREFUSED → 503, PNG binary streaming with Content-Type/Length preservation, dual-param lesson-candidate URL, percent-encoding path param guard, auth gate never reaches upstream fetch). `src/api/routes/linkedin.ts` modified to call `await registerReadRoutes(fastify)` after the existing health route, with a clearly-commented slot for Plan 34-03's `registerWriteRoutes` call below. Image streaming uses `Readable.fromWeb(upstream.body as any)` to bridge undici's Web ReadableStream to a Node Readable — Fastify 5 accepts it directly via `reply.send(stream)` — zero buffering, upstream Content-Type and Content-Length forwarded via the shared `sendBinaryStream(reply, upstream)` helper. Timeout tiers as module constants: `JSON_READ_TIMEOUT_MS=3000`, `IMAGE_STREAM_TIMEOUT_MS=30000`. Vitest: 18 client + 7 health + 13 reads = 38/38 green. TypeScript clean. Live smoke test via in-repo tsx + `fastify.inject` against the live PM2 pm-authority: list (2 posts), multi-status filter (2 → 1), single get (round-trip), image stream (1.7 MB PNG with `89504e47` magic bytes + `image/png` content-type preserved), bogus-post 404, bogus-job 404 — all envelopes verbatim from upstream. whatsapp-bot commits: c9cdf7e (JSON read routes + 9 tests), 4576fb1 (image streaming routes + 4 tests). Plan 34-02 SUMMARY.md lives at `.planning/phases/34-fastify-proxy-layer/34-02-SUMMARY.md`. LIN-02 marked complete.
Resume with: `/gsd:execute-phase 34` to kick off Plan 34-03 (write endpoints: approve/reject/edit/regenerate/pick-variant/pick-lesson/replace-image/lesson-runs — 8 POST routes). Plan 34-03 will create `src/api/linkedin/routes/writes.ts` exporting `registerWriteRoutes(fastify)` and append `await registerWriteRoutes(fastify)` below the `registerReadRoutes` call in `src/api/routes/linkedin.ts`. It uses `callUpstream` with `validateStatuses: [200]` opt-out for endpoints that return mixed 200 Post / 202 JobAccepted responses (regenerate, pick-lesson, lesson-runs). PM2 rollout is still blocked on 34-04; do NOT restart the whatsapp-bot PM2 process until Plan 34-04.

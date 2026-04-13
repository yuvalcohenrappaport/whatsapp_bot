# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — Phase 34 Fastify Proxy Layer in flight (1/4 plans complete)

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 34 — Fastify Proxy Layer — IN PROGRESS (1/4 plans)
Plan: 34-01 complete (proxy foundation: schemas + client + errors + /api/linkedin/health); next = Phase 34 Plan 02
Status: Phase 34 Plan 01 shipped. Zod schema module, upstream fetch client with timeout + response-schema validation, error mapper with verbatim HTTP passthrough, and the always-200 `/api/linkedin/health` endpoint are live in `src/api/linkedin/` and `src/api/routes/linkedin.ts`. `src/api/server.ts` registers `linkedinRoutes` after scheduledMessageRoutes and before the static SPA catch-all. 25/25 vitest cases pass (18 client + 7 health). TypeScript clean. Live smoke tested both directions: happy path against the PM2 `pm-authority-http` service returns `200 {upstream:'ok', detail:{status:'ok', version:'0.1.0', db_ready:true}}`; dead-upstream path against closed port 9999 returns `200 {upstream:'unavailable', reason:'connection_refused'}`. Phase 34 SC#4 (always-200 degraded signal for dashboard banner) satisfied end-to-end. No direct SQLite access introduced. PM2 `whatsapp-bot` process NOT restarted — intentional per plan; rollout deferred to Plan 34-04. LIN-02 satisfied. Plans 34-02 (read endpoints) and 34-03 (write endpoints) are unblocked; both import from `src/api/linkedin/{schemas,client,errors}.ts` and extend `src/api/routes/linkedin.ts`.
Last activity: 2026-04-13 — Phase 34 Plan 01 complete — proxy foundation shipped. whatsapp-bot commits: 3553120 (feat: schemas), fb4aab0 (feat: client + errors + 18 client tests), 90e2cba (feat: health route + server.ts registration + 7 health tests). 25/25 linkedin vitest suite green.

Progress: [==        ] 21% (v1.7: 1/6 phases complete + 1/4 plans of Phase 34 done)

## Performance Metrics

**Velocity:**
- Total plans completed: 69 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 12, v1.6: 12)
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
Stopped at: Phase 34 Plan 01 complete — proxy foundation shipped in whatsapp-bot. `src/api/linkedin/schemas.ts` (17 Zod schemas + inferred types mirroring pm-authority v1 DTOs / requests / error envelope / proxy health union), `src/api/linkedin/client.ts` (callUpstream with AbortSignal.timeout + response-schema validation + ECONNREFUSED/AbortError/TimeoutError kind taxonomy, plus streamUpstream for Plan 02's image endpoints and PM_AUTHORITY_BASE_URL env override), `src/api/linkedin/errors.ts` (mapUpstreamErrorToReply — HTTP passthrough verbatim, timeout→504, refused→503, network/parse→502, schema mismatch→500), `src/api/routes/linkedin.ts` (JWT-guarded Fastify plugin with the single /api/linkedin/health route — always 200 regardless of upstream state), `src/api/server.ts` (registers linkedinRoutes after scheduledMessageRoutes, before static SPA). Vitest: 18 client tests + 7 health tests = 25/25 green in 478ms. TypeScript clean. Live smoke test confirmed both the happy path against the PM2 pm-authority-http service and the `connection_refused` classification against port 9999. whatsapp-bot commits: 3553120 (schemas), fb4aab0 (client + errors + client tests), 90e2cba (route + server.ts + health tests). Plan 34-01 SUMMARY.md lives at `.planning/phases/34-fastify-proxy-layer/34-01-SUMMARY.md`.
Resume with: `/gsd:execute-phase 34` to kick off Plan 34-02 (read endpoints: list posts, get post, get job, stream images). Plan 34-02 extends `src/api/routes/linkedin.ts` with GET routes using 3s read timeout + 30s image-stream timeout; it imports callUpstream/streamUpstream/mapUpstreamErrorToReply from `src/api/linkedin/*`. Plans 34-02 and 34-03 can run in parallel — both append handlers to the shared linkedin.ts plugin. PM2 rollout is still blocked on 34-04; do NOT restart the whatsapp-bot PM2 process until Plan 34-04.

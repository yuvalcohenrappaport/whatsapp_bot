# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — Phase 34 Fastify Proxy Layer in flight (3/4 plans complete)

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 34 — Fastify Proxy Layer — IN PROGRESS (3/4 plans)
Plan: 34-03 complete (write routes: approve/reject/edit + regenerate/pick-variant mixed/pick-lesson/replace-image/lesson-runs, 8 POST routes); next = Phase 34 Plan 04 (live PM2 rollout + end-to-end smoke test against live pm-authority)
Status: Phase 34 Plan 03 shipped. Eight JWT-protected POST routes live under `/api/linkedin/*` via the new `src/api/linkedin/routes/writes.ts` module exporting `registerWriteRoutes(fastify)`: three sync mutations returning `PostSchema` (approve/reject/edit), four async mutations returning `JobAcceptedSchema` (regenerate/pick-lesson/replace-image/lesson-runs), and the mixed `pick-variant` route that branches on upstream status (200 → PostSchema / 202 → JobAcceptedSchema). The mixed branch uses `callUpstream`'s `validateStatuses:[200]` opt-out so the client PostSchema-validates the 200 branch; the 202 branch is validated inline via `JobAcceptedSchema.safeParse` with a `SchemaMismatchError` on drift. Body-validated routes use a `validateBody<T>` helper that writes a pm-authority-shaped `VALIDATION_ERROR` envelope on failure (400, fetch never called). Every upstream error code passes through verbatim: STATE_VIOLATION (409), REGEN_CAPPED (409), LESSON_ALREADY_PICKED (409), VARIANT_ALREADY_PICKED (409), NOT_FOUND (404). Timeout tiers as module constants: FAST_MUTATION_TIMEOUT_MS=5000, SLOW_MUTATION_TIMEOUT_MS=10000. `src/api/routes/linkedin.ts` now calls `await registerWriteRoutes(fastify)` after `registerReadRoutes(fastify)` in the Plan 34-03 placeholder slot Plan 34-02 left behind. 63/63 linkedin vitest cases pass (18 client + 7 health + 13 reads + 25 writes). TypeScript clean. No live smoke test this session — skipped intentionally since (a) 25 mocked-fetch tests cover every branch including both schema-mismatch paths and (b) live PM2 rollout is Plan 34-04's explicit job. PM2 `whatsapp-bot` process NOT restarted — per plan directive. LIN-02 deliberately NOT marked complete (a prior agent had prematurely flipped it to `[x]` after 34-02; reverted to `[ ]` / "In Progress (34-01/02/03 complete, awaiting 34-04 live integration)" since LIN-02's success criterion requires the dashboard actually fetching data through the live proxy, which only happens after 34-04 ships).
Last activity: 2026-04-13 — Phase 34 Plan 03 complete — write routes shipped. whatsapp-bot commits: 55ba096 (feat: writes.ts + plugin wiring), 11d9a38 (test: writes.test.ts 25 tests). 63/63 linkedin vitest suite green.

Progress: [====      ] 33% (v1.7: 1/6 phases complete + 3/4 plans of Phase 34 done)

## Performance Metrics

**Velocity:**
- Total plans completed: 71 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 12, v1.6: 12; v1.7 in progress: +2 Plans 34-02 & 34-03)
- v1.6 shipped in 1 day (12 plans, 6 phases)
- v1.4 shipped in 1 day (12 plans, 5 phases)
- v1.3 shipped in 1 day (9 plans, 5 phases)

**Cumulative (all milestones):**
- 7 milestones shipped (v1.0 through v1.6)
- 32 phases complete, 70 plans complete

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

Plan 34-03 decisions (2026-04-13):
- Mixed 200/202 pick-variant implemented via Plan 34-01's `validateStatuses:[200]` opt-out — client PostSchema-validates only the fast branch; the 202 branch is validated inline in the route with `JobAcceptedSchema.safeParse` and a `SchemaMismatchError` thrown on drift. Keeps `callUpstream` one-schema-per-call; branching logic lives only in the one route that needs it.
- `validateBody<T>(schema, body, reply)` helper writes a `VALIDATION_ERROR` envelope shaped identically to pm-authority's (`error.code`/`message`/`details.issues`) and returns `null` on failure so routes bail out with `if (body === null) return`. Makes the wire shape of proxy-local validation errors indistinguishable from upstream ones — the dashboard's future error discriminator needs no special case for "who validated first".
- `EditRequestSchema` and every other request schema kept `.strict()` per Plan 34-01's convention — extra fields on body-validated routes become 400 VALIDATION_ERROR (pinned by a dedicated test). Dashboard bugs that smuggle unexpected fields surface at the proxy boundary rather than at pm-authority.
- Timeout tiers `FAST_MUTATION_TIMEOUT_MS=5000` and `SLOW_MUTATION_TIMEOUT_MS=10000` as top-of-file module constants — matches Plan 34-02's `JSON_READ_TIMEOUT_MS`/`IMAGE_STREAM_TIMEOUT_MS` pattern and Plan 34-01's tier hierarchy (1s health / 3s reads / 5s fast / 10s slow / 30s images).
- `SchemaMismatchError` imported directly from `../client.js`, not via `../errors.js` re-export — shorter, tighter dependency graph, matches reads.ts.
- No live smoke test this session — 25 mocked-fetch tests cover every branch including schema-mismatch on both pick-variant branches (impossible to reliably trigger against real pm-authority), and Plan 34-04 is the explicit owner of live PM2 end-to-end. Running curl now would duplicate work for zero information gain.
- Auth-gate test block exercises both Fastify type shapes — `/edit` (body + path param) and `/lesson-runs` (body only, no params) — each asserting the 401 short-circuit happens before any upstream fetch.
- LIN-02 deliberately REVERTED to `[ ]` / "In Progress (34-01/02/03 complete, awaiting 34-04 live integration)". A prior agent had prematurely marked it `[x]` after 34-02, but LIN-02's SC is "User can open the dashboard and it fetches LinkedIn post data" — that only happens after Plan 34-04 rolls the new routes into the live PM2 `whatsapp-bot` process. No false "done" signals.

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
Stopped at: Phase 34 Plan 03 complete — write-side proxy routes shipped in whatsapp-bot. `src/api/linkedin/routes/writes.ts` exports `registerWriteRoutes(fastify)` registering 8 JWT-protected POST routes: three fast sync mutations (approve/reject/edit) returning `PostSchema`, four async 202 mutations (regenerate/pick-lesson/replace-image/lesson-runs) returning `JobAcceptedSchema`, and the mixed `pick-variant` route branching on upstream status (200 → PostSchema, 202 → JobAcceptedSchema). Mixed branch uses `callUpstream` with `validateStatuses:[200]` and inline `JobAcceptedSchema.safeParse` on the 202 body (SchemaMismatchError on drift — both branches → 500 INTERNAL_ERROR on upstream bug). Body-validated routes use `validateBody<T>(schema, body, reply)` helper that writes a pm-authority-shaped VALIDATION_ERROR envelope and returns null; caller bails with `if (body === null) return`. Every upstream error code passes through verbatim: STATE_VIOLATION (test 7), NOT_FOUND (test 8), REGEN_CAPPED (test 10), LESSON_ALREADY_PICKED (test 13), VARIANT_ALREADY_PICKED (test 18c). `src/api/linkedin/__tests__/writes.test.ts` has 25 vitest cases across two describe blocks (happy-path + auth-gate) — same harness as reads.test.ts. `src/api/routes/linkedin.ts` modified to call `await registerWriteRoutes(fastify)` after `registerReadRoutes(fastify)` in the Plan 34-03 placeholder slot. Timeout tiers `FAST_MUTATION_TIMEOUT_MS=5000`, `SLOW_MUTATION_TIMEOUT_MS=10000` as module constants. Vitest: 18 client + 7 health + 13 reads + 25 writes = 63/63 green (no regression). TypeScript clean. No live smoke test this session — 25 mocked-fetch tests cover every branch incl. both schema-mismatch paths; live PM2 end-to-end is Plan 34-04's job. whatsapp-bot commits: 55ba096 (feat 34-03: writes.ts + plugin wiring), 11d9a38 (test 34-03: writes.test.ts 25 tests). Plan 34-03 SUMMARY.md lives at `.planning/phases/34-fastify-proxy-layer/34-03-SUMMARY.md`. LIN-02 deliberately reverted from `[x]` → `[ ]` / "In Progress (34-01/02/03 complete, awaiting 34-04 live integration)" — a prior agent had prematurely marked it complete after 34-02, but its success criterion requires the dashboard actually fetching data through the live proxy, which only happens after Plan 34-04.
Resume with: `/gsd:execute-phase 34` to kick off Plan 34-04 (live PM2 rollout + end-to-end smoke test against live pm-authority on 127.0.0.1:8765). Plan 34-04 will graceful-reload the PM2 `whatsapp-bot` process with the new read+write routes, then curl every `/api/linkedin/*` endpoint against the real upstream — list/get/image/job/approve/reject/edit/regenerate/pick-variant/pick-lesson/replace-image/lesson-runs — and assert upstream envelopes forward verbatim. It also auto-skips when `pm-authority-http` is not running (per the plan's degraded-state contract). On success, LIN-02 flips back to `[x]` Complete.

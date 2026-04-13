# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — Phase 33 complete (5/5 plans); next = Phase 34 Fastify Proxy Layer

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 33 — pm-authority HTTP Service — **COMPLETE** (5/5 plans)
Plan: 33-05 complete (e2e walkthrough + smoke script + README v1 contract + PM2 live verification); next = Phase 34 Plan 01
Status: Phase 33 closed. pm-authority HTTP service is live on PM2 — process `pm-authority-http` online (pid 1875924, 0 restarts, 57.8mb), `/v1/health` returns `{status:ok, db_ready:true}`, socket bound 127.0.0.1:8765 only (verified via `ss -tlnH`, no 0.0.0.0 bind, no Tailscale interface). 52/52 HTTP TestClient tests pass in one pytest run (13 reads + 13 fast mutations + 9 jobs + 16 slow mutations + 1 end-to-end walkthrough). All 14 v1 endpoints live and documented in pm-authority/README.md with full Route Table, error envelope, security note, and concurrency model. LIN-01 satisfied. Phase 34 (Fastify proxy) unblocked — Zod schemas should derive directly from the pm-authority README v1 Route Table.
Last activity: 2026-04-13 — Phase 33 complete — pm-authority HTTP service live on PM2. Plan 33-05 shipped: `pm-authority/tests/test_http_end_to_end.py` (single-file walkthrough of all 14 endpoints including REAL `/v1/lesson-runs` call-through via class-level monkeypatch of `PostGenerator.generate_lesson_variants`), `pm-authority/scripts/http_smoke.sh` (curl-based smoke test with `ss -tlnp` loopback assertion), `pm-authority/README.md` (complete v1 Route Table section). Task 3 was a human-verify checkpoint: operator confirmed PM2 online, /v1/health green, loopback-only bind, whatsapp-bot PM2 process unaffected. pm-authority commits: f5b2174 (e2e test), 6d03883 (smoke + README).

Progress: [==        ] 17% (v1.7: 1/6 phases complete — Phase 33 done; Phases 34, 35, 36, 37, 38 pending)

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
Stopped at: Phase 33 Plan 04 complete — services/http/exception_map.py (10-code taxonomy translation), services/http/workers.py (run_regenerate / run_pick_variant / run_pick_lesson / run_lesson_run, all under tracker.semaphore + run_in_threadpool with lazy bot.py import), routers/mutations_slow.py routes appended (regenerate / pick-variant fast+slow branch / pick-lesson / replace-image with path-jail), routers/lesson_runs.py routes appended (POST /v1/lesson-runs with sync 404/422 pre-flight). The lesson-runs worker is a REAL call-through to PostGenerator.generate_lesson_variants per Roadmap Success Criterion #3 — proven by tests/test_http_slow_mutations.py::test_lesson_runs_calls_generate_lesson_variants_and_persists which monkeypatches the generator method on the class, asserts it was called exactly once with the right context, and asserts the new sequence + post + two post_variants rows landed in the DB. 16 new TestClient tests, all passing alongside the 35 from Plans 33-02 and 33-03 (51/51 total HTTP). main.py STILL at commit 4801111 from Plan 33-01 — verified via git log --follow. pm-authority commits: 3133d91 (workers + exception_map), 5b60aeb (slow + lesson-runs routes), 3b06b97 (test suite). Plan 33-04 SUMMARY.md committed in whatsapp-bot.
Resume with: `/gsd:execute-phase 33` to kick off Plan 33-05 (e2e walkthrough). Plan 33-05 should run the live uvicorn server and exercise every one of the 14 endpoints with a real state.db (or a seeded test DB), including: list posts, fetch fat DTO, regenerate a post via job poll loop, pick a variant fast-path, pick a lesson via job poll loop, replace an image with a real screenshot, and start a lesson run via /v1/lesson-runs with a real source_sequence_id. Verify all 14 endpoints surface the correct shapes and error envelopes. Document any contract gaps for the Phase 34 Fastify proxy work.

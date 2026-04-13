# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — Phase 33 in progress (plan 01 complete: sidecar scaffold shipped)

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 33 — pm-authority HTTP Service
Plan: 33-01 complete (sidecar scaffold, /v1/health, six pre-wired empty routers)
Status: Plan 33-01 shipped, ready for plans 33-02 / 33-03 / 33-04 (wave 2-4) to append route handlers to the pre-wired router modules
Last activity: 2026-04-12 — FastAPI sidecar scaffolded in pm-authority, state.db WAL retry + 10-code error envelope + six empty routers mounted at /v1, PM2 ecosystem.config.js entry added

Progress: [=         ] 5% (v1.7: 0/6 phases complete; phase 33 = 1/5 plans done)

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

Last session: 2026-04-12
Stopped at: Phase 33 Plan 01 complete — pm-authority FastAPI sidecar scaffolded (services/http/ package, six pre-wired empty routers, /v1/health, error envelope, state.db retry, PM2 ecosystem entry). uvicorn starts and /v1/health returns 200 on 127.0.0.1:8765. Code committed in pm-authority repo (072041b, 35e6c28, 4801111); planning commit in whatsapp-bot repo.
Resume with: `/gsd:execute-phase 33` to kick off plans 33-02 / 33-03 / 33-04 (wave 2-4 route handlers appended to the pre-wired router modules). Plans 02/03/04 must NOT edit services/http/main.py — only append to their respective router file.

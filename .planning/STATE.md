# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.7 LinkedIn Bot Dashboard Integration — roadmap defined, ready to plan Phase 33

## Current Position

Milestone: v1.7 LinkedIn Bot Dashboard Integration
Phase: 33 — pm-authority HTTP Service
Plan: —
Status: Roadmap complete, awaiting plan-phase for Phase 33
Last activity: 2026-04-12 — ROADMAP.md updated with phases 33-38, all 14 LIN-* requirements mapped, REQUIREMENTS.md traceability table filled

Progress: [          ] 0% (v1.7: 0/6 phases)

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
Stopped at: Milestone v1.7 roadmap complete — phases 33-38 defined, all 14 LIN-* reqs mapped, ROADMAP.md + STATE.md + REQUIREMENTS.md updated.
Resume with: `/gsd:plan-phase 33` to decompose the pm-authority HTTP service phase into plans.

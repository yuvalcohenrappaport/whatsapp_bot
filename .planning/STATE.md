# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 27 — DB Foundation (v1.6 Scheduled Replies)

## Current Position

Phase: 27 of 32 (DB Foundation)
Plan: 1 of 1 in current phase
Status: In progress
Last activity: 2026-03-30 — Phase 27 Plan 01 complete (DB foundation tables)

Progress: [█░░░░░░░░░] 10% (v1.6)

## Performance Metrics

**Velocity:**
- Total plans completed: 57 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 12)
- v1.4 shipped in 1 day (12 plans, 5 phases)
- v1.3 shipped in 1 day (9 plans, 5 phases)

**Cumulative (all milestones):**
- 6 milestones shipped (v1.0 through v1.5)
- 26 phases complete, 57 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Recent decisions affecting v1.6:
- DB schema is unconditional root blocker — Phase 27 must complete before any other phase starts
- Cancel state must be DB-persisted (cancelRequestedAt column), never in-memory — survives PM2 reloads
- Voice/AI content resolves at fire time, not schedule time — no pre-generation
- Cron strings (not ms intervals) stored for recurrence — DST-safe via node-cron Asia/Jerusalem
- Promise.race timeout on every Baileys send (15s) and every TTS/Gemini call (30s)
- p-queue concurrency:1 for TTS to respect ElevenLabs limits
- Plain text FK for scheduledMessageId (no drizzle references()) — consistent with project convention (27-01)
- Migration applied directly to live DB; hash inserted into __drizzle_migrations to prevent double-run (27-01)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 stale-socket bug (issue #2132) — Promise.race mitigation required regardless of fix
- buildSystemPrompt in gemini.ts is currently non-exported — needs export or extraction before Phase 31
- ElevenLabs plan tier determines p-queue concurrency ceiling — verify at Phase 31 planning time

## Session Continuity

Last session: 2026-03-30
Stopped at: Completed 27-01-PLAN.md (DB Foundation tables)
Resume with: /gsd:execute-phase 28

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** v1.4 Travel Agent — Phase 18: Trip Memory (in progress)

## Current Position

Phase: 18 of 21 (Trip Memory)
Plan: 1 of 3 in current phase
Status: In Progress
Last activity: 2026-03-02 — Plan 18-01 complete (trip memory DB schema and FTS5)

Progress: [███░░░░░░░] 30% (v1.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 38 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 3)
- v1.3 shipped in 1 day (9 plans, 5 phases)
- v1.2 shipped in 1 day (4 plans, 2 phases)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 17-01 | Travel search audit | 5min | 3 | 3 |
| 17-02 | Calendar extraction audit | 4min | 3 | 3 |
| 18-01 | Trip memory DB schema and FTS5 | 2min | 2 | 5 |

**Cumulative (all milestones):**
- 4 milestones shipped
- 17 phases complete, 38 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key decisions for v1.4:
- All new pipeline steps added inside existing `groupMessageCallback` in `groupMessagePipeline.ts` — never call `setGroupMessageCallback()` from a new module (silently overwrites)
- tripContexts (one row per group, upsert) vs tripDecisions (append-only typed decisions) — boundary established in Phase 18-01
- No new npm packages for Phases 17-19; zero new packages confirmed for Phases 17-20
- FTS5 migration is hand-written (0010), separate from Drizzle-generated (0009) — never run db:generate after 0010 (Drizzle will emit DROP TABLE for the virtual table) (18-01)
- Zod v4: use `z.toJSONSchema()` natively — installed `zod-to-json-schema` silently broken with Zod v4, never use it
- Gemini Maps Grounding: swap `googleSearch` tool for `googleMaps` in travelSearch.ts; keep `googleSearch` fallback path
- WhatsApp interactive buttons are Business API-only — use numbered text lists and quoted-reply confirmations instead
- Pre-filter non-travel messages in JavaScript before Gemini call — prevents cost explosion ($1-3/month with filter vs $15-40/month without)
- Proactive messages: 2-hour per-group cooldown, max 3/day/group, 90% confidence threshold, 3-8s randomized delay
- Grounding metadata URLs: cross-reference by title similarity, then fill empty URLs with unused chunks (17-01)
- Follow-up framing: augment both recentContext AND messageText for dual-path coverage (17-01)
- Pipeline guard reorder: handleReplyToDelete runs before fromMe guard so owner can delete calendar events (17-02)
- Minimal NaN date patch in dateExtractor.ts since Phase 19 rewrites the extraction flow (17-02)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- Phase 18 classifier prompt needs tuning for mixed Hebrew/English group chat before wiring to pipeline
- Phase 21 proactive trigger has highest WhatsApp ban risk — must validate Phase 18 confidence calibration first

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 18-01-PLAN.md (trip memory DB schema and FTS5)
Resume with: /gsd:execute-phase 18 (Phase 18: Trip Memory — plan 02)
Resume file: .planning/phases/18-trip-memory/18-01-SUMMARY.md

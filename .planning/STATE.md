# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** v1.4 Travel Agent — Phase 17: Pipeline Audit

## Current Position

Phase: 17 of 21 (Pipeline Audit)
Plan: 1 of 2 in current phase
Status: Executing
Last activity: 2026-03-02 — Plan 17-01 complete (travel search audit)

Progress: [█░░░░░░░░░] 10% (v1.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 36 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 1)
- v1.3 shipped in 1 day (9 plans, 5 phases)
- v1.2 shipped in 1 day (4 plans, 2 phases)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 17-01 | Travel search audit | 5min | 3 | 3 |

**Cumulative (all milestones):**
- 4 milestones shipped
- 16 phases complete, 36 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key decisions for v1.4:
- All new pipeline steps added inside existing `groupMessageCallback` in `groupMessagePipeline.ts` — never call `setGroupMessageCallback()` from a new module (silently overwrites)
- tripContexts (one row per group, upsert) vs tripDecisions (append-only typed decisions) — canonical boundary must be resolved before Phase 18 migration
- No new npm packages for Phases 17-19; zero new packages confirmed for Phases 17-20
- Zod v4: use `z.toJSONSchema()` natively — installed `zod-to-json-schema` silently broken with Zod v4, never use it
- Gemini Maps Grounding: swap `googleSearch` tool for `googleMaps` in travelSearch.ts; keep `googleSearch` fallback path
- WhatsApp interactive buttons are Business API-only — use numbered text lists and quoted-reply confirmations instead
- Pre-filter non-travel messages in JavaScript before Gemini call — prevents cost explosion ($1-3/month with filter vs $15-40/month without)
- Proactive messages: 2-hour per-group cooldown, max 3/day/group, 90% confidence threshold, 3-8s randomized delay
- Grounding metadata URLs: cross-reference by title similarity, then fill empty URLs with unused chunks (17-01)
- Follow-up framing: augment both recentContext AND messageText for dual-path coverage (17-01)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- Phase 18 classifier prompt needs tuning for mixed Hebrew/English group chat before wiring to pipeline
- Phase 21 proactive trigger has highest WhatsApp ban risk — must validate Phase 18 confidence calibration first

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 17-01-PLAN.md (travel search audit)
Resume with: /gsd:execute-phase 17 (Plan 17-02 remaining)
Resume file: .planning/phases/17-pipeline-audit/17-01-SUMMARY.md

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** v1.4 Travel Agent — Phase 17: Pipeline Audit

## Current Position

Phase: 17 of 21 (Pipeline Audit)
Plan: 0 of 2 in current phase
Status: Ready to plan
Last activity: 2026-03-02 — v1.4 roadmap created, Phase 17 ready

Progress: [░░░░░░░░░░] 0% (v1.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 35 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9)
- v1.3 shipped in 1 day (9 plans, 5 phases)
- v1.2 shipped in 1 day (4 plans, 2 phases)

**Cumulative (all milestones):**
- 4 milestones shipped
- 16 phases complete, 35 plans complete

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

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- Phase 18 classifier prompt needs tuning for mixed Hebrew/English group chat before wiring to pipeline
- Phase 21 proactive trigger has highest WhatsApp ban risk — must validate Phase 18 confidence calibration first

## Session Continuity

Last session: 2026-03-02
Stopped at: v1.4 roadmap created — all 15 requirements mapped across Phases 17-21
Resume with: /gsd:plan-phase 17
Resume file: —

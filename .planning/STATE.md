# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 1 — WhatsApp Foundation

## Current Position

Phase: 1 of 5 (WhatsApp Foundation)
Plan: 2 of 3 in current phase
Status: Checkpoint — Plan 01-02 Task 3 (human-verify: QR scan + session persistence on hardware)
Last activity: 2026-02-22 — Plan 01-02 Tasks 1-2 complete (connection factory, reconnect, wiring)

Progress: [██░░░░░░░░] 12%

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: 5min
- Total execution time: 5min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. WhatsApp Foundation | 1/3 | 5min | 5min |

**Recent Trend:**
- Last 5 plans: 01-01 (5min)
- Trend: First plan

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Baileys over whatsapp-web.js: eliminates Puppeteer, ~50 MB RAM vs 300-600 MB, WebSocket-native
- @google/genai (not @google/generative-ai): old SDK is EOL August 2025
- Fastify over Express: first-class TypeScript, faster, serves dashboard static build
- Drizzle + SQLite: zero operational overhead, no daemon, single-server personal use
- Draft-approval mode first: quality gate before enabling auto-send per contact
- Node.js 20 via nvm: system Node 18 rejected by Baileys; nvm default set to 20.20.0
- Drizzle 0.45 array-style index API: use `(t) => [index(...)]` not deprecated object syntax

### Pending Todos

None yet.

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — validate ESM init, session persistence, and reconnect on actual Ubuntu 24.04 hardware in Phase 1 before planning deeper phases
- Gemini free tier rate limits (5-15 RPM) will be exceeded during development — budget for Tier 1 paid access at Phase 2 kickoff

## Session Continuity

Last session: 2026-02-22
Stopped at: Plan 01-02 checkpoint — awaiting human verification of QR scan, session persistence, and reconnect on hardware.
Resume with: `/gsd:execute-phase 1` (will skip completed 01-01, resume 01-02 at checkpoint Task 3)
Resume file: .planning/phases/01-whatsapp-foundation/01-02-PLAN.md

### Checkpoint Pending

**Plan 01-02, Task 3:** Verify WhatsApp connection on actual hardware
**What to do before resuming:**
1. Run `cd /home/yuval/whatsapp-bot && npx tsx src/index.ts`
2. Scan the QR code with WhatsApp (Settings > Linked Devices > Link a Device)
3. Confirm "Connected to WhatsApp" appears in terminal
4. Check `ls data/auth/` shows session files
5. Stop (Ctrl+C) and restart — confirm reconnects WITHOUT new QR
6. (Optional) Test network disconnect/reconnect

When ready, run `/gsd:execute-phase 1` and type "approved" at the checkpoint.

### Phase 1 Plan Summary

| Wave | Plan | Autonomous | What it builds |
|------|------|------------|----------------|
| 1 | 01-01 | yes | TypeScript ESM scaffold, Drizzle + SQLite schema, PM2 config |
| 2 | 01-02 | no (QR checkpoint) | Baileys connection, QR auth, session persistence, reconnect |
| 3 | 01-03 | no (pipeline checkpoint) | Message receive pipeline (filter, dedup, persist) + send with delay |

Plans at: `.planning/phases/01-whatsapp-foundation/01-{01,02,03}-PLAN.md`

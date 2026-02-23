# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.1 — Phase 6: Web Dashboard

## Current Position

Phase: 6 of 9 (Web Dashboard)
Plan: 3 of 4 in current phase
Status: Executing
Last activity: 2026-02-23 — Completed 06-03-PLAN.md (Contacts & Overview Pages)

Progress: [████░░░░░░] 33% (phases 1-3 complete + plans 1-3/4 of phase 6)

## Performance Metrics

**Velocity:**
- Total plans completed: 11 (phases 1-3 + 2 of phase 6)
- Average duration: unknown
- Total execution time: unknown

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. WhatsApp Foundation | 3/3 | — | — |
| 2. AI Response Engine | 3/3 | — | — |
| 3. Style Learning | 3/3 | — | — |
| 6. Web Dashboard | 3/4 | 13min | 4.3min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Fastify 5 over Express: first-class TypeScript, serves static dashboard build
- Service account (not OAuth2) for Google Calendar: avoids 7-day token expiry in Testing mode
- chrono-node pre-filter before Gemini: eliminates 80-90% of Gemini calls on group messages
- CLI imports Drizzle directly (no HTTP): same DB layer, no Fastify dependency
- node-cron inside process (not PM2 cron_restart): PM2 restart kills WhatsApp session
- JWT secret from Zod-validated env config, SSE uses ?token= query param for EventSource auth
- Static plugin skips gracefully if dashboard/dist not yet built
- Contacts DELETE is soft-delete (mode='off') to preserve message history
- Draft approve uses shared in-process state for sock.sendMessage, returns 503 if disconnected
- shadcn Sidebar with collapsible='none' for always-visible fixed sidebar (single user dashboard)
- Path alias @/ in both tsconfig.json (shadcn detection) and tsconfig.app.json (TS compilation)
- Contact mode changes save immediately on click; relationship/instructions save on blur
- Card grid + Sheet side panel pattern for contact (and group) configuration

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 8]: GCP service account setup must happen at Phase 8 start — do not defer to end of phase
- [Phase 8]: SQLite WAL mode + busy_timeout must be set on ALL DB connections before Phase 8 writes group messages concurrently
- [Phase 8]: Baileys 7.0.0-rc.9 `key.fromMe` behavior in group context needs validation via debug log during early Phase 8 development
- Baileys v7.0.0-rc.9 is a release candidate — monitor stability in production

## Session Continuity

Last session: 2026-02-23
Stopped at: Completed 06-03-PLAN.md (Contacts & Overview Pages)
Resume with: `/gsd:execute-phase 06` (plan 06-04 next)
Resume file: .planning/phases/06-web-dashboard/06-04-PLAN.md

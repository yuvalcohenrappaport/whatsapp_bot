# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Milestone v1.1 — Phase 9: Travel Search (COMPLETE)

## Current Position

Phase: 9 of 9 (Travel Search)
Plan: 2 of 2 in current phase — COMPLETE
Status: Phase 9 COMPLETE — all plans delivered
Last activity: 2026-02-24 — Phase 9 Plan 02 complete (travel search scraping + formatting + reply chains)

Progress: [██████████] 100% (all phases 1-3 + 6-9 complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 24 (phases 1-3 + phase 6 + phase 7 + phase 8 all 4 plans + phase 9 all 2 plans)
- Average duration: unknown
- Total execution time: unknown

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. WhatsApp Foundation | 3/3 | — | — |
| 2. AI Response Engine | 3/3 | — | — |
| 3. Style Learning | 3/3 | — | — |
| 6. Web Dashboard | 4/4 | 16min | 4min |
| 7. CLI Dashboard | 3/3 | 10min | 3.3min |

*Updated after each plan completion*
| Phase 07 P01 | 3min | 2 tasks | 7 files |
| Phase 07 P02 | 3min | 2 tasks | 4 files |
| Phase 07 P03 | 4min | 2 tasks | 3 files |
| Phase 08 P02 | 9min | 2 tasks | 3 files |
| Phase 08 P01 | 10min | 2 tasks | 9 files |
| Phase 08 P03 | 24min | 2 tasks | 6 files |
| Phase 08 P04 | 3min | 2 tasks | 5 files |
| Phase 09 P01 | 4min | 2 tasks | 8 files |
| Phase 09 P02 | 3min | 2 tasks | 3 files |

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
- Topbar manages QR modal state internally (not via AppLayout callback)
- GroupPanel saves on blur/change for immediate persistence
- Member emails stored as JSON array string, parsed on render
- DraftRow inline edit: local body state preserved across edit/blur cycles, sent on Approve
- Static Ink render (no useApp/exit) for CLI status: pure functional component, Ink exits naturally
- PM2 installed as local dep for CLI programmatic API: global pm2 not importable from ESM
- renderToString for one-shot CLI table output: simpler than render+waitUntilExit for non-interactive display
- Dynamic import of importChats after dotenv.config(): ensures .env loaded before src/config.ts Zod validation
- process.exit(0) after import: Gemini client leaves open handles preventing natural exit
- CLI drafts approve marks status in DB only (no WhatsApp send): CLI has no WASocket access
- Partial ID matching for draft approve/reject via SQL LIKE: 8-char prefix suffices
- JID normalization appends @g.us if no @ present: consistent with WhatsApp JID format
- google.auth.JWT over GoogleAuth for service account: simpler, no GOOGLE_APPLICATION_CREDENTIALS env var needed
- Lazy cached calendar client init: initCalendarAuth called once on first use, cached in module-level variable
- Graceful null degradation for calendar: all functions return null/false/void when calendar not configured
- [Phase 08]: Callback registration pattern (setGroupMessageCallback) for downstream pipeline: allows Plan 03 date extraction to register without modifying messageHandler again
- zod/v3 compat import for zod-to-json-schema: zod v4 defs incompatible with zod-to-json-schema@3.x; use 'zod/v3' subpath within date extraction module
- chrono-node installed but not used as pre-filter: Hebrew not supported; digit regex (/\d/) is sole pre-filter gate
- In-memory calendarId cache per group: avoids re-parsing calendarLink URL on every event; warm from cache or decode from URL on first use
- Reply-to-delete is non-debounced: immediate handling before debounce buffer for instant user feedback
- Per-group cron job map (scheduledJobs Map): allows stop/replace on config change without restarting all jobs
- generateWeeklyDigest returns null for empty content: caller skips post, no empty messages sent to group
- listUpcomingEvents added to calendarService (not inline in scheduler): reusable, consistent with service pattern
- [Phase 09]: JID prefix matching (split('@')[0]) for @mention detection: handles LID format mismatch in Baileys v7 RC
- [Phase 09]: Lazy dynamic import of detectGroupLanguage in travelHandler: avoids circular dependency
- [Phase 09]: Travel handler runs BEFORE reply-to-delete in pipeline dispatch: reply to travel result routes to travel handler
- [Phase 09]: Multi-tier cheerio selectors (.yuRUbf primary, h3 fallback) for Google HTML scraping resilience
- [Phase 09]: FIFO eviction on travelResultMessages Map at 500 entries to prevent unbounded memory growth
- [Phase 09]: Reply chain follow-up bypasses isBotMentioned: replying to travel result is implicit mention
- [Phase 09]: Rate limit sends user-facing message rather than silent drop

### Pending Todos

- **Group keyword monitor + auto-response**: Monitor groups for specific messages (user-defined keywords/patterns), and send automatic responses based on user-configured templates. Separate from travel search — general-purpose group trigger/response system.

### Blockers/Concerns

- [Phase 8]: GCP service account setup complete — data/service-account-key.json exists, GOOGLE_SERVICE_ACCOUNT_KEY_PATH configured in .env
- [Phase 8]: SQLite WAL mode + busy_timeout must be set on ALL DB connections before Phase 8 writes group messages concurrently
- [Phase 8]: Baileys 7.0.0-rc.9 `key.fromMe` behavior in group context needs validation via debug log during early Phase 8 development
- Baileys v7.0.0-rc.9 is a release candidate — monitor stability in production

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed 09-02-PLAN.md — Phase 9 complete, all milestone v1.1 phases delivered
Resume with: All current roadmap phases complete. Next: define new milestone or features.
Resume file: N/A

### Hot fixes applied this session (not part of any phase):
- **messageHandler.ts**: Fixed `.run()` calls on `upsertContact`, `updateContactMode`, `markDraftSent`, `markDraftRejected` — these functions were changed to call `.run()` internally during Phase 6 UAT, but the messageHandler still called `.run()` on their (now void) return values, crashing on every incoming message.
- **importChats.ts**: Same `.run()` fix for `upsertContact` call.
- **messageHandler.ts**: Added group message storage — `@g.us` messages now persisted to messages table (store only, no reply pipeline).

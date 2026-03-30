# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 31 — Voice and AI Content Types (v1.6 Scheduled Replies)

## Current Position

Phase: 32 of 32 (Recurring Schedules)
Plan: 2 of 2 in current phase
Status: Phase 32 Complete
Last activity: 2026-03-30 — Phase 32 Plan 02 complete (recurring schedule dashboard UI: repeat dropdown, cronstrue preview, cadence badge)

Progress: [██████████] 100% (v1.6)

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
- getPending and getNotified are separate functions — Phase 29 uses notified independently for cancel window expiry (27-02)
- deleteOldScheduledMessages uses .returning() to pass deleted IDs to deleteRecipientsForMessages — avoids secondary lookup (27-02)
- 15-minute periodic scan interval for scheduled messages (not hourly like reminders) — finer-grained promotion needed (28-01)
- activeTimers Map is module-private in scheduledMessageScheduler — callers use functional API only (28-01)
- fireMessage sets status to 'sending' before send — prevents periodic scan from re-firing same message (28-02)
- recoverMessages uses non-blocking setTimeout stagger — recovery returns immediately after scheduling timeouts (28-02)
- 'expired' status for recovery messages older than 1 hour — distinct from 'failed' which implies attempted sends (28-02)
- fireMessage gates on status!=='notified' (not 'pending') — only messages that went through notification are fired (29-01)
- Retry reverts to 'notified' (not 'pending') — message already went through notification pipeline (29-01)
- Recovery for 'notified' messages: re-arm fire timer only, never re-send notification — Pitfall 4 (29-01)
- sendPreSendNotification falls back to scheduling send directly if sock is unavailable — send guaranteed, cancel window is best-effort (29-01)
- Scheduled message cancel placed after task cancel in handleOwnerCommand — both use same stanzaId guard, task cancel tries first (29-02)
- scheduleNewMessage wraps dispatchCallback (not fireCallback) — new messages go through full notification pipeline (30-01)
- Tab 'pending' maps to status IN (pending, notified, sending); 'failed' maps to (failed, cancelled, expired) (30-01)
- PATCH edits restricted to status='pending' only — notified messages have active cancel windows (30-01)
- resolveContent called once before recipient loop — single TTS buffer shared across all recipients (31-01)
- ttsQueue is module-level singleton ensuring global concurrency:1 enforcement (31-01)
- sendVoiceWithTimeout persists sourceText (not audio) to messages DB for AI context continuity (31-01)
- Custom getNextOccurrence using Intl.DateTimeFormat loop — avoids node-cron v4.2.1 weekday bug (32-01)
- Re-fetch message before re-arm to handle cancel race (Pitfall 3) (32-01)
- Recovery re-arms recurring messages to next occurrence instead of expiring (32-01)
- updateScheduledMessageContentAndTime extended with optional cronExpression for PATCH edits (32-01)
- Client-side buildCronExpression mirrors backend for cronstrue preview (32-02)
- getCadenceFromCron inline in both dialog and card -- 2 usages don't warrant shared module (32-02)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 stale-socket bug (issue #2132) — Promise.race mitigation required regardless of fix
- ElevenLabs plan tier determines p-queue concurrency ceiling — currently :1 (conservative), verify if higher is needed

## Session Continuity

Last session: 2026-03-30
Stopped at: Completed 32-02-PLAN.md — recurring schedule dashboard UI (repeat dropdown, cronstrue preview, cadence badge)
Resume with: v1.6 complete — all phases (27-32) shipped. Human verify checkpoint pending for 32-02.

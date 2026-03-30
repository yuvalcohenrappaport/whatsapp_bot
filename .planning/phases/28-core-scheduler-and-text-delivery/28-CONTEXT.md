# Phase 28: Core Scheduler and Text Delivery - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the scheduling engine that picks up pending scheduled messages from the DB, fires them at the correct time via WhatsApp, handles restart recovery for missed messages, and prevents double-fires on Baileys reconnect. Text messages only in this phase — voice and AI content types come in Phase 31.

</domain>

<decisions>
## Implementation Decisions

### Scheduler startup
- On boot, recover missed messages that are **less than 1 hour old** — send them
- Messages older than 1 hour are skipped (Claude's discretion on status value — e.g., 'expired' or 'failed')
- Multiple recovered messages are **staggered 5 seconds apart** to avoid WhatsApp rate limits
- Scheduler starts immediately on boot — does **not** wait for Baileys 'open' event (let sends fail naturally if connection isn't ready yet)

### Send failure behavior
- **Exponential backoff** retry strategy: 1min, 5min, 30min between attempts
- **5 attempts max** before giving up permanently
- When a message permanently fails (exhausts all retries), **notify the owner via self-chat** with a failure message
- **15-second Promise.race timeout** on every Baileys sendMessage call
- Failed sends write status='failed' to DB with incremented failCount

### Scheduler lifecycle
- Periodic DB scan runs **every 15 minutes** to pick up distant messages that are now near-term
- Disconnect/reconnect behavior: **Claude's discretion** based on Baileys connection event model
- Logging: **Claude's discretion** based on existing project logging patterns
- Initialization point: **Claude's discretion** based on codebase (likely index.ts like reminders)

### Claude's Discretion
- Status value for expired/skipped messages (too old on recovery)
- Whether to pause scheduler on Baileys disconnect or let sends fail
- Logging verbosity (fires, failures, or both)
- Where to initialize the scheduler (index.ts or elsewhere)
- Exact exponential backoff implementation (setTimeout chain, or DB-stored nextRetryAt)

</decisions>

<specifics>
## Specific Ideas

- The two-tier scheduler pattern from reminderScheduler.ts is the starting template — setTimeout for near-term, periodic scan for distant
- Dedup guard uses an in-memory `activeTimers` Map (same pattern as reminders)
- The 15-minute scan interval is tighter than reminders (hourly) because scheduled messages are more time-sensitive
- Exponential backoff retry intervals: 1min → 5min → 30min → 30min → 30min (cap at 30min)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 28-core-scheduler-and-text-delivery*
*Context gathered: 2026-03-30*

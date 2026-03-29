# Phase 27: DB Foundation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the `scheduled_messages` and `scheduled_message_recipients` tables, migration, and query layer. Schema must support all downstream phases: text, voice, AI-generated content, recurring cron schedules, pre-send cancel window, retry on failure, multi-recipient, and 30-day retention cleanup.

</domain>

<decisions>
## Implementation Decisions

### Message lifecycle
- Status flow: `pending` → `notified` (self-chat cancel window sent) → `sending` → `sent` / `failed`
- Explicit `notified` state for the 2-minute cancel window between notification and send
- Cancel window is **2 minutes** between self-chat notification and actual send
- Cancelled messages are **soft-deleted** (status='cancelled', row kept for history)
- Recurring messages that fail: **continue the series** — mark this occurrence as failed, compute next fire, keep going. One failure doesn't break the series.
- Failed one-off messages retry up to 3 times via hourly scan (from Phase 29 spec)

### Content storage
- Store generated text in a `sentContent` column after AI messages are sent — reviewable in dashboard history
- Voice audio files are **deleted from disk after send** — audio is a one-time delivery vehicle
- Sent/cancelled messages auto-purge after **30 days** (cleanup job)
- Content column design: **Claude's discretion** (single `content` + `type` enum vs separate columns)

### Recipient model
- **Multi-recipient**: one scheduled message can target multiple contacts/groups
- Separate `scheduled_message_recipients` table with per-recipient send status
- Each recipient has **independent status** — partial delivery is OK (one can fail while others succeed)
- Recipient picker shows **both contacts and groups** from WhatsApp
- AI-generated messages produce **unique content per recipient** using each contact's style context

### Claude's Discretion
- Single `content` column vs separate columns for text/prompt/voiceText — pick what fits the query patterns best
- Exact column types and defaults
- Index strategy for pending message lookups
- Whether `sentContent` is on the main table or the recipients table (since AI content is per-recipient)

</decisions>

<specifics>
## Specific Ideas

- Per-recipient `sentContent` makes more sense than per-message since AI generates unique text per recipient
- The `notified` state + 2-minute window mirrors the existing calendar suggest-then-confirm pattern
- Cron expressions stored as strings (not ms intervals) — confirmed in research for DST safety
- Schema should support the existing two-tier scheduler pattern (setTimeout + hourly DB scan) without requiring changes to the scheduler architecture

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 27-db-foundation*
*Context gathered: 2026-03-30*

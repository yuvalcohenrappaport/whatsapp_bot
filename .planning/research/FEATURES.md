# Feature Research

**Domain:** Scheduled message delivery — WhatsApp bot that impersonates owner
**Researched:** 2026-03-30
**Confidence:** HIGH (project context clear; scheduling patterns well-established)

---

## Context: What Is Already Built

This is a subsequent milestone. The existing bot has:
- Draft queue with pending/approved/rejected lifecycle
- Auto-reply with safety guardrails (cap, cooldown, snooze)
- Smart reminders with two-tier scheduler (setTimeout + hourly DB scan) in `src/reminders/reminderScheduler.ts`
- Commitment detection from private chats
- Voice message generation via ElevenLabs TTS (`src/voice/`)
- Dashboard management for contacts, groups, keyword rules, reminders
- Self-chat notification pattern for owner approvals (`notificationMsgId` column pattern)
- Recurring weekly digest via node-cron
- AI pipeline for text generation (`src/ai/`)

**Critical integration points for new features:**
- `src/reminders/reminderScheduler.ts` — two-tier scheduler to extend/reuse
- `src/db/schema.ts` — Drizzle ORM + SQLite; new `scheduledMessages` table follows established patterns
- `src/voice/` — ElevenLabs TTS already wired; call at fire time for voice messages
- `src/ai/` — Gemini pipeline; call at fire time for AI prompt messages
- `dashboard/src/` — React app; new page follows existing route/component patterns
- Self-chat notification pattern — used by drafts, commitments, reminders for owner interaction

---

## Table Stakes (Users Expect These)

Features the owner assumes exist. Missing any makes the feature feel incomplete.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| One-time scheduled message | Core promise of the milestone | LOW | Reuses two-tier scheduler from `reminderScheduler.ts` |
| Send to contact OR group | Both recipient types already tracked | LOW | `contacts.jid` and `groups.id` already in DB |
| Text message content | Simplest content type | LOW | Plain string, sends via existing WhatsApp socket |
| Dashboard list of scheduled messages | Cannot manage what you cannot see | MEDIUM | New page in dashboard; table with status, recipient, time, content preview |
| Edit a pending scheduled message | Scheduling errors are common | LOW | Update body or time before it fires; cancel timer, register new one |
| Cancel a pending scheduled message | Must exist — unsent messages must not fire silently | LOW | Set status = 'cancelled', clear in-memory timer |
| Pre-send self-chat notification with cancel window | Established codebase pattern; owner expects it from reminders | MEDIUM | Self-chat send + reply matching via `notificationMsgId` pattern |
| Status tracking (pending / sent / cancelled / failed) | Owner needs to audit what actually fired | LOW | Follows `reminders.status` pattern already in schema |
| Timezone-correct scheduling | Owner is in IST; times must be unambiguous | LOW | Store all times as UTC Unix ms; display in IST in dashboard — existing project convention |

### Notes on Table Stakes

- **Pre-send cancel window** is critical for a bot that impersonates the owner. Sending wrong messages to real contacts without a safety net is a serious UX risk. Default window of 5 minutes is appropriate.
- **Status tracking** should show `sentAt` timestamp so the owner can confirm delivery — not just "sent" as a boolean.

---

## Differentiators (Competitive Advantage)

Features that add real value beyond basic scheduling.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| Voice message content type | Bot already does TTS; scheduling a voice message is novel | MEDIUM | `src/voice/` ElevenLabs pipeline; `contacts.voiceId` for per-contact voice override — resolve at fire time |
| AI prompt content type | Owner writes a short prompt; actual message generated at send time — stays contextually fresh | MEDIUM | `src/ai/` Gemini pipeline; generate at fire time, not at schedule time |
| Simple recurrence (daily / weekly / monthly) | Covers "good morning every Monday" without calendar complexity | MEDIUM | On fire: compute next occurrence, insert new row; no cron-string complexity needed |
| Cancel window configurable per message | Some sends need 1-minute warning, others need 10 minutes | LOW | Store `cancelWindowMinutes` on the row; default = 5 |
| Delivery status (`sentAt` timestamp) | Did it actually send? | LOW | Set after WhatsApp socket ACK; surface in dashboard list |

---

## Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Complex recurrence (RRULE, every 2nd Tuesday) | Feels powerful | iCal RRULE parsing is complex; month-end boundary cases (Feb 30), DST gaps, missed-send recovery — rabbit hole | Support daily/weekly/monthly only; insert-next-row on fire |
| Bulk broadcast (send same message to many contacts) | Seems efficient | WhatsApp rate limits will ban the number; bulk send is a distinct problem domain | Keep it one recipient per scheduled message |
| Message templates with variable substitution ({{name}}) | Personalization without AI | Adds a template engine; AI prompt mode already covers this better | Use AI prompt content type for dynamic content |
| Persistent job queue (Bull/Agenda/BullMQ) | Seems more robust | Overkill — project already has a proven two-tier scheduler that survives restarts via hourly DB scan; introduces Redis/MongoDB dependency | Extend the existing `reminderScheduler.ts` pattern |
| Delivery receipts / read confirmations | Transparency | WhatsApp Web.js does not reliably surface read receipts for all message types; creates false confidence | Show `sent` vs `failed` only; do not promise `read` status |
| Auto-retry on failure | Prevents silent drops | Auto-retry risks double-sends if first send succeeded but ACK was lost | Mark as `failed`, surface in dashboard; let owner manually reschedule |
| Recipient picker from "all contacts" | Seems obvious | Contacts table may have hundreds of entries; sending to wrong contact is dangerous | Require explicit JID selection from dashboard; show name + last active for confirmation |

---

## Feature Dependencies

```
[scheduledMessages DB table]
    └──required by──> [Dashboard list/create/edit/cancel]
    └──required by──> [Scheduler registration on startup]
    └──required by──> [Pre-send self-chat notification]
    └──required by──> [Recurrence: next-occurrence insert]

[Existing two-tier scheduler (reminderScheduler.ts)]
    └──extended by──> [scheduledMessages timer registration]
                       (generalize scheduleReminder to accept generic callback)

[Pre-send self-chat notification]
    └──required by──> [Cancel window via owner reply]

[Voice content type]
    └──depends on──> [ElevenLabs TTS — exists in src/voice/]
    └──depends on──> [contacts.voiceId — exists in schema]

[AI prompt content type]
    └──depends on──> [Gemini pipeline — exists in src/ai/]

[Recurrence]
    └──depends on──> [One-time send working end-to-end]
    └──implemented as──> [Insert new scheduledMessages row on fire]
```

### Dependency Notes

- **DB schema is the root blocker.** Every other feature in this milestone needs it. Schema design gates all parallel work.
- **Two-tier scheduler generalization** is low-effort. `scheduleReminder` already accepts an `onFire` callback. A thin wrapper that reads `scheduledMessages` instead of `reminders` is all that's needed. The hourly scan already handles missed fires after restart.
- **Voice and AI content types are parallel additions.** Both are optional content types resolved at fire time. Neither blocks text scheduling.
- **Recurrence has no engine** — it's just an insert. On successful fire, compute next occurrence based on `recurrenceType` + original `scheduledAt`, insert a new row with `status = 'pending'`.
- **Cancel window depends on pre-send notification.** The self-chat message IS the cancel mechanism — owner replies to abort. This follows the existing `notificationMsgId` reply-matching pattern already in drafts, commitments, and reminders.

---

## MVP Definition

### Launch With (v1)

Minimum viable for this milestone.

- [ ] `scheduledMessages` DB table with all required columns
- [ ] One-time text message: contact or group recipient, specific datetime
- [ ] Extend hourly scan to cover `scheduledMessages` (reuse `reminderScheduler.ts`)
- [ ] Pre-send self-chat notification with 5-minute cancel window
- [ ] Dashboard page: list, create, edit, cancel
- [ ] Status lifecycle: `pending` → `sent` / `cancelled` / `failed`

### Add After Validation (v1.x)

- [ ] Voice message content type — existing TTS pipeline, medium effort
- [ ] AI prompt content type — existing AI pipeline, medium effort
- [ ] Simple recurrence (daily / weekly / monthly) — insert-next-row approach
- [ ] Configurable cancel window per message

### Future Consideration (v2+)

- [ ] Recurrence end date / max occurrences — adds row-management complexity; only if owner uses recurrence heavily
- [ ] Message preview in pre-send notification for AI content — useful but post-MVP

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| DB schema + one-time text scheduling | HIGH | LOW | P1 |
| Scheduler extension (hourly scan) | HIGH | LOW | P1 |
| Pre-send self-chat + cancel window | HIGH | MEDIUM | P1 |
| Dashboard list/create/edit/cancel | HIGH | MEDIUM | P1 |
| Voice content type | MEDIUM | MEDIUM | P2 |
| AI prompt content type | MEDIUM | MEDIUM | P2 |
| Simple recurrence | MEDIUM | MEDIUM | P2 |
| Configurable cancel window | LOW | LOW | P2 |
| Delivery `sentAt` timestamp | LOW | LOW | P2 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Edge Cases to Handle

| Edge Case | Expected Behavior |
|-----------|-------------------|
| Bot restarts before a scheduled message fires | Hourly scan picks it up within 60 min; fires within 1 hour of scheduled time — same guarantee as reminders |
| Owner cancels via self-chat reply after pre-send notification fires | Parse "cancel" reply matched by `notificationMsgId`; set status = 'cancelled'; clear timer |
| Scheduled time is in the past at creation time | Reject at creation with validation error; dashboard shows "scheduled time must be in the future" |
| Recurrence fires but next month occurrence falls on invalid day (e.g., Feb 30) | Round to last valid day of month (standard calendar behavior, e.g., Feb 28/29) |
| AI generation fails at fire time | Mark `status = 'failed'`, log error, surface in dashboard; do not retry automatically (double-send risk) |
| Recipient contact deleted from DB before fire time | Attempt send using stored JID anyway; log warning if contact lookup fails for display purposes |
| Cancel window race: message fires before owner can read self-chat notification | Pre-send notification time + cancel window duration must elapse before fire; timer for send starts AFTER pre-send notification is delivered |
| Two messages to same recipient scheduled at same time | No dedup needed — both fire; owner is responsible for scheduling |
| Voice message with no voiceId on contact | Fall back to default ElevenLabs voice; same as ad-hoc voice replies |

---

## Existing System Leverage

Key existing building blocks to reuse rather than rebuild:

| Existing Asset | Location | How It's Used |
|---------------|----------|----------------|
| Two-tier scheduler | `src/reminders/reminderScheduler.ts` | Generalize `scheduleReminder` + `startHourlyScan` to handle `scheduledMessages` rows |
| Self-chat notification + reply matching | Drafts, commitments, reminders pattern | `notificationMsgId` + owner reply parsing for cancel window |
| ElevenLabs TTS | `src/voice/` | Call at fire time for voice content type |
| Gemini AI pipeline | `src/ai/` | Call at fire time for AI prompt content type |
| Drizzle ORM + SQLite | `src/db/schema.ts` | Add `scheduledMessages` table following established conventions |
| Dashboard React app | `dashboard/src/` | New page following existing route/component patterns |
| Contacts + Groups DB | `src/db/schema.ts` | Recipient JID resolution and display name lookup |
| node-cron (already in package.json) | — | Existing hourly scan driver |

---

## Sources

- [WhatsApp Message Scheduler: How to Automate Messages Easily — PickyAssist](https://pickyassist.com/blog/whatsapp-message-scheduler/)
- [Top 10 WhatsApp Scheduler Use Cases — AiSensy](https://m.aisensy.com/blog/whatsapp-scheduler-use-cases/)
- [Communicate Across Time Zones on WhatsApp — A2C.chat](https://www.a2c.chat/en/communicate-across-time-zones-on-whatsapp-4-effective-scheduling-tools.html)
- [Job Schedulers for Node: Bull or Agenda? — AppSignal](https://blog.appsignal.com/2023/09/06/job-schedulers-for-node-bull-or-agenda.html)
- [Comparing the best Node.js schedulers — LogRocket](https://blog.logrocket.com/comparing-best-node-js-schedulers/)
- [Scheduling messages — Slack API docs](https://api.slack.com/messaging/scheduling)
- Existing codebase: `src/reminders/reminderScheduler.ts`, `src/db/schema.ts`, `package.json`

---

*Feature research for: WhatsApp bot scheduled message delivery milestone*
*Researched: 2026-03-30*

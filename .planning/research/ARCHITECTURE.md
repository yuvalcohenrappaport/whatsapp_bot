# Architecture Research

**Domain:** Scheduled message delivery — adding to existing WhatsApp bot
**Researched:** 2026-03-30
**Confidence:** HIGH (based on direct codebase analysis)

---

## Existing Architecture Summary

The bot follows a clean layered structure:

```
┌─────────────────────────────────────────────────────────────┐
│                      Dashboard (React SPA)                   │
│  shadcn/ui, React Query, Vite — served as static by Fastify │
├─────────────────────────────────────────────────────────────┤
│                    Fastify REST API                          │
│  src/api/routes/*.ts — JWT-protected, one file per domain   │
├───────────────────┬─────────────────────────────────────────┤
│  Message Pipeline │  Scheduler Subsystems                   │
│  src/pipeline/    │  src/reminders/  src/groups/            │
│  messageHandler   │  Two-tier model  node-cron jobs         │
├───────────────────┴─────────────────────────────────────────┤
│                  Service Layer                               │
│  src/ai/  src/voice/  src/calendar/  src/commitments/       │
│  src/todo/  src/whatsapp/sender.ts                          │
├─────────────────────────────────────────────────────────────┤
│                  DB Layer (Drizzle + SQLite)                 │
│  src/db/schema.ts + src/db/queries/*.ts                     │
└─────────────────────────────────────────────────────────────┘
```

### Existing Scheduler Patterns (Both Reusable)

**Two-tier pattern** (`src/reminders/reminderScheduler.ts`):
- `scheduleReminder(id, fireAt, onFire)` — uses `setTimeout` for ≤24h. Beyond 24h, skips (DB scan promotes later).
- `startHourlyScan(onFire)` — `setInterval` every hour, queries DB for records entering the 24h window, promotes to `setTimeout`.
- `scheduleAllUpcoming(onFire)` — called on startup to bootstrap near-term timers.
- `activeTimers: Map<string, NodeJS.Timeout>` — tracks in-memory timers, supports cancel.

**Cron pattern** (`src/groups/reminderScheduler.ts`):
- `node-cron.schedule(expression, handler, { timezone: 'Asia/Jerusalem' })` keyed in a `Map<id, ScheduledTask>`.
- Used for group weekly digest — fixed day/time recurring jobs.

Both patterns are directly reusable. The scheduled messages feature combines them: cron for cron-expression recurring, two-tier for one-off and interval-based.

### Self-Chat Approval Pattern (`src/calendar/personalCalendarPipeline.ts`)

Existing pattern for owner approval flows:
1. Send notification to `config.USER_JID`, store returned message ID as `notificationMsgId` in DB.
2. Inbound reply to self-chat is checked via `quotedMsgId` against `notificationMsgId`.
3. Owner's "yes"/"no" reply triggers approval or rejection.

This pattern is already in `messageHandler.ts` via `handleCalendarApproval`, `handleTaskCancel`, `tryHandleReminder`. Add scheduled message approval to the same chain.

### Sender Layer (`src/whatsapp/sender.ts`)

- `sendWithDelay(sock, jid, text)` — typing presence + 1.5–4s delay + send + DB persist.
- `sendVoiceWithDelay(sock, jid, audioBuffer, replyText)` — recording presence + send PTT + DB persist (text, not audio).
Both called as-is. No modification needed.

### Voice Pipeline (`src/voice/tts.ts`)

- `textToSpeech(text, logger): Promise<Buffer>` — ElevenLabs → MP3 → ffmpeg → OGG/Opus.
Called as-is at fire time. No modification needed.

### AI Layer (`src/ai/gemini.ts`)

- `generateReply(contactJid)` — builds from last 50 messages + style context. **Not suitable for scheduled messages** (assumes an inbound message to reply to).
- `buildSystemPrompt` (internal) — assembles per-contact style context (persona, styleSummary, examples).
A new exported function `generateScheduledContent(contactJid, promptHint)` is needed. It reuses `buildSystemPrompt` but uses `promptHint` as the user message instead of real chat history.

---

## New vs Modified — Explicit Component Map

| Component | Status | What Changes |
|-----------|--------|--------------|
| `src/db/schema.ts` | **Modified** | Add `scheduledMessages` table |
| `src/db/queries/scheduledMessages.ts` | **New** | Insert, getById, getByStatus, getInWindow, updateStatus, updateScheduledAt, updateNotificationMsgId |
| `drizzle/XXXX_scheduled_messages.sql` | **New** | Migration for the table |
| `src/scheduled/scheduledMessageScheduler.ts` | **New** | Timer logic: setTimeout/cron, activeTimers + activeCrons Maps, hourly scan, startup bootstrap |
| `src/scheduled/scheduledMessageService.ts` | **New** | Fire logic, pre-send approval notification, recovery on restart, `initScheduledMessageSystem()` |
| `src/ai/gemini.ts` | **Modified** | Add `generateScheduledContent(contactJid, promptHint)` export |
| `src/api/routes/scheduledMessages.ts` | **New** | CRUD + manual fire endpoints |
| `src/api/server.ts` | **Modified** | One `fastify.register(scheduledMessageRoutes)` line |
| `src/index.ts` | **Modified** | Call `initScheduledMessageSystem()` in `onOpen` callback |
| `src/pipeline/messageHandler.ts` | **Modified** | Add `tryHandleScheduledMessageApproval` to self-chat handler chain |
| `dashboard/src/pages/ScheduledMessages.tsx` | **New** | Management list + create form |
| `dashboard/src/hooks/useScheduledMessages.ts` | **New** | React Query hook |
| `dashboard/src/api/scheduledMessages.ts` | **New** | API client functions |
| `dashboard/src/router.tsx` | **Modified** | One route entry |

Everything else — `sender.ts`, `tts.ts`, voice pipeline, DB client, reminder system — is unchanged.

---

## Data Schema

Add to `src/db/schema.ts`:

```typescript
export const scheduledMessages = sqliteTable(
  'scheduled_messages',
  {
    id: text('id').primaryKey(),                    // UUID
    label: text('label'),                           // Human-readable name for dashboard
    recipientJid: text('recipient_jid').notNull(),  // Contact or group JID
    messageType: text('message_type').notNull(),    // 'text' | 'voice' | 'ai'
    content: text('content'),                       // Raw text (text/voice) or prompt hint (ai)
    status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'failed' | 'cancelled'
    scheduledAt: integer('scheduled_at').notNull(), // Unix ms — next fire time
    cronExpression: text('cron_expression'),        // null for one-off; cron string for recurring
    intervalMs: integer('interval_ms'),             // null unless interval-based recurring
    requireApproval: integer('require_approval', { mode: 'boolean' }).notNull().default(false),
    notifyBeforeMs: integer('notify_before_ms'),    // How early to send approval notification
    notificationMsgId: text('notification_msg_id'), // Self-chat msg ID for approval matching
    approvalStatus: text('approval_status'),        // null | 'pending' | 'approved' | 'rejected'
    lastSentAt: integer('last_sent_at'),            // Unix ms of most recent send
    failureReason: text('failure_reason'),
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_sched_msgs_status_time').on(table.status, table.scheduledAt),
    index('idx_sched_msgs_notification').on(table.notificationMsgId),
  ],
);
```

**Design decisions:**
- `cronExpression` (node-cron string) and `intervalMs` (milliseconds) are mutually exclusive. `cronExpression` for human-specified day/time patterns; `intervalMs` for "every N days/hours". Null for one-off.
- `requireApproval + notifyBeforeMs` mirrors `personalPendingEvents`. Fire the notification `notifyBeforeMs` before `scheduledAt`, wait for reply.
- `messageType: 'ai'` stores a prompt hint in `content` (e.g., "morning check-in message", "remind about meeting"). The AI call gets style context from the contact record.
- Status `'pending'` covers both waiting-to-fire and waiting-for-approval-before-fire. `approvalStatus` tracks the approval sub-state when `requireApproval` is true.

---

## Data Flow

### Create Flow (Dashboard → DB → Timer)

```
Dashboard form submit
    ↓
POST /api/scheduled-messages
    ↓
Insert row (status: 'pending', scheduledAt: given time)
    ↓
If cronExpression:
    node-cron.schedule(cronExpression, onFire, { timezone: 'Asia/Jerusalem' })
    store in activeCrons Map<id, ScheduledTask>
Else if scheduledAt within 24h:
    setTimeout → activeTimers Map<id, Timeout>
Else:
    hourly scan will promote when it enters the 24h window
    ↓
Return { id } to dashboard
```

### Fire Flow (Timer → WhatsApp)

```
setTimeout or cron triggers onFire(id)
    ↓
scheduledMessageService.fireMessage(id)
    ↓
Read row — guard: status === 'pending', approvalStatus !== 'rejected'
    ↓
If requireApproval and notifyBeforeMs and not yet notified:
    Send self-chat notification → save returned msgId as notificationMsgId
    Set approvalStatus = 'pending'
    Re-schedule fire for scheduledAt (actual send time)
    Return — wait for owner reply
    ↓ (owner approves via self-chat reply)
    approvalStatus = 'approved' → continue to send
    ↓
Branch on messageType:

  'text'  → sendWithDelay(sock, recipientJid, content)

  'voice' → textToSpeech(content, logger)
            → sendVoiceWithDelay(sock, recipientJid, buffer, content)

  'ai'    → generateScheduledContent(recipientJid, content)
            → based on contact.voiceReplyEnabled:
                voice: textToSpeech → sendVoiceWithDelay
                text:  sendWithDelay
    ↓
Update: status = 'sent', lastSentAt = now
    ↓
If cronExpression: cron handles next execution; status resets to 'pending'
If intervalMs: update scheduledAt = now + intervalMs; re-enter two-tier scheduler
If one-off: done, status stays 'sent'
```

### Approval Flow (Self-Chat Reply → Fire)

```
Owner replies "yes" or "no" in self-chat (quoting or following notification)
    ↓
messageHandler.ts self-chat handler chain:
    tryHandleReminder → tryHandleScheduledMessageApproval (NEW) → ...
    ↓
tryHandleScheduledMessageApproval(sock, text, incomingMsg):
    Look up row by notificationMsgId matching quotedMsgId (or last pending-approval row)
    ↓
'yes' → approvalStatus = 'approved'
         → fireMessage(id) immediately (bypasses approval check)
'no'  → approvalStatus = 'rejected'
         → send confirmation: "Scheduled message cancelled"
         If recurring: reset to 'pending' for next cycle
         If one-off: status = 'cancelled'
```

---

## Integration Points in Existing Code

### 1. `src/index.ts` — `onOpen` callback

```typescript
// alongside initReminderSystem():
initScheduledMessageSystem().catch((err) => {
  logger.error(err, 'Failed to initialize scheduled message system');
});
```

`initScheduledMessageSystem` does: recover missed one-offs, bootstrap near-term timers, start hourly scan, register cron jobs for recurring.

### 2. `src/pipeline/messageHandler.ts` — self-chat handler chain

The file has a chain where each `tryHandle*` returns `true` if it consumed the message. Add after `tryHandleReminder`:

```typescript
if (await tryHandleScheduledMessageApproval(sock, text, msg)) return;
```

The function signature mirrors existing handlers: `(sock, text, msg?) => Promise<boolean>`.

### 3. `src/api/server.ts` — route registration

```typescript
import scheduledMessageRoutes from './routes/scheduledMessages.js';
// ...
await fastify.register(scheduledMessageRoutes);
```

### 4. `src/ai/gemini.ts` — new export for AI scheduled messages

```typescript
export async function generateScheduledContent(
  contactJid: string,
  promptHint: string,
): Promise<string | null>
```

Reuses `buildSystemPrompt(contactJid, contact)` (already exists as internal function — no changes to its logic), then calls `generateText` with `promptHint` as user message. Does not read recent chat history (this is an outbound-only message, not a reply).

---

## Scheduler Architecture for Recurring Messages

Three sub-cases based on recurrence type:

**One-off** (no `cronExpression`, no `intervalMs`):
- Two-tier scheduler (setTimeout ≤24h, hourly scan otherwise).
- After sending: `status = 'sent'`. Done.

**Cron-expression recurring** (`cronExpression` set, e.g., `0 9 * * 1`):
- On create/init: `node-cron.schedule(expression, () => fireMessage(id))` → store in `activeCrons Map<id, ScheduledTask>`.
- After each send: reset `status = 'pending'`, `lastSentAt = now`. Cron continues automatically.
- On cancel: `activeCrons.get(id)?.stop()`, `activeCrons.delete(id)`, `status = 'cancelled'`.

**Interval recurring** (`intervalMs` set, e.g., every 3 days = 259200000ms):
- Two-tier scheduler (same as one-off for initial fire).
- After each send: `scheduledAt = now + intervalMs`, `status = 'pending'`. Re-enter scheduler.

**Recovery on restart** (same strategy as `recoverReminders`):
- Missed by <1h: fire immediately.
- Missed by >1h and one-off: mark `status = 'skipped'`, notify self-chat.
- Missed by >1h and recurring: compute next fire time, update `scheduledAt`, reschedule.

---

## API Routes Shape

```
GET    /api/scheduled-messages           — list (filter by status)
GET    /api/scheduled-messages/:id       — single record
POST   /api/scheduled-messages           — create
PATCH  /api/scheduled-messages/:id       — update (reschedule, edit content)
DELETE /api/scheduled-messages/:id       — cancel + remove timer
POST   /api/scheduled-messages/:id/fire  — manual fire (dashboard "send now" button)
```

The `PATCH` endpoint must cancel any existing timer before rescheduling.

---

## Dashboard Components

Two views on the new `ScheduledMessages.tsx` page:

1. **Management list** — shows all scheduled messages (pending, sent, failed, cancelled). Each card: label, recipient name, next fire time, recurrence indicator, cancel button. Filter tabs by status. Mirrors pattern of `Reminders.tsx`.

2. **Create form** — fields: label, recipient (contact picker from existing `/api/contacts`), message type (text/voice/ai), content/prompt, scheduled date-time, recurrence (none / cron / interval), require approval toggle + notify-before-minutes. Submit → `POST /api/scheduled-messages`.

Contact picker reuses the existing contacts API. No new API needed for that.

---

## Suggested Build Order

Each step unblocks the next. No step requires work from a later step.

**Step 1: DB schema + migration**
- Add `scheduledMessages` table to `src/db/schema.ts`.
- Run `npm run db:generate` to produce migration SQL, then `npm run db:migrate`.
- Everything downstream depends on the table existing.

**Step 2: DB queries** (`src/db/queries/scheduledMessages.ts`)
- insert, getById, getByStatus, getPendingInWindow, updateStatus, updateScheduledAt, updateNotificationMsgId.
- No other dependencies.

**Step 3: Scheduler** (`src/scheduled/scheduledMessageScheduler.ts`)
- Mirror `src/reminders/reminderScheduler.ts` structure.
- Add `activeCrons Map<string, cron.ScheduledTask>` alongside `activeTimers`.
- Exports: `scheduleMessage`, `cancelScheduledMessage`, `scheduleCronMessage`, `cancelCronMessage`, `startHourlyScan`, `scheduleAllUpcoming`.
- Depends only on DB queries and `node-cron`.

**Step 4: `generateScheduledContent` in `src/ai/gemini.ts`**
- New export, reuses existing `buildSystemPrompt`.
- Isolated change, no downstream impact yet.
- Can be stubbed (returns `promptHint` as-is) and fleshed out separately.

**Step 5: Service** (`src/scheduled/scheduledMessageService.ts`)
- Fire logic, approval notification, recovery, init function.
- Depends on: scheduler (step 3), `generateScheduledContent` (step 4), `textToSpeech`, `sendWithDelay`, `sendVoiceWithDelay`, `getState`, DB queries.
- Write `tryHandleScheduledMessageApproval` here (exported for messageHandler).

**Step 6: Wire into `index.ts` and `messageHandler.ts`**
- `index.ts`: one `initScheduledMessageSystem()` call in `onOpen`.
- `messageHandler.ts`: one `tryHandleScheduledMessageApproval` call in self-chat chain.
- Two-line changes each. Verifiable immediately after step 5.

**Step 7: API routes** (`src/api/routes/scheduledMessages.ts`) + register in `server.ts`
- Exposes CRUD to dashboard.
- Depends on service (step 5) and DB queries (step 2).

**Step 8: Dashboard**
- `dashboard/src/api/scheduledMessages.ts` — API client functions.
- `dashboard/src/hooks/useScheduledMessages.ts` — React Query hook.
- `dashboard/src/pages/ScheduledMessages.tsx` — Build list view first (simpler, no new API needed), then create form.
- `dashboard/src/router.tsx` — add route.
- Fully unblocked once step 7 is done.

---

## Anti-Patterns to Avoid

### Re-implementing the Two-Tier Scheduler from Scratch

**What:** Writing new timer logic independently of `reminderScheduler.ts`.
**Why wrong:** The existing implementation is clean and well-tested. The only additions needed are cron support alongside it.
**Instead:** Copy `reminderScheduler.ts` structure, add `activeCrons` Map alongside `activeTimers`.

### Pre-generating Voice Audio at Create Time

**What:** TTS when the scheduled message is created, storing the audio buffer in DB.
**Why wrong:** Audio is large, ElevenLabs voice output is for real-time delivery. Stale audio sounds fine but wastes storage and complicates the schema.
**Instead:** Call `textToSpeech` at fire time. Voice generation is fast (< 2s).

### Calling `generateReply` for AI Scheduled Messages

**What:** Reusing the existing `generateReply(contactJid)` for AI message type.
**Why wrong:** `generateReply` reads the last 50 messages and generates a reply in reply-to context. A scheduled "good morning" message doesn't have an inbound message context.
**Instead:** New `generateScheduledContent(contactJid, promptHint)` that reuses style building but treats `promptHint` as the user message.

### Global "yes/no" Matching for Approval

**What:** Matching any "yes" or "no" in self-chat as approval for the most recent pending scheduled message.
**Why wrong:** Owner has other approval flows (calendar events, tasks). Collisions are likely.
**Instead:** Match via `quotedMsgId` (reply-to) matching `notificationMsgId` in DB — same pattern as `personalPendingEvents`.

### Modifying `reminderScheduler.ts` to Handle Scheduled Messages

**What:** Adding scheduled message logic into the existing reminder scheduler.
**Why wrong:** These are separate features with separate schemas and fire logic. Coupling them creates a maintenance burden.
**Instead:** New `src/scheduled/` directory with its own scheduler and service, mirroring the `src/reminders/` pattern.

---

## Scalability Considerations

| Concern | At current scale (personal bot) | Notes |
|---------|----------------------------------|-------|
| Active timers | Dozens — fine in-memory | Map<id, Timeout> |
| Active cron jobs | ~10s of recurring messages — fine | Map<id, ScheduledTask> |
| AI calls (type='ai') | Per scheduled fire, no batch | ElevenLabs and Gemini fine for personal use |
| SQLite rows | Hundreds over months | Trivial |
| PM2 cluster | Single process assumed | node-cron jobs would duplicate in cluster mode — keep single worker |

No scalability concerns at personal bot scale.

---

## Sources

- Direct codebase analysis: `src/reminders/reminderScheduler.ts` (two-tier pattern to mirror)
- Direct codebase analysis: `src/reminders/reminderService.ts` (orchestrator pattern, fire logic, recovery)
- Direct codebase analysis: `src/groups/reminderScheduler.ts` (node-cron pattern for recurring)
- Direct codebase analysis: `src/db/schema.ts` (table structure conventions, index patterns)
- Direct codebase analysis: `src/pipeline/messageHandler.ts` (self-chat handler chain, tryHandle* pattern)
- Direct codebase analysis: `src/calendar/personalCalendarPipeline.ts` (notificationMsgId approval pattern)
- Direct codebase analysis: `src/voice/tts.ts`, `src/whatsapp/sender.ts` (reuse as-is)
- Direct codebase analysis: `src/ai/gemini.ts` (buildSystemPrompt, generateReply — identifies gap)
- Direct codebase analysis: `src/api/server.ts`, `src/api/routes/reminders.ts` (route registration pattern)
- Direct codebase analysis: `src/index.ts` (startup init sequence)

---
*Architecture research for: WhatsApp bot — scheduled message delivery milestone*
*Researched: 2026-03-30*

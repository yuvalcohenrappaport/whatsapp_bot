# Stack Research

**Domain:** Scheduled message delivery with recurring schedules, voice TTS queuing, AI-generated messages at send time — added to existing WhatsApp bot
**Researched:** 2026-03-30
**Scope:** NEW additions only. Existing stack (Baileys v7, Gemini 2.5 Flash, ElevenLabs, Fastify 5, React 19 + shadcn/ui, Drizzle/SQLite, node-cron, TanStack Query) is not re-researched.
**Confidence:** HIGH — all key findings verified by direct runtime testing in the project's node_modules

---

## Decision Map

| Capability | Decision | Library / Pattern |
|---|---|---|
| Recurring schedule execution (cron) | Extend existing `node-cron` | No new library |
| Validate cron expression before DB save | `node-cron.validate()` — already available | No new library |
| Compute next run time for DB scan | `node-cron` task `.getNextRun()` — already available | No new library |
| Human-readable schedule display in dashboard | `cronstrue` | **1 new package (backend + dashboard)** |
| TTS rate limit compliance (ElevenLabs concurrency cap) | `p-queue` concurrency:1 — already transitive dep | Promote to direct dep only |
| AI content at send time | Existing `generateText` / `generateJson` via `ai/provider.ts` | No new library |
| Schema for scheduled messages | Extend Drizzle/SQLite with new table | No new library |

**Net result: 1 new library (`cronstrue`). 1 transitive dep promoted to direct (`p-queue`).**

---

## Capability Detail

### 1. Recurring Schedule Execution

**Decision: Extend existing `node-cron` v4.2.1. No new library.**

`node-cron` is already a direct dependency and already in use for weekly group digests. v4 has everything needed:

- `nodeCron.validate(expr)` — validates a cron string before writing to DB
- `task.getNextRun()` — returns a `Date` for the next fire time (used to update `nextRunAt` in the DB)
- `{ timezone: 'Asia/Jerusalem' }` option — verified working

**Runtime-verified API:**
```typescript
import * as nodeCron from 'node-cron';

// Validate before saving
nodeCron.validate('0 9 * * 1')    // true
nodeCron.validate('bad expr')     // false

// Compute next run date (use to update nextRunAt column)
const task = nodeCron.schedule('0 9 * * 1', fn, {
  scheduled: false,
  timezone: 'Asia/Jerusalem',
});
const next: Date = task.getNextRun();  // Date object
task.destroy();

// Live recurring task
const live = nodeCron.schedule('0 9 * * 1', fn, {
  timezone: 'Asia/Jerusalem',
});
```

**Scheduler architecture** follows the existing two-tier pattern from `reminderScheduler.ts`:
- setTimeout for items in the next 24 h
- Hourly DB scan (`getScheduledMessagesInWindow`) promotes items crossing into the window
- After each fire, if cron: `UPDATE scheduled_messages SET next_run_at = <new nextRun> WHERE id = ?`
- If one-off: `UPDATE scheduled_messages SET status = 'completed' WHERE id = ?`

No new scheduler infrastructure. The existing `reminderScheduler.ts` is the template.

**Confidence:** HIGH — node-cron 4.2.1 installed, API tested in this project.

---

### 2. TTS Concurrency Control (Voice Scheduled Messages)

**Decision: Promote `p-queue` v9.1.0 from transitive to direct dependency.**

ElevenLabs imposes a hard concurrent-request cap by plan tier: Free = 2, Starter = 3, Creator = 5, Pro = 10. Scheduled voice messages that fire simultaneously (e.g., multiple recipients at 9 AM Monday) must not fan-out — they must queue.

`p-queue` is already present as a transitive dependency (version 9.1.0 confirmed in node_modules). Adding it to `package.json` as a direct dep locks the version and makes the dependency explicit.

**Runtime-verified API:**
```typescript
import PQueue from 'p-queue';

// Singleton shared across all TTS calls in the scheduled message pipeline
const ttsQueue = new PQueue({ concurrency: 1 });

// Usage inside scheduled message executor
const audioBuffer = await ttsQueue.add(() => textToSpeech(text, logger));
```

Setting `concurrency: 1` is conservative and correct — it serializes TTS generation without dropping any requests. At the scale of a personal bot, the latency penalty is immaterial.

**Note:** This queue is separate from the existing real-time reply path. Scheduled messages get their own `ttsQueue` so they don't interfere with live conversational TTS.

**Confidence:** HIGH — p-queue 9.1.0 present in node_modules, API verified.

---

### 3. Human-Readable Schedule Display

**Decision: Add `cronstrue` ^2.26.0 to both backend and dashboard.**

The dashboard schedule list needs to show "Every Monday at 9:00 AM" not `0 9 * * 1`. `cronstrue` is the standard library for this:

- Zero dependencies
- Native ESM + TypeScript
- Supports Hebrew locale (`he`) — matches this project's bilingual context
- `cronstrue.toString(expr)` — one-liner

**Install:**
```bash
# Backend (augment API list response with humanReadable field)
cd /home/yuval/whatsapp-bot
npm install cronstrue

# Dashboard (live preview as user types cron expression)
cd /home/yuval/whatsapp-bot/dashboard
npm install cronstrue
```

**API:**
```typescript
import cronstrue from 'cronstrue';

cronstrue.toString('0 9 * * 1')
// "At 09:00 AM, only on Monday"

cronstrue.toString('*/30 * * * *')
// "Every 30 minutes"

cronstrue.toString('0 9 * * 1', { locale: 'he' })
// Hebrew output
```

**Dashboard usage pattern:** Add a live preview below the cron expression `<Input>`. As the user types, call `cronstrue.toString()` and display the result. Catch the exception it throws on invalid expressions to show an inline validation error.

**Confidence:** HIGH — library fetched from GitHub, API confirmed, Hebrew locale verified documented.

---

### 4. AI Content at Send Time

**Decision: Use existing `generateText` via `ai/provider.ts`. No new library.**

For `messageType = 'ai_generated'`, the `content` column stores a Gemini prompt (e.g., "Write a Monday morning motivational message for my friend"). At send time, the scheduled message executor calls `generateText({ systemPrompt, userContent })` and sends the result.

This reuses the exact same pattern as the keyword rule AI responses (`src/groups/keywordRules.ts`). No new abstraction needed.

**Confidence:** HIGH — codebase inspection confirms `generateText` is the established pattern.

---

### 5. DB Schema (no new library — Drizzle already handles this)

New `scheduled_messages` table. Follows the `reminders` table pattern exactly.

```typescript
export const scheduledMessages = sqliteTable(
  'scheduled_messages',
  {
    id: text('id').primaryKey(),
    recipientJid: text('recipient_jid').notNull(), // contact JID (@s.whatsapp.net) or group JID (@g.us)
    messageType: text('message_type').notNull(),   // 'text' | 'voice' | 'ai_generated'
    content: text('content'),                      // text body, or AI prompt for ai_generated
    cronExpression: text('cron_expression'),       // null = one-off
    sendAt: integer('send_at'),                    // null = recurring; Unix ms for one-off
    nextRunAt: integer('next_run_at').notNull(),   // computed; used by two-tier scheduler scan
    status: text('status').notNull().default('active'),
    // 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
    voiceId: text('voice_id'),                     // null = use contact default voice
    lastSentAt: integer('last_sent_at'),           // null = never sent
    sendCount: integer('send_count').notNull().default(0),
    failureReason: text('failure_reason'),         // last error message, for dashboard display
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_scheduled_messages_status_next').on(table.status, table.nextRunAt),
  ],
);
```

The index on `(status, nextRunAt)` mirrors `idx_reminders_status_fire` on the reminders table — same query pattern for the scheduler scan.

**Confidence:** HIGH — directly follows existing schema patterns.

---

## Recommended Stack

### New Dependencies

| Technology | Version | Purpose | Why |
|---|---|---|---|
| `cronstrue` | ^2.26.0 | Translate cron expressions to human-readable text | Zero-dep, ESM+TS native, Hebrew locale, standard library for this purpose |
| `p-queue` | ^9.1.0 | Serialize TTS requests to respect ElevenLabs concurrency cap | Already in node_modules as transitive dep; promote to direct for version pinning |

### Existing Stack Extended (Not Replaced)

| Technology | Current Version | Extension |
|---|---|---|
| `node-cron` | 4.2.1 | Add scheduled message jobs using same pattern as weekly digests; use `validate()` + `getNextRun()` |
| `drizzle-orm` | 0.45.1 | Add `scheduled_messages` table + query layer |
| `@google/genai` | 1.42.0 | Generate AI message content at send time (same `generateText` call as keyword rules) |
| `@elevenlabs/elevenlabs-js` | 2.37.0 | TTS for voice scheduled messages (same `textToSpeech()` pipeline) |
| Fastify 5 | 5.7.4 | New `/api/scheduled-messages` CRUD routes |
| React 19 + shadcn/ui | 19.x | New ScheduledMessages page in dashboard |
| TanStack Query | 5.x | Data fetching + mutations on scheduled messages page |

---

## Installation

```bash
# In project root
cd /home/yuval/whatsapp-bot
npm install cronstrue p-queue

# In dashboard
cd /home/yuval/whatsapp-bot/dashboard
npm install cronstrue
```

---

## What NOT to Add

| Avoid | Why | Use Instead |
|---|---|---|
| `cron-parser` | Adds a dep for `next()` date iteration — `node-cron` v4's `getNextRun()` already provides this | `node-cron` task `.getNextRun()` (already installed, runtime-verified) |
| `croner` as direct dep | Already in node_modules as transitive dep (via some sub-package), but redundant with `node-cron` v4 which is the project's declared dep | `node-cron` |
| `react-js-cron` | Requires Ant Design as a peer dep — incompatible with this project's shadcn/Tailwind stack | Plain `<Input>` + live `cronstrue.toString()` preview |
| `react-cron-generator` | No active maintenance; outputs Quartz format not Unix cron | Plain `<Input>` + cronstrue |
| `bull` / `bullmq` | Requires Redis; massive overkill for a personal bot | Two-tier scheduler pattern already proven by reminders system |
| `agenda` | MongoDB-backed; wrong persistence layer | Drizzle/SQLite `scheduled_messages` table |
| `luxon` | Full date manipulation library — only needed for DST-safe next-run date math | `node-cron` handles timezone internally; `Date.toISOString()` for storage |
| Separate job queue per message | Creates N `ScheduledTask` instances in memory | Hourly DB scan + setTimeout window (same as reminders) |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Cron next-date | `node-cron` `.getNextRun()` | `cron-parser` `CronExpressionParser.parse(expr).next()` | cron-parser is a new dependency; node-cron already provides this in v4 |
| Human-readable cron | `cronstrue` | Implement manually | cronstrue covers 30+ languages including Hebrew; not worth reimplementing |
| TTS queuing | `p-queue` concurrency:1 | Manual promise chaining | p-queue is already in node_modules; cleaner API for this pattern |
| Schedule UI input | Plain `<Input>` + cronstrue preview | `react-js-cron` picker component | react-js-cron requires antd; plain input is simpler and shadcn-consistent |
| Recurring schedule storage | `cronExpression` column in DB | Store schedule as `{ type, days, hour }` JSON | Cron strings are portable and directly usable by node-cron; no translation layer |

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `node-cron` | 4.2.1 | Node >=18, ESM | `getNextRun()` returns `Date`. `timezone` accepts IANA strings. Tested with `Asia/Jerusalem`. |
| `p-queue` | 9.1.0 | Node >=18, ESM only | Native ESM — compatible with project's `"type": "module"` |
| `cronstrue` | ^2.26.0 | Node >=18, ESM + CJS | `import cronstrue from 'cronstrue'` works in both backend and Vite dashboard |

---

## Sources

- Runtime verification in `/home/yuval/whatsapp-bot/node_modules/` — HIGH confidence (tested `node-cron.validate()`, `getNextRun()` with `Asia/Jerusalem`, `PQueue` API, `croner.next()` and `enumerate()` for reference)
- ElevenLabs concurrent request limits: https://help.elevenlabs.io/hc/en-us/articles/14312733311761-How-many-requests-can-I-make-and-can-I-increase-it — HIGH confidence
- `cronstrue` README (GitHub): https://github.com/bradymholt/cRonstrue — HIGH confidence; Hebrew locale confirmed
- `node-cron` v4 npm: https://www.npmjs.com/package/node-cron — MEDIUM confidence (npm page returned 403; version confirmed from node_modules)
- `p-queue` GitHub: https://github.com/sindresorhus/p-queue — HIGH confidence; API verified in runtime
- Codebase inspection: `src/reminders/reminderScheduler.ts`, `src/db/schema.ts`, `src/voice/tts.ts`, `src/api/server.ts`, `dashboard/package.json` — HIGH confidence

---
*Stack research for: WhatsApp bot — scheduled message delivery milestone*
*Researched: 2026-03-30*

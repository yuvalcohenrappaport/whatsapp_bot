# Phase 19: Itinerary Builder - Research

**Researched:** 2026-03-02
**Domain:** WhatsApp group calendar suggest-then-confirm flow; SQLite persistence for ephemeral state with TTL
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Suggestion message format**
- Always in Hebrew (all target groups are Hebrew-speaking)
- One suggestion per detected event (multiple events in one message produce multiple suggestion messages)
- Minimal detail: title + date + time (if available) + location (if detected, appended)
- Example: "📅 הוסיף 'ארוחת ערב באיסרוטל' ב-15 באפריל, אילת? השב ✅ או ❌"
- No rich previews or verbose formatting — keep group chat clean

**Confirmation and rejection UX**
- Anyone in the group can confirm (✅) or reject (❌) — trip planning is collaborative
- Detection method: quoted-reply to the bot's suggestion message with ✅ or ❌ (consistent with existing reply-to-delete pattern)
- Silent rejection: bot removes suggestion from tracking, no acknowledgment message sent
- Confirmation triggers calendar event creation and sends the standard confirmation message (same format as current auto-add confirmations)

**Expiry and persistence**
- 30-minute TTL per suggestion — silent expiry (no notification to group)
- DB persistence: pending suggestions saved to a table, restored on bot restart with remaining TTL
- No concurrency limit on pending suggestions per group

**Replacing existing calendar flow**
- Phase 19 fully replaces dateExtractor's silent-add with suggest-then-confirm for all cases
- Reply-to-delete still works on confirmed events (confirmation message uses the same format, so existing handleReplyToDelete works automatically)
- The existing dateExtractor Zod schema is extended with optional location/description/url fields — not replaced

**Prior cross-phase decisions (from STATE.md)**
- All new pipeline steps added inside existing `groupMessageCallback` in `groupMessagePipeline.ts` — never call `setGroupMessageCallback()` from a new module (silently overwrites)
- No new npm packages for Phases 17-19; zero new packages confirmed for Phases 17-20
- FTS5 migration is hand-written (0010) — never run db:generate after 0010
- Zod v4: use `z.toJSONSchema()` natively — never use zod-to-json-schema
- WhatsApp interactive buttons are Business API-only — use quoted-reply confirmations instead
- Pipeline guard reorder: handleReplyToDelete runs before fromMe guard (17-02)
- Minimal NaN date patch in dateExtractor.ts since Phase 19 rewrites the extraction flow (17-02)

### Claude's Discretion
- Exact DB table schema for pending suggestions (columns, indexes)
- How to handle edge cases: duplicate suggestions for the same event, rapid-fire messages
- TTL timer implementation details (setInterval vs per-suggestion setTimeout)
- Error handling for Google Calendar API failures during confirmation

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ITIN-01 | Date extraction suggests adding to calendar before auto-adding (suggest-then-confirm via reply) | suggestionTracker module replaces the direct createCalendarEvent call in processGroupMessages; pending suggestions DB table provides restart persistence |
| ITIN-02 | Calendar events include location, description, and relevant links (not just title + date) | Zod schema extension adds optional location/description/url fields; createCalendarEvent already accepts a description param; Google Calendar events.insert accepts location field separately |
| ITIN-03 | User can confirm (✅) or reject (❌) a suggestion by replying to the bot's message | handleConfirmReject mirrors the existing handleReplyToDelete pattern: check quotedMessageId against pendingSuggestions Map, dispatch on ✅/❌ |
</phase_requirements>

---

## Summary

Phase 19 transforms the calendar pipeline from silent auto-add into a suggest-then-confirm flow. The core mechanic is already proven: the codebase uses quoted-reply detection twice (reply-to-delete in `groupMessagePipeline.ts` and travel reply chain in `travelHandler.ts`), so the confirmation routing pattern is well-established. The new work is: (1) extend the dateExtractor Zod schema with optional enrichment fields, (2) replace the direct `createCalendarEvent` call with a "send suggestion + store pending" path, (3) add a `pendingSuggestions` Map with TTL timers plus a DB table for restart persistence, and (4) route quoted-reply ✅/❌ to either confirm (create event + send standard confirmation) or reject (silent discard).

The DB table for pending suggestions mirrors the existing `calendarEvents` table pattern. TTL should use per-suggestion `setTimeout` (same mechanism as debounce buffers throughout the codebase) rather than a polling `setInterval`. The confirmation message format must reuse `buildConfirmationText` so that the existing `handleReplyToDelete` handler continues to work on confirmed events without any changes.

**Primary recommendation:** Build `suggestionTracker.ts` as the central module that owns the pending suggestions Map, DB persistence, and TTL expiry. Wire it into `groupMessagePipeline.ts` at the same location where `createCalendarEvent` is currently called, and add a new `handleConfirmReject` step in the pipeline callback before `handleReplyToDelete`.

---

## Standard Stack

### Core (all already in package.json — zero new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` + `drizzle-orm` | ^12.6.2 / ^0.45.1 | Pending suggestions DB table | Already used for all persistence; synchronous API fits TTL restore-on-startup |
| `zod` v4 | ^4.3.6 | Extended DateExtractionSchema | Already used in dateExtractor.ts; use `z.toJSONSchema()` not `zodToJsonSchema` |
| `googleapis` | ^171.4.0 | Google Calendar events.insert with location | Already initialized in calendarService.ts; `location` field is a top-level event property |
| `crypto.randomUUID()` | Node built-in | Suggestion IDs | Already used in groupMessagePipeline.ts for event record IDs |
| `pino` | ^10.3.1 | Logging | Already the logger for every module |

### No New Packages
The constraint "zero new packages for Phases 17-20" is met. Everything needed is already installed.

---

## Architecture Patterns

### Recommended New File Structure

```
src/
├── groups/
│   ├── dateExtractor.ts         # MODIFY: extend Zod schema, return enriched ExtractedDate
│   ├── groupMessagePipeline.ts  # MODIFY: add handleConfirmReject step; replace direct-add with suggest path
│   └── suggestionTracker.ts     # NEW: pending suggestions Map, TTL timers, DB queries, restore-on-startup
├── db/
│   ├── schema.ts                # MODIFY: add pendingSuggestions table
│   └── queries/
│       └── pendingSuggestions.ts # NEW: insert/get/delete DB queries for pending suggestions
drizzle/
└── 0011_pending_suggestions.sql # NEW: hand-written migration (NOT from db:generate)
```

### Pattern 1: Per-Suggestion setTimeout (TTL Timer)

**What:** Each suggestion gets its own `setTimeout` with remaining TTL. On expiry, the timer callback silently deletes the record from the Map and from the DB.

**When to use:** When TTL varies per item and silent expiry is required. `setInterval` would be wrong here — it polls all items unnecessarily and requires manual tracking of what's expired.

**Example (consistent with debounceBuffers pattern in groupMessagePipeline.ts):**
```typescript
// Source: observed from groupMessagePipeline.ts debounce and tripContextManager.ts debounce
const timer = setTimeout(() => {
  pendingSuggestions.delete(suggestionId);
  deletePendingSuggestion(suggestionId); // DB delete
  logger.debug({ suggestionId }, 'Suggestion TTL expired — silently discarded');
}, remainingMs);

pendingSuggestions.set(suggestionId, { ...suggestion, timer });
```

**Why not setInterval:** The codebase uses setTimeout everywhere for deferred cleanup. A single setInterval checking all suggestions would add complexity, require explicit tracking of each suggestion's expiry timestamp, and is harder to cancel on confirmation/rejection.

### Pattern 2: Quoted-Reply Detection (mirrors handleReplyToDelete)

**What:** In the pipeline callback, before `handleReplyToDelete`, check if `quotedMessageId` matches a known suggestion message ID and body is ✅ or ❌.

**Existing code to mirror exactly:**
```typescript
// Source: src/groups/groupMessagePipeline.ts handleReplyToDelete
async function handleReplyToDelete(
  groupJid: string,
  msg: GroupMsg,
  quotedMessageId: string | null,
): Promise<boolean> {
  if (!quotedMessageId) return false;
  const calendarEventRecord = getCalendarEventByConfirmationMsgId(quotedMessageId);
  if (!calendarEventRecord) return false;
  if (!isDeleteTrigger(msg.body)) return false;
  // ... action ...
  return true;
}
```

**New handler follows the same structure:**
```typescript
async function handleConfirmReject(
  groupJid: string,
  msg: GroupMsg,
  quotedMessageId: string | null,
): Promise<boolean> {
  if (!quotedMessageId) return false;
  const suggestion = getPendingSuggestionBySuggestionMsgId(quotedMessageId);
  if (!suggestion) return false;
  const trimmed = msg.body.trim();
  if (trimmed !== '✅' && trimmed !== '❌') return false;
  // dispatch
  return true;
}
```

**Pipeline order (CRITICAL — must run before handleReplyToDelete):**
```typescript
// Inside groupMessageCallback:
const wasConfirmReject = await handleConfirmReject(groupJid, msg, quotedMessageId);
if (wasConfirmReject) return;

const wasDelete = await handleReplyToDelete(groupJid, msg, quotedMessageId);
if (wasDelete) return;
```

**Why before handleReplyToDelete:** A confirmed suggestion creates a calendar event and sends a confirmation message. `handleReplyToDelete` listens on *that* confirmation message. The suggestion message is a different message ID, so there is no ID collision. But handleConfirmReject must be terminal so ✅ on a suggestion doesn't accidentally fall through to other handlers.

### Pattern 3: Zod Schema Extension (not replacement)

**What:** Add optional fields to the existing `DateExtractionSchema` in `dateExtractor.ts`.

**Current schema (from source):**
```typescript
const DateExtractionSchema = z.object({
  dates: z.array(
    z.object({
      title: z.string().describe('...'),
      date: z.string().describe('ISO 8601...'),
      confidence: z.enum(['high', 'medium', 'low']).describe('...'),
    }),
  ),
});
```

**Extended schema:**
```typescript
const DateExtractionSchema = z.object({
  dates: z.array(
    z.object({
      title: z.string().describe('Concise smart title for the event...'),
      date: z.string().describe('ISO 8601 date string (YYYY-MM-DDTHH:mm:ss) in Asia/Jerusalem timezone'),
      confidence: z.enum(['high', 'medium', 'low']).describe('How confident you are this is a real date/event mention'),
      location: z.string().optional().describe('Physical location or venue if mentioned in the message (e.g., "Isrotel Hotel, Eilat")'),
      description: z.string().optional().describe('Relevant details about the event from the message'),
      url: z.string().optional().describe('URL mentioned in the message related to this event, if any'),
    }),
  ),
});
```

**Critical Zod v4 note:** Use `z.toJSONSchema(DateExtractionSchema)` — NOT `zodToJsonSchema(DateExtractionSchema)`. The codebase has `zod-to-json-schema` installed but `tripContextManager.ts` already switched to `z.toJSONSchema()`. The `dateExtractor.ts` file still uses the old import — this must be fixed in Plan 19-02.

**ExtractedDate interface extension:**
```typescript
export interface ExtractedDate {
  title: string;
  date: Date;
  confidence: string;
  location?: string;
  description?: string;
  url?: string;
}
```

### Pattern 4: DB Table for Pending Suggestions

**What:** A `pending_suggestions` SQLite table stores suggestions across restarts. The `suggestionTracker` module reads all unexpired rows at startup and rehydrates the in-memory Map with adjusted TTLs.

**Recommended schema:**
```sql
CREATE TABLE `pending_suggestions` (
  `id` text PRIMARY KEY NOT NULL,          -- UUID, the suggestion ID
  `group_jid` text NOT NULL,              -- @g.us JID of the group
  `suggestion_msg_id` text NOT NULL,      -- WhatsApp message ID of the bot's suggestion message (lookup key)
  `title` text NOT NULL,                  -- Event title
  `event_date` integer NOT NULL,          -- Unix ms of the event
  `location` text,                        -- Optional location
  `description` text,                     -- Optional description
  `url` text,                             -- Optional URL
  `calendar_id` text NOT NULL,            -- Target Google Calendar ID
  `calendar_link` text NOT NULL,          -- Calendar embed URL (for confirmation message)
  `source_message_id` text NOT NULL,      -- Triggering group message ID (for description)
  `sender_name` text,                     -- Sender of the original message
  `expires_at` integer NOT NULL,          -- Unix ms when suggestion expires (createdAt + 30min)
  `created_at` integer NOT NULL
);
-- Index on suggestion_msg_id (lookup path from quoted reply)
CREATE INDEX `idx_pending_suggestions_msg_id` ON `pending_suggestions` (`suggestion_msg_id`);
-- Index on group_jid (for group-scoped queries)
CREATE INDEX `idx_pending_suggestions_group` ON `pending_suggestions` (`group_jid`);
-- Index on expires_at (for startup cleanup of already-expired rows)
CREATE INDEX `idx_pending_suggestions_expiry` ON `pending_suggestions` (`expires_at`);
```

**Migration filename:** `0011_pending_suggestions.sql` — hand-written, NOT from `db:generate`.

**Drizzle schema addition (in schema.ts):**
```typescript
export const pendingSuggestions = sqliteTable(
  'pending_suggestions',
  {
    id: text('id').primaryKey(),
    groupJid: text('group_jid').notNull(),
    suggestionMsgId: text('suggestion_msg_id').notNull(),
    title: text('title').notNull(),
    eventDate: integer('event_date').notNull(),
    location: text('location'),
    description: text('description'),
    url: text('url'),
    calendarId: text('calendar_id').notNull(),
    calendarLink: text('calendar_link').notNull(),
    sourceMessageId: text('source_message_id').notNull(),
    senderName: text('sender_name'),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_pending_suggestions_msg_id').on(table.suggestionMsgId),
    index('idx_pending_suggestions_group').on(table.groupJid),
    index('idx_pending_suggestions_expiry').on(table.expiresAt),
  ],
);
```

### Pattern 5: Startup Restore with TTL Adjustment

**What:** On `initGroupPipeline()`, load all unexpired pending suggestions from DB and rehydrate the in-memory Map with `remainingMs = expiresAt - Date.now()`.

```typescript
// Source: pattern consistent with tripContextManager.ts startup behavior
export function restorePendingSuggestions(): void {
  const now = Date.now();
  const rows = getUnexpiredPendingSuggestions(now); // SELECT WHERE expires_at > now

  for (const row of rows) {
    const remainingMs = row.expiresAt - now;
    if (remainingMs <= 0) continue; // shouldn't happen but guard anyway

    const timer = setTimeout(() => {
      pendingSuggestions.delete(row.id);
      deletePendingSuggestion(row.id);
      logger.debug({ id: row.id }, 'Restored suggestion TTL expired');
    }, remainingMs);

    pendingSuggestions.set(row.id, { ...row, timer });
  }

  logger.info({ count: rows.length }, 'Pending suggestions restored from DB');
}
```

**Where called:** In `initGroupPipeline()` in `groupMessagePipeline.ts`, after `setGroupMessageCallback`.

### Anti-Patterns to Avoid

- **Calling `setGroupMessageCallback()` from `suggestionTracker.ts`:** Silently overwrites the existing callback. All pipeline logic stays inside `groupMessagePipeline.ts`. `suggestionTracker.ts` exports functions that `groupMessagePipeline.ts` calls.
- **Running `db:generate` to create migration 0011:** Must be hand-written SQL. After 0010, `db:generate` would emit DROP TABLE for the FTS5 virtual table.
- **Using `zodToJsonSchema` import:** Already broken with Zod v4. Use `z.toJSONSchema()` (Zod v4 native). The `dateExtractor.ts` file still uses the old import — fix it in Plan 19-02.
- **Storing the timer object in DB:** Timers are in-memory only. DB stores `expires_at`; restart computes `remainingMs`.
- **Using setInterval to poll TTL:** Adds hidden state management complexity. Per-suggestion `setTimeout` is simpler and consistent with existing debounce patterns.
- **Sending a rejection acknowledgment:** Per locked decision, rejection is silent — delete from Map/DB, no message.
- **Sending suggestion as a quoted reply to the original message:** The bot sends the suggestion as a plain message, not a quoted reply. This ensures the group sees it as a standalone suggestion, not an inline reply (which can be hard to read in Hebrew group chats).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quoted reply detection | Custom message parsing | `quotedMessageId` param already extracted from `msg.message?.extendedTextMessage?.contextInfo?.stanzaId` in `messageHandler.ts` | Already done upstream; arrives as a parameter in groupMessageCallback |
| Hebrew date formatting | Custom Intl.DateTimeFormat builder | Reuse / extend `formatDateForDisplay` in `groupMessagePipeline.ts` with `'he-IL'` locale | Function exists; only needs locale switch and format tweaks for Hebrew output |
| UUID generation | Custom ID generator | `crypto.randomUUID()` | Already used in groupMessagePipeline.ts for event record IDs |
| Google Calendar event creation with location | Direct API construction | Extend `createCalendarEvent` params in `calendarService.ts` | Function already wraps the API; just add `location?: string` param |
| TTL expiry cleanup | A sweep loop at startup | `getUnexpiredPendingSuggestions` + `deleteExpiredPendingSuggestions` SQL WHERE clause | Simpler: delete expired rows at startup, then only restore the live ones |

**Key insight:** The pipeline infrastructure already does everything except the suggest-then-confirm interception. The task is wiring, not building new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Migration 0011 Must Be Hand-Written

**What goes wrong:** Running `npm run db:generate` after modifying `schema.ts` produces a migration that includes `DROP TABLE group_messages_fts` (Drizzle doesn't understand FTS5 virtual tables). This destroys the FTS5 index.

**Why it happens:** Drizzle's differ compares the snapshot to the current schema; it doesn't know about hand-created virtual tables.

**How to avoid:** Write `0011_pending_suggestions.sql` by hand with the exact CREATE TABLE and CREATE INDEX statements. Do NOT run `db:generate`. Do NOT update the drizzle `meta/_journal.json` manually either — that's auto-updated by the migrate() call at runtime.

**Warning signs:** Any migration file containing `DROP TABLE group_messages_fts`.

### Pitfall 2: suggesionMsgId vs calendarEventConfirmationMsgId — Two Different Message IDs

**What goes wrong:** `handleConfirmReject` accidentally checks `getCalendarEventByConfirmationMsgId` (which looks up confirmed event confirmations) instead of pending suggestions, or vice versa.

**Why it happens:** Both lookup by WhatsApp message ID; the distinction is which table/Map is queried.

**How to avoid:** Clear naming. The suggestion message (what triggers ✅/❌) is stored in `pending_suggestions.suggestion_msg_id`. The confirmation message (what triggers reply-to-delete) is stored in `calendar_events.confirmation_msg_id`. They are different message IDs at different lifecycle stages.

**Warning signs:** `handleConfirmReject` calling `getCalendarEventByConfirmationMsgId`.

### Pitfall 3: fromMe Guard Runs AFTER handleConfirmReject

**What goes wrong:** If `handleConfirmReject` is placed after the `if (msg.fromMe) return;` guard in the pipeline, the owner cannot confirm/reject suggestions with their own ✅/❌ reply.

**Why it happens:** The fromMe guard was introduced to skip keyword rules and date extraction for bot-generated messages. But the confirm/reject handler must allow owner participation.

**How to avoid:** `handleConfirmReject` (and `handleReplyToDelete`) run before the `fromMe` guard. This is already the pattern for `handleReplyToDelete` (decision from 17-02). Follow the same order for `handleConfirmReject`.

**Correct pipeline order:**
```
1. handleTravelMention     ← terminal, runs on fromMe too
2. handleConfirmReject     ← terminal, NEW, runs on fromMe too
3. handleReplyToDelete     ← terminal, runs on fromMe too
4. if (msg.fromMe) return  ← blocks items 5+ for bot own messages
5. handleKeywordRules      ← non-terminal
6. addToTripContextDebounce ← non-terminal
7. addToDebounce           ← calendar extraction debounce
```

### Pitfall 4: Suggestion Deduplication for Same Event

**What goes wrong:** If the same event is mentioned twice in rapid succession (or in two messages before the debounce fires), two suggestion messages are sent for the same event.

**Why it happens:** The debounce batches messages but processes each `extractedDates` array independently.

**How to avoid:** Before sending a suggestion, check if an existing pending suggestion for the same `groupJid` + `title` + `eventDate` (within a ±1-hour window) already exists. If so, skip the duplicate.

**Implementation:**
```typescript
// Inside the suggest loop, before sending:
const isDuplicate = [...pendingSuggestions.values()].some(
  (s) =>
    s.groupJid === groupJid &&
    s.title === extracted.title &&
    Math.abs(s.eventDate - extracted.date.getTime()) < 3_600_000, // 1 hour tolerance
);
if (isDuplicate) {
  logger.debug({ title: extracted.title }, 'Duplicate suggestion skipped');
  continue;
}
```

### Pitfall 5: Calendar Must Exist Before Suggestion Is Created

**What goes wrong:** The suggestion is sent to the group, but when ✅ is received, the calendar creation fails (or the calendarId is unknown), so the event cannot be created.

**Why it happens:** In the current flow, calendar creation happens at the same time as event creation. In the new flow, calendar creation must happen before sending the suggestion (so the calendarId can be stored in the pending suggestion record).

**How to avoid:** Preserve the "ensure group has calendar" logic (currently at the top of the per-event loop in `processGroupMessages`) and execute it before creating the pending suggestion. Store `calendarId` and `calendarLink` in the pending suggestion DB record.

### Pitfall 6: Google Calendar API Failure at Confirmation Time

**What goes wrong:** User replies ✅, bot confirms, but `createCalendarEvent` returns null (API failure). The suggestion is consumed (removed from Map/DB) but no event is created.

**Why it happens:** The API call is async and can fail due to rate limits, auth expiry, or network issues.

**How to avoid:** If `createCalendarEvent` returns null, do NOT delete the pending suggestion from the Map/DB. Log the error but leave the suggestion live so the user can retry with ✅ again. Or send a brief Hebrew error message: "לא הצלחתי להוסיף ללוח השנה, נסה שוב".

---

## Code Examples

### Suggestion Message Format (Hebrew)

```typescript
// Source: locked decision in CONTEXT.md
// Format: title + date in Hebrew + optional location
function buildSuggestionText(
  title: string,
  date: Date,
  location?: string,
): string {
  // Hebrew date: "15 באפריל" (no year if same year)
  const dateStr = date.toLocaleString('he-IL', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
  const locationPart = location ? `, ${location}` : '';
  return `📅 להוסיף '${title}' ב-${dateStr}${locationPart}? השב ✅ או ❌`;
}
```

### Confirmation Flow (on ✅)

```typescript
// Source: mirrors createCalendarEvent + insertCalendarEvent + sendMessage in groupMessagePipeline.ts
async function confirmSuggestion(
  groupJid: string,
  suggestion: PendingSuggestion,
): Promise<void> {
  // 1. Create the calendar event (with enriched fields)
  const calendarEventId = await createCalendarEvent({
    calendarId: suggestion.calendarId,
    title: suggestion.title,
    date: new Date(suggestion.eventDate),
    description: suggestion.description ?? buildDefaultDescription(suggestion),
    location: suggestion.location,
  });

  if (!calendarEventId) {
    // API failure — leave suggestion alive for retry
    logger.warn({ id: suggestion.id }, 'Calendar event creation failed at confirmation');
    const { sock } = getState();
    await sock?.sendMessage(groupJid, { text: 'לא הצלחתי להוסיף ללוח השנה, נסה שוב' });
    return;
  }

  // 2. Remove from pending (success path)
  clearTimeout(suggestion.timer);
  pendingSuggestions.delete(suggestion.id);
  deletePendingSuggestion(suggestion.id);

  // 3. Insert calendar event record (same as current flow)
  const eventRecordId = crypto.randomUUID();
  insertCalendarEvent({
    id: eventRecordId,
    groupJid,
    messageId: suggestion.sourceMessageId,
    calendarId: suggestion.calendarId,
    calendarEventId,
    title: suggestion.title,
    eventDate: suggestion.eventDate,
  });

  // 4. Send standard confirmation message (reuses buildConfirmationText)
  const { sock } = getState();
  if (sock) {
    const confirmationText = buildConfirmationText('he', suggestion.title, new Date(suggestion.eventDate), suggestion.calendarLink);
    const sent = await sock.sendMessage(groupJid, { text: confirmationText });
    const sentMsgId = sent?.key?.id ?? null;
    if (sentMsgId) {
      updateCalendarEventConfirmation(eventRecordId, sentMsgId);
    }
  }
}
```

### createCalendarEvent Extension (calendarService.ts)

```typescript
// Source: src/calendar/calendarService.ts — add location param
export async function createCalendarEvent(params: {
  calendarId: string;
  title: string;
  date: Date;
  description: string;
  location?: string;    // NEW — optional
  timeZone?: string;
}): Promise<string | null> {
  // ... existing auth check ...
  const res = await client.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.title,
      description: params.description,
      location: params.location,  // NEW — Google Calendar accepts this directly
      start: { dateTime: params.date.toISOString(), timeZone },
      end: { dateTime: endDate.toISOString(), timeZone },
      reminders: { useDefault: true },
    },
  });
  // ...
}
```

### TTL Restore at Startup

```typescript
// Source: pattern consistent with groupMessagePipeline.ts initGroupPipeline
export function restorePendingSuggestions(): void {
  const now = Date.now();
  // Delete already-expired rows to keep the table clean
  deleteExpiredPendingSuggestions(now);

  const rows = getUnexpiredPendingSuggestions(now);
  for (const row of rows) {
    const remainingMs = row.expiresAt - now;
    const timer = setTimeout(() => {
      pendingSuggestions.delete(row.id);
      deletePendingSuggestion(row.id);
    }, remainingMs);
    pendingSuggestions.set(row.id, { ...row, timer });
  }
  logger.info({ count: rows.length }, 'Pending suggestions restored from DB');
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent auto-add (dateExtractor → createCalendarEvent directly) | Suggest-then-confirm via quoted reply | Phase 19 | Users can reject false-positive event detections |
| Events with only title + date | Events with title + date + location + description + url | Phase 19 | ITIN-02 compliance; richer calendar events |
| `zodToJsonSchema(schema)` | `z.toJSONSchema(schema)` | Phase 18 (tripContextManager) | dateExtractor.ts still uses old import — must fix in 19-02 |

**Deprecated/outdated in dateExtractor.ts:**
- `import zodToJsonSchema from 'zod-to-json-schema'` — must be replaced with native Zod v4 call
- `import { z } from 'zod/v3'` — must be replaced with `import { z } from 'zod'` (Zod v4)

---

## Open Questions

1. **Should the suggestion message be sent as a quoted reply to the original group message?**
   - What we know: CONTEXT.md says "minimal detail, keep group chat clean." Quoted replies are visually noisier.
   - What's unclear: Whether members need the original message context to understand what's being suggested.
   - Recommendation: Send as a standalone message (no quote). The title is descriptive enough (e.g., "ארוחת ערב באיסרוטל"). If the group sends rapid messages, the suggestion appears shortly after, making the context implicit.

2. **What if calendarId lookup fails at suggestion time (calendar creation fails)?**
   - What we know: The current code does `continue` (skips the event entirely) if `createGroupCalendar` returns null.
   - What's unclear: Whether to skip the suggestion entirely or queue it for retry.
   - Recommendation: Skip the suggestion entirely (same as current behavior). If Google Calendar is down, no suggestion is sent. This is simpler and avoids half-states.

3. **Deduplication window: ±1 hour for same title+date?**
   - What we know: Gemini returns ISO 8601 times; the same event mentioned twice might have slightly different times if phrased differently.
   - Recommendation: Use ±1 hour tolerance on `eventDate` + exact `title` match as the deduplication key. This is Claude's discretion per CONTEXT.md.

---

## Sources

### Primary (HIGH confidence)

All findings are derived from direct source code inspection. No external libraries required.

- `src/groups/groupMessagePipeline.ts` — pipeline callback structure, handleReplyToDelete pattern, buildConfirmationText, processGroupMessages, debounce pattern
- `src/groups/dateExtractor.ts` — Zod schema, extractDates signature, ExtractedDate interface
- `src/groups/tripContextManager.ts` — module-level Map + setTimeout debounce pattern, `z.toJSONSchema()` usage
- `src/groups/travelHandler.ts` — quotedMessageId detection pattern, Map-based message tracking, cap/eviction pattern
- `src/calendar/calendarService.ts` — createCalendarEvent signature, Google Calendar API usage, location field availability
- `src/db/schema.ts` — existing table patterns for reference schema design
- `src/db/queries/calendarEvents.ts` — DB query patterns to mirror for pendingSuggestions queries
- `src/db/queries/tripMemory.ts` — upsert patterns, query structure
- `drizzle/0009_trip_memory.sql` + `0010_fts5_group_messages.sql` — migration format to follow for 0011
- `drizzle/meta/_journal.json` — confirms 0010 is last auto-tracked migration; 0011 must be manual
- `src/pipeline/messageHandler.ts` — quotedMessageId extraction from Baileys message structure
- `.planning/STATE.md` — cross-phase decisions, confirmed zero-package constraint

### Secondary (MEDIUM confidence)
- Google Calendar REST API documentation (googleapis library): `location` is a standard top-level field in `events.insert` requestBody, confirmed by calendarService.ts usage pattern and googleapis TypeScript types (`calendar_v3.Schema$Event.location?: string`)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, confirmed in package.json
- Architecture: HIGH — patterns directly mirrored from existing production code
- DB schema: HIGH — mirrors existing table patterns; columns chosen to satisfy all confirmation-time needs
- Pipeline order: HIGH — follows established fromMe-guard precedence rule from Phase 17-02
- Pitfalls: HIGH — derived from existing code constraints and locked decisions

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable codebase; no external API changes expected)

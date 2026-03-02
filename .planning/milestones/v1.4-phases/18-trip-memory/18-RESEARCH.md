# Phase 18: Trip Memory - Research

**Researched:** 2026-03-02
**Domain:** Structured decision extraction from chat, FTS5 search, Gemini structured output classification, pipeline integration
**Confidence:** HIGH

## Summary

Phase 18 adds three capabilities to the existing group message pipeline: (1) always-listening context accumulation that classifies messages for travel relevance and persists trip decisions, (2) full-text search over group message history for conversation recall, and (3) a `history_search` queryType that lets users ask "@bot what did we decide about X?" and get answers from stored decisions + chat history rather than live web search.

The codebase is well-structured for this extension. The `groupMessagePipeline.ts` callback has a clear insertion point after the `fromMe` guard and keyword handler (step [3.5]), using the same debounce-then-classify pattern already established for calendar date extraction. SQLite FTS5 is supported by the installed `better-sqlite3` (verified) and can be layered over the existing `groupMessages` table as an external content FTS5 table with trigger-based sync. Drizzle ORM does not natively support FTS5 virtual tables, so FTS5 creation and querying must use raw SQL via `db.run()` / `sql` tagged templates, with the FTS5 virtual table and triggers created in a hand-written Drizzle migration file.

**Primary recommendation:** Use a two-table schema (`tripContexts` for per-group mutable state, `tripDecisions` for append-only typed records), an external-content FTS5 index on `groupMessages.body` with trigger-based sync, and a JavaScript pre-filter that checks for travel-signal keywords before invoking the Gemini classifier.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEM-01 | Bot stores confirmed trip decisions (destination, accommodation, activities, transport) in structured DB records | `tripDecisions` append-only table with `type` enum column; Gemini classifier extracts structured decisions from batched messages; Zod schema validated |
| MEM-02 | User can ask "@bot what did we decide about X?" and bot answers from stored decisions + chat history | `history_search` queryType added to `TravelIntentSchema`; handler queries `tripDecisions` by groupJid + optional type filter, falls back to FTS5 on `groupMessages` for raw history matches; Gemini synthesizes answer |
| MEM-03 | Bot detects unanswered questions/commitments in chat and tracks them as open items | Gemini classifier output includes `openItems` array; stored in `tripDecisions` with `type: 'open_question'` and `resolved: false`; Phase 21 reads unresolved items for digest |
</phase_requirements>

## Standard Stack

### Core (already installed -- no new packages)

| Library | Version | Purpose | How Used |
|---------|---------|---------|----------|
| better-sqlite3 | 12.6.2 | SQLite driver with FTS5 support | FTS5 virtual table creation and MATCH queries via raw SQL |
| drizzle-orm | 0.45.1 | ORM for typed queries | Schema for tripContexts/tripDecisions; `sql` tag for FTS5 queries |
| drizzle-kit | 0.31.9 | Migration generation | `db:generate` creates migration files; hand-edit to add FTS5 |
| zod | 4.3.6 | Schema validation | `z.toJSONSchema()` for classifier and recall Gemini schemas |
| @google/genai | 1.42.0 | Gemini API | `generateJson` for classifier; `generateText` for recall synthesis |
| pino | 10.3.1 | Logging | Same pattern as all existing modules |

### Key: Zod v4 JSON Schema

The codebase has Zod v4 installed. `z.toJSONSchema()` is available natively (verified). Existing files (`travelParser.ts`, `dateExtractor.ts`) still use `zod/v3` + `zod-to-json-schema` -- per STATE.md decision, new Phase 18 code MUST use Zod v4 native:

```typescript
import { z } from 'zod';
const schema = z.object({ ... });
const jsonSchema = z.toJSONSchema(schema);
```

Do NOT import from `'zod/v3'`. Do NOT use `zod-to-json-schema`.

### No New Packages

Per STATE.md: "No new npm packages for Phases 17-19; zero new packages confirmed for Phases 17-20."

## Architecture Patterns

### Existing Pipeline Flow (groupMessagePipeline.ts)

```
setGroupMessageCallback() registers one callback for ALL group messages
  |
  v
[1] handleTravelMention(groupJid, msg, quotedMessageId, mentionedJids)
    - Runs immediately, terminal if @mention detected
    |
[2] handleReplyToDelete(groupJid, msg, quotedMessageId)
    - Runs immediately, terminal if delete trigger
    |
[3] if (msg.fromMe) return;    <-- fromMe guard
    |
[3.5] handleKeywordRules(groupJid, msg)     <-- non-terminal
    |
[4] addToDebounce(groupJid, msg)            <-- calendar date extraction
```

**Phase 18 insertion point: between [3.5] and [4], as a new non-terminal step.** The trip context accumulator runs AFTER keyword rules and BEFORE calendar debounce. It uses its own separate debounce buffer (not the calendar one) because the classifier prompt is different and the debounce window may differ.

### Step [3.5] Trip Context Accumulator Design

```
[3.5a] Pre-filter: hasTravelSignal(msg.body)
       - Pure JavaScript, no Gemini call
       - Returns false for greetings, emojis, short acks
       - Returns true for travel keywords (Hebrew + English)
       |
[3.5b] addToTripContextDebounce(groupJid, msg)
       - Separate debounce buffer from calendar extraction
       - Same pattern: Map<groupJid, { messages, timer }>
       - DEBOUNCE_MS = 10_000 (same 10s window)
       |
[3.5c] processTripContext(groupJid, messages[])  -- on debounce flush
       - Calls Gemini with classifier prompt
       - Extracts: decisions, open questions, context updates
       - Upserts tripContexts (per-group row)
       - Inserts tripDecisions (append-only)
```

### Recommended Project Structure

```
src/
  groups/
    groupMessagePipeline.ts     # Add trip context accumulator call at [3.5]
    travelParser.ts             # Add 'history_search' to queryType enum
    travelHandler.ts            # Add history_search dispatch branch
    tripContextManager.ts       # NEW: debounce + classifier + DB ops
  db/
    schema.ts                   # Add tripContexts + tripDecisions tables
    queries/
      tripMemory.ts             # NEW: CRUD for trip tables + FTS5 search
      groupMessages.ts          # Add searchGroupMessages (FTS5)
```

### Pattern: Debounce Buffer (from existing codebase)

The calendar extraction already uses a debounce pattern. The trip context accumulator needs an identical but independent debounce:

```typescript
// Existing pattern in groupMessagePipeline.ts (lines 39-49)
const debounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();
const DEBOUNCE_MS = 10_000;

// Trip context needs its OWN map (separate from calendar debounce)
const tripDebounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();
```

### Pattern: Gemini Structured Output (from existing codebase)

```typescript
// Existing pattern in travelParser.ts + dateExtractor.ts
import { z } from 'zod';  // Zod v4 for new code
import { generateJson } from '../ai/provider.js';

const ClassifierSchema = z.object({
  decisions: z.array(z.object({
    type: z.enum(['destination', 'accommodation', 'activity', 'transport', 'dates', 'budget']),
    value: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
  })),
  openItems: z.array(z.object({
    question: z.string(),
    context: z.string(),
  })),
  contextSummary: z.string().nullable(),
});

const jsonSchema = z.toJSONSchema(ClassifierSchema);

const result = await generateJson<ClassifierOutput>({
  systemPrompt: classifierPrompt,
  userContent: batchedMessages,
  jsonSchema: jsonSchema as Record<string, unknown>,
  schemaName: 'trip_context_classifier',
});
```

### Pattern: Non-terminal Pipeline Step

The keyword handler is the model for non-terminal steps -- it processes but does not block subsequent steps:

```typescript
// From groupMessagePipeline.ts line 419
await handleKeywordRules(groupJid, msg);  // non-terminal, pipeline continues

// Trip context should follow the same pattern:
await addToTripContextDebounce(groupJid, msg);  // non-terminal
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search | Custom LIKE queries or JS string matching | SQLite FTS5 with MATCH operator | FTS5 handles tokenization, ranking, Hebrew text natively; LIKE is O(n) |
| Message debouncing | Custom setTimeout chains | Copy existing debounce pattern from groupMessagePipeline.ts | Proven pattern, handles edge cases (timer reset, buffer cleanup) |
| JSON schema generation | Manual JSON schema objects | `z.toJSONSchema()` from Zod v4 | Keeps schema and validation in sync; one source of truth |
| Decision deduplication | Custom diff logic | Gemini classifier with `existingDecisions` in prompt context | AI handles semantic dedup ("hilton hotel" == "the Hilton in Barcelona") |
| Hebrew tokenization | Custom word splitter | FTS5 default tokenizer | SQLite's unicode61 tokenizer handles Hebrew word boundaries |

## DB Schema Design

### tripContexts Table (one row per group, upsert)

Stores the rolling context summary for each group. Updated on every classifier run.

```typescript
// In schema.ts
export const tripContexts = sqliteTable('trip_contexts', {
  groupJid: text('group_jid').primaryKey(),     // One row per group
  destination: text('destination'),              // Current confirmed destination
  dates: text('dates'),                          // Trip date range as text
  contextSummary: text('context_summary'),       // AI-generated rolling summary
  lastClassifiedAt: integer('last_classified_at'), // Unix ms
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});
```

### tripDecisions Table (append-only)

Stores individual decisions and open items. Each row is one decision or question.

```typescript
export const tripDecisions = sqliteTable(
  'trip_decisions',
  {
    id: text('id').primaryKey(),                 // UUID
    groupJid: text('group_jid').notNull(),
    type: text('type').notNull(),                // 'destination' | 'accommodation' | 'activity' | 'transport' | 'dates' | 'budget' | 'open_question'
    value: text('value').notNull(),              // The decision text or question text
    confidence: text('confidence').notNull().default('high'), // 'high' | 'medium' | 'low'
    sourceMessageId: text('source_message_id'),  // Links to triggering groupMessage.id
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false), // For open_question type
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_trip_decisions_group').on(table.groupJid),
    index('idx_trip_decisions_type').on(table.groupJid, table.type),
  ],
);
```

### FTS5 Virtual Table (hand-written migration)

Drizzle ORM does NOT support FTS5 virtual tables natively (open issue #2046, unresolved). The FTS5 table and triggers must be added via a hand-written migration SQL file, placed in the `drizzle/` folder with proper `statement-breakpoint` markers.

```sql
-- In drizzle/0009_xxxx.sql (hand-written, not generated)
CREATE VIRTUAL TABLE IF NOT EXISTS group_messages_fts USING fts5(
  body,
  content='group_messages',
  content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_ai AFTER INSERT ON group_messages BEGIN
  INSERT INTO group_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_ad AFTER DELETE ON group_messages BEGIN
  INSERT INTO group_messages_fts(group_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_au AFTER UPDATE ON group_messages BEGIN
  INSERT INTO group_messages_fts(group_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO group_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
```

**Critical: Migration workflow for mixed Drizzle + hand-written SQL:**

1. Add `tripContexts` and `tripDecisions` to `schema.ts`
2. Run `npm run db:generate` to create the Drizzle migration
3. Hand-edit the generated migration file to append the FTS5 statements
4. Also add `INSERT INTO group_messages_fts(group_messages_fts) VALUES('rebuild')` as a one-time statement to index existing messages
5. Update `drizzle/meta/_journal.json` if adding a separate migration file

**Alternative (simpler):** Run `db:generate` for the Drizzle tables, then create a separate hand-written migration file for FTS5 only. The journal must be updated manually either way.

### FTS5 Query Pattern

```typescript
import { sql } from 'drizzle-orm';
import { db } from '../client.js';

export function searchGroupMessages(
  groupJid: string,
  query: string,
  limit = 10,
) {
  // FTS5 MATCH with group_jid filter via JOIN
  return db.all(sql`
    SELECT gm.id, gm.sender_name, gm.body, gm.timestamp
    FROM group_messages_fts fts
    JOIN group_messages gm ON gm.rowid = fts.rowid
    WHERE group_messages_fts MATCH ${query}
      AND gm.group_jid = ${groupJid}
    ORDER BY fts.rank
    LIMIT ${limit}
  `);
}
```

**Verified:** FTS5 with external content table and trigger-based sync works correctly with Hebrew text via `better-sqlite3` (tested during research).

## TravelParser Changes: history_search queryType

### Current queryType enum (travelParser.ts line 27-34):
```typescript
queryType: z.enum([
  'flights', 'hotels', 'restaurants', 'activities', 'car_rental', 'general',
]).nullable()
```

### After Phase 18:
```typescript
queryType: z.enum([
  'flights', 'hotels', 'restaurants', 'activities', 'car_rental', 'general',
  'history_search',  // NEW: recall from stored decisions / chat history
]).nullable()
```

### TravelHandler Dispatch (history_search branch)

Added before the search branch in `handleTravelMention()`:

```typescript
// Recall query: answer from stored decisions + chat history
if (intent.queryType === 'history_search') {
  const answer = await handleHistorySearch(groupJid, intent, lang);
  await sock.sendMessage(groupJid, { text: answer });
  return true;
}
```

The `handleHistorySearch` function:
1. Queries `tripDecisions` for the group, filtered by type if the query mentions a specific category
2. Queries `group_messages_fts` MATCH for relevant messages
3. Passes both results + the user question to Gemini `generateText` for synthesis
4. Returns a natural language answer

## Pre-filter Design: hasTravelSignal()

The pre-filter prevents the Gemini classifier from being called on every group message. It runs in pure JavaScript with zero API cost.

### Reference Pattern: hasNumberPreFilter (dateExtractor.ts line 51-53)

```typescript
export function hasNumberPreFilter(text: string): boolean {
  return /\d/.test(text);
}
```

### Travel Signal Pre-filter

```typescript
// Minimum message length to classify (skip "ok", "lol", emojis)
const MIN_CLASSIFY_LENGTH = 15;

// Travel signal keywords (Hebrew + English)
const TRAVEL_SIGNALS = /\b(hotel|hostel|airbnb|flight|fly|airport|book|reserve|booked|decided|destination|budget|itinerary|trip|travel|vacation|rent|car rental)\b|מלון|טיסה|הזמנ|טיול|תקציב|יעד|נופש|השכר|רכב|החלטנו|הזמנו|סגרנו|נסגר/i;

// Definite skip patterns
const SKIP_PATTERNS = /^[\p{Emoji}\s]{1,10}$|^(ok|lol|haha|yes|no|אוקי|כן|לא|נכון|סבבה|👍|❤️|😂|🤣|😍)\s*$/iu;

export function hasTravelSignal(text: string): boolean {
  if (text.length < MIN_CLASSIFY_LENGTH) return false;
  if (SKIP_PATTERNS.test(text)) return false;
  return TRAVEL_SIGNALS.test(text);
}
```

**Design rationale:**
- False negatives are OK (miss a travel message -> it gets picked up on the next batch or not at all)
- False positives are expensive (unnecessary Gemini calls -> $$$)
- The keyword list focuses on decision-bearing words, not generic travel discussion
- Hebrew keywords include common conjugations: "הזמנ" matches "הזמנו"/"הזמנתי"/"הזמנה"
- Short messages (<15 chars) are almost never travel decisions
- Emoji-only messages are definitionally not decisions

## Gemini Classifier Prompt Design

### Key Concern: Mixed Hebrew/English Group Chat

Per STATE.md: "Phase 18 classifier prompt needs tuning for mixed Hebrew/English group chat."

The classifier prompt must:
1. Handle bilingual messages (same message may mix Hebrew and English)
2. Distinguish decisions from discussions ("let's stay at the Hilton" vs "have you tried the Hilton?")
3. Detect open questions ("does anyone know if..." / "מישהו יודע אם...")
4. Avoid false positives on casual mentions ("I saw a hotel on TV")

### Classifier Input Context

The classifier receives a batch of messages (from debounce flush) along with existing trip context:

```typescript
const systemPrompt = `You are analyzing WhatsApp group messages for a trip planning bot. The messages may be in Hebrew, English, or a mix. Extract:
1. Trip decisions: confirmed choices about destination, accommodation, activities, transport, dates, or budget. Only mark as a decision if the group appears to have agreed/confirmed (not just suggesting).
2. Open questions: unanswered questions or unresolved commitments about the trip.
3. Context summary: brief updated summary of the trip state.

Existing trip context: ${existingContext || 'None yet'}
Existing decisions: ${existingDecisions || 'None yet'}`;
```

### Deduplication Strategy

The prompt includes existing decisions so Gemini can avoid re-extracting the same decision. For example, if "destination: Barcelona" is already stored, and someone says "so we're going to Barcelona right?", Gemini should not create a new decision (it's reaffirming, not deciding).

## Common Pitfalls

### Pitfall 1: FTS5 Migration Not Tracked by Drizzle

**What goes wrong:** Running `db:generate` after adding FTS5 manually causes Drizzle to emit a "drop table" for the unrecognized virtual table.
**Why it happens:** Drizzle doesn't know about FTS5 virtual tables in its schema introspection.
**How to avoid:** Never run `db:generate` after adding FTS5. Keep Drizzle schema changes and FTS5 changes in separate, ordered migrations. Add a comment in schema.ts noting the FTS5 table exists outside Drizzle's purview.
**Warning signs:** Drizzle migration contains `DROP TABLE group_messages_fts`.

### Pitfall 2: FTS5 External Content Table Requires Triggers

**What goes wrong:** Messages inserted after FTS5 creation don't appear in search results.
**Why it happens:** External content FTS5 tables don't auto-sync; they need INSERT/UPDATE/DELETE triggers.
**How to avoid:** Always create all three triggers (INSERT, DELETE, UPDATE) in the same migration as the FTS5 table. Run `rebuild` command once for existing data.
**Warning signs:** FTS5 MATCH returns 0 results for messages you know exist.

### Pitfall 3: Classifier Cost Explosion

**What goes wrong:** Every group message triggers a Gemini API call, costing $15-40/month.
**Why it happens:** Pre-filter is too permissive or missing entirely.
**How to avoid:** Pre-filter MUST run before debounce add (not inside the debounce flush handler). A message that fails the pre-filter never enters the debounce buffer at all.
**Warning signs:** Gemini API usage spikes after deploying the context accumulator. Log a counter for pre-filter pass/fail ratio.

### Pitfall 4: Debounce Buffer Race with Calendar Extraction

**What goes wrong:** The trip context debounce and calendar extraction debounce interfere with each other.
**Why it happens:** Sharing the same buffer or timer.
**How to avoid:** Completely separate Maps and timers. The trip context debounce is in `tripContextManager.ts`, the calendar debounce stays in `groupMessagePipeline.ts`.
**Warning signs:** Calendar events stop being detected after trip context is added.

### Pitfall 5: setGroupMessageCallback Overwrite

**What goes wrong:** A new module calls `setGroupMessageCallback()`, silently overwriting the existing pipeline.
**Why it happens:** The callback is a single function, not an event emitter.
**How to avoid:** Per STATE.md decision: ALL new pipeline steps MUST be added inside the existing callback in `groupMessagePipeline.ts`. Never call `setGroupMessageCallback()` from a new module.
**Warning signs:** Travel search or calendar extraction stops working after adding trip memory.

### Pitfall 6: Zod v3/v4 Import Confusion

**What goes wrong:** New code imports `z` from `'zod/v3'` instead of `'zod'`, or uses `zod-to-json-schema` package.
**Why it happens:** Copy-pasting from existing travelParser.ts or dateExtractor.ts which still use v3.
**How to avoid:** New Phase 18 files MUST use `import { z } from 'zod'` and `z.toJSONSchema()`. Do NOT copy the import pattern from existing files.
**Warning signs:** TypeScript errors about schema incompatibility, or `zod-to-json-schema` producing incorrect schemas.

### Pitfall 7: FTS5 Query Injection

**What goes wrong:** User search queries containing FTS5 special syntax (AND, OR, NOT, quotes, asterisks) cause unexpected results or errors.
**Why it happens:** FTS5 MATCH uses its own query syntax, and user input is passed directly.
**How to avoid:** Wrap user search terms in double quotes to treat them as phrase queries, or strip FTS5 operators. For single-word queries, this is not an issue.
**Warning signs:** `SqliteError: fts5: syntax error` on certain user inputs.

## Code Examples

### Example 1: FTS5 Search Query via Drizzle sql Tag

```typescript
// Verified pattern: FTS5 MATCH with JOIN to get full row data
import { sql } from 'drizzle-orm';
import { db } from '../client.js';

export function searchGroupMessages(
  groupJid: string,
  searchTerms: string,
  limit = 10,
): { id: string; senderName: string | null; body: string; timestamp: number }[] {
  // Sanitize: wrap each word in quotes to prevent FTS5 syntax injection
  const sanitized = searchTerms
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => `"${w.replace(/"/g, '')}"`)
    .join(' ');

  if (!sanitized) return [];

  const results = db.all<{
    id: string;
    sender_name: string | null;
    body: string;
    timestamp: number;
  }>(sql`
    SELECT gm.id, gm.sender_name, gm.body, gm.timestamp
    FROM group_messages_fts fts
    JOIN group_messages gm ON gm.rowid = fts.rowid
    WHERE group_messages_fts MATCH ${sanitized}
      AND gm.group_jid = ${groupJid}
    ORDER BY fts.rank
    LIMIT ${limit}
  `);

  return results.map(r => ({
    id: r.id,
    senderName: r.sender_name,
    body: r.body,
    timestamp: r.timestamp,
  }));
}
```

### Example 2: Zod v4 Schema with toJSONSchema

```typescript
// Source: verified on this machine with Zod 4.3.6
import { z } from 'zod';
import { generateJson } from '../ai/provider.js';

const TripClassifierSchema = z.object({
  decisions: z.array(z.object({
    type: z.enum(['destination', 'accommodation', 'activity', 'transport', 'dates', 'budget']),
    value: z.string().describe('The confirmed decision text'),
    confidence: z.enum(['high', 'medium', 'low']),
  })).describe('Confirmed trip decisions found in the messages'),
  openItems: z.array(z.object({
    question: z.string().describe('The unanswered question or unresolved commitment'),
    context: z.string().describe('Brief context about what prompted this question'),
  })).describe('Open questions or unresolved items'),
  contextSummary: z.string().nullable()
    .describe('Brief updated summary of the trip planning state, or null if no travel content'),
});

const CLASSIFIER_JSON_SCHEMA = z.toJSONSchema(TripClassifierSchema);
```

### Example 3: tripContextManager.ts Skeleton

```typescript
import crypto from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { generateJson } from '../ai/provider.js';
import { getTripContext, upsertTripContext } from '../db/queries/tripMemory.js';
import { insertTripDecision, getDecisionsByGroup } from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

interface GroupMsg {
  id: string;
  senderJid: string;
  senderName: string | null;
  body: string;
  timestamp: number;
}

// --- Pre-filter ---

const MIN_CLASSIFY_LENGTH = 15;
const TRAVEL_SIGNALS = /\b(hotel|hostel|airbnb|flight|fly|airport|book|reserve|booked|decided|destination|budget|itinerary|trip|travel|vacation|rent|car rental)\b|מלון|טיסה|הזמנ|טיול|תקציב|יעד|נופש|השכר|רכב|החלטנו|הזמנו|סגרנו|נסגר/i;
const SKIP_PATTERNS = /^[\p{Emoji}\s]{1,10}$|^(ok|lol|haha|yes|no|אוקי|כן|לא|נכון|סבבה)\s*$/iu;

export function hasTravelSignal(text: string): boolean {
  if (text.length < MIN_CLASSIFY_LENGTH) return false;
  if (SKIP_PATTERNS.test(text)) return false;
  return TRAVEL_SIGNALS.test(text);
}

// --- Debounce ---

const tripDebounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();
const TRIP_DEBOUNCE_MS = 10_000;

export function addToTripContextDebounce(groupJid: string, msg: GroupMsg): void {
  // Pre-filter first
  if (!hasTravelSignal(msg.body)) {
    logger.debug({ msgId: msg.id }, 'Trip pre-filter: no travel signal, skipping');
    return;
  }

  const existing = tripDebounceBuffers.get(groupJid);
  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(msg);
    existing.timer = setTimeout(() => {
      tripDebounceBuffers.delete(groupJid);
      processTripContext(groupJid, existing.messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in trip context processing');
      });
    }, TRIP_DEBOUNCE_MS);
  } else {
    const messages = [msg];
    const timer = setTimeout(() => {
      tripDebounceBuffers.delete(groupJid);
      processTripContext(groupJid, messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in trip context processing');
      });
    }, TRIP_DEBOUNCE_MS);
    tripDebounceBuffers.set(groupJid, { messages, timer });
  }
}

// --- Classifier ---

async function processTripContext(groupJid: string, messages: GroupMsg[]): Promise<void> {
  // Load existing context + decisions for dedup
  const existingContext = getTripContext(groupJid);
  const existingDecisions = getDecisionsByGroup(groupJid);

  // Format messages for classifier
  const messagesText = messages
    .map(m => `${m.senderName ?? 'Unknown'}: ${m.body}`)
    .join('\n');

  // Call Gemini classifier
  const result = await generateJson<ClassifierOutput>({
    systemPrompt: buildClassifierPrompt(existingContext, existingDecisions),
    userContent: messagesText,
    jsonSchema: CLASSIFIER_JSON_SCHEMA as Record<string, unknown>,
    schemaName: 'trip_context_classifier',
  });

  if (!result) return;

  // Upsert trip context
  if (result.contextSummary) {
    upsertTripContext(groupJid, {
      destination: result.decisions.find(d => d.type === 'destination')?.value ?? existingContext?.destination ?? null,
      dates: result.decisions.find(d => d.type === 'dates')?.value ?? existingContext?.dates ?? null,
      contextSummary: result.contextSummary,
    });
  }

  // Insert new decisions (dedup by not re-inserting existing)
  for (const decision of result.decisions) {
    if (decision.confidence === 'low') continue;
    insertTripDecision({
      id: crypto.randomUUID(),
      groupJid,
      type: decision.type,
      value: decision.value,
      confidence: decision.confidence,
      sourceMessageId: messages[0]?.id ?? null,
    });
  }

  // Insert open items
  for (const item of result.openItems) {
    insertTripDecision({
      id: crypto.randomUUID(),
      groupJid,
      type: 'open_question',
      value: item.question,
      confidence: 'high',
      sourceMessageId: messages[0]?.id ?? null,
    });
  }
}
```

### Example 4: Pipeline Integration in groupMessagePipeline.ts

```typescript
// In the callback inside initGroupPipeline():
import { addToTripContextDebounce } from './tripContextManager.js';

// ... existing steps [1]-[3] ...

// Skip keyword rules and date extraction for own messages
if (msg.fromMe) return;

// Keyword auto-response -- runs immediately, non-terminal
await handleKeywordRules(groupJid, msg);

// [3.5] Trip context accumulation -- non-terminal
// Pre-filter is inside addToTripContextDebounce; no-op for non-travel messages
addToTripContextDebounce(groupJid, msg);

// Batch for calendar date extraction
addToDebounce(groupJid, msg);
```

## Future Phase Dependencies

### Phase 19: Itinerary Builder
- **Reads from:** `tripContexts.destination` and `tripContexts.dates` to enrich calendar event suggestions
- **Interface needed:** `getTripContext(groupJid)` query must be exported from `tripMemory.ts`

### Phase 21: Travel Intelligence
- **Reads from:** `tripDecisions` where `type = 'open_question'` and `resolved = false` for weekly digest
- **Reads from:** `tripContexts.destination` to trigger proactive suggestions on new destination confirmation
- **Interface needed:**
  - `getUnresolvedOpenItems(groupJid)` query
  - `resolveOpenItem(decisionId)` mutation (sets `resolved = true`)
  - `getTripContext(groupJid)` for destination-based triggers

### Exported Interface Summary

```typescript
// From src/db/queries/tripMemory.ts
export function getTripContext(groupJid: string): TripContext | undefined;
export function upsertTripContext(groupJid: string, data: Partial<TripContextUpdate>): void;
export function getDecisionsByGroup(groupJid: string, type?: string): TripDecision[];
export function insertTripDecision(decision: NewTripDecision): void;
export function getUnresolvedOpenItems(groupJid: string): TripDecision[];
export function resolveOpenItem(decisionId: string): void;
export function searchGroupMessages(groupJid: string, query: string, limit?: number): SearchResult[];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zod/v3` + `zod-to-json-schema` | Zod v4 native `z.toJSONSchema()` | Zod 4.x (installed) | New code MUST use v4; existing files remain on v3 compat |
| LIKE queries for text search | FTS5 with MATCH and ranking | N/A (first FTS5 use) | Orders of magnitude faster for substring search; supports ranking |
| No trip memory | tripContexts + tripDecisions tables | Phase 18 (this phase) | Bot remembers decisions across sessions |

**Deprecated/outdated:**
- `zod-to-json-schema` package: still installed but should NOT be used in new code; `z.toJSONSchema()` replaces it entirely
- `import { z } from 'zod/v3'`: backward compat import, new code uses `import { z } from 'zod'`

## Open Questions

1. **FTS5 rebuild for existing data: performance on large tables?**
   - What we know: `INSERT INTO group_messages_fts(group_messages_fts) VALUES('rebuild')` reindexes all rows. Works fine in testing.
   - What's unclear: If the group has thousands of messages, how long does rebuild take? (Likely <1 second for <100K rows.)
   - Recommendation: Run rebuild in the migration. It's a one-time cost. Log timing.

2. **Classifier prompt tuning for Hebrew/English mix**
   - What we know: The prompt must handle bilingual messages. Similar pattern to `parseTravelIntent` which already works bilingually.
   - What's unclear: Exact prompt wording that minimizes false positives on casual Hebrew group chatter.
   - Recommendation: Start with the prompt in Example 3, then iterate after real-world testing. Log classifier outputs for a week before trusting them.

3. **Decision deduplication granularity**
   - What we know: Passing existing decisions in the classifier prompt helps Gemini avoid duplicates.
   - What's unclear: Should we do exact-match dedup in DB as a safety net, or rely entirely on Gemini?
   - Recommendation: Use Gemini for semantic dedup in the prompt, plus a simple DB-level check (same groupJid + type + similar value within last hour). Belt and suspenders.

## Sources

### Primary (HIGH confidence)
- Codebase files read directly:
  - `src/groups/groupMessagePipeline.ts` -- pipeline flow, debounce pattern, insertion point
  - `src/groups/travelParser.ts` -- Zod schema, queryType enum, generateJson pattern
  - `src/groups/travelHandler.ts` -- dispatch logic, reply chain, rate limiting
  - `src/groups/travelSearch.ts` -- grounded search (what NOT to call for recall)
  - `src/groups/dateExtractor.ts` -- hasNumberPreFilter reference pattern
  - `src/groups/keywordHandler.ts` -- non-terminal pipeline step pattern
  - `src/db/schema.ts` -- all existing tables, column conventions
  - `src/db/client.ts` -- better-sqlite3 + Drizzle setup, migration call
  - `src/db/queries/groupMessages.ts` -- getGroupMessagesSince, insertGroupMessage
  - `src/db/queries/calendarEvents.ts` -- CRUD pattern for new query files
  - `src/ai/provider.ts` -- generateJson, generateText API
  - `src/pipeline/messageHandler.ts` -- setGroupMessageCallback, group message persistence
  - `.planning/STATE.md` -- locked decisions, constraints
  - `.planning/REQUIREMENTS.md` -- MEM-01, MEM-02, MEM-03, MEM-04
  - `.planning/ROADMAP.md` -- Phase 19/21 dependencies
- Runtime verification:
  - `better-sqlite3` FTS5 support: CONFIRMED (tested in-process)
  - FTS5 with Hebrew text: CONFIRMED (tested tokenization of Hebrew words)
  - FTS5 external content + trigger sync: CONFIRMED (tested full workflow)
  - Zod v4 `z.toJSONSchema()`: CONFIRMED (tested output format)
  - Zod version 4.3.6: CONFIRMED (checked package.json)

### Secondary (MEDIUM confidence)
- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) -- authoritative reference for MATCH syntax, ranking, external content tables
- [Drizzle ORM FTS5 issue #2046](https://github.com/drizzle-team/drizzle-orm/issues/2046) -- confirms no native virtual table support, raw SQL workaround required

### Tertiary (LOW confidence)
- None -- all findings verified with primary sources or runtime tests

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified
- Architecture: HIGH -- extends proven patterns already in the codebase (debounce, generateJson, pipeline callback)
- DB schema: HIGH -- follows existing Drizzle conventions, FTS5 verified working
- Pre-filter: MEDIUM -- keyword list needs real-world tuning; design is sound but Hebrew coverage may need expansion
- Classifier prompt: MEDIUM -- similar to existing travel parser but untested on real mixed-language group data

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- all dependencies pinned, no fast-moving concerns)

# Architecture Patterns: Travel Agent Integration

**Domain:** Travel agent features for an existing WhatsApp group bot
**Researched:** 2026-03-02
**Confidence:** HIGH — based on direct codebase inspection of all relevant source files

---

## Existing Architecture (Ground Truth)

Every design decision below is grounded in the actual code. The codebase is ~8,700 LOC TypeScript.

### The Pipeline Chain (as implemented in `src/groups/groupMessagePipeline.ts`)

```
messages.upsert event (Baileys)
  └─> messageHandler.ts: processMessage()
        ├─ persist to groupMessages table (not-fromMe only)
        └─> groupMessageCallback()   [single registered callback slot]
              └─> groupMessagePipeline.ts: the registered callback
                    │
                    ├─[1] handleTravelMention()   ← TERMINAL if returns true
                    │     detects @mention OR reply-to-travel-result msgId
                    │     returns true → pipeline stops
                    │
                    ├─[2] if (msg.fromMe) return  ← TERMINAL guard
                    │
                    ├─[3] handleKeywordRules()    ← NON-TERMINAL
                    │     first-match-wins but pipeline continues
                    │
                    ├─[4] handleReplyToDelete()   ← TERMINAL if returns true
                    │     checks reply to bot calendar confirmation + delete word
                    │
                    └─[5] addToDebounce()         ← DEBOUNCED (10s window, batch)
                          └─> processGroupMessages() → Gemini date extraction → calendar
```

### Callback Registration (as implemented in `src/pipeline/messageHandler.ts`)

```typescript
// One slot — last write wins. There is no array. No pub/sub.
let groupMessageCallback: ((groupJid, msg, quotedMessageId, mentionedJids) => void) | null = null;

export function setGroupMessageCallback(cb: typeof groupMessageCallback) {
  groupMessageCallback = cb;
}
```

This is critical: all group message handling must live inside the single registered callback in `groupMessagePipeline.ts`. Calling `setGroupMessageCallback()` a second time from a new module silently overwrites the first registration and breaks the pipeline.

### State Pattern (as implemented)

- `getState()` / `updateState()` in `src/api/state.ts` — module-level singleton for `sock`, `botJid`, `botDisplayName`, connection status. All handlers use `const { sock } = getState()` to access the socket.
- Module-level Maps for ephemeral state: `travelResultMessages`, `lastRequestTime`, `debounceBuffers`, `calendarIdCache`, `ruleCooldowns`, `lastAutoReplyTime`. Each module owns its own state.
- SQLite (via Drizzle ORM) for persistent state across restarts.

### AI Pattern (as implemented)

- `generateJson<T>()` in `src/ai/provider.ts` — structured JSON output using Zod schema passed as `responseSchema` to Gemini
- `generateText()` in `src/ai/provider.ts` — free-form text generation
- Every caller validates with `ZodSchema.safeParse()` before trusting output; returns `null` on failure — never crashes the pipeline
- Gemini grounded search (Google Search tool) used exclusively in `travelSearch.ts` — separate API path from `provider.ts`

### DB Pattern (as implemented)

- Drizzle ORM over better-sqlite3, WAL mode enabled
- Schema in `src/db/schema.ts`, migrations in `drizzle/` folder
- Query functions in `src/db/queries/*.ts` — one file per table, exported individually
- `onConflictDoNothing` for dedup on insert; WAL mode allows concurrent reads with writes

---

## New Feature Integration Map

### Feature 1: Trip Context Manager (always-listening accumulator)

**What it is:** Every message in the group is passively scanned for travel signals (destination mentions, date references, budget, group size). This accumulated context feeds @mention handling and the proactive suggestion trigger.

**Pipeline integration point:** New non-terminal step at position [3.5] — after keyword rules, before reply-to-delete. Same shape as `handleKeywordRules()`:

```
[3] handleKeywordRules()          ← existing non-terminal
[3.5] updateTripContext()         ← NEW non-terminal (always-listening, never sends)
[4] handleReplyToDelete()         ← existing terminal
[5] addToDebounce()               ← existing
```

`updateTripContext()` must never block the pipeline noticeably. The implementation uses a **debounce + batch** approach identical to the existing `addToDebounce()` pattern: buffer messages for 30 seconds, then run one Gemini call on the batch. Not every message triggers a Gemini call.

**Storage:** New DB table (`tripContexts`), not in-memory only. Trip planning conversations span hours or days. Loss on restart is a real UX bug.

**New DB table: `tripContexts`**

```typescript
// src/db/schema.ts addition
export const tripContexts = sqliteTable('trip_contexts', {
  id: text('id').primaryKey(),
  groupJid: text('group_jid').notNull().unique(), // one active context per group (upsert pattern)
  destination: text('destination'),
  dates: text('dates'),             // JSON string: { start?: string; end?: string; raw: string }
  budget: text('budget'),
  preferences: text('preferences'), // JSON string: string[]
  partySize: integer('party_size'),
  confidence: text('confidence'),   // 'low' | 'medium' | 'high'
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index('idx_trip_contexts_group').on(table.groupJid),
]);
```

**Gemini call shape for context extraction:**

```typescript
// schemaName: 'trip_context_update'
const TripContextUpdateSchema = z.object({
  hasTravelSignal: z.boolean(),
  destination: z.string().nullable(),
  dates: z.object({
    raw: z.string(),
    start: z.string().nullable(),
    end: z.string().nullable(),
  }).nullable(),
  budget: z.string().nullable(),
  preferences: z.array(z.string()),
  partySize: z.number().int().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});
```

**DB write strategy:** Upsert (merge into existing context, not replace). Only overwrite a field if the new extraction is non-null. This preserves early partial context as more signals accumulate.

**Component location:** `src/groups/tripContextManager.ts` (new file)

---

### Feature 2: Structured Decision Storage

**What it is:** When the group reaches a travel decision (agreed destination, confirmed dates, chosen hotel), store it as a typed record — not just as a message in `groupMessages`.

**Pipeline integration:** Decision detection runs inside `tripContextManager.ts` during the context update cycle. When accumulated context reaches `confidence: 'high'` AND a commitment signal appears (e.g., "נקנה", "let's book", "confirmed", "agreed"), a `tripDecision` record is written.

This is not a new pipeline stage. It is logic within the trip context flush, reusing the same Gemini call.

**New DB table: `tripDecisions`**

```typescript
// src/db/schema.ts addition
export const tripDecisions = sqliteTable('trip_decisions', {
  id: text('id').primaryKey(),
  groupJid: text('group_jid').notNull(),
  type: text('type').notNull(),        // 'destination' | 'dates' | 'accommodation' | 'activity' | 'transport'
  value: text('value').notNull(),      // Human-readable: "Rome, 15-20 March"
  valueJson: text('value_json'),       // Structured JSON for calendar automation
  sourceMessageId: text('source_message_id'), // groupMessages.id that triggered this
  status: text('status').notNull().default('active'), // 'active' | 'overridden' | 'cancelled'
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index('idx_trip_decisions_group').on(table.groupJid),
]);
```

**Relationship to `calendarEvents`:** When a `tripDecision` of type `dates` or `activity` includes a specific time, it should create a `calendarEvent`. The existing `calendarService.ts` + `insertCalendarEvent()` handle this — no new calendar code needed. The trip decision module calls the same functions that `processGroupMessages()` already calls.

**Enhanced date extraction (modification to `src/groups/dateExtractor.ts`):** The existing `ExtractedDate` interface only has `{ title, date, confidence }`. Extend the Zod schema with optional fields for richer calendar events:

```typescript
// Extended — backward compatible (new fields optional, no existing field type changes)
const DateExtractionSchema = z.object({
  dates: z.array(z.object({
    title: z.string().describe('Concise smart title for the event'),
    date: z.string().describe('ISO 8601 date string in Asia/Jerusalem timezone'),
    confidence: z.enum(['high', 'medium', 'low']),
    location: z.string().optional(),     // NEW: "Rome", "Airbnb near Colosseum"
    description: z.string().optional(),  // NEW: richer context for calendar event body
    url: z.string().optional(),          // NEW: booking link if mentioned in message
  })),
});
```

**`calendarService.ts` modification** — add optional `location` parameter:

```typescript
export async function createCalendarEvent(params: {
  calendarId: string;
  title: string;
  date: Date;
  description: string;
  location?: string;   // NEW — Google Calendar API accepts this as top-level field
  timeZone?: string;
}): Promise<string | null>
```

Google Calendar API's `events.insert` accepts `location` as a top-level field in the request body.

**Component location:** Logic in `src/groups/tripContextManager.ts`. DB queries in `src/db/queries/tripContexts.ts` and `src/db/queries/tripDecisions.ts`.

---

### Feature 3: Suggest-Then-Confirm Flow

**What it is:** The bot sends a proactive suggestion message ("I see you're planning Rome — want me to search for flights?") and waits for a reply before executing the search.

**Pipeline integration:** No new pipeline stage. Confirmations arrive as regular group messages and are caught by the existing step [1] `handleTravelMention()`, which already handles reply-chain detection via `travelResultMessages.has(quotedMessageId)`. Add a parallel check for pending suggestions:

```
[1] handleTravelMention()
      │
      ├── isReplyToTravelResult = travelResultMessages.has(quotedMessageId)  ← existing
      │
      ├── isPendingSuggestion = pendingSuggestions.has(quotedMessageId)       ← NEW check
      │     └── parse user intent: confirm / deny
      │         ├── confirm → execute pending action, clear suggestion
      │         └── deny   → acknowledge, clear suggestion
      │
      └── isBotMentioned (existing)
```

**Pending suggestions state:** Module-level Map in `src/groups/suggestionTracker.ts`. Ephemeral — acceptable, because a pending suggestion expires after 2 hours anyway and the bot can re-suggest on next proactive trigger.

```typescript
// src/groups/suggestionTracker.ts
const pendingSuggestions = new Map<
  string, // WhatsApp message ID of the bot's suggestion message
  {
    groupJid: string;
    type: 'travel_search' | 'calendar_confirm' | 'decision_confirm';
    payload: unknown;     // What to execute on confirmation
    expiresAt: number;    // Unix ms — auto-expire after 2 hours
  }
>();
const SUGGESTIONS_MAP_MAX = 200;
const SUGGESTION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
```

**Confirmation language:** Text-based only (reply with "yes"/"כן" or "no"/"לא"). WhatsApp message reactions are delivered via a separate `messages.upsert` event with a different message structure — they are accessible but add complexity. Text replies are simpler and work in all WhatsApp versions.

**Modification required:** `src/groups/travelHandler.ts` — add `pendingSuggestions.has(quotedMessageId)` check after the existing `travelResultMessages.has(quotedMessageId)` check.

**Component location:** `src/groups/suggestionTracker.ts` (new), `src/groups/travelHandler.ts` (modify).

---

### Feature 4: Proactive Suggestion Trigger

**What it is:** When the accumulated trip context reaches sufficient confidence (destination set, some dates present), the bot proactively offers to help without being @mentioned.

**Pipeline integration:** Runs at the end of the trip context flush in `tripContextManager.ts`. After updating the DB context, if conditions are met, send a suggestion message and store the sent `msgId` in `pendingSuggestions`.

**Trigger conditions (all must be true):**
1. `context.destination` is non-null
2. `context.confidence >= 'medium'`
3. Per-group cooldown has elapsed (minimum 2 hours since last proactive message)
4. No active pending suggestion already exists for this group

**Rate limiting state:**

```typescript
// Module-level in tripContextManager.ts — ephemeral, resets on restart
const lastProactiveSuggestionTime = new Map<string, number>(); // groupJid -> epoch ms
const PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
```

**Socket access:** Uses existing `const { sock } = getState()` pattern from `travelHandler.ts` and `groupMessagePipeline.ts`.

**Modification required:** None to existing files except adding the call at the end of the trip context flush. The proactive message is sent from `tripContextManager.ts` using `sock.sendMessage()`.

---

### Feature 5: Chat History Search

**What it is:** Search historical `groupMessages` to answer backward-looking @mention queries ("what hotels did we look at last week?", "when did we agree on Rome?").

**Pipeline integration:** No new pipeline stage. Handled inside the existing `handleTravelMention()` flow. The `travelParser.ts` detects the query type; if it is `'history_search'`, `travelHandler.ts` queries the DB instead of running a live search.

**`travelParser.ts` modification** — extend `queryType` enum:

```typescript
queryType: z.enum([
  'flights',
  'hotels',
  'restaurants',
  'activities',
  'car_rental',
  'general',
  'history_search',   // NEW: looking back at conversation history
]),
```

**`groupMessages.ts` modification** — add keyword search query:

```typescript
// Simple LIKE-based search — sufficient for personal bot volumes
export function searchGroupMessages(
  groupJid: string,
  keyword: string,
  sinceMs?: number,
  limit = 50,
): { senderName: string | null; body: string; timestamp: number }[]
```

SQLite's built-in `LIKE` with the existing `idx_group_messages_group_ts` index is sufficient for personal bot volumes (groups rarely exceed 10,000 total messages). SQLite FTS5 is an optimization for later if search becomes slow — defer it.

**`travelFormatter.ts` modification** — add formatting for history search results (messages returned from DB, formatted chronologically with sender names and timestamps).

**No new components** for this feature. Pure modifications to existing files.

---

### Feature 6: Enhanced Date Extraction

**What it is:** Calendar events created from group messages include location, richer description, and booking links — instead of just the raw message body.

**Pipeline integration:** Modification to `src/groups/dateExtractor.ts` only. The pipeline step and calendar service are the consumers. Changes are backward-compatible (new fields are optional).

**Changes:**
1. Extend `DateExtractionSchema` Zod object with optional `location`, `description`, `url` fields (see Feature 2 schema above)
2. Extend `ExtractedDate` TypeScript interface with same optional fields
3. In `processGroupMessages()` in `groupMessagePipeline.ts`, pass the new fields to `createCalendarEvent()`:
   - `description`: use `extracted.description ?? rawBodyFallback`
   - `location`: pass through to `createCalendarEvent()`

This is the lowest-risk change in the milestone — isolated to one file's Zod schema and the `createCalendarEvent()` call in the pipeline.

---

## Component Boundaries (Complete Picture)

```
src/groups/
├── groupMessagePipeline.ts    [MODIFY] — add updateTripContext() at step [3.5]
├── travelHandler.ts           [MODIFY] — add pendingSuggestions check alongside travelResultMessages
├── travelParser.ts            [MODIFY] — add 'history_search' to queryType enum
├── travelSearch.ts            [unchanged]
├── travelFormatter.ts         [MODIFY] — formatting for history results, proactive suggestions
├── dateExtractor.ts           [MODIFY] — extend schema with location/description/url
├── keywordHandler.ts          [unchanged]
├── reminderScheduler.ts       [unchanged]
├── tripContextManager.ts      [NEW] — trip context debounce+batch, Gemini call, DB upsert,
│                                      decision detection, proactive trigger
└── suggestionTracker.ts       [NEW] — pendingSuggestions Map, storeSuggestion(),
                                       checkAndClearSuggestion(), expiry cleanup

src/db/
├── schema.ts                  [MODIFY] — add tripContexts, tripDecisions table definitions
├── queries/
│   ├── groupMessages.ts       [MODIFY] — add searchGroupMessages() function
│   ├── tripContexts.ts        [NEW] — upsertTripContext(), getTripContext(), clearTripContext()
│   └── tripDecisions.ts       [NEW] — insertTripDecision(), getDecisionsByGroup()

src/calendar/
└── calendarService.ts         [MODIFY] — add optional location param to createCalendarEvent()
```

---

## Data Flow Diagrams

### Trip Context Accumulation

```
Message arrives in monitored group
  │
  ▼ [step 3.5 in pipeline callback]
updateTripContext(groupJid, msg)
  │
  ├── Add msg to per-group debounce buffer (30s window)
  │
  └── [On 30s flush] single Gemini call on buffered messages
        │
        ├── TripContextUpdateSchema: hasTravelSignal, destination, dates, budget, ...
        │
        ├── If hasTravelSignal:
        │     └── upsertTripContext(groupJid, merged) → tripContexts table
        │           └── Only overwrite fields where new value is non-null (merge strategy)
        │
        ├── If confidence === 'high' AND commitment signal detected:
        │     └── insertTripDecision() → tripDecisions table
        │
        └── If confidence >= 'medium' AND destination set AND cooldown elapsed:
              └── sock.sendMessage(groupJid, proactiveSuggestionText)
                    └── storeSuggestion(sentMsgId, { type: 'travel_search', payload: ... })
```

### Suggest-Then-Confirm

```
User replies to bot's suggestion message
  │
  ▼ [step 1 in pipeline — handleTravelMention()]
Check: pendingSuggestions.has(quotedMessageId)  ← new check
  │
  ├── [YES] Parse user reply for affirmation/denial
  │     ├── Affirmative → execute pending payload (search / calendar / etc.)
  │     │     └── checkAndClearSuggestion(quotedMessageId)
  │     └── Negative → send acknowledgment, clear suggestion
  │           └── checkAndClearSuggestion(quotedMessageId)
  │
  └── [NO] Continue existing logic (travelResultMessages check, isBotMentioned, etc.)
```

### Enhanced Calendar Event Creation

```
groupMessages debounce fires (existing step 5)
  │
  ▼ processGroupMessages() [existing, modified]
extractDates() → now returns:
  { title, date, confidence, location?, description?, url? }
  │
  ▼ createCalendarEvent({
      calendarId,
      title: extracted.title,
      date: extracted.date,
      description: extracted.description ?? rawBodyFallback,
      location: extracted.location,    ← NEW passthrough
    })
  │
  ▼ Google Calendar API: events.insert with location field
```

### History Search Flow

```
User @mentions bot with backward-looking query
  │
  ▼ parseTravelIntent() in travelParser.ts
Returns: { queryType: 'history_search', searchQuery: 'hotels in Rome last week', ... }
  │
  ▼ travelHandler.ts: dispatch on queryType
  │
  └── queryType === 'history_search'
        └── searchGroupMessages(groupJid, keyword, sinceMs)
              └── DB LIKE query on groupMessages table
                    └── Format results via travelFormatter.ts
                          └── sock.sendMessage(groupJid, formatted)
```

---

## Patterns to Follow

### Pattern 1: Non-Terminal Pipeline Step

Every new step that does not interrupt message flow follows this shape. The function returns `void`, not `boolean`. It wraps all errors internally and never throws.

```typescript
// In groupMessagePipeline.ts callback body
await handleKeywordRules(groupJid, msg);          // existing
await updateTripContext(groupJid, msg);            // new — same shape
const wasDelete = await handleReplyToDelete(...); // existing terminal
if (wasDelete) return;
addToDebounce(groupJid, msg);                      // existing
```

`updateTripContext()` signature:
```typescript
export async function updateTripContext(
  groupJid: string,
  msg: GroupMsg,
): Promise<void> {
  try {
    addToTripContextDebounce(groupJid, msg);
  } catch (err) {
    logger.error({ err, groupJid }, 'Error in trip context update — continuing pipeline');
  }
}
```

### Pattern 2: Debounce + Batch for AI Calls

Any always-listening feature that needs Gemini must buffer messages, not call Gemini per message. Follow the existing `addToDebounce()` pattern exactly.

```typescript
// In tripContextManager.ts
const tripContextBuffers = new Map<
  string, // groupJid
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();
const TRIP_CONTEXT_DEBOUNCE_MS = 30_000; // 30 seconds — longer than date extraction

function addToTripContextDebounce(groupJid: string, msg: GroupMsg): void {
  // identical structure to addToDebounce() in groupMessagePipeline.ts
}
```

30 seconds is appropriate for trip context (lower urgency than date extraction's 10 seconds). It also batches more messages per Gemini call, reducing cost.

### Pattern 3: In-Memory Map with Cap for Ephemeral Reply State

Pending suggestions and rate limits do not need to survive restarts. Follow the existing `travelResultMessages` pattern with a size cap to prevent unbounded growth.

```typescript
const pendingSuggestions = new Map<string, PendingSuggestion>();
const SUGGESTIONS_MAP_MAX = 200;

function storeSuggestion(msgId: string, suggestion: PendingSuggestion): void {
  if (pendingSuggestions.size >= SUGGESTIONS_MAP_MAX) {
    const firstKey = pendingSuggestions.keys().next().value;
    if (firstKey !== undefined) pendingSuggestions.delete(firstKey);
  }
  pendingSuggestions.set(msgId, suggestion);
}
```

### Pattern 4: Zod Schema for All AI Structured Output

Every Gemini call that returns structured data uses:
1. A Zod schema definition (`z.object(...)`)
2. `zodToJsonSchema()` to convert it for Gemini's `responseSchema` parameter
3. `SchemaName.safeParse(raw)` on the response before trusting any field
4. Return `null` on parse failure — never crash or throw from an AI-calling function

### Pattern 5: DB Upsert for Single-Row-Per-Group State

Trip context is one row per group, updated as context accumulates. Use Drizzle's `onConflictDoUpdate`:

```typescript
// src/db/queries/tripContexts.ts
export function upsertTripContext(ctx: {
  groupJid: string;
  destination?: string | null;
  dates?: string | null;
  budget?: string | null;
  preferences?: string | null;
  partySize?: number | null;
  confidence: string;
}) {
  return db.insert(tripContexts)
    .values({ id: crypto.randomUUID(), ...ctx })
    .onConflictDoUpdate({
      target: tripContexts.groupJid,
      set: {
        // Only overwrite non-null values (merge strategy)
        ...(ctx.destination != null && { destination: ctx.destination }),
        ...(ctx.dates != null && { dates: ctx.dates }),
        ...(ctx.budget != null && { budget: ctx.budget }),
        ...(ctx.preferences != null && { preferences: ctx.preferences }),
        ...(ctx.partySize != null && { partySize: ctx.partySize }),
        confidence: ctx.confidence,
        updatedAt: Date.now(),
      },
    });
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Registering a Second Pipeline Callback

**What it looks like:** Creating a new file (e.g., `tripContextPipeline.ts`) that calls `setGroupMessageCallback()` to register its own callback.
**Why it breaks things:** `messageHandler.ts` has a single-slot callback. The second `setGroupMessageCallback()` call silently replaces the first. The existing travel, keyword, date extraction, and delete handlers all stop working with no error thrown.
**Correct approach:** Add new steps inside the existing registered callback in `groupMessagePipeline.ts`. One callback, all steps inside it.

### Anti-Pattern 2: Synchronous Gemini Calls on Every Message

**What it looks like:** `await updateTripContext(groupJid, msg)` calling Gemini directly, without debouncing.
**Why it breaks things:** The pipeline callback awaits this. At 500-2000ms per Gemini call, an active group with 10 messages/minute creates a 5-20 second backlog. The pipeline stalls. The bot stops responding.
**Correct approach:** Debounce in a 30-second window. One Gemini call per batch per group.

### Anti-Pattern 3: Trip Context in Memory Only

**What it looks like:** `const tripContexts = new Map<string, TripContext>()` at module level.
**Why it breaks things:** PM2 restarts the bot on crashes and deployments. Trip planning conversations span hours. Context accumulated from "let's go to Rome" at 10am is gone after the 2pm restart. The proactive suggestion fires again based on an empty context.
**Correct approach:** Persist to `tripContexts` DB table. An in-memory Map is acceptable as a read cache for performance, but the DB is the source of truth.

### Anti-Pattern 4: Proactive Messages Without Rate Limiting

**What it looks like:** Sending a proactive suggestion every time context confidence crosses the threshold.
**Why it breaks things:** In an active planning conversation, confidence oscillates around the threshold as new messages arrive. Without a cooldown, the bot sends a suggestion every 30 seconds during an active planning discussion.
**Correct approach:** Per-group cooldown of at least 2 hours. Also: only send a new suggestion if the destination has changed since the last suggestion, not on every confidence update.

### Anti-Pattern 5: Breaking the Existing DateExtractionSchema

**What it looks like:** Changing `confidence` from `z.enum(['high', 'medium', 'low'])` to `z.number()` (numeric score), or removing existing fields.
**Why it breaks things:** `processGroupMessages()` filters on `d.confidence === 'high'`. The `ExtractedDate` interface is the return type of the public `extractDates()` function. Any breaking change to these contracts breaks the calendar pipeline.
**Correct approach:** Add new fields as `.optional()`. Never change the type of existing fields. Run the full date extraction + calendar flow in a test group after any schema change.

---

## Build Order (Dependency-Driven)

### Step 1: DB Schema Extensions

New tables, new query files. No application logic yet — just the persistence layer. Everything else depends on this.

**Files:**
- `src/db/schema.ts` — add `tripContexts` and `tripDecisions` table definitions
- `drizzle/` — `drizzle-kit generate` then `drizzle-kit push` (or migration run at startup)
- `src/db/queries/tripContexts.ts` — new: `upsertTripContext()`, `getTripContext()`, `clearTripContext()`
- `src/db/queries/tripDecisions.ts` — new: `insertTripDecision()`, `getDecisionsByGroup()`
- `src/db/queries/groupMessages.ts` — add `searchGroupMessages()` (independent, low risk)

**Why first:** All subsequent components read and write these tables. Cannot write the context manager without the query layer. Running migrations before any other code change is the safe order.

### Step 2: Enhanced Date Extraction

Isolated modification. Can be shipped and validated independently before building the more complex trip context system.

**Files:**
- `src/groups/dateExtractor.ts` — extend `DateExtractionSchema` and `ExtractedDate` interface
- `src/calendar/calendarService.ts` — add `location?` param to `createCalendarEvent()`
- `src/groups/groupMessagePipeline.ts` — pass new fields in the `createCalendarEvent()` call

**Why second:** Self-contained. Validates the pattern of safely extending the Zod schema before applying the same pattern to the more complex trip context schema. Low blast radius if it has a bug.

### Step 3: Trip Context Manager (core)

The foundation for proactive suggestions and the suggestion tracker. Build the accumulation and storage logic first, without the proactive send.

**Files:**
- `src/groups/tripContextManager.ts` — new: debounce buffer, Gemini call, DB upsert, decision detection
- `src/groups/groupMessagePipeline.ts` — add `await updateTripContext(groupJid, msg)` at step [3.5]

**Why third:** Proactive suggestions (Step 5) and the suggestion tracker (Step 5) both depend on the trip context being accumulated. Build and verify accumulation + storage before adding the send path.

### Step 4: Chat History Search

Independent of trip context. Builds on the DB query added in Step 1. Can be developed in parallel with Step 3.

**Files:**
- `src/groups/travelParser.ts` — add `'history_search'` to `queryType` enum
- `src/groups/travelHandler.ts` — add dispatch path for `queryType === 'history_search'`
- `src/groups/travelFormatter.ts` — add history result formatting

**Why fourth:** Standalone feature addition. Shares no dependencies with Steps 3 or 5. Low risk — confined to the existing travel @mention flow.

### Step 5: Suggestion Tracker + Proactive Trigger

Most complex step. Depends on trip context (Step 3) being working and verified. Introduces cross-message state (pendingSuggestions) and the proactive send path.

**Files:**
- `src/groups/suggestionTracker.ts` — new: `pendingSuggestions` Map, `storeSuggestion()`, `checkAndClearSuggestion()`, expiry
- `src/groups/travelHandler.ts` — add `pendingSuggestions.has(quotedMessageId)` check
- `src/groups/tripContextManager.ts` — add proactive trigger at end of context flush
- `src/groups/travelFormatter.ts` — add proactive suggestion message formatting

**Why last:** Most moving parts. The confirm/deny detection in `travelHandler.ts` depends on `suggestionTracker.ts`. The proactive send depends on `tripContextManager.ts` having valid context. Building Steps 1-4 first means the proactive trigger has real context to work with during testing.

---

## Scalability at Personal Bot Scale

This bot runs for one person's groups (estimated 3-20 groups, 5-50 messages/group/day).

| Concern | At Current Scale | Notes |
|---------|-----------------|-------|
| Trip context DB writes | One upsert per 30s flush, per active group | WAL mode handles concurrent reads fine |
| `pendingSuggestions` Map size | Cap at 200 entries | Trivial memory footprint |
| History search latency | LIKE on `groupMessages` with existing `idx_group_messages_group_ts` index | Fast at 10,000 rows; add FTS5 only if proven slow |
| Gemini calls for context | 1 per 30s debounce window per group | Not a bottleneck |
| Proactive suggestion spam | 2-hour per-group cooldown | Sufficient guard |
| `tripDecisions` table size | One row per decision event | Indefinitely sustainable |

---

## Sources

- `src/groups/groupMessagePipeline.ts` — pipeline structure, step ordering, debounce pattern, `initGroupPipeline()` (direct inspection)
- `src/pipeline/messageHandler.ts` — single-slot `groupMessageCallback`, callback registration pattern, `fromMe` guard (direct inspection)
- `src/groups/travelHandler.ts` — `travelResultMessages` Map, reply-chain detection, `getState()` usage, `storeTravelResult()` cap pattern (direct inspection)
- `src/groups/travelParser.ts` — `TravelIntentSchema` full Zod definition, `queryType` enum (direct inspection)
- `src/groups/dateExtractor.ts` — `DateExtractionSchema`, `ExtractedDate` interface, `confidence === 'high'` filter (direct inspection)
- `src/db/schema.ts` — all existing table definitions, index patterns, `onConflictDoNothing` usage (direct inspection)
- `src/db/queries/groupMessages.ts` — `getGroupMessagesSince()` signature, Drizzle query builder pattern (direct inspection)
- `src/calendar/calendarService.ts` — `createCalendarEvent()` parameter shape, Google Calendar API fields used (direct inspection)
- `src/api/state.ts` — `getState()` pattern for cross-module `sock` access (direct inspection)
- `src/db/client.ts` — WAL mode confirmed (`sqlite.pragma('journal_mode = WAL')`), Drizzle migration runner (direct inspection)
- `src/groups/keywordHandler.ts` — non-terminal handler pattern (direct inspection)

---
*Architecture research for: Travel agent features integration — WhatsApp bot (subsequent milestone)*
*Researched: 2026-03-02*

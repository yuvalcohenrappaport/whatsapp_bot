# Architecture Patterns: Personal Assistant Features (v1.5)

**Domain:** Universal calendar detection, smart reminders, and Microsoft To Do sync for existing WhatsApp bot
**Researched:** 2026-03-16
**Confidence:** HIGH -- based on direct codebase inspection of all relevant source files

---

## Current Architecture Summary

The bot has two main pipelines:

1. **Private pipeline** (`pipeline/messageHandler.ts`): Incoming message -> persist -> contact mode check (off/draft/auto) -> AI reply generation -> send or create draft
2. **Group pipeline** (`groups/groupMessagePipeline.ts`): Registered via single-slot `setGroupMessageCallback` -> travel handler -> confirm/reject -> delete handler -> keyword handler -> trip context accumulation + date extraction (debounced 10s)

Key patterns already in use:
- Single-slot callback registration (`setGroupMessageCallback`) -- last write wins, no pub/sub
- Debounced message batching (10s window) before AI date extraction
- Suggest-then-confirm flow with reply-based confirm/reject and 30-minute TTL
- Lazy resource creation (Google Calendars created on first event)
- In-memory Map + DB persistence for pending suggestions (crash recovery via `restorePendingSuggestions`)
- AI provider abstraction (`generateText` / `generateJson` via `ai/provider.ts`)
- Global state singleton (`getState()` for sock access)
- `node-cron` for scheduled jobs (weekly digest reminders)
- Owner command parsing in `messageHandler.ts` (snooze, resume, draft approval via emojis)

**Calendar detection currently lives only in the group pipeline.** `dateExtractor.ts` extracts dates, `groupMessagePipeline.ts` orchestrates the debounce/batch/create flow, `suggestionTracker.ts` handles suggest-then-confirm. None of this is accessible from the private message path.

---

## New Features Integration Map

### Feature 1: Universal Calendar Detection (Private Messages)

**What it is:** Extend the existing date extraction capability from group-only to also work on private (1:1) messages. When a friend says "let's meet Thursday at 3pm", the bot detects the date and creates a Google Calendar event on the owner's personal calendar.

#### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `CalendarDetectionService` | `src/calendar/calendarDetection.ts` | Source-agnostic orchestrator: wraps dateExtractor + calendar event creation logic |
| Owner calendar config | `settings` table or `config.ts` | Owner's personal Google Calendar ID for private message events |

#### Modified Components

| Component | Change |
|-----------|--------|
| `pipeline/messageHandler.ts` | After persisting incoming private message, call `CalendarDetectionService.detectAndCreate()` before reply generation |
| `groups/groupMessagePipeline.ts` | Refactor: delegate to `CalendarDetectionService` instead of inline date extraction + suggestion logic |
| `config.ts` | Add optional `OWNER_CALENDAR_ID` env var |

#### Data Flow: Private Messages

```
Incoming private message (not fromMe, not group)
  |
  v
  Persist to messages table (existing)
  |
  v
  CalendarDetectionService.detectPrivate(text, contactName)
    |-> hasNumberPreFilter(text)  [existing, fast JS check]
    |-> extractDates(text, contactName, null)  [existing Gemini call]
    |-> If dates found with high confidence:
    |     -> createCalendarEvent on OWNER_CALENDAR_ID
    |     -> Send confirmation to owner's self-chat:
    |        "Added 'Meeting with Dan' on Thursday at 3pm to your calendar"
    |     -> Insert into calendarEvents table (sourceType: 'private')
    |
  Continue to reply generation (existing, unaffected)
```

**Key design decision: No suggest-then-confirm for private messages.**

Rationale:
1. Sending a suggestion message in a 1:1 chat would confuse the contact (they'd see the bot asking itself to confirm)
2. Private messages are higher signal than group chat -- a friend explicitly mentioning a date/time is very likely intentional
3. The owner can delete events via calendar app or via a future "undo" command
4. This matches the user's mental model: "the bot watches my chats and adds things to my calendar"

The confirmation goes to the owner's self-chat (existing `config.USER_JID`), not to the contact.

#### Data Flow: Group Messages (Refactored)

```
Group message batch (after existing 10s debounce)
  |
  v
  CalendarDetectionService.detectGroup(messages, groupJid, calendarId, calendarLink)
    |-> Same extraction logic as today
    |-> Routes through existing suggestionTracker (suggest-then-confirm)
    |-> No behavior change -- just moved to shared service
```

The refactoring enables code reuse without changing any group pipeline behavior.

---

### Feature 2: Smart Reminders

**What it is:** Proactive reminder system that goes beyond the existing weekly digest. Supports event-triggered reminders, commitment detection from conversations, and owner-initiated "remind me" commands.

#### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `ReminderService` | `src/reminders/reminderService.ts` | Manages reminder lifecycle: create, schedule, fire, cancel |
| `CommitmentDetector` | `src/ai/commitmentDetector.ts` | AI-powered extraction of commitments/follow-ups from messages |
| `reminders` table | DB migration | Persists reminder definitions |
| Owner command: "remind me" | `pipeline/messageHandler.ts` | Parse "remind me to X at/in Y" in owner self-chat |

#### Modified Components

| Component | Change |
|-----------|--------|
| `CalendarDetectionService` | After creating calendar event, auto-create a default reminder (1h before) |
| `pipeline/messageHandler.ts` | Add "remind me" command parsing in `handleOwnerCommand()` |
| `groups/reminderScheduler.ts` | On startup, also call `ReminderService.loadAndSchedule()` |
| `index.ts` | Initialize ReminderService during startup |

#### Reminder Types

| Type | Source | Example |
|------|--------|---------|
| **Event reminder** | Auto-created when calendar event is created | "Reminder: Flight to Barcelona in 1 hour" |
| **Commitment follow-up** | AI detects commitment in chat | Friend: "I'll send you the doc tomorrow" -> remind owner in 24h to follow up |
| **Custom reminder** | Owner sends "remind me to X at Y" to self-chat | "remind me to call dentist tomorrow at 9am" |
| **Recurring** | Owner configures via dashboard or command | "remind me every Monday to check project status" |

#### Scheduling Strategy

```
Reminder created
  |
  |-- triggerAt <= 24h from now?
  |     YES -> setTimeout(fireReminder, remainingMs)
  |     NO  -> Store in DB only. Loaded on next startup or hourly check.
  |
  |-- On startup:
  |     Load all pending reminders from DB
  |     For each where triggerAt <= 24h: schedule setTimeout
  |     For each where triggerAt > 24h: skip (hourly loader picks them up)
  |
  |-- Hourly loader (node-cron, every hour):
  |     SELECT * FROM reminders WHERE status='pending' AND triggerAt <= now + 24h
  |     Schedule setTimeout for each
```

**Why setTimeout instead of node-cron for individual reminders:** node-cron is designed for recurring patterns ("every Monday at 9"), not one-shot events at arbitrary times. `setTimeout` is precise for one-shots. For reminders beyond 24h, we avoid holding thousands of timers by doing a periodic DB scan.

**Why not just use node-cron for everything:** A cron expression can't represent "March 20 at 14:37" -- it would need per-minute resolution checks, which is wasteful.

#### Data Flow: Event Reminder

```
CalendarDetectionService creates event (private or group)
  |
  v
  ReminderService.createEventReminder({
    type: 'event',
    sourceId: calendarEventRecord.id,
    targetJid: groupJid or USER_JID,
    message: "Reminder: Flight to Barcelona in 1 hour",
    triggerAt: eventDate - 3600000  (1 hour before)
  })
  |
  v
  Insert into reminders table
  |
  v
  If triggerAt <= 24h: schedule setTimeout
  |
  v
  At trigger time:
    const { sock } = getState();
    sock.sendMessage(targetJid, { text: message });
    UPDATE reminders SET status = 'fired'
```

#### Data Flow: Commitment Detection

```
Private message persisted
  |
  v
  CommitmentDetector.detect(text, contactName)
    |-> Pre-filter: skip if < 15 chars, no action verbs, no temporal markers
    |-> generateJson with CommitmentSchema
    |-> Returns: { hasCommitment, description, suggestedFollowUpDate, who }
    |
    v
  If hasCommitment:
    ReminderService.createCommitmentReminder({
      type: 'commitment',
      targetJid: USER_JID,
      message: "Follow up with Dan: they said they'd send the doc",
      triggerAt: suggestedFollowUpDate
    })
    |
    Optionally -> TodoService.createTask() (if connected)
```

#### Data Flow: Owner "Remind Me" Command

```
Owner sends to self-chat: "remind me to call dentist tomorrow at 9am"
  |
  v
  handleOwnerCommand() in messageHandler.ts
    |-> Detect "remind me" prefix
    |-> generateJson with ReminderParseSchema:
    |     { task: "call dentist", triggerAt: "2026-03-17T09:00:00", recurring: null }
    |-> ReminderService.createCustomReminder({
          type: 'custom',
          targetJid: USER_JID,
          message: "Reminder: call dentist",
          triggerAt: parsed timestamp
        })
    |-> Reply: "Got it! I'll remind you to call dentist tomorrow at 9:00 AM"
```

---

### Feature 3: Microsoft To Do Sync

**What it is:** One-way push of detected tasks, commitments, and calendar events to Microsoft To Do lists.

#### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `TodoService` | `src/todo/todoService.ts` | Microsoft Graph API client for To Do CRUD |
| `TodoAuthManager` | `src/todo/authManager.ts` | MSAL token management with SQLite persistence |
| `todoAuth` table | DB migration | Persists MSAL serialized token cache |
| `todoMappings` table | DB migration | Maps local entity IDs to To Do task IDs |
| API route: `/api/todo` | `src/api/routes/todo.ts` | OAuth initiation + callback + sync config |
| Dashboard component | React SPA | Connect/disconnect Microsoft account, select default list |

#### Modified Components

| Component | Change |
|-----------|--------|
| `config.ts` | Add optional `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` env vars |
| `CalendarDetectionService` | After event creation, optionally push to To Do |
| `CommitmentDetector` | Detected commitments also create To Do tasks |
| `api/server.ts` | Register `/api/todo` routes |

#### Authentication Architecture

**Critical decision: OAuth2 Authorization Code Flow via the existing dashboard web UI.**

The bot already has a Fastify web server serving the React dashboard. Use this for the OAuth flow:

```
1. Owner logs into dashboard (existing JWT auth)
2. Clicks "Connect Microsoft To Do"
3. Dashboard opens: /api/todo/auth/start
   -> Fastify redirects to Microsoft login URL
   -> Scopes: Tasks.ReadWrite, offline_access
4. Microsoft redirects to: /api/todo/auth/callback
   -> Fastify exchanges code for tokens via MSAL
   -> MSAL token cache serialized to SQLite (todoAuth table)
   -> Redirect back to dashboard with success message
5. Subsequent API calls:
   -> TodoAuthManager.getClient()
   -> MSAL silently refreshes access token using cached refresh token
   -> If refresh fails (token expired after 90 days of inactivity):
      -> TodoService.isConnected() returns false
      -> Dashboard shows "Reconnect Microsoft To Do" prompt
```

**Why NOT device code flow:** Device code flow requires the owner to manually open a URL and enter a code -- unnecessary complexity when we already have a web UI.

**Why NOT app-only (daemon) auth:** The To Do API requires delegated permissions (acting on behalf of a user). App-only permissions cannot access a specific user's To Do lists without admin consent for an organization.

**Required Azure AD app registration:**
- Application type: Web
- Redirect URI: `{API_HOST}:{API_PORT}/api/todo/auth/callback`
- Supported account types: Personal Microsoft accounts (or personal + work/school)
- API permissions: `Tasks.ReadWrite`, `offline_access` (delegated)

**Token persistence:** MSAL Node's `CachePlugin` interface writes serialized token cache to SQLite. Tokens survive restarts. Refresh tokens last 90 days if used regularly; MSAL handles rotation automatically.

#### Data Flow: Task Creation

```
Event or commitment detected
  |
  v
  TodoService.isConnected()
    |
    |-- NO -> skip silently (graceful degradation)
    |
    |-- YES ->
          TodoService.createTask({
            title: "Flight to Barcelona",
            body: "Detected from chat with Dan",
            dueDate: "2026-03-20",
            listId: owner's configured default list
          })
          |
          v
          Microsoft Graph API: POST /me/todo/lists/{listId}/tasks
          |
          v
          Store mapping in todoMappings table:
            { localType: 'calendar_event', localId, todoTaskId, todoListId }
```

#### Sync Strategy

**v1: One-way push only.** The bot creates tasks in To Do when events/commitments are detected. No polling for changes in To Do.

Rationale:
- Polling adds complexity, API quota concerns, and stale-data bugs
- The bot is the source of truth for detected items
- If the owner completes a task in To Do, that's fine -- the bot doesn't need to know
- Microsoft Graph webhook subscriptions require a publicly accessible HTTPS endpoint, which adds infrastructure requirements

**Future v2 (defer):** Add webhook subscription via Microsoft Graph change notifications for bidirectional sync. Requires HTTPS endpoint exposed to the internet (currently the bot runs on a Tailscale network at `100.124.47.99`).

---

## Component Boundaries (Complete New/Modified Map)

```
src/
  calendar/
    calendarService.ts         [UNCHANGED] -- Google Calendar API wrapper
    calendarDetection.ts       [NEW] -- Source-agnostic detection orchestrator
                                       Calls dateExtractor + calendarService + reminderService + todoService

  reminders/
    reminderService.ts         [NEW] -- Reminder lifecycle: create, schedule (setTimeout), fire, cancel
                                       Hourly DB scan via node-cron for distant reminders
                                       On-startup load of pending reminders

  todo/
    todoService.ts             [NEW] -- Microsoft Graph To Do CRUD via @microsoft/msgraph-sdk
    authManager.ts             [NEW] -- MSAL ConfidentialClientApplication + SQLite CachePlugin

  ai/
    provider.ts                [UNCHANGED]
    gemini.ts                  [UNCHANGED]
    commitmentDetector.ts      [NEW] -- AI commitment extraction from messages
                                       Pre-filter + Gemini generateJson with CommitmentSchema

  pipeline/
    messageHandler.ts          [MODIFIED] -- Add:
                                 1. CalendarDetection hook after private message persistence
                                 2. CommitmentDetector hook after private message persistence
                                 3. "remind me" command in handleOwnerCommand()

  groups/
    groupMessagePipeline.ts    [MODIFIED] -- Refactor: delegate to CalendarDetectionService
                                            (behavior unchanged, code moved)
    dateExtractor.ts           [UNCHANGED] -- Reused by CalendarDetectionService
    suggestionTracker.ts       [UNCHANGED] -- Still used for group suggest-then-confirm
    reminderScheduler.ts       [MODIFIED] -- On startup, also call ReminderService.loadAndSchedule()

  api/
    routes/
      todo.ts                  [NEW] -- /api/todo/auth/start, /api/todo/auth/callback,
                                        GET /api/todo/status, POST /api/todo/config
    server.ts                  [MODIFIED] -- Register todo routes

  db/
    schema.ts                  [MODIFIED] -- Add reminders, todoAuth, todoMappings tables
    queries/
      reminders.ts             [NEW] -- CRUD for reminders table
      todoAuth.ts              [NEW] -- Get/set MSAL token cache
      todoMappings.ts          [NEW] -- CRUD for local<->todo mappings
```

---

## Communication Between Components

```
messageHandler.ts (private message path)
  |
  |-> CalendarDetectionService.detectPrivate(text, contactName)
  |     |-> dateExtractor.extractDates()
  |     |-> calendarService.createCalendarEvent() on OWNER_CALENDAR_ID
  |     |-> ReminderService.createEventReminder()  [auto 1h-before]
  |     |-> TodoService.createTask()  [if connected, graceful skip if not]
  |     |-> sock.sendMessage(USER_JID, confirmation)
  |
  |-> CommitmentDetector.detect(text, contactName)
  |     |-> Pre-filter (length, verb check)
  |     |-> generateJson with CommitmentSchema
  |     |-> ReminderService.createCommitmentReminder()
  |     |-> TodoService.createTask()  [if connected]
  |
  |-> generateReply()  [existing, unchanged]


groupMessagePipeline.ts (group message path)
  |
  |-> [existing steps: travel, confirm/reject, delete, keywords]
  |
  |-> CalendarDetectionService.detectGroup(messages, groupJid, ...)
  |     |-> dateExtractor.extractDates()  [existing]
  |     |-> suggestionTracker.createSuggestion()  [existing suggest-then-confirm]
  |     |-> On confirmation:
  |           |-> calendarService.createCalendarEvent()  [existing]
  |           |-> ReminderService.createEventReminder()  [NEW]
  |           |-> TodoService.createTask()  [NEW, if connected]


ReminderService (background)
  |
  |-> On startup: loadAndSchedule() -- DB scan, setTimeout for near-term
  |-> Hourly cron: scan DB for reminders entering 24h window
  |-> On fire: sock.sendMessage(targetJid, reminderText), mark 'fired'


TodoAuthManager (background)
  |
  |-> On OAuth callback: persist MSAL cache to DB
  |-> On API call: MSAL silently refreshes token from cache
  |-> On refresh failure: mark disconnected, dashboard prompts reconnect
```

---

## Patterns to Follow

### Pattern 1: Service Isolation with Graceful Degradation

Each new service must work independently. If Microsoft auth fails, calendar detection and reminders still work. If reminder scheduling fails, calendar events still get created.

```typescript
// In CalendarDetectionService
async function onEventCreated(event: CreatedEvent): Promise<void> {
  // Core: always try reminders
  await reminderService.createEventReminder(event).catch(err => {
    logger.error({ err, eventId: event.id }, 'Failed to schedule reminder');
  });

  // Optional: push to To Do only if connected
  if (todoService.isConnected()) {
    await todoService.createTask({
      title: event.title,
      dueDate: event.date,
      body: `Detected from ${event.source}`,
    }).catch(err => {
      logger.error({ err, eventId: event.id }, 'Failed to create To Do task');
    });
  }
}
```

**Why:** The owner should never lose calendar events because Microsoft auth expired. Each `.catch()` isolates failures.

### Pattern 2: Extend Existing Pipeline Callback (Never Register a Second)

The group pipeline uses `setGroupMessageCallback` which has a **single slot**. Calling it again from a new module silently overwrites the existing registration and breaks travel, keywords, dates, and everything else -- with no error thrown.

All new group processing goes inside the existing callback in `groupMessagePipeline.ts`.

### Pattern 3: Reuse Existing Owner Command Pattern

The "remind me" command follows the same pattern as the existing snooze/resume/draft-approval commands in `handleOwnerCommand()`:

```typescript
// Existing pattern in messageHandler.ts
async function handleOwnerCommand(sock: WASocket, text: string): Promise<boolean> {
  // ... existing snooze, resume, draft approval ...

  // NEW: "remind me" command
  if (trimmed.startsWith('remind me')) {
    // Parse and create reminder
    return true;  // consumed
  }

  return false;  // not a command
}
```

### Pattern 4: Confirmation to Self-Chat (Not to Contact)

For private message calendar detection, confirmations go to the owner's self-chat (`USER_JID`), not to the contact's chat. This avoids:
1. Confusing the contact with bot messages
2. Revealing that a bot is active
3. Breaking the existing auto-reply flow

```typescript
// CalendarDetectionService for private messages
await sock.sendMessage(config.USER_JID, {
  text: `Added "${event.title}" on ${formatDate(event.date)} to your calendar`,
});
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running AI on Every Private Message

**What:** Calling CommitmentDetector on every incoming private message.
**Why bad:** Most messages don't contain commitments. At 50+ private messages/day, Gemini costs add up.
**Instead:** Pre-filter before AI:
- Skip messages under 15 characters
- Skip messages without temporal markers (numbers, "tomorrow", "next week", Hebrew time words)
- Skip messages without action verbs ("send", "call", "bring", "check")
Only messages passing all filters go to Gemini.

### Anti-Pattern 2: Polling Microsoft Graph API

**What:** Cron job to poll To Do for task completion.
**Why bad:** API rate limits, unnecessary complexity, stale data.
**Instead:** One-way push in v1. Webhooks in v2 if bidirectional sync is needed.

### Anti-Pattern 3: Storing MSAL Tokens in .env or Config File

**What:** Writing refresh tokens to `.env` or a config JSON file.
**Why bad:** Tokens rotate on refresh. File-based storage requires file writes on every token refresh, which is error-prone and not atomic.
**Instead:** Use MSAL's `CachePlugin` interface with SQLite as the backing store. Atomic writes, survives restarts, works with the existing DB infrastructure.

### Anti-Pattern 4: Separate Reminder Cron Per Event

**What:** Creating a `node-cron` schedule for every individual reminder.
**Why bad:** 100+ reminders = 100+ cron jobs, each checking every minute. Wasteful.
**Instead:** Use `setTimeout` for near-term reminders (< 24h) and a single hourly cron job that scans the DB for reminders entering the 24h window.

---

## DB Schema Additions

```typescript
// src/db/schema.ts -- NEW tables

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),                    // UUID
    type: text('type').notNull(),                   // 'event' | 'commitment' | 'custom' | 'recurring'
    sourceId: text('source_id'),                    // calendarEvent.id or null
    targetJid: text('target_jid').notNull(),        // Where to send (group JID or USER_JID)
    message: text('message').notNull(),             // Reminder text to send
    triggerAt: integer('trigger_at').notNull(),      // Unix ms
    status: text('status').notNull().default('pending'), // 'pending' | 'fired' | 'cancelled'
    recurCron: text('recur_cron'),                  // Cron expression for recurring, null for one-shot
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_reminders_trigger_status').on(table.triggerAt, table.status),
    index('idx_reminders_source').on(table.sourceId),
  ],
);

export const todoAuth = sqliteTable('todo_auth', {
  id: text('id').primaryKey().default('default'),   // Single-row table
  tokenCache: text('token_cache').notNull(),         // MSAL serialized cache (encrypted with JWT_SECRET)
  defaultListId: text('default_list_id'),            // User's chosen default To Do list
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
});

export const todoMappings = sqliteTable(
  'todo_mappings',
  {
    id: text('id').primaryKey(),                     // UUID
    localType: text('local_type').notNull(),          // 'calendar_event' | 'commitment' | 'custom_reminder'
    localId: text('local_id').notNull(),
    todoTaskId: text('todo_task_id').notNull(),
    todoListId: text('todo_list_id').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_todo_mappings_local').on(table.localType, table.localId),
  ],
);
```

---

## Build Order (Dependency-Driven)

```
Phase 1: CalendarDetectionService (refactor only)
  Goal: Extract reusable calendar detection logic from groupMessagePipeline.ts
  Files: NEW src/calendar/calendarDetection.ts
         MODIFY src/groups/groupMessagePipeline.ts (delegate, no behavior change)
  Risk: LOW -- pure refactor, no new features
  Test: All existing group calendar detection works identically

Phase 2: Universal Calendar Detection (private messages)
  Goal: Detect dates in private messages, create events on owner's personal calendar
  Files: MODIFY src/pipeline/messageHandler.ts (add detection hook)
         MODIFY src/config.ts (add OWNER_CALENDAR_ID)
         NEW migration for any schema additions
  Depends on: Phase 1
  Risk: MEDIUM -- new Gemini calls on private messages, need pre-filter tuning
  Test: Send date-containing private messages, verify calendar events created

Phase 3: Smart Reminders (core)
  Goal: Reminder table, service, scheduling, event-triggered reminders, "remind me" command
  Files: NEW src/reminders/reminderService.ts
         NEW src/db/queries/reminders.ts
         MODIFY src/db/schema.ts (add reminders table)
         MODIFY src/pipeline/messageHandler.ts (add "remind me" command)
         MODIFY src/groups/reminderScheduler.ts (load reminders on startup)
         MODIFY src/index.ts (init ReminderService)
  Depends on: Phase 1 (hooks into event creation)
  Risk: MEDIUM -- timer management, DB scan cron, need to handle restart recovery
  Test: Create reminders via command, verify they fire at correct times

Phase 4: Commitment Detection
  Goal: AI-powered detection of commitments in private messages, auto-create follow-up reminders
  Files: NEW src/ai/commitmentDetector.ts
         MODIFY src/pipeline/messageHandler.ts (add commitment detection hook)
  Depends on: Phase 3 (uses ReminderService to schedule follow-ups)
  Risk: MEDIUM -- AI false positive tuning, pre-filter design
  Test: Send commitment-containing messages, verify reminders created

Phase 5: Microsoft To Do Sync
  Goal: OAuth flow, task creation, mapping persistence
  Files: NEW src/todo/todoService.ts
         NEW src/todo/authManager.ts
         NEW src/api/routes/todo.ts
         NEW src/db/queries/todoAuth.ts
         NEW src/db/queries/todoMappings.ts
         MODIFY src/db/schema.ts (add todoAuth, todoMappings tables)
         MODIFY src/config.ts (add MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI)
         MODIFY src/api/server.ts (register routes)
         MODIFY src/calendar/calendarDetection.ts (add TodoService hook)
         MODIFY src/ai/commitmentDetector.ts (add TodoService hook)
  Depends on: Phase 1-4 (plugs into existing hooks)
  Risk: HIGH -- OAuth flow, external API, token persistence, Azure AD app registration
  Test: OAuth flow end-to-end, task appears in Microsoft To Do app
```

**Phase ordering rationale:**
- Phase 1 first: pure refactor, zero risk, enables all subsequent phases
- Phase 2 before 3: calendar detection is the primary value -- reminders enhance it but aren't blocked
- Phase 3 before 4: commitment detection needs the reminder service to schedule follow-ups
- Phase 5 last: most external dependencies (Azure AD, Microsoft Graph), purely additive, graceful degradation if not configured

---

## Scalability Considerations

| Concern | At Current Scale (personal) | Notes |
|---------|----------------------------|-------|
| Gemini calls for private date extraction | ~20-30/day (after pre-filter) | Well within paid tier limits |
| Gemini calls for commitment detection | ~10-20/day (after pre-filter) | Pre-filter eliminates most messages |
| Microsoft Graph API calls | ~5-15/day | Way under 10,000/10min limit |
| In-memory setTimeout reminders | ~20-50 active | Negligible memory |
| SQLite reminder rows | ~500-2000 over months | Trivial for SQLite |
| MSAL token refreshes | ~1/hour when active | MSAL handles this automatically |

All well within limits for a personal bot.

---

## Sources

- Microsoft Graph To Do API: https://learn.microsoft.com/en-us/graph/todo-concept-overview
- Microsoft Graph To Do REST API: https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0
- Microsoft Graph Auth (delegated): https://learn.microsoft.com/en-us/graph/auth-v2-user
- MSAL Node.js: https://www.npmjs.com/package/@azure/msal-node
- Microsoft Graph TypeScript SDK: https://github.com/microsoftgraph/msgraph-sdk-typescript
- Microsoft Graph Auth Concepts: https://learn.microsoft.com/en-us/graph/auth/auth-concepts
- Direct codebase inspection: `src/pipeline/messageHandler.ts`, `src/groups/groupMessagePipeline.ts`, `src/calendar/calendarService.ts`, `src/groups/dateExtractor.ts`, `src/groups/suggestionTracker.ts`, `src/groups/reminderScheduler.ts`, `src/db/schema.ts`, `src/config.ts`, `src/ai/provider.ts`, `src/ai/gemini.ts`, `src/index.ts`

---
*Architecture research for: Personal Assistant Features (v1.5) -- WhatsApp bot*
*Researched: 2026-03-16*

# Feature Landscape: v1.5 Personal Assistant Features

**Domain:** WhatsApp bot -- universal calendar detection, smart reminders, Microsoft To Do sync
**Researched:** 2026-03-16
**Scope:** NEW features only (existing travel/group calendar pipeline not covered)

---

## Context: What Is Already Built

This is a subsequent milestone. The existing bot has:
- Group message monitoring with Gemini-based date extraction (`dateExtractor.ts`)
- Suggest-then-confirm flow for calendar events (`suggestionTracker.ts` -- ✅/❌ reply pattern)
- Enriched calendar events with location, description, links
- Per-group calendars with lazy creation and member email sharing (`calendarService.ts`)
- Weekly AI digest with node-cron (`reminderScheduler.ts`)
- Trip memory with context accumulation (`tripContextManager.ts`)
- Draft queue with pending/approved/rejected lifecycle
- Private chat impersonation (auto/draft modes per contact)
- Owner command handling via self-chat (snooze, resume, draft ✅/❌)

**Critical integration points for new features:**
- `messageHandler.ts` -- main message router. Currently private chats go to AI reply pipeline, groups go to `groupMessageCallback`. Date extraction only runs in groups with `travelBotActive`
- `groupMessagePipeline.ts` -- debounce + date extraction + suggest-then-confirm. Needs generalization beyond travel groups
- `suggestionTracker.ts` -- generic suggest-then-confirm with TTL, DB persistence, and restart recovery. Can be extended for reminders/tasks
- `config.ts` -- env schema with Zod validation. New Microsoft credentials go here
- `db/schema.ts` -- Drizzle ORM with SQLite. New tables for reminders, task sync state

---

## Table Stakes

Features users expect from a personal assistant bot with calendar and task management.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Universal calendar detection (private + group)** | Bot already detects dates in travel groups; extending to all chats is the natural next step. "Dentist Tuesday 2pm" in a private chat should be caught | Medium | `dateExtractor.ts` (reuse Gemini extraction), `messageHandler.ts` (add private chat hook), `suggestionTracker.ts` (extend suggest-then-confirm) | Currently limited to groups with `travelBotActive`. Need to process private chats and non-travel groups. Requires a "personal calendar" concept |
| **Suggest-then-confirm for all detected events** | Existing pattern users already know from group travel. Must carry over to private chats and non-travel groups | Low | `suggestionTracker.ts` (mostly reuse, adapt for private/self-chat confirmation) | Private chat confirmation goes to self-chat (USER_JID). Simpler than group flow -- no multi-user voting |
| **Quick reminders via WhatsApp DM** | "Remind me to X in Y" is the most basic assistant function. Every personal assistant (Siri, Google, Alexa) does this | Medium | `node-cron` already used for weekly digests. `sender.ts` for message delivery | Core loop: detect intent -> suggest -> confirm -> store -> schedule -> deliver -> optional snooze |
| **Time-specific reminders as calendar events** | When reminder has a specific date/time ("remind me March 20 at 9am"), it belongs on Google Calendar with a native notification | Low | `calendarService.ts` (createCalendarEvent already exists) | Routing decision: relative time ("in 30 min") -> WhatsApp DM reminder. Absolute datetime -> calendar event with reminder |
| **Microsoft To Do task creation** | Detected tasks need a persistent home. To Do is the Microsoft personal task hub, syncs across devices | High | Entirely new integration. Requires OAuth2 device code flow + Graph API client + token management | `Tasks.ReadWrite` delegated permission only. Application permissions NOT supported. Must use delegated auth with refresh token |
| **Task detection from chat messages** | Bot should notice "I need to buy groceries" or "don't forget to call the dentist" -- clear task intent without explicit dates | Medium | Pattern from `dateExtractor.ts` (Gemini structured output + Zod validation) | Separate Gemini prompt from date extraction. Tasks may have no date. Need intent pre-filter to avoid unnecessary Gemini calls |
| **Linked resources on To Do tasks** | Tasks created from WhatsApp should reference back to the original conversation for context | Low | Part of Graph API task creation payload | `linkedResource`: applicationName ("WhatsApp Bot"), displayName (sender/group name), webUrl (optional) |

---

## Differentiators

Features that make this bot stand out from basic reminder/calendar bots.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Smart routing: reminder vs calendar vs task** | Bot decides WHERE to put each detected item based on context. Most bots make the user choose; this bot infers correctly | Medium | All three destination systems must work first | Decision tree: specific datetime -> calendar; relative time -> WhatsApp reminder; task intent without time -> To Do; task with deadline -> calendar + To Do |
| **Context-aware task extraction** | "I'll handle the hotel booking" in a trip group = task with trip context attached. Bot understands speaker assignment | High | `tripContextManager.ts` (trip context), `dateExtractor.ts` extraction pattern | Differentiated from generic task detection. Leverages existing trip memory for richer task descriptions |
| **Unified suggest-then-confirm across all types** | Same ✅/❌ UX regardless of whether it's a calendar event, reminder, or task. Consistent, learnable interaction | Medium | `suggestionTracker.ts` generalization from calendar-only to multi-type suggestions | Most bots use different flows per type. Unified flow reduces cognitive load |
| **Private chat calendar detection** | Most WhatsApp calendar bots only work in groups. Detecting "let's meet Thursday at 3" in a private chat and offering to add it is uncommon | Medium | `messageHandler.ts` (currently private chats -> reply generation only) | Personal calendar (not group-specific). Auto-create or use a configured default calendar ID |
| **Reminder snooze/reschedule** | When a reminder fires, user replies "snooze 1h" or "tomorrow" to reschedule | Low | `parseSnoozeCommand` already exists in `messageHandler.ts` | Reuse snooze parsing pattern. Track delivered reminder message ID for reply matching |
| **Weekly digest includes To Do tasks** | Existing digest shows calendar events + chat-inferred tasks. Adding actual To Do items completes the picture | Low | `reminderScheduler.ts` (weekly digest generation) | Fetch via `GET /me/todo/lists/{id}/tasks` and include in digest prompt context |
| **Broadened Gemini prompt for non-travel events** | Current prompt is travel-focused. A universal prompt catches "dentist appointment", "meeting at 10", "dinner Friday" -- everyday life events | Low | `dateExtractor.ts` prompt text | Prompt change only. Widen from travel context to general event detection |

---

## Anti-Features

Features to explicitly NOT build in v1.5.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Two-way To Do sync (To Do -> WhatsApp)** | Requires webhooks/polling, conflict resolution. Microsoft Graph does NOT support application-level subscriptions for To Do tasks (confirmed in official docs). Massive complexity for a personal bot | One-way push: WhatsApp -> To Do only. User manages/completes tasks in the To Do app |
| **Natural language task management ("mark X done", "list my tasks")** | Requires task listing, fuzzy matching against To Do, state management. The To Do app already has a great UI for this | Bot only creates tasks. Management happens in Microsoft To Do directly |
| **Shared/collaborative task lists** | Each user needs separate OAuth. This is a personal bot for one user | Use personal task list only. Group-detected tasks get suggested to the bot owner's To Do |
| **Calendar event editing via WhatsApp** | Editing (change time, add attendees) is an edge-case rabbithole. Current flow supports create + delete | Keep create + delete. For edits: delete and re-create, or edit in Google Calendar directly |
| **Recurring reminders ("remind me every Monday")** | Requires cron management, cancellation UX, storage of recurrence patterns. Weekly digest already handles recurring awareness | One-shot reminders only. Recurring needs are served by calendar recurring events or weekly digest |
| **Multi-account Microsoft auth** | Supporting org accounts, multiple personal accounts, or family accounts multiplies OAuth complexity | Single personal Microsoft account. Device code flow. One refresh token stored in DB |
| **Proactive unsolicited task suggestions** | Bot randomly saying "you should do X" based on conversation analysis feels creepy and spammy | Only detect tasks from clear intent statements ("I need to", "don't forget to", "we should book") |
| **Reminder grouping / batching** | "Here are your 5 reminders for today" -- adds scheduling complexity and reduces urgency of individual reminders | Each reminder fires independently at its scheduled time |

---

## Feature Dependencies

```
Phase 1: Universal Calendar Detection
=========================================
Broaden Gemini prompt (non-travel)
    -> Universal date extraction (private + group chats)
        -> Personal calendar concept (lazy creation)
            -> Suggest-then-confirm in private chats (via self-chat)

Phase 2: Quick Reminders
=========================================
Reminder intent detection (new Gemini prompt)
    -> Reminders table + in-memory scheduling
        -> Delivery via WhatsApp DM to USER_JID
            -> Snooze on delivered reminders (reuse parseSnoozeCommand)

Phase 3: Microsoft To Do Sync
=========================================
Microsoft OAuth2 device code flow
    -> Token storage + auto-refresh
        -> To Do task creation via Graph API
            -> Linked resources on created tasks
            -> Weekly digest includes To Do tasks

Cross-cutting: Smart Routing
=========================================
All three destinations operational (calendar, reminder, To Do)
    -> Smart routing decision tree (per-extraction)
        -> Unified suggest-then-confirm (type-aware suggestions)
```

---

## Implementation Details by Feature

### Universal Calendar Detection

**Current state:** `groupMessagePipeline.ts` processes group messages only when `travelBotActive` is set. Date extraction runs via debounced batches. Private chats go through `messageHandler.ts` which only does AI reply generation.

**What changes:**
1. **`messageHandler.ts`** -- after persisting incoming private message and before generating reply, run date extraction on the message body. If dates found, send suggestion to self-chat (USER_JID)
2. **Personal calendar** -- not tied to any group. Store calendar ID in `settings` table (key: `personal_calendar_id`). Lazy-create on first use via `createGroupCalendar("My Events")`
3. **Group expansion** -- date extraction should run for ALL groups, not just `travelBotActive`. Add a new `calendarDetectionActive` flag on groups table, defaulting to true
4. **Gemini prompt** -- broaden from travel-specific to universal. Catch appointments, meetings, dinners, deadlines, social plans. Keep Hebrew + English support

**Suggestion flow in private chats:**
- Bot detects date in private message (from contact or fromMe)
- Sends suggestion to USER_JID: "Add 'Dentist appointment' on Tuesday March 18 at 2:00 PM? Reply ✅ or ❌"
- On ✅, creates event on personal calendar
- On ❌, silently discards

### Quick Reminders

**Expected UX:**
1. User sends "remind me to call mom in 2 hours" (in any chat, or to self)
2. Bot detects reminder intent via Gemini (new prompt, separate from date extraction)
3. Bot suggests: "Set reminder: Call mom at 3:00 PM? ✅ / ❌"
4. User confirms in self-chat
5. Bot stores reminder in DB + starts in-memory timer
6. At trigger time, bot sends to USER_JID: "Reminder: Call mom"
7. User can reply "snooze 30m" to reschedule

**New DB table:**
```sql
reminders (
  id TEXT PRIMARY KEY,          -- UUID
  title TEXT NOT NULL,
  triggerAt INTEGER NOT NULL,   -- Unix ms
  sourceJid TEXT,               -- chat where reminder was detected
  sourceMessageId TEXT,
  suggestionMsgId TEXT,         -- for confirm/reject tracking
  deliveredMsgId TEXT,          -- for snooze tracking
  status TEXT DEFAULT 'pending', -- pending | confirmed | delivered | snoozed | cancelled
  createdAt INTEGER NOT NULL
)
```

**Scheduling strategy:** Follow the `suggestionTracker.ts` pattern exactly:
- `setTimeout` for reminders within 24 hours
- On startup, `restoreReminders()` loads all confirmed-but-undelivered reminders from DB and re-schedules with adjusted remaining time
- For reminders >24h out, just store in DB. A periodic scan (every hour via node-cron) picks up reminders coming due in the next hour and schedules them

### Microsoft To Do Integration

**Auth flow (device code -- verified via official docs):**
1. Register app in Azure AD (Microsoft Entra) with `Tasks.ReadWrite` delegated permission
2. User triggers setup via dashboard button or self-chat command ("setup todo")
3. Bot calls `POST /devicecode` with `scope=Tasks.ReadWrite offline_access`
4. Gets `user_code` + `verification_uri` + `device_code` + `interval`
5. Sends to USER_JID: "Go to https://microsoft.com/devicelogin and enter code XXXXXXXX"
6. Bot polls `POST /token` with `device_code` at specified interval until auth completes or expires
7. Store `access_token`, `refresh_token`, `expires_at` in settings table
8. Auto-refresh before expiry (personal account refresh tokens last ~90 days, must be used before expiry)

**Task creation (verified via Microsoft docs):**
```http
POST /me/todo/lists/{listId}/tasks
Content-Type: application/json

{
  "title": "Buy groceries",
  "body": { "content": "Detected from WhatsApp chat with Mom", "contentType": "text" },
  "importance": "normal",
  "dueDateTime": { "dateTime": "2026-03-20T00:00:00", "timeZone": "Asia/Jerusalem" },
  "linkedResources": [{
    "applicationName": "WhatsApp Bot",
    "displayName": "Chat with Mom",
    "externalId": "msg-abc123"
  }]
}
```

**Permissions confirmed:** `Tasks.ReadWrite` (delegated only). Application permissions are NOT supported for To Do API. This means the bot must always act on behalf of the signed-in user via delegated auth.

**Dedicated task list:** On first setup, create a dedicated list (`POST /me/todo/lists` with summary "WhatsApp Bot Tasks") and store the list ID. Avoids polluting the user's default task list.

### Task Detection

**New Gemini prompt (separate from date extraction):**

```typescript
const TaskExtractionSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().describe('Concise task title, action-oriented'),
    dueDate: z.string().optional().describe('ISO date if a deadline is mentioned'),
    importance: z.enum(['low', 'normal', 'high']),
    confidence: z.enum(['high', 'medium', 'low']),
    context: z.string().optional().describe('Brief context from the message'),
  })),
});
```

**Pre-filter (avoid unnecessary Gemini calls):**
Unlike date extraction (checks for digits), task detection uses intent keyword matching:
- English: "need to", "have to", "should", "must", "don't forget", "remember to", "todo", "task"
- Hebrew: equivalents -- "צריך ל", "חייב ל", "אל תשכח", "לא לשכוח"
- Only messages matching at least one keyword pattern go to Gemini

**Confidence filtering:** Same as date extraction -- only HIGH confidence tasks get suggested. "We should totally go skydiving someday" (LOW confidence) gets filtered out.

### Smart Routing

**Decision tree (post-extraction):**

```
1. Gemini returns date/event extraction result?
   -> Has specific date+time? -> CALENDAR EVENT (existing flow)
   -> Has relative time ("in 2 hours")? -> WHATSAPP REMINDER (new)

2. Gemini returns task extraction result?
   -> Has due date? -> TO DO TASK with dueDateTime
   -> No due date? -> TO DO TASK without dueDateTime
   -> Task is time-critical ("call dentist at 3pm")? -> CALENDAR EVENT + TO DO TASK

3. Ambiguous (both date and task detected)?
   -> Default to CALENDAR EVENT (calendar has native reminders)
   -> Also create TO DO TASK if task confidence is HIGH
```

Routing logic is a pure function: given extraction results, returns `{ type: 'calendar' | 'reminder' | 'todo', data }`. No Gemini call needed -- routing is rule-based on the extraction output structure.

---

## MVP Recommendation

**Phase 1 -- Universal Calendar Detection (foundation):**
1. Broaden `dateExtractor.ts` Gemini prompt for non-travel events
2. Add personal calendar concept (settings-based, lazy creation)
3. Hook date extraction into `messageHandler.ts` for private chats
4. Adapt `suggestionTracker.ts` for private chat suggestions (via self-chat)
5. New `calendarDetectionActive` flag on groups table (default true)

**Phase 2 -- Quick Reminders:**
1. Reminder intent detection (new Gemini prompt + pre-filter)
2. `reminders` DB table + in-memory scheduling (follow suggestionTracker pattern)
3. Delivery via WhatsApp DM to USER_JID
4. Startup recovery (`restoreReminders()`)
5. Snooze on delivered reminders (reuse `parseSnoozeCommand`)

**Phase 3 -- Microsoft To Do Sync:**
1. Azure AD app registration + OAuth2 device code flow
2. Token storage in settings table + auto-refresh logic
3. Task detection (new Gemini prompt + Zod schema + pre-filter)
4. Create tasks via Graph API with linkedResources
5. Dedicated "WhatsApp Bot Tasks" list creation
6. Smart routing between calendar / reminder / To Do

**Defer:**
- **Weekly digest To Do integration** -- nice-to-have, add after core To Do works
- **Context-aware task extraction from trip groups** -- requires deep trip context integration
- **Reminder snooze** -- can ship basic reminders without snooze, add in follow-up

---

## Sources

- [Microsoft To Do API Overview](https://learn.microsoft.com/en-us/graph/todo-concept-overview) -- HIGH confidence (official docs)
- [Create todoTask - Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0) -- HIGH confidence (task fields, permissions, linkedResources, code examples)
- [linkedResource resource type](https://learn.microsoft.com/en-us/graph/api/resources/linkedresource?view=graph-rest-1.0) -- HIGH confidence (official)
- [OAuth 2.0 device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) -- HIGH confidence (official, confirms personal account support)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) -- HIGH confidence (Tasks.ReadWrite is delegated-only, no application permission for To Do)
- [Use the Microsoft To Do API](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0) -- HIGH confidence (API structure, delta query support)
- Existing codebase analysis: `dateExtractor.ts`, `suggestionTracker.ts`, `messageHandler.ts`, `groupMessagePipeline.ts`, `calendarService.ts`, `reminderScheduler.ts`, `config.ts`, `db/schema.ts` -- HIGH confidence (read directly)

---

*Feature research for: WhatsApp Bot v1.5 -- Personal Assistant Features*
*Researched: 2026-03-16*
*Codebase files read: src/groups/dateExtractor.ts, src/groups/suggestionTracker.ts, src/groups/groupMessagePipeline.ts, src/groups/reminderScheduler.ts, src/pipeline/messageHandler.ts, src/calendar/calendarService.ts, src/config.ts, src/db/schema.ts*

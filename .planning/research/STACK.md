# Technology Stack — v1.5 Personal Assistant Features

**Project:** WhatsApp Bot — Universal Calendar Detection, Smart Reminders, Microsoft To Do Sync
**Researched:** 2026-03-16
**Scope:** NEW additions only. Existing validated stack (Baileys v7, Gemini 2.5 Flash, Fastify 5, Drizzle/SQLite, Zod v4, node-cron, googleapis, ElevenLabs, chrono-node) is not re-researched.

---

## Decision Map

| Capability | Decision | Library / Pattern |
|---|---|---|
| Universal calendar detection (all chats) | Extend existing `dateExtractor.ts` + pipeline to private messages | No new library |
| Smart reminders (WhatsApp messages) | Extend existing `node-cron` scheduler + new Drizzle tables | No new library |
| Smart reminders (calendar event proximity) | Poll Google Calendar via existing `googleapis` on cron schedule | No new library |
| Microsoft To Do sync | `@microsoft/microsoft-graph-client` + `@azure/msal-node` | **2 new packages** |
| MSAL token cache persistence | `@azure/msal-node-extensions` (file-based, OS-encrypted) | **1 new package** |
| Microsoft Graph TypeScript types | `@microsoft/microsoft-graph-types` | **1 new package (devDependency)** |
| OAuth2 one-time auth flow | Fastify route for authorization code callback | No new library |

**Net result: 3 new runtime packages + 1 dev dependency.**

---

## Capability Detail

### 1. Universal Calendar Detection (All Chats)

**Decision: Extend existing `dateExtractor.ts` to run on private messages. No new library.**

The project already has a battle-tested date extraction pipeline in `src/groups/dateExtractor.ts` that uses Gemini structured output with Zod v4 schemas. It currently runs only in the group message pipeline (`groupMessagePipeline.ts`). For v1.5, this same `extractDates()` function should be called from the private message handler in `src/pipeline/messageHandler.ts`.

What needs to change (code, not libraries):
- Move `dateExtractor.ts` from `src/groups/` to `src/calendar/` (it has no group-specific logic)
- Call `extractDates()` in the private message pipeline after message storage
- Add a `detectedEvents` table (see Architecture) to store detections from both private and group chats
- Add a confirmation flow: bot sends "I noticed [event] on [date] -- want me to add it to your calendar?" via WhatsApp to the user (self-chat or dashboard notification)

The existing `hasNumberPreFilter()` gate (line 69 of `dateExtractor.ts`) keeps Gemini calls minimal -- only messages containing digits hit the LLM. This is critical for private chats which are higher volume than group chats.

**Confidence:** HIGH -- reusing proven code, no new dependencies.

---

### 2. Smart Reminders

**Decision: Extend existing `node-cron` + new Drizzle tables. No new library.**

The existing `reminderScheduler.ts` handles weekly group digests with `node-cron`. Smart reminders need two new capabilities:

**A. User-defined reminders (from chat messages):**
When a user says "remind me to call the dentist tomorrow at 3pm" in any chat, the bot should:
1. Detect the reminder intent via Gemini (extend the existing structured output pattern)
2. Store in a new `reminders` table with `triggerAt` timestamp
3. Schedule delivery via `node-cron` or a polling pattern

For reminder scheduling, the existing `node-cron` is sufficient. The concern with per-reminder cron jobs is memory at scale, but for a personal bot with maybe 10-50 active reminders, creating individual `ScheduledTask` instances is fine. Alternative: a single cron job running every minute that queries the DB for due reminders -- simpler and more resilient to restarts.

**Recommendation: Use the single-poller pattern.** One cron job every 60 seconds: `SELECT * FROM reminders WHERE trigger_at <= now AND status = 'pending'`. This survives PM2 restarts without re-scheduling individual jobs.

**B. Calendar proximity reminders:**
For calendar events detected from chats, send a WhatsApp reminder N hours before the event. The poller pattern above handles this too -- query `detected_events` where `event_date - reminder_offset <= now AND reminder_sent = false`.

**Confidence:** HIGH -- `node-cron` v4.2.1 already in `package.json`, polling pattern is trivial.

---

### 3. Microsoft To Do Sync

**Decision: Use `@microsoft/microsoft-graph-client` v3.0.7 + `@azure/msal-node` v5.x + `@azure/msal-node-extensions` v5.x.**

This is the only capability requiring new packages. Here is the detailed rationale:

#### Why `@microsoft/microsoft-graph-client` (not `@microsoft/msgraph-sdk`)

| | `@microsoft/microsoft-graph-client` | `@microsoft/msgraph-sdk` |
|---|---|---|
| Version | 3.0.7 (stable GA) | 1.0.0-preview.80 (preview) |
| Status | Production-ready, maintained | Preview -- "not for production apps" per MS docs |
| API surface | Fluent `.api('/me/todo/...').get()` | Fluent but requires installing separate sub-packages per API area |
| Types | Pair with `@microsoft/microsoft-graph-types` | Built-in types |
| Risk | Low -- stable for 2+ years | Breaking changes expected before GA |

For a personal bot where stability matters more than cutting-edge DX, the mature library is the right call. The new SDK can be adopted later when it reaches GA.

#### Authentication: OAuth2 Authorization Code Flow (Delegated Permissions)

**Critical constraint: Microsoft To Do API only supports delegated permissions.** Application-only permissions (client credentials flow) do NOT work for To Do tasks. This means:

1. The bot owner must perform a one-time OAuth2 authorization code flow (browser login)
2. MSAL stores the refresh token and handles silent token renewal
3. The refresh token is long-lived (~90 days), and MSAL auto-refreshes access tokens

**Implementation pattern:**

```
One-time setup:
  1. User clicks "Connect Microsoft To Do" in dashboard
  2. Dashboard redirects to Microsoft login (authorization code flow)
  3. Microsoft redirects back to Fastify callback route with auth code
  4. Fastify exchanges code for tokens via MSAL
  5. MSAL caches tokens to disk via msal-node-extensions

Ongoing operation:
  - Bot calls acquireTokenSilent() before each Graph API call
  - MSAL handles refresh transparently
  - If refresh token expires (90d no use), dashboard shows "Re-connect" prompt
```

#### Token Cache Persistence

**Decision: Use `@azure/msal-node-extensions` with file persistence on Linux.**

MSAL's in-memory cache is lost on PM2 restart. `msal-node-extensions` provides:
- **Linux:** LibSecret-based encrypted storage (preferred)
- **Fallback:** Unencrypted file persistence (acceptable for a single-user home server)

Since this is a personal bot on a home server (not multi-tenant), the file persistence with appropriate file permissions (chmod 600) is acceptable. LibSecret adds a dependency on `gnome-keyring` or `kwallet` which may not be installed.

**Recommendation: Use file persistence with `0600` permissions.** Simpler, no desktop environment dependency. The token cache file contains refresh tokens but the server is single-user.

```typescript
import { PublicClientApplication } from '@azure/msal-node';
import {
  FilePersistence,
  PersistenceCachePlugin,
} from '@azure/msal-node-extensions';

const persistence = await FilePersistence.create(
  '/home/yuval/whatsapp-bot/.data/msal-cache.json', // outside git
  600, // file mode
);

const pca = new PublicClientApplication({
  auth: {
    clientId: config.MS_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/consumers', // personal MS accounts
  },
  cache: {
    cachePlugin: new PersistenceCachePlugin(persistence),
  },
});
```

**Note:** For personal Microsoft accounts (not work/school), the authority MUST be `https://login.microsoftonline.com/consumers`. Using `common` or a tenant ID will fail for personal accounts.

#### Graph API Scopes for To Do

Required scopes:
- `Tasks.ReadWrite` -- create/read/update/delete tasks and task lists
- `offline_access` -- receive refresh token for long-lived access
- `User.Read` -- basic profile (needed for initial sign-in)

```typescript
const SCOPES = ['Tasks.ReadWrite', 'offline_access', 'User.Read'];
```

#### To Do API Endpoints Used

| Operation | Endpoint | Method |
|---|---|---|
| List task lists | `/me/todo/lists` | GET |
| Create task | `/me/todo/lists/{listId}/tasks` | POST |
| Update task | `/me/todo/lists/{listId}/tasks/{taskId}` | PATCH |
| Complete task | PATCH with `status: 'completed'` | PATCH |
| List tasks | `/me/todo/lists/{listId}/tasks` | GET |

**Confidence:** HIGH -- Graph API To Do endpoints are stable v1.0 (not beta). Auth flow well-documented.

---

### 4. Detected Events Storage and Reminder Schema

**Decision: Add Drizzle tables. No new library.**

New tables needed:

```typescript
// Detected events from ALL chats (private + group)
export const detectedEvents = sqliteTable('detected_events', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(), // 'private' | 'group'
  sourceJid: text('source_jid').notNull(),   // contact JID or group JID
  messageId: text('message_id').notNull(),
  title: text('title').notNull(),
  eventDate: integer('event_date').notNull(), // Unix ms
  location: text('location'),
  description: text('description'),
  status: text('status').notNull().default('detected'), // 'detected' | 'confirmed' | 'dismissed' | 'synced'
  calendarEventId: text('calendar_event_id'), // Google Calendar event ID if synced
  todoTaskId: text('todo_task_id'),           // Microsoft To Do task ID if synced
  reminderSent: integer('reminder_sent', { mode: 'boolean' }).default(false),
  reminderOffsetMs: integer('reminder_offset_ms').default(3600000), // 1 hour default
  createdAt: integer('created_at').$defaultFn(() => Date.now()),
});

// User-defined reminders (from "remind me..." messages)
export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  sourceJid: text('source_jid').notNull(),
  messageId: text('message_id'),
  body: text('body').notNull(),           // "Call the dentist"
  triggerAt: integer('trigger_at').notNull(), // Unix ms
  status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'cancelled'
  syncedToTodo: integer('synced_to_todo', { mode: 'boolean' }).default(false),
  todoTaskId: text('todo_task_id'),
  createdAt: integer('created_at').$defaultFn(() => Date.now()),
});

// Microsoft auth tokens (single row for bot owner)
export const microsoftAuth = sqliteTable('microsoft_auth', {
  id: text('id').primaryKey().default('owner'),
  accountId: text('account_id'),        // MSAL home account ID
  displayName: text('display_name'),
  connectedAt: integer('connected_at'),
  lastRefreshedAt: integer('last_refreshed_at'),
});
```

**Note:** MSAL handles the actual token storage via `msal-node-extensions`. The `microsoftAuth` table only stores metadata (account ID, display name) for the dashboard to show connection status. Tokens are NOT stored in SQLite.

**Confidence:** HIGH -- standard Drizzle pattern, consistent with existing schema.

---

## Recommended Stack

### New Runtime Dependencies

| Technology | Version | Purpose | Why |
|---|---|---|---|
| `@microsoft/microsoft-graph-client` | ^3.0.7 | Microsoft Graph API client for To Do sync | Stable GA; fluent API; only option for production (new SDK is preview) |
| `@azure/msal-node` | ^5.0.6 | OAuth2 auth for Microsoft Graph | Official MS auth library; handles token refresh automatically |
| `@azure/msal-node-extensions` | ^5.0.3 | Persist MSAL token cache to disk | Survives PM2 restarts; file persistence with 0600 perms for home server |

### New Dev Dependencies

| Technology | Version | Purpose | Why |
|---|---|---|---|
| `@microsoft/microsoft-graph-types` | ^2.40.0 | TypeScript types for Graph API responses | Type safety for To Do task objects; zero runtime cost |

### Existing Stack (Extended, Not Replaced)

| Technology | Current Version | Extension for v1.5 |
|---|---|---|
| `node-cron` | ^4.2.1 | Add 1-minute poller job for reminders |
| `drizzle-orm` | ^0.45.1 | New tables: `detected_events`, `reminders`, `microsoft_auth` |
| `@google/genai` | ^1.42.0 | Reminder intent detection schema (same `generateJson` pattern) |
| `zod` | ^4.3.6 | New schemas for reminder intent, To Do task mapping |
| `googleapis` | ^171.4.0 | Calendar event polling for proximity reminders |
| `fastify` | ^5.7.4 | OAuth2 callback route for Microsoft auth |
| `chrono-node` | ^2.9.0 | Fallback date parsing for reminder extraction |

---

## Installation

```bash
# New runtime dependencies
npm install @microsoft/microsoft-graph-client @azure/msal-node @azure/msal-node-extensions

# New dev dependency
npm install -D @microsoft/microsoft-graph-types
```

---

## What NOT to Add

| Do Not Add | Why | Alternative |
|---|---|---|
| `@microsoft/msgraph-sdk` | Preview (1.0.0-preview.80); breaking changes expected; requires installing sub-packages per API area | `@microsoft/microsoft-graph-client` v3.0.7 (stable GA) |
| `@microsoft/msgraph-sdk-tasks` | Preview sub-package of the above | Direct `.api('/me/todo/...')` calls on stable client |
| `node-ical` / `ical.js` | No iCal files to parse; events are detected from chat text via Gemini | Existing `dateExtractor.ts` with Gemini structured output |
| `croner` / `toad-scheduler` | Marginal improvement over `node-cron` which is already in the project; switching adds churn for no benefit | `node-cron` v4.2.1 (already installed) |
| `bull` / `bullmq` | Requires Redis; overkill for a personal bot with <50 reminders | 1-minute `node-cron` poller querying SQLite |
| `agenda` / `bree` | Heavyweight job schedulers; unnecessary for simple time-based polling | `node-cron` poller |
| `@azure/identity` | For Azure-hosted apps; `@azure/msal-node` is the right choice for self-hosted Node.js | `@azure/msal-node` |
| Separate token encryption library | Home server, single user; file permissions (0600) are sufficient | `msal-node-extensions` file persistence |
| `passport-microsoft` / `passport-azure-ad` | Passport is for multi-user web apps with sessions; bot has one owner | Direct MSAL `acquireTokenByCode` flow |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Graph SDK | `@microsoft/microsoft-graph-client` v3.0.7 | `@microsoft/msgraph-sdk` v1.0.0-preview.80 | Preview; not production-ready; MS docs say "not for production" |
| MS auth | `@azure/msal-node` v5.x | Raw OAuth2 fetch calls | MSAL handles token refresh, cache serialization, retry; reimplementing is error-prone |
| Token persistence | `@azure/msal-node-extensions` (file) | Custom SQLite cache plugin | File persistence is officially supported; less code; separation of concerns (tokens outside DB) |
| Token persistence | File with 0600 perms | LibSecret (Linux keyring) | LibSecret requires `gnome-keyring` daemon; home server may not have desktop environment |
| Reminder scheduling | 1-min `node-cron` poller | Per-reminder `ScheduledTask` | Poller survives restarts without re-hydration; simpler; single job vs N jobs |
| Date detection | Gemini structured output (existing) | `node-ical` + calendar feed parsing | Bot detects events from chat text, not from iCal feeds; Gemini already does this |
| Date detection | Gemini structured output (existing) | `chrono-node` as primary parser | `chrono-node` doesn't support Hebrew; already rejected in existing code (see line 66 comment in `dateExtractor.ts`) |

---

## Integration Points

### How the 3 Features Connect

```
Private Message → dateExtractor.extractDates()
                     ↓
              detectedEvents table
                     ↓
         ┌──────────┼──────────────┐
         ↓          ↓              ↓
   Google Calendar  Reminder     To Do
   (googleapis)     Poller       Sync
                   (node-cron)  (Graph API)
```

1. **Calendar detection** feeds the `detectedEvents` table (shared data store)
2. **Smart reminders** read from `detectedEvents` + `reminders` tables via the 1-minute poller
3. **To Do sync** is triggered when a detected event or reminder is confirmed, pushing to Microsoft To Do via Graph API

### OAuth2 Flow Integration with Existing Fastify

```
Dashboard (React) → GET /api/microsoft/auth-url → Redirect to MS login
MS login callback → GET /api/microsoft/callback → Exchange code → Store tokens
Dashboard polls  → GET /api/microsoft/status → { connected: true, displayName: "..." }
```

The Fastify routes follow the existing JWT-protected pattern in `src/api/routes/`.

---

## Environment Variables (New)

```bash
# Microsoft Graph / To Do integration
MS_CLIENT_ID=           # Azure App Registration client ID
MS_CLIENT_SECRET=       # Azure App Registration client secret (for confidential client)
MS_REDIRECT_URI=        # e.g. http://localhost:3000/api/microsoft/callback
MS_TODO_LIST_NAME=      # Default list name to sync to (e.g. "WhatsApp Bot")
```

**Azure App Registration setup:**
1. Go to https://portal.azure.com > App registrations > New registration
2. Supported account types: "Personal Microsoft accounts only" (for personal To Do)
3. Redirect URI: Web > `http://localhost:3000/api/microsoft/callback`
4. API permissions: Add `Tasks.ReadWrite` (delegated) + `User.Read` (delegated)
5. Certificates & secrets: Create a client secret

---

## Version Reference

| Item | Version / Status | Notes |
|---|---|---|
| `@microsoft/microsoft-graph-client` | 3.0.7 (GA, stable) | Last published ~2024; mature and maintained |
| `@azure/msal-node` | 5.0.6 (GA) | Published 2026-03-07; actively maintained |
| `@azure/msal-node-extensions` | 5.0.3 (GA) | Published 2026-03-04; actively maintained |
| `@microsoft/microsoft-graph-types` | ~2.40.0 (types only) | Dev dependency; check npm for latest |
| Microsoft To Do API | v1.0 (GA) | Stable; delegated permissions only |
| `node-cron` | 4.2.1 (already installed) | No change needed |
| `drizzle-orm` | 0.45.1 (already installed) | Schema extension only |

---

## Sources

- [@microsoft/microsoft-graph-client npm](https://www.npmjs.com/package/@microsoft/microsoft-graph-client) -- v3.0.7, stable GA -- HIGH confidence
- [@microsoft/msgraph-sdk npm](https://www.npmjs.com/package/@microsoft/msgraph-sdk) -- v1.0.0-preview.80, NOT production-ready -- HIGH confidence
- [Microsoft Graph SDK overview (MS Learn)](https://learn.microsoft.com/en-us/graph/sdks/sdks-overview) -- recommends stable client for production -- HIGH confidence
- [@azure/msal-node npm](https://www.npmjs.com/package/@azure/msal-node) -- v5.0.6 -- HIGH confidence
- [@azure/msal-node-extensions npm](https://www.npmjs.com/package/@azure/msal-node-extensions) -- v5.0.3, file persistence docs -- HIGH confidence
- [MSAL Node token caching (MS Learn)](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) -- cache plugin pattern -- HIGH confidence
- [Microsoft To Do API overview (MS Learn)](https://learn.microsoft.com/en-us/graph/todo-concept-overview) -- API surface, capabilities -- HIGH confidence
- [To Do API resource reference (MS Learn)](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0) -- endpoints, delegated-only -- HIGH confidence
- [Tasks.ReadWrite permission details](https://graphpermissions.merill.net/permission/Tasks.ReadWrite) -- delegated only, no application permissions for To Do -- HIGH confidence
- [Graph API delegated auth flow (MS Learn)](https://learn.microsoft.com/en-us/graph/auth-v2-user) -- authorization code flow, refresh tokens -- HIGH confidence
- [OAuth2 auth code flow (MS Learn)](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) -- code exchange, token refresh -- HIGH confidence
- [Node.js schedulers comparison (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) -- node-cron vs croner vs toad-scheduler -- MEDIUM confidence
- [Gemini structured output docs](https://ai.google.dev/gemini-api/docs/structured-output) -- JSON schema response pattern -- HIGH confidence
- Existing codebase: `src/groups/dateExtractor.ts`, `src/groups/reminderScheduler.ts`, `src/calendar/calendarService.ts` -- reviewed directly

---
*Stack research for: WhatsApp Bot v1.5 -- Personal Assistant Features*
*Researched: 2026-03-16*

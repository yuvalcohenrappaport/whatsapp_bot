# Architecture Research

**Domain:** WhatsApp AI Impersonation Bot
**Researched:** 2026-02-22
**Confidence:** MEDIUM (core patterns are well-established; some component boundaries are design decisions with no single canonical answer)

---

## Standard Architecture

### System Overview (ASCII Diagram)

```
  ┌──────────────────────────────────────────────────────────────┐
  │                        yuval-server                          │
  │                                                              │
  │  ┌─────────────────────────────────────────────────────────┐ │
  │  │                    Bot Process (PM2)                     │ │
  │  │                                                          │ │
  │  │  ┌──────────────┐    ┌──────────────┐                   │ │
  │  │  │  WhatsApp    │    │   Message    │                   │ │
  │  │  │  Client      │───▶│   Router     │                   │ │
  │  │  │  (wwebjs)    │    │              │                   │ │
  │  │  └──────────────┘    └──────┬───────┘                   │ │
  │  │       ▲ ▼                   │                           │ │
  │  │   WA Web                    ▼                           │ │
  │  │  Protocol           ┌──────────────┐                   │ │
  │  │                     │  AI Service  │                   │ │
  │  │                     │  (Gemini)    │                   │ │
  │  │                     └──────┬───────┘                   │ │
  │  │                            │                           │ │
  │  │                            ▼                           │ │
  │  │                   ┌──────────────┐                     │ │
  │  │                   │  Draft Queue │                     │ │
  │  │                   │  (auto/      │                     │ │
  │  │                   │  pending)    │                     │ │
  │  │                   └──────┬───────┘                     │ │
  │  │                          │                             │ │
  │  └──────────────────────────┼─────────────────────────────┘ │
  │                             │                               │
  │  ┌──────────────────────────▼─────────────────────────────┐ │
  │  │                 SQLite Database                         │ │
  │  │   messages | contacts | drafts | sessions | config      │ │
  │  └─────────────────────────────────────────────────────────┘ │
  │                             │                               │
  │  ┌──────────────────────────▼─────────────────────────────┐ │
  │  │              API Server (Express + Socket.io)           │ │
  │  │                                                         │ │
  │  │   REST endpoints: /contacts /messages /drafts /config   │ │
  │  │   WebSocket: real-time push to dashboard                │ │
  │  └──────────────────────────┬──────────────────────────────┘ │
  │                             │ HTTP + WS                     │
  └─────────────────────────────┼──────────────────────────────┘
                                │ (Tailscale network)
                     ┌──────────▼──────────┐
                     │  Web Dashboard      │
                     │  (React SPA)        │
                     │  served by Express  │
                     └─────────────────────┘
                              ▲
                         User (macOS)

  External:
  ┌─────────────────────┐
  │  Gemini API         │
  │  (Google Cloud)     │
  └─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Technology | Communicates With |
|-----------|---------------|------------|------------------|
| WhatsApp Client | Maintain WA Web session; emit incoming message events; send outgoing messages | whatsapp-web.js + Puppeteer | Message Router (events), WA servers (WebSocket) |
| Message Router | Filter messages by contact allowlist; decide auto-reply vs. draft mode; orchestrate the pipeline | Node.js event handler | WhatsApp Client, AI Service, Draft Queue, DB |
| AI Service | Build prompts from system persona + contact style + history; call Gemini API; return generated text | @google/genai SDK | Message Router, DB (read history), Gemini API |
| Draft Queue | Hold pending replies in "suggest" mode; emit events when approved or timed out | In-DB queue (SQLite table) | Message Router, API Server |
| SQLite Database | Single-file persistence for all data; no network, no separate process | better-sqlite3 | All server-side components |
| API Server | Expose REST + WebSocket endpoints; serve static React build; handle dashboard actions | Express + Socket.io | Dashboard, DB, Draft Queue, WhatsApp Client |
| Web Dashboard | UI for contact management, conversation view, draft approval, config | React (Vite) | API Server (HTTP + WS) |
| Process Manager | Keep bot process alive across crashes and reboots | PM2 | OS systemd |

---

## Recommended Project Structure

```
whatsapp-bot/
├── src/
│   ├── whatsapp/
│   │   ├── client.ts          # whatsapp-web.js init, QR, session
│   │   ├── session.ts         # LocalAuth config, reconnect logic
│   │   └── sender.ts          # Outgoing message wrapper
│   │
│   ├── router/
│   │   └── messageRouter.ts   # Allowlist filter, mode dispatch
│   │
│   ├── ai/
│   │   ├── gemini.ts          # Gemini API client wrapper
│   │   ├── promptBuilder.ts   # System prompt + history assembly
│   │   └── personaLoader.ts   # Load per-contact style instructions
│   │
│   ├── db/
│   │   ├── database.ts        # better-sqlite3 init, migrations
│   │   ├── messages.ts        # Message CRUD
│   │   ├── contacts.ts        # Contact config CRUD
│   │   └── drafts.ts          # Draft lifecycle (create, approve, reject)
│   │
│   ├── api/
│   │   ├── server.ts          # Express + Socket.io setup
│   │   ├── routes/
│   │   │   ├── contacts.ts
│   │   │   ├── messages.ts
│   │   │   ├── drafts.ts
│   │   │   └── config.ts
│   │   └── ws/
│   │       └── events.ts      # Socket.io event definitions
│   │
│   └── index.ts               # Entry point: init all components
│
├── dashboard/                 # React SPA (Vite project)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Contacts.tsx
│   │   │   ├── Conversation.tsx
│   │   │   └── Drafts.tsx
│   │   └── lib/
│   │       └── socket.ts      # Socket.io client
│   └── vite.config.ts
│
├── data/
│   ├── bot.db                 # SQLite database file
│   └── wwa-session/           # WhatsApp LocalAuth session files
│
├── imports/                   # Staging area for .txt chat exports
│
├── ecosystem.config.js        # PM2 config
└── .env                       # GEMINI_API_KEY, PORT, etc.
```

---

## Architectural Patterns

### Pattern 1: Event-Driven Message Pipeline

The WhatsApp client emits a `message` event for every incoming message. The router subscribes to this event and dispatches through the pipeline synchronously within an async handler. This avoids a separate message queue process (like BullMQ) for a single-account personal bot. Queue overhead is unjustified here; a plain async pipeline handles volume well.

```typescript
// src/router/messageRouter.ts
client.on('message', async (msg) => {
  const contact = await getContactConfig(msg.from);
  if (!contact?.enabled) return;          // allowlist gate

  await db.messages.save(msg);            // persist immediately

  const reply = await ai.generateReply(msg, contact);

  if (contact.mode === 'auto') {
    await sender.send(msg.from, reply);
    await db.drafts.markSent(reply);
  } else {
    await db.drafts.savePending(msg.from, reply);
    io.emit('draft:new', { contactId: msg.from, draft: reply });
  }
});
```

### Pattern 2: Prompt-as-Database-Record

Each contact's AI behavior is driven by a structured config stored in the database, not hardcoded. The prompt builder assembles the system prompt dynamically at inference time.

```typescript
// src/ai/promptBuilder.ts
function buildSystemPrompt(contact: ContactConfig, history: Message[]): string {
  return [
    `You are impersonating Yuval in a WhatsApp conversation with ${contact.name}.`,
    `Communication style instructions: ${contact.styleInstructions}`,
    `General persona notes: ${GLOBAL_PERSONA}`,
    `Recent conversation history (for reference only, do not repeat):`,
    history.map(m => `${m.fromMe ? 'Yuval' : contact.name}: ${m.body}`).join('\n'),
    `Reply as Yuval would. Be concise. Match his tone exactly.`,
  ].join('\n\n');
}
```

### Pattern 3: Dual-Mode Draft Lifecycle

Every generated reply goes through a draft lifecycle. In auto mode the draft is immediately sent and marked `sent`. In suggest mode it sits as `pending` until approved or rejected via the dashboard.

```
draft states: pending → approved → sent
                      → rejected → (discarded)
              auto → sent (skips pending)
```

### Pattern 4: Gemini Multi-Turn Chat Session Per Contact

Rather than assembling a full history string each time, use Gemini's `startChat()` with a `history` array populated from the database. This leverages Gemini's native multi-turn format and is more efficient than injecting history into the system prompt.

```typescript
const chat = geminiModel.startChat({
  history: dbHistory.map(m => ({
    role: m.fromMe ? 'model' : 'user',
    parts: [{ text: m.body }],
  })),
  systemInstruction: buildSystemPrompt(contact),
});
const result = await chat.sendMessage(incomingMessage);
```

Note: Gemini 1.5 Flash context window is ~1M tokens (HIGH confidence — Google docs). Truncate history to the last N messages (e.g., 100) to control latency and cost, not because of token limits.

### Pattern 5: API Server Co-Located in Bot Process

For a single-user personal tool, the API server and bot process share the same Node.js process. This simplifies deployment and IPC — the router can emit Socket.io events directly, without HTTP or queue overhead between services. Separate the concerns via modules, not processes.

---

## Data Flow

### Incoming Message → Auto Reply

```
WhatsApp servers
  → [WebSocket, WA Web protocol]
  → wwebjs Client.on('message')
  → messageRouter: allowlist check
  → db.messages.save()
  → ai.generateReply()
      → db.messages.getHistory(contactId, limit=100)
      → promptBuilder.buildSystemPrompt(contact, history)
      → gemini.startChat(history).sendMessage(body)
      → returns: replyText
  → sender.send(contactId, replyText)
  → db.drafts.markSent(replyText)
  → io.emit('message:sent', { contactId, replyText })
  → [WebSocket to dashboard]
  → Dashboard updates conversation view
```

### Incoming Message → Draft Approval Flow

```
WhatsApp servers
  → wwebjs Client.on('message')
  → messageRouter: mode === 'suggest'
  → db.messages.save()
  → ai.generateReply()  [same as above]
  → db.drafts.savePending(contactId, replyText)
  → io.emit('draft:new', { contactId, draft })
  → Dashboard: notification badge, draft appears in Drafts page
  → User clicks "Approve"
  → Dashboard: POST /api/drafts/:id/approve
  → API: db.drafts.markApproved(), sender.send()
  → WhatsApp servers receive message
  → io.emit('draft:sent', { draftId })
  → Dashboard updates
```

### Chat History Import

```
User uploads .txt (WhatsApp export)
  → POST /api/import
  → parser: extract messages, timestamps, sender names
  → db.messages.bulkInsert(contactId, messages)
  → These become history context for future AI calls
```

### Dashboard State Sync

```
Dashboard loads
  → GET /api/contacts   (initial state)
  → GET /api/messages/:contactId   (conversation)
  → Socket.io connects
  → Server: pushes events on new messages, drafts, status changes
  → Dashboard: React state updated in real-time
```

---

## Database Schema

Single SQLite file. Use better-sqlite3 (synchronous API, better for single-process Node apps than node-sqlite3).

```sql
-- Contacts the bot monitors
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,          -- WA JID: "972501234567@c.us"
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,    -- 0 = paused
  mode TEXT DEFAULT 'suggest',  -- 'auto' | 'suggest'
  style_instructions TEXT,      -- per-contact prompt additions
  created_at INTEGER
);

-- All messages (sent and received), including imported history
CREATE TABLE messages (
  id TEXT PRIMARY KEY,          -- WA message ID or generated UUID for imports
  contact_id TEXT NOT NULL,
  from_me INTEGER NOT NULL,     -- 1 = user sent, 0 = contact sent
  body TEXT NOT NULL,
  timestamp INTEGER NOT NULL,   -- Unix ms
  imported INTEGER DEFAULT 0,   -- 1 = from .txt import
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
CREATE INDEX idx_messages_contact_ts ON messages(contact_id, timestamp);

-- Pending and sent AI-generated drafts
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  in_reply_to_message_id TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'sent' | 'rejected'
  created_at INTEGER,
  actioned_at INTEGER,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- WhatsApp session metadata (used alongside LocalAuth file store)
CREATE TABLE sessions (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Global bot configuration
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Keys: global_persona, gemini_model, history_limit, etc.
```

---

## Anti-Patterns

### Anti-Pattern 1: External Message Queue for Single Bot

**What it looks like:** Adding Redis + BullMQ to serialize message processing.

**Why it's wrong here:** This is a single-account personal bot. WA Web delivers one message at a time per connection. Async/await within a single Node.js process is sufficient. Adding BullMQ introduces Redis as a dependency, complicates deployment on yuval-server, and adds latency. Use it only if you expand to multi-account.

**Instead:** Plain async event handler with proper error handling and a simple in-process semaphore per contact if ordering matters.

---

### Anti-Pattern 2: Separate Microservices (Bot + API + AI)

**What it looks like:** Running the WhatsApp bot, the API server, and an AI inference service as separate processes communicating via HTTP or queues.

**Why it's wrong here:** Single-user personal tool on one server. The overhead of inter-process communication adds latency and deployment complexity with no benefit. Socket.io events, DB writes, and function calls within one process are faster and simpler.

**Instead:** Single PM2-managed Node.js process that owns all concerns. Separate by module, not by process.

---

### Anti-Pattern 3: Full Chat History in Every Prompt

**What it looks like:** Injecting all 5,000 messages from a chat as raw text into the system prompt.

**Why it's wrong here:** Latency increases linearly with context. 5,000 messages would cost significant tokens on each call even though 95% of old history is irrelevant to the current reply.

**Instead:** Use the last 100 messages (configurable) as conversational context via Gemini's `history` array. Separately, feed a "style reference" of the user's most characteristic messages as a static few-shot block in the system prompt. These are two different things: style learning (static, from imports) vs. conversational context (dynamic, recent).

---

### Anti-Pattern 4: Polling the Dashboard for Updates

**What it looks like:** Dashboard calls `GET /api/drafts` every 3 seconds to check for new pending replies.

**Why it's wrong here:** Polling adds unnecessary load, introduces latency, and is simply unnecessary since Socket.io is already in the stack for real-time updates.

**Instead:** Server pushes `draft:new` events over Socket.io. Dashboard reacts immediately.

---

### Anti-Pattern 5: Storing Session Credentials Only in Memory

**What it looks like:** Starting whatsapp-web.js without an `authStrategy`, so the QR code must be scanned on every bot restart.

**Why it's wrong here:** PM2 will restart the process on crashes. Server reboots happen. Without persistent auth, the bot goes offline until you manually scan a QR code.

**Instead:** Use `LocalAuth` strategy, which stores the Chromium user profile directory on disk. Back up `data/wwa-session/` to survive accidental deletion. Expose a `/api/status` endpoint that surfaces auth state to the dashboard, and serve the QR code image through the dashboard so re-auth can happen remotely via Tailscale.

---

### Anti-Pattern 6: Sending AI Replies Without Deduplication

**What it looks like:** A message is processed twice (e.g., due to reconnect), and the contact receives two identical replies.

**Why it's wrong here:** WA Web can re-deliver messages after reconnection. Double-replies are jarring and break the illusion of a real person.

**Instead:** Store the WA message ID in the database before processing. Check existence before generating a reply — if message ID already exists, skip.

---

## Integration Points

### WhatsApp Web (via whatsapp-web.js)

- **Protocol:** WebSocket to WhatsApp servers via Puppeteer-controlled Chromium
- **Authentication:** QR code scan once; LocalAuth persists session to disk
- **Key events:** `qr`, `ready`, `authenticated`, `auth_failure`, `disconnected`, `message`
- **Resource usage:** Chromium process consumes ~300-600 MB RAM. Acceptable on a dedicated server. Known memory leak issues exist in some versions — pin whatsapp-web.js version and test stability.
- **Reconnect:** Handle `disconnected` event; call `client.initialize()` again after delay. Exponential backoff recommended.

### Gemini API

- **SDK:** `@google/genai` (official Google package, HIGH confidence)
- **Model choice:** `gemini-1.5-flash` for fast responses at lower cost; `gemini-1.5-pro` for higher quality if replies feel generic. Flash is the right default.
- **Auth:** `GEMINI_API_KEY` env var
- **Rate limits:** Free tier is 15 RPM / 1M TPM for Flash (verify current limits at time of build — these change frequently)
- **Error handling:** Wrap Gemini calls with retry logic (exponential backoff for 429/503)

### Web Dashboard (React SPA)

- **Served by:** Express static middleware from `dashboard/dist/` after Vite build
- **API base:** Same origin as the bot API server (no CORS config needed)
- **Real-time:** Socket.io client connects to same origin
- **Access:** Via Tailscale IP + port, or set up a local domain via `/etc/hosts` on macOS

### PM2 Process Manager

- **Config file:** `ecosystem.config.js` at project root
- **Startup:** `pm2 startup systemd` then `pm2 save` to survive reboots
- **Log rotation:** `pm2 install pm2-logrotate`
- **Monitoring:** `pm2 monit` from terminal; optionally expose PM2 metrics via API endpoint

---

## Suggested Build Order (Dependencies)

Phase order implied by component dependencies:

1. **Database schema + migrations** — everything depends on this; build first, no external dependencies
2. **WhatsApp client layer** — foundational; all message processing depends on it; validate WA connection works before building on top
3. **Message persistence** — need WA client running to test; need DB schema done
4. **AI service (Gemini integration)** — depends on: DB (for history), Gemini API key; can be developed in isolation with mock history
5. **Message router + draft queue** — ties WA client, AI service, and DB together; the central coordination logic
6. **API server (REST endpoints)** — depends on DB; can be built in parallel with router once DB is stable
7. **Web dashboard** — depends on API server being stable; built last because it has no unique backend dependencies, only consumes existing APIs
8. **Process management (PM2)** — configured last, wraps the complete working system

The AI service and API server can be developed in parallel after the DB layer is stable. The dashboard is always last since it only consumes APIs.

---

## Sources

- [whatsapp-web.js Authentication Strategies](https://wwebjs.dev/guide/creating-your-bot/authentication) — LocalAuth and RemoteAuth documentation
- [Baileys Architecture Overview (DeepWiki)](https://deepwiki.com/WhiskeySockets/Baileys/1-overview) — Layered WebSocket architecture (Baileys)
- [Baileys 2025 REST API Pattern](https://github.com/PointerSoftware/Baileys-2025-Rest-API) — Production REST wrapper reference
- [WhatsApp Monitoring Dashboard (wa-bot)](https://github.com/agussuwerdo/wa-bot) — Real-world Node.js + whatsapp-web.js + Socket.io dashboard reference
- [Gemini Chat History Management](https://firebase.google.com/docs/ai-logic/chat) — startChat() / history array pattern (HIGH confidence — Google official docs)
- [Google Gemini Node.js SDK (@google/genai)](https://www.npmjs.com/package/@google/genai) — Official npm package
- [Gemini Context Window 2025](https://www.datastudios.org/post/google-gemini-context-window-token-limits-and-memory-in-2025) — Token limits reference (MEDIUM confidence — third-party, verify at build time)
- [PM2 Quick Start](https://pm2.keymetrics.io/docs/usage/quick-start/) — Process management for Node.js (HIGH confidence — official docs)
- [PM2 Production on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-use-pm2-to-setup-a-node-js-production-environment-on-an-ubuntu-vps) — Startup + systemd integration
- [Real-Time Dashboard with Socket.io](https://oneuptime.com/blog/post/2026-01-26-socketio-realtime-dashboards/view) — Socket.io dashboard pattern reference
- [Puppeteer Memory Issues in whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js/issues/5817) — Known production issue, pin versions
- [Session Persistence Issues](https://github.com/pedroslopez/whatsapp-web.js/issues/3224) — Disconnect after 2-3 days — known issue, implement reconnect handler
- [LLM Persona System Prompts](https://brimlabs.ai/blog/llm-personas-how-system-prompts-influence-style-tone-and-intent/) — Style/tone/intent framework for persona prompts
- [AI WhatsApp Bot (GeeksforGeeks)](https://www.geeksforgeeks.org/node-js/ai-whatsapp-bot-using-nodejs-whatsapp-webjs-and-gemini-ai/) — whatsapp-web.js + Gemini integration reference

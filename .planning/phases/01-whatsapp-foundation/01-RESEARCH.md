# Phase 1: WhatsApp Foundation - Research

**Researched:** 2026-02-22
**Domain:** Baileys v7 WebSocket connection, TypeScript ESM, Drizzle + SQLite, PM2 process management
**Confidence:** MEDIUM-HIGH — Baileys is community-maintained on an unofficial API (inherent instability); the TypeScript/Drizzle/PM2 layers are HIGH confidence.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WA-01 | Bot connects to WhatsApp via Baileys WebSocket API | makeWASocket pattern documented; connection.update event handling verified |
| WA-02 | User can authenticate by scanning QR code | QR flow via printQRInTerminal or serving QR string to frontend; documented in Baileys wiki |
| WA-03 | Session persists across process restarts (no re-scan needed) | useMultiFileAuthState for file-based persistence; saveCreds on creds.update event |
| WA-04 | Bot receives incoming text messages in real-time | messages.upsert event with type="notify" filter; key.fromMe check documented |
| WA-05 | Bot sends text replies through WhatsApp on behalf of the user | sock.sendMessage(jid, { text }) documented |
| WA-06 | Bot automatically reconnects after network interruption | connection.update with DisconnectReason enum; reconnect-on-close pattern documented |
| WA-07 | Bot simulates typing delay before sending replies (anti-ban) | sock.sendPresenceUpdate('composing', jid) + randomized delay before sendMessage |
| OPS-01 | Bot runs as a persistent PM2-managed service on Ubuntu server | PM2 ecosystem.config.cjs pattern; interpreter_args '--import tsx' for TypeScript ESM |
| OPS-02 | Bot session data persists across server reboots | useMultiFileAuthState writes to disk; PM2 startup + save; session dir backed by filesystem |
| OPS-04 | Bot deduplicates messages to prevent double-replies | SQLite INSERT OR IGNORE on message key.id; check before processing |
</phase_requirements>

---

## Summary

Phase 1 builds the foundation layer: a Baileys v7 WebSocket connection to WhatsApp, a TypeScript ESM project scaffold, SQLite persistence via Drizzle ORM, and PM2 process management for 24/7 operation. This phase has no upstream dependencies — everything else in the project builds on top of it.

The most important constraint is that Baileys is an unofficial library reverse-engineering WhatsApp's Web protocol. This means the connection layer has inherent fragility: Meta protocol updates can silently break it, and account bans are a real risk if message sending patterns are not carefully human-like. Both risks must be designed against from day one, not patched in later.

The standard pattern is: `makeWASocket` with persistent `useMultiFileAuthState`, `connection.update` handler with `DisconnectReason`-aware reconnect logic (with exponential backoff), and `messages.upsert` handler filtering to `type === 'notify'` and `!msg.key.fromMe`. Outgoing messages use `sendPresenceUpdate('composing', jid)` followed by a randomized delay and `sendMessage`. Message deduplication uses the message's `key.id` as a unique constraint in SQLite with `INSERT OR IGNORE`.

**Primary recommendation:** Build the three-plan sequence in strict order: scaffold first (TypeScript ESM, Drizzle schema, PM2 config), then Baileys connection with full reconnect logic, then the message pipeline. Do not interleave — each plan's output is the next plan's foundation.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | WhatsApp WebSocket connection | Only actively maintained unofficial API library; pure WebSocket, no Puppeteer; ~50 MB RAM |
| TypeScript | 5.x | Language | Baileys ships full TypeScript types; ESM-native |
| Node.js | 20 LTS | Runtime | Required v17+; Node 20 adds stable ESM, native fetch; LTS support window |
| `drizzle-orm` | 0.38.x | ORM | TypeScript-native, SQL-transparent, no runtime engine binary |
| `better-sqlite3` | 11.x | SQLite driver | Synchronous API; ideal for single-process Node.js |
| `drizzle-kit` | latest | Schema migrations | Generates SQL migration files from TypeScript schema |
| PM2 | 5.x | Process manager | `pm2 startup` + `pm2 save` for systemd persistence; built-in log rotation |
| `tsx` | 4.x | TypeScript execution | Runs `.ts` files via Node.js import hook; used in PM2 config |
| `pino` | 9.x | Logging | Fast JSON logger; Baileys accepts it as `logger` option directly |
| `dotenv` | 16.x | Environment config | Load secrets from `.env`; never hardcode |
| `zod` | 3.x | Schema validation | Validate message payloads and env before use |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino-pretty` | latest | Pretty log output | Development only; pipe logs through it in dev, raw JSON in PM2 |
| `@tsconfig/node20` | latest | Shared tsconfig base | Extend for `moduleResolution: nodenext`, `module: nodenext` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `useMultiFileAuthState` | Custom SQLite auth state | File-based is simpler for Phase 1; SQLite auth state is better for production but requires more upfront code |
| `tsx` via `--import` | `tsup` build + run JS | Building to JS is more stable for production; tsx is simpler for Phase 1 and avoids a build step |
| PM2 with tsx | Raw systemd unit file | systemd is more robust but has worse DX; PM2 wraps systemd and adds log management |

**Installation:**

```bash
# Initialize project
npm init -y
npm pkg set type="module"
npm pkg set engines.node=">=20"

# WhatsApp layer
npm install @whiskeysockets/baileys

# Storage
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3

# Utilities
npm install pino pino-pretty dotenv zod

# TypeScript tooling
npm install -D typescript tsx @tsconfig/node20 @types/node

# PM2 (global)
npm install -g pm2
```

---

## Architecture Patterns

### Recommended Project Structure

```
whatsapp-bot/
├── src/
│   ├── db/
│   │   ├── schema.ts          # Drizzle table definitions (single source of truth)
│   │   ├── client.ts          # better-sqlite3 + drizzle() init, migrate() on startup
│   │   └── queries/
│   │       └── messages.ts    # message insert, exists-check, get-recent
│   ├── whatsapp/
│   │   ├── connection.ts      # makeWASocket factory, auth state init, reconnect loop
│   │   ├── reconnect.ts       # Exponential backoff logic, DisconnectReason routing
│   │   └── sender.ts          # sendPresenceUpdate + delay + sendMessage wrapper
│   ├── pipeline/
│   │   └── messageHandler.ts  # messages.upsert handler: filter, deduplicate, persist
│   ├── config.ts              # Typed env var loading with zod
│   └── index.ts               # Entry: init db, init socket, wire events
├── drizzle/                   # Generated migration SQL files
├── data/
│   ├── bot.db                 # SQLite database file
│   └── auth/                  # useMultiFileAuthState session directory
├── drizzle.config.ts          # Drizzle Kit config
├── ecosystem.config.cjs       # PM2 config (MUST be .cjs — not .js — in ESM projects)
├── tsconfig.json
├── .env
└── .env.example
```

**Critical:** The PM2 ecosystem file MUST use the `.cjs` extension when the project has `"type": "module"` in package.json. PM2 reads this file via CommonJS `require()` and will fail with `ERR_REQUIRE_ESM` if named `.js` in an ESM project.

### Pattern 1: Baileys Socket Initialization

**What:** Factory function that creates and returns a configured `makeWASocket` instance.
**When to use:** Called at startup and on every reconnect (Baileys requires creating a new socket, not reusing the old one).

```typescript
// src/whatsapp/connection.ts
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';

export async function createSocket() {
  const { state, saveCreds } = await useMultiFileAuthState('./data/auth');
  const logger = pino({ level: 'silent' }); // Baileys is very verbose; silence in prod

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'), // browser fingerprint
    markOnlineOnConnect: false,         // prevents stopping phone notifications
    // getMessage is required for resending missing messages
    getMessage: async (key) => {
      // return stored message from DB by key, or undefined
      return undefined;
    },
  });

  sock.ev.on('creds.update', saveCreds);
  return sock;
}
```

**Source:** [Baileys Configuration docs](https://baileys.wiki/docs/socket/configuration/), [Baileys Connecting docs](https://baileys.wiki/docs/socket/connecting/)

### Pattern 2: Connection.Update Handler with Reconnect

**What:** Handles all connection state changes, routes to appropriate action per `DisconnectReason`.
**When to use:** Required — this is the only way to know when to reconnect.

```typescript
// src/whatsapp/reconnect.ts
import { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

const MAX_RETRIES = 10;
let retryCount = 0;

export function handleConnectionUpdate(
  update: Partial<ConnectionState>,
  reconnect: () => Promise<void>,
  deleteSession: () => Promise<void>
) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    // Serve QR to terminal or dashboard
    console.log('QR code received — scan with WhatsApp');
  }

  if (connection === 'close') {
    const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

    if (reason === DisconnectReason.loggedOut) {
      // Session invalidated — delete auth files, require new QR scan
      console.error('Logged out. Delete session and restart.');
      deleteSession();
      return; // Do NOT reconnect automatically
    }

    if (reason === DisconnectReason.badSession) {
      // Corrupt session file — same as logged out
      deleteSession();
      return;
    }

    // All other reasons: reconnect with exponential backoff
    const delay = Math.min(1000 * 2 ** retryCount, 60_000); // max 60s
    retryCount++;
    if (retryCount > MAX_RETRIES) {
      console.error('Max reconnect attempts reached. Manual intervention needed.');
      return;
    }
    console.log(`Reconnecting in ${delay}ms (attempt ${retryCount})...`);
    setTimeout(reconnect, delay);
  }

  if (connection === 'open') {
    retryCount = 0; // reset on successful connection
    console.log('Connected to WhatsApp');
  }
}
```

**DisconnectReason reference (verified from official docs):**
| Code | Reason | Action |
|------|--------|--------|
| 401 | `loggedOut` | Delete session, require QR re-scan |
| 403 | `forbidden` | Delete session, require QR re-scan |
| 408 | `connectionLost` | Reconnect with backoff |
| 411 | `multideviceMismatch` | Reconnect with backoff |
| 428 | `connectionClosed` | Reconnect with backoff |
| 440 | `connectionReplaced` | Do NOT reconnect (another session is running) |
| 500 | `badSession` | Delete session, require QR re-scan |
| 515 | `restartRequired` | Reconnect immediately (create new socket) |
| 503 | `unavailableService` | Reconnect with backoff |

**Source:** [Baileys DisconnectReason enum](https://baileys.wiki/docs/api/enumerations/DisconnectReason/), [Baileys Connecting docs](https://baileys.wiki/docs/socket/connecting/)

### Pattern 3: Message Handler with Deduplication

**What:** `messages.upsert` handler that filters to real incoming messages and deduplicates.
**When to use:** Primary incoming message processing entry point.

```typescript
// src/pipeline/messageHandler.ts

sock.ev.on('messages.upsert', async ({ messages, type }) => {
  // Only process new messages, not history sync
  if (type !== 'notify') return;

  for (const msg of messages) {
    // Ignore messages sent by the bot itself
    if (msg.key.fromMe) continue;

    const jid = msg.key.remoteJid;
    if (!jid) continue;

    // Filter out group chats — only process individual DMs
    // Group JIDs end in @g.us; individual JIDs end in @s.whatsapp.net or @lid
    if (jid.endsWith('@g.us')) continue;

    // Extract message ID for deduplication
    const messageId = msg.key.id;
    if (!messageId) continue;

    // Check for duplicate — INSERT OR IGNORE handles race conditions
    const alreadyProcessed = await db.messages.exists(messageId);
    if (alreadyProcessed) continue;

    // Persist message first, before any processing
    await db.messages.insert({
      id: messageId,
      contactJid: jid,
      fromMe: false,
      body: extractTextBody(msg),
      timestamp: (msg.messageTimestamp as number) * 1000,
    });

    // Hand off to downstream pipeline (Phase 2+)
  }
});

function extractTextBody(msg: proto.IWebMessageInfo): string {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    ''
  );
}
```

**Source:** [Baileys Receiving Updates](https://baileys.wiki/docs/socket/receiving-updates/), [Baileys Handling Messages](https://baileys.wiki/docs/socket/handling-messages/)

### Pattern 4: Anti-Ban Send with Typing Simulation

**What:** Wraps outgoing message sending with human-like presence updates and delays.
**When to use:** Every outgoing message. Never send raw without delay.

```typescript
// src/whatsapp/sender.ts

export async function sendWithDelay(
  sock: WASocket,
  jid: string,
  text: string,
  options?: { minDelay?: number; maxDelay?: number }
) {
  const { minDelay = 1500, maxDelay = 4000 } = options ?? {};

  // Signal "typing" presence to the contact
  await sock.sendPresenceUpdate('composing', jid);

  // Randomized human-like delay (min 1.5s, max 4s by default)
  const delay = minDelay + Math.random() * (maxDelay - minDelay);
  await new Promise(resolve => setTimeout(resolve, delay));

  // Clear typing indicator
  await sock.sendPresenceUpdate('paused', jid);

  // Send the actual message
  await sock.sendMessage(jid, { text });
}
```

**Key constraint (WA-07):** The delay must be randomized — uniform delays are detectable. Scale delay proportionally to message length for more realistic behavior (longer message = longer "typing" time).

**Source:** [BrightCoding Baileys guide](https://www.blog.brightcoding.dev/2025/08/28/building-whatsapp-bots-integrations-with-baileys/), verified sendPresenceUpdate docs

### Pattern 5: Drizzle Schema and Migration

**What:** TypeScript schema definition consumed by Drizzle Kit for migrations.
**When to use:** Define all tables here first; run `drizzle-kit generate` then `drizzle-kit migrate`.

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),          // WhatsApp message key.id — dedup key
  contactJid: text('contact_jid').notNull(),
  fromMe: integer('from_me', { mode: 'boolean' }).notNull(),
  body: text('body').notNull().default(''),
  timestamp: integer('timestamp').notNull(), // Unix ms
  processed: integer('processed', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (table) => ({
  contactTsIdx: index('idx_messages_contact_ts').on(table.contactJid, table.timestamp),
}));
```

```typescript
// src/db/client.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js'; // .js extension required in ESM

const sqlite = new Database('./data/bot.db');
export const db = drizzle({ client: sqlite, schema });

// Run migrations on startup — idempotent
export function runMigrations() {
  migrate(db, { migrationsFolder: './drizzle' });
}
```

**drizzle.config.ts:**
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/bot.db',
  },
});
```

**Source:** [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started/sqlite-new), [Drizzle Migrations docs](https://orm.drizzle.team/docs/migrations)

### Pattern 6: PM2 Ecosystem Config

**What:** PM2 process declaration for TypeScript ESM apps.
**Critical:** File must be named `ecosystem.config.cjs` (not `.js`) in ESM projects.

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: './src/index.ts',
      interpreter: 'node',
      interpreterArgs: '--import tsx',  // tsx as Node.js customization hook
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/bot-error.log',
      out_file: './logs/bot-out.log',
    },
  ],
};
```

**Startup persistence (OPS-01, OPS-02):**
```bash
# After bot is running:
pm2 startup systemd    # generates and installs a systemd unit
# Copy-paste the command it outputs, then:
pm2 save               # saves current process list to ~/.pm2/dump.pm2
# From now on, bot auto-starts after server reboot
```

**Source:** [PM2 tsx pattern](https://blog.vramana.com/posts/2023-02-05-pm2-tsx/), [PM2 Startup docs](https://pm2.keymetrics.io/docs/usage/startup/)

### Pattern 7: TypeScript ESM Configuration

```json
// tsconfig.json
{
  "extends": "@tsconfig/node20/tsconfig.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*", "drizzle.config.ts"]
}
```

**Critical ESM rule:** All local imports in TypeScript source MUST use `.js` extension (even though the source file is `.ts`). Node.js ESM resolution requires the extension and TypeScript preserves it.

```typescript
// Correct: import from './schema.js'  (not './schema' or './schema.ts')
import * as schema from './schema.js';
```

**Source:** [TypeScript ESM docs](https://www.typescriptlang.org/docs/handbook/modules/reference.html)

### Anti-Patterns to Avoid

- **Reusing a closed Baileys socket:** When connection closes, create a new socket via `makeWASocket`. The old socket is dead. Never call `.connect()` on a closed socket.
- **Calling `reconnect()` on `loggedOut` (401) or `forbidden` (403):** These mean the session is invalidated by WhatsApp. Reconnecting spins in an infinite loop and burns through reconnect attempts. Delete session files and surface a re-auth alert.
- **Naming PM2 config `.js` in an ESM project:** PM2 reads ecosystem config with CommonJS `require()`. Fails with `ERR_REQUIRE_ESM`. Use `.cjs` extension.
- **Importing Drizzle schema without `.js` extension:** Node.js ESM will throw `ERR_MODULE_NOT_FOUND`. Always use `.js` extension for local imports.
- **Using `useMultiFileAuthState` in high-IO environments:** It reads/writes many small files on every creds update. For a single-bot personal project it is acceptable. For multi-session use, implement a SQLite-backed auth state.
- **Sending messages without any delay:** Zero-delay responses are a bot fingerprint detectable by Meta. Minimum 1.5 seconds, randomized.
- **Processing group JIDs:** Messages from `@g.us` JIDs must be filtered out before any processing. The bot is explicitly scoped to 1:1 DMs only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WhatsApp protocol | Custom WebSocket client | `@whiskeysockets/baileys` | WhatsApp Web uses custom binary protocol over WebSocket; reverse-engineered by Baileys |
| Auth state persistence | Custom file serialization | `useMultiFileAuthState` (built-in) | Handles signal keys, pre-keys, session data correctly; hand-rolled auth state will corrupt |
| Migration runner | SQL file reader | `drizzle-kit generate` + `migrate()` | Drizzle tracks applied migrations in `__drizzle_migrations` table; hand-rolled risks double-apply |
| Exponential backoff | Custom timer logic | Inline `Math.min(1000 * 2 ** retryCount, 60000)` | Simple enough to inline; no library needed |
| Process supervision | `setInterval` watchdog | PM2 | PM2 handles crash restarts, reboot persistence, log rotation with a single config file |

**Key insight:** Baileys is already the thin wrapper around the protocol — do not wrap it further. Interact with `sock.ev`, `sock.sendMessage`, and `sock.sendPresenceUpdate` directly. Over-abstracting the WhatsApp layer makes debugging protocol-level issues harder.

---

## Common Pitfalls

### Pitfall 1: `loggedOut` Reconnect Loop

**What goes wrong:** The connection handler calls `reconnect()` on every `DisconnectReason`, including `loggedOut` (401). This creates an infinite reconnect loop — each attempt fails immediately, generates a new socket, fails again, filling logs and burning CPU.

**Why it happens:** Treating all disconnects as "transient network errors" rather than distinguishing permanent session revocation from temporary connectivity loss.

**How to avoid:** Check `reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession`. On these codes: delete the auth state directory, log a critical alert, and halt reconnect. Surface this state so the user can re-scan a QR code.

**Warning signs:** Log shows rapid-fire reconnect attempts, each immediately closing.

### Pitfall 2: `ERR_REQUIRE_ESM` on PM2 Start

**What goes wrong:** PM2 fails to load `ecosystem.config.js` with `ERR_REQUIRE_ESM` when the project has `"type": "module"`.

**Why it happens:** PM2 uses CommonJS `require()` to load the ecosystem config file. A `.js` file in an ESM project is treated as ESM, which `require()` cannot load.

**How to avoid:** Name the file `ecosystem.config.cjs`. CommonJS files with the `.cjs` extension are always loaded as CommonJS regardless of `package.json` type.

**Warning signs:** `pm2 start ecosystem.config.js` fails immediately at startup.

### Pitfall 3: Missing `.js` Extensions in ESM Imports

**What goes wrong:** TypeScript ESM project throws `ERR_MODULE_NOT_FOUND` at runtime for local imports.

**Why it happens:** Node.js ESM resolution does not auto-add extensions. TypeScript in `nodenext` mode requires explicit `.js` extensions even when the source file is `.ts`.

**How to avoid:** Always write `import { x } from './module.js'` in TypeScript ESM source. The TypeScript compiler preserves the extension; at runtime Node.js finds the compiled `.js` file.

**Warning signs:** Works fine in development with tsx but fails when running the compiled output.

### Pitfall 4: LID JID Format Breaking Contact Matching

**What goes wrong:** In Baileys v7, WhatsApp migrated from phone-number-based JIDs (`@s.whatsapp.net`) to LID-based JIDs (`@lid`). Some contacts arrive with LID JIDs instead of phone numbers. A simple string comparison against a stored phone-number JID silently fails.

**Why it happens:** v7's LID migration is ongoing. Not all contacts have completed migration. `remoteJid` may return either format for the same contact at different times.

**How to avoid:** For Phase 1, use `jid.endsWith('@g.us')` to filter groups and `!jid.endsWith('@g.us')` to accept DMs (both `@s.whatsapp.net` and `@lid` DMs pass this filter). Store the raw JID as received — do not normalize to phone number format in Phase 1.

**Warning signs:** Messages from some contacts are not being processed; JIDs in logs show `@lid` suffix.

### Pitfall 5: Duplicate Messages on Reconnect

**What goes wrong:** After the bot reconnects following a crash or network drop, Baileys re-delivers recent messages (history sync). The bot processes them again and sends duplicate replies.

**Why it happens:** Baileys delivers recent messages as `messages.upsert` with `type === 'append'` on reconnect — but `type === 'notify'` messages can also be replayed in some conditions.

**How to avoid:** The `id` field (`msg.key.id`) is stable and unique per message in WhatsApp. Use it as the primary key in the `messages` table with `INSERT OR IGNORE` (Drizzle: `.onConflictDoNothing()`). Check existence before processing.

**Warning signs:** Contacts report receiving duplicate replies after the bot restarts.

### Pitfall 6: Session Files Corrupted by Root-Owned Process

**What goes wrong:** Running PM2 as root causes the auth state files to be owned by root. If the process crashes and restarts as a non-root user (or vice versa), files cannot be read/written.

**Why it happens:** PM2 startup may configure the systemd service to run as root unless explicitly configured otherwise.

**How to avoid:** Run PM2 and the bot as the `yuval` user, not root. Configure the systemd unit with `User=yuval`. The `pm2 startup` command run as `yuval` will generate the correct unit file.

**Warning signs:** Auth state directory shows root ownership; `EACCES` errors in logs after reboot.

---

## Code Examples

### Full Connection Bootstrap

```typescript
// src/index.ts
import { createSocket } from './whatsapp/connection.js';
import { handleConnectionUpdate } from './whatsapp/reconnect.js';
import { setupMessageHandler } from './pipeline/messageHandler.js';
import { runMigrations } from './db/client.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig(); // zod-validated env
  runMigrations();             // apply pending DB migrations on startup

  let sock = await createSocket();

  async function reconnect() {
    sock = await createSocket();
    sock.ev.on('connection.update', (update) =>
      handleConnectionUpdate(update, reconnect, deleteSession)
    );
    setupMessageHandler(sock);
  }

  sock.ev.on('connection.update', (update) =>
    handleConnectionUpdate(update, reconnect, deleteSession)
  );

  setupMessageHandler(sock);
}

async function deleteSession() {
  const { rm } = await import('fs/promises');
  await rm('./data/auth', { recursive: true, force: true });
  console.error('Session deleted. Restart bot and scan QR code.');
  process.exit(1); // exit; PM2 will restart and prompt QR scan
}

main().catch(console.error);
```

### Environment Config with Zod

```typescript
// src/config.ts
import { z } from 'zod';
import { config } from 'dotenv';

config(); // load .env

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  DB_PATH: z.string().default('./data/bot.db'),
  AUTH_DIR: z.string().default('./data/auth'),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
```

### Drizzle Message Deduplication Query

```typescript
// src/db/queries/messages.ts
import { db } from '../client.js';
import { messages } from '../schema.js';
import { eq } from 'drizzle-orm';

export async function messageExists(id: string): Promise<boolean> {
  const result = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);
  return result.length > 0;
}

export async function insertMessage(data: typeof messages.$inferInsert) {
  await db.insert(messages).values(data).onConflictDoNothing();
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CommonJS (`require`) | ESM (`import`) | Baileys v7 (2024) | `package.json` must have `"type": "module"`; all `require()` replaced with `import` |
| `isJidUser()` | `isPnUser()` | Baileys v7 | Old helper removed; use `isPnUser()` for phone-number JID check, `isJidGroup()` still works for groups |
| `@google/generative-ai` | `@google/genai` | August 2025 (EOL) | Old SDK end-of-life; any tutorial using old import is outdated — not relevant to Phase 1 |
| whatsapp-web.js + Puppeteer | Baileys WebSocket | Decision locked | 300-600 MB RAM vs ~50 MB; no Chromium dependency |
| PM2 `ecosystem.config.js` | `ecosystem.config.cjs` | ESM adoption | `.js` extension fails in ESM projects; use `.cjs` |

**Deprecated/outdated:**
- `isJidUser()`: Replaced by `isPnUser()` in Baileys v7 due to LID migration
- ACK sending: Baileys v7 no longer sends delivery ACKs — WhatsApp was banning accounts for it
- `@adiwajshing/baileys`: The original repo was deleted; all code must use `@whiskeysockets/baileys`

---

## Open Questions

1. **LID JID Normalization**
   - What we know: Baileys v7 introduces LID-based JIDs (`@lid`), coexisting with `@s.whatsapp.net`. `remoteJid` may return either for the same contact.
   - What's unclear: Whether `msg.key.remoteJidAlt` reliably provides the PN equivalent when `remoteJid` is a LID. The mapping is documented as available via `signalRepository.lidMapping` but the access pattern at message handler time is unclear.
   - Recommendation: Phase 1 — store the raw JID as received, no normalization. Phase 2 — investigate LID-to-PN mapping when contact whitelisting requires matching by phone number.

2. **`useMultiFileAuthState` for Production**
   - What we know: Official docs explicitly say "DONT EVER USE in prod". It writes many small files on every credentials update. Documented as acceptable "perhaps for a bot."
   - What's unclear: At what volume does the IO overhead become a real problem? For a single-account personal bot with low message volume, it may be fine indefinitely.
   - Recommendation: Use `useMultiFileAuthState` for Phase 1. Evaluate SQLite-backed auth state only if IO-related issues are observed in practice. The `baileys-auth-states` npm package provides a drop-in SQLite alternative if needed.

3. **`getMessage` Callback Implementation**
   - What we know: `makeWASocket` requires a `getMessage` function for "resending missing messages or decrypting poll votes."
   - What's unclear: What happens in practice if it returns `undefined` for all keys (stub implementation). Some sources suggest certain features degrade silently; others suggest it's only needed for specific operations.
   - Recommendation: Implement as a real DB lookup after messages table is populated. For initial bootstrap, returning `undefined` is acceptable — document this as a known limitation to revisit.

---

## Sources

### Primary (HIGH confidence)
- [Baileys Wiki: Introduction](https://baileys.wiki/docs/intro/) — Node version requirement, makeWASocket, auth state
- [Baileys Wiki: Migration to v7](https://baileys.wiki/docs/migration/to-v7.0.0/) — ESM migration, LID JID changes, ACK removal, auth state new keys
- [Baileys Wiki: Connecting](https://baileys.wiki/docs/socket/connecting/) — connection.update event, QR flow, reconnect pattern
- [Baileys Wiki: Configuration](https://baileys.wiki/docs/socket/configuration/) — makeWASocket required/optional params
- [Baileys Wiki: DisconnectReason enum](https://baileys.wiki/docs/api/enumerations/DisconnectReason/) — all disconnect codes and their numeric values
- [Baileys Wiki: useMultiFileAuthState](https://baileys.wiki/docs/api/functions/useMultiFileAuthState/) — return type, production warning
- [Baileys Wiki: Receiving Updates](https://baileys.wiki/docs/socket/receiving-updates/) — messages.upsert event types
- [Baileys Wiki: Handling Messages](https://baileys.wiki/docs/socket/handling-messages/) — message structure, text vs extendedTextMessage
- [Drizzle ORM: SQLite Get Started](https://orm.drizzle.team/docs/get-started/sqlite-new) — drizzle(), schema definition, config
- [Drizzle ORM: Migrations](https://orm.drizzle.team/docs/migrations) — migrate() function, drizzle-kit generate workflow
- [PM2: Startup Script](https://pm2.keymetrics.io/docs/usage/startup/) — systemd integration, pm2 save
- [PM2: Ecosystem File](https://pm2.keymetrics.io/docs/usage/application-declaration/) — ecosystem config options

### Secondary (MEDIUM confidence)
- [BrightCoding: Building with Baileys 2025](https://www.blog.brightcoding.dev/2025/08/28/building-whatsapp-bots-integrations-with-baileys/) — sendPresenceUpdate usage, connection.update handler pattern
- [PM2 + tsx blog post](https://blog.vramana.com/posts/2023-02-05-pm2-tsx/) — `interpreter: 'node', interpreterArgs: '--import tsx'` pattern verified to work
- [Drizzle ORM push vs generate](https://orm.drizzle.team/docs/drizzle-kit-push) — push for dev, generate+migrate for production

### Tertiary (LOW confidence — flag for validation)
- [GitHub: rzkytmgr/baileysauth](https://github.com/rzkytmgr/baileysauth) — SQLite-backed auth state alternative; not validated for v7 compatibility
- [GitHub: kobie3717/baileys-antiban](https://github.com/kobie3717/baileys-antiban) — anti-ban middleware library; not validated; implementing delay manually is simpler for Phase 1
- Baileys GitHub Issues #860, #1625, #1965 — session disconnect timing reports; community-reported, not official

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Baileys v7 version verified on npm; Drizzle and PM2 are stable and well-documented
- Architecture patterns: HIGH — Verified against official Baileys wiki; PM2 tsx pattern has multiple corroborating sources
- DisconnectReason handling: HIGH — Verified directly from [official enum docs](https://baileys.wiki/docs/api/enumerations/DisconnectReason/)
- LID JID behavior: LOW-MEDIUM — v7 migration is recent and ongoing; behavior may differ per account; open question flagged
- Anti-ban delay effectiveness: MEDIUM — Documented as best practice across multiple sources; no official WhatsApp confirmation of specific thresholds

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (Baileys is fast-moving; check for rc.10+ before building; check GitHub releases for breaking changes)

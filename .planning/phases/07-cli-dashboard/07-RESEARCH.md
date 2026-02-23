# Phase 7: CLI Dashboard - Research

**Researched:** 2026-02-23
**Domain:** Node.js CLI tooling — Commander.js, Ink/React terminal UI, PM2 programmatic API, Drizzle direct DB import
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | User can check bot status (connection, uptime, active contacts/groups) | PM2 programmatic API for process status; Drizzle direct queries for counts |
| CLI-02 | User can manage contacts from CLI (add/remove/configure mode/instructions) | Existing contacts queries; Commander.js nested subcommands; Ink table rendering |
| CLI-03 | User can manage tracked groups from CLI (add/remove, set reminder day) | Existing groups queries; Commander nested subcommands |
| CLI-04 | User can view recent conversations and pending drafts from CLI | Existing drafts queries; Ink table/list rendering |
| CLI-05 | User can approve or reject drafts from CLI | `markDraftSent` / `markDraftRejected` in drafts queries |
| CLI-06 | User can import WhatsApp chat history (.txt) from CLI | `importChats()` already exists at `src/importer/importChats.ts` — CLI wraps it |
| CLI-07 | User can manage group member emails for calendar sharing from CLI | `updateGroup` in groups queries; JSON array in `memberEmails` field |
</phase_requirements>

---

## Summary

Phase 7 builds a one-shot CLI tool that runs over SSH and directly accesses the same SQLite database the bot uses. The CLI does not start an HTTP server or connect to Fastify — it imports Drizzle and the existing query functions directly. Connection state (`connected`/`disconnected`/etc.) lives only in the bot's in-process memory (`src/api/state.ts`), so the CLI reads it via PM2's programmatic API rather than from the database.

The stack is Commander.js 14 for command routing and argument parsing, Ink 6 (React 19) for terminal-formatted output, tsx for TypeScript execution, and PM2's programmatic API for bot process status. All commands are one-shot: they connect to the DB, execute the operation, render output, and exit. No persistent process or event loop is needed beyond the command's async work.

The most critical design decision is how to fetch bot connection status: since it is in-process only, the CLI must call `pm2.connect()` + `pm2.describe('whatsapp-bot')` to read `pm2_env.status` (online/stopped/errored). Uptime is `Date.now() - pm2_env.pm_uptime`. This is the standard pattern for this architecture.

**Primary recommendation:** Use Commander.js 14 with `parseAsync` for the entry point, one file per top-level command group (`contacts.ts`, `groups.ts`, `drafts.ts`, `import.ts`, `calendar.ts`, `status.ts`), Ink's `render` + `waitUntilExit` for async-aware output, and PM2's programmatic API (not shell spawn) for status.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | 14.0.3 | CLI argument parsing, subcommand routing | De facto standard Node.js CLI parser; built-in TypeScript types; nested subcommands; `parseAsync` for async handlers |
| ink | 6.8.0 | Terminal UI output (React components) | Renders formatted, colored, aligned output via React; used by GitHub Copilot CLI, Gatsby, Prisma |
| react | 19.2.4 | Ink 6 peer dependency | Ink 6 requires React 19 |
| @types/react | 19.2.14 | TypeScript types for React/Ink | Ships with Ink 6 peer |
| tsx | 4.x (already installed) | TypeScript execution for the CLI entry point | Already in devDependencies; shebang `#!/usr/bin/env tsx` works without build step |
| pm2 | 6.0.14 (already installed globally) | Programmatic process status query | Bot runs under PM2; `pm2.connect + pm2.describe` reads runtime status from PM2 daemon |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm | 0.45.1 (already installed) | Direct DB reads/writes | All data operations — import existing `db` client and query functions |
| better-sqlite3 | 12.6.2 (already installed) | SQLite driver | Already configured with WAL + busy_timeout=5000; safe for CLI concurrent access |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Ink render | `console.log` + chalk | Simpler but no column alignment, no box drawing; harder to format tables |
| Ink render | cli-table3 | Pure table formatting without React overhead; viable but adds another dep when Ink already handles it |
| PM2 programmatic API | `spawnSync('pm2 jlist')` + JSON.parse | Shell spawn is fragile (PATH, output buffering); PM2 API is the correct approach |
| PM2 programmatic API | Fastify HTTP call to bot's `/status` endpoint | Adds HTTP dependency; CLI goal is no network dependency |
| tsx shebang | Compile to JS first | tsx already in project; no build step needed for CLI development |

**Installation (new dependencies only):**
```bash
npm install commander ink react @types/react
```

---

## Architecture Patterns

### Recommended Project Structure
```
cli/
├── bot.ts               # Entry point: #!/usr/bin/env tsx shebang, Commander root program
├── commands/
│   ├── status.ts        # bot status — PM2 query + DB counts
│   ├── contacts.ts      # contacts list/add/remove/configure
│   ├── groups.ts        # groups list/add/remove/set-reminder
│   ├── drafts.ts        # drafts list/approve/reject
│   ├── import.ts        # import <file> --contact <jid>
│   └── calendar.ts      # calendar members add/remove --group <jid>
└── ui/
    ├── Table.tsx         # Reusable Ink table component
    ├── StatusBadge.tsx   # Colored connection status badge
    └── DraftCard.tsx     # Draft display component
```

The `cli/` directory lives alongside `src/` at the project root. The entry point imports from `src/db/` directly using relative paths.

### Pattern 1: Entry Point with parseAsync

Commander with async handlers MUST use `parseAsync`, not `parse`. The entry point wires all subcommand modules and calls `parseAsync`.

```typescript
// cli/bot.ts
#!/usr/bin/env tsx
import { Command } from 'commander';
import { addStatusCommand } from './commands/status.js';
import { addContactsCommand } from './commands/contacts.js';
import { addGroupsCommand } from './commands/groups.js';
import { addDraftsCommand } from './commands/drafts.js';
import { addImportCommand } from './commands/import.js';
import { addCalendarCommand } from './commands/calendar.js';

const program = new Command()
  .name('bot')
  .description('WhatsApp bot management CLI')
  .version('1.0.0');

addStatusCommand(program);
addContactsCommand(program);
addGroupsCommand(program);
addDraftsCommand(program);
addImportCommand(program);
addCalendarCommand(program);

await program.parseAsync(process.argv);
```

### Pattern 2: File-Per-Command with addCommand

Each command file exports a registration function that attaches its subcommand tree to the root program.

```typescript
// cli/commands/contacts.ts
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { db } from '../../src/db/client.js';
import { contacts } from '../../src/db/schema.js';

export function addContactsCommand(program: Command): void {
  const contactsCmd = new Command('contacts').description('Manage contacts');

  contactsCmd
    .command('list')
    .description('List all contacts')
    .action(async () => {
      const rows = db.select().from(contacts).all();
      const { waitUntilExit } = render(React.createElement(ContactsTable, { rows }));
      await waitUntilExit();
    });

  contactsCmd
    .command('add <jid>')
    .description('Add a contact by JID')
    .option('-n, --name <name>', 'Display name')
    .option('-m, --mode <mode>', 'Response mode: off|draft|auto', 'draft')
    .action(async (jid: string, options) => {
      // upsert logic
    });

  program.addCommand(contactsCmd);
}
```

### Pattern 3: Ink render + waitUntilExit for Async Output

For commands that do async work (PM2 API, import), use `render` + `waitUntilExit`. The component calls `exit()` from `useApp` when work is done.

```typescript
// cli/commands/status.ts
import { Command } from 'commander';
import { render } from 'ink';
import React, { useEffect, useState } from 'react';
import { useApp } from 'ink';
import pm2 from 'pm2';

function StatusView() {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>('loading...');

  useEffect(() => {
    pm2.connect(true, (err) => {  // true = no daemon spawn if not running
      if (err) {
        setStatus('PM2 not running');
        pm2.disconnect();
        exit();
        return;
      }
      pm2.describe('whatsapp-bot', (err, procs) => {
        pm2.disconnect();
        if (err || !procs.length) {
          setStatus('stopped');
        } else {
          const proc = procs[0];
          setStatus(proc.pm2_env?.status ?? 'unknown');
        }
        exit();
      });
    });
  }, []);

  return React.createElement(Box, null,
    React.createElement(Text, null, `Bot: ${status}`)
  );
}

export function addStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show bot connection state and counts')
    .action(async () => {
      const { waitUntilExit } = render(React.createElement(StatusView));
      await waitUntilExit();
    });
}
```

### Pattern 4: renderToString for Pure Synchronous Output

For commands with no async work (read-only DB queries that are synchronous with better-sqlite3), `renderToString` gives cleaner one-shot output without needing `waitUntilExit`. However, `useEffect` does NOT work with `renderToString` — it only reflects initial render state.

```typescript
import { renderToString } from 'ink';
const output = renderToString(React.createElement(ContactsTable, { rows }));
process.stdout.write(output + '\n');
```

Use `renderToString` only when all data is fetched BEFORE rendering. Use `render` + `waitUntilExit` when data is fetched inside the component via `useEffect`.

**Recommendation for this phase:** Since better-sqlite3 is synchronous, fetch all data before calling render, then use `renderToString`. Only the `status` command (PM2 async callback) and `import` command (async file I/O + Gemini) need `render` + `waitUntilExit`.

### Pattern 5: PM2 Programmatic Status

The bot connection state is in-process only (`src/api/state.ts`). The CLI reads it via PM2:

```typescript
import pm2 from 'pm2';

export async function getBotStatus(): Promise<{
  status: string;
  uptime: number | null;
  memory: number | null;
}> {
  return new Promise((resolve) => {
    pm2.connect(true, (err) => {
      if (err) return resolve({ status: 'pm2_unavailable', uptime: null, memory: null });
      pm2.describe('whatsapp-bot', (err, procs) => {
        pm2.disconnect();
        if (err || !procs.length) return resolve({ status: 'stopped', uptime: null, memory: null });
        const proc = procs[0];
        resolve({
          status: proc.pm2_env?.status ?? 'unknown',
          uptime: proc.pm2_env?.pm_uptime
            ? Date.now() - proc.pm2_env.pm_uptime
            : null,
          memory: proc.monit?.memory ?? null,
        });
      });
    });
  });
}
```

Note: `pm2.connect(true, cb)` — the `true` flag means "do not spawn a new PM2 daemon if one isn't running." This prevents accidentally starting PM2 in CLI context.

### Pattern 6: Wrapping importChats for CLI

The importer at `src/importer/importChats.ts` already does all the work. The CLI command just needs to invoke it with the right args:

```typescript
// cli/commands/import.ts
import { Command } from 'commander';
import { importChats } from '../../src/importer/importChats.js';
import { config } from '../../src/config.js';
import path from 'node:path';
import fs from 'node:fs/promises';

export function addImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import a WhatsApp .txt chat history file')
    .requiredOption('--contact <jid>', 'Contact JID (e.g. 972501234567@s.whatsapp.net)')
    .action(async (file: string, options: { contact: string }) => {
      // Copy file to import dir named as JID, then run importChats
      const jid = options.contact;
      const dest = path.join(config.IMPORT_DIR, `${jid}.txt`);
      await fs.copyFile(file, dest);
      await importChats(config.IMPORT_DIR, config.PROCESSED_DIR, config.OWNER_EXPORT_NAME);
    });
}
```

### Pattern 7: package.json bin Registration

To make `bot` available as a command when installed locally:

```json
// package.json addition
{
  "bin": {
    "bot": "./cli/bot.ts"
  }
}
```

After `npm link` or setting up shell alias, `bot status` works from anywhere. Since `tsx` is in devDependencies, on the server the user must use `npx tsx cli/bot.ts status` or configure a shell alias:

```bash
# In ~/.bashrc or ~/.zshrc
alias bot="npx tsx /home/yuval/whatsapp-bot/cli/bot.ts"
```

This is simpler than global install for a home server use case.

### Anti-Patterns to Avoid

- **Do NOT use `parse` instead of `parseAsync`:** If any action handler is async, `parse` will not await it and the process exits before the async work completes.
- **Do NOT use `renderToString` with async data:** `useEffect` callbacks run but state updates are NOT reflected in `renderToString` output. Fetch data before rendering.
- **Do NOT spawn `pm2 jlist` via shell:** PATH may not include PM2's global bin in the tsx shebang context. Use the PM2 programmatic API instead.
- **Do NOT import from `src/api/state.ts` in the CLI:** The exported `state` object is only populated by the running bot process. Importing it in the CLI process gives a fresh disconnected instance.
- **Do NOT call `migrate()` in the CLI DB client:** The bot already runs migrations on startup. CLI should use DB read/write without re-running migrations. Create a CLI-specific DB connection that skips `initDb()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argument parsing | Custom argv parser | Commander.js | Handles --flags, <required>, [optional], -h help, error messages, version |
| Terminal color/style | ANSI escape codes | Ink `<Text color="green">` | Ink handles color codes, TTY detection, reset |
| Column alignment | String padding logic | Ink `<Box flexDirection="row">` with width props | Flexbox layout handles terminal column alignment |
| Process exit on error | Custom exit logic | `program.error('msg')` | Commander auto-sets exit code 1 and prints to stderr |
| Chat history parsing | Custom regex | `parseMyMessages` in `importChats.ts` | Already implemented with edge case handling |
| DB schema management | Raw SQL | Existing Drizzle schema + queries in `src/db/` | Already tested; direct import is the design |

**Key insight:** The most valuable work in this phase is wiring together existing pieces (importChats, DB queries, PM2 API) into a clean command interface — not building new abstractions.

---

## Common Pitfalls

### Pitfall 1: parse vs parseAsync
**What goes wrong:** Using `program.parse(process.argv)` with async action handlers — the process exits immediately after the command is matched, before async work completes. No error is thrown; the command silently does nothing.
**Why it happens:** `parse` is synchronous; it calls action handlers but does not await their promises.
**How to avoid:** Always use `await program.parseAsync(process.argv)` in the entry point.
**Warning signs:** Command appears to run (no error) but DB changes don't happen, output doesn't appear.

### Pitfall 2: renderToString with async data
**What goes wrong:** Data fetched in `useEffect` inside a `renderToString` call is never shown — the string is generated from the initial empty state.
**Why it happens:** `renderToString` is synchronous; `useEffect` callbacks are enqueued but state updates after the initial render are not captured.
**How to avoid:** For synchronous DB reads (better-sqlite3 is sync), fetch data before calling `renderToString`. For async operations, use `render` + `waitUntilExit` with `useEffect` + `exit()`.
**Warning signs:** Component renders with empty/undefined data even though the query function is called inside `useEffect`.

### Pitfall 3: PM2 connect without `true` flag
**What goes wrong:** Calling `pm2.connect(cb)` without `true` as first argument spawns a new PM2 daemon if one isn't running, leaving a background daemon process.
**Why it happens:** Default PM2 connect behavior is to start the daemon if absent.
**How to avoid:** Always `pm2.connect(true, cb)` — `true` means "nospawn". Also always call `pm2.disconnect()` in the callback.
**Warning signs:** Orphan `pm2` daemon processes accumulate on the server.

### Pitfall 4: SQLite busy_timeout not set in CLI DB client
**What goes wrong:** CLI writes (e.g., adding a contact) fail with `SQLITE_BUSY` when the bot process is writing simultaneously.
**Why it happens:** The CLI creates its own better-sqlite3 connection; if it doesn't set `busy_timeout`, SQLite throws immediately on lock contention.
**How to avoid:** The CLI must set the same pragmas as the main bot: `sqlite.pragma('journal_mode = WAL')` and `sqlite.pragma('busy_timeout = 5000')`.
**Warning signs:** `SQLITE_BUSY: database is locked` errors intermittently.

### Pitfall 5: Config loading fails due to missing env vars
**What goes wrong:** `src/config.ts` validates all env vars including `GEMINI_API_KEY`, `JWT_SECRET`, `DASHBOARD_PASSWORD` — the CLI doesn't need these but config.ts will throw if they are absent.
**Why it happens:** Zod schema validates on import; missing vars cause `process.exit(1)`.
**How to avoid:** Two options:
  - Run CLI in same env as bot (source the `.env` file or set `NODE_ENV`).
  - Create a minimal `cli/config.ts` that only reads `DB_PATH`, `IMPORT_DIR`, `PROCESSED_DIR`, and `OWNER_EXPORT_NAME`.
**Warning signs:** `Invalid environment configuration` error when running any CLI command.

### Pitfall 6: ESM import paths need .js extensions
**What goes wrong:** TypeScript ESM imports from within `cli/` to `src/` need `.js` extensions on import paths (e.g., `../../src/db/client.js`), otherwise tsx/Node resolves incorrectly.
**Why it happens:** The project uses `"type": "module"` in package.json; ESM requires explicit file extensions in import specifiers.
**How to avoid:** Use `.js` extensions in all relative imports, even for `.ts` source files.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime despite file existing.

### Pitfall 7: Ink not exiting after render
**What goes wrong:** `render()` keeps the process alive if there are pending async operations or open handles (e.g., PM2 connection not disconnected).
**Why it happens:** Node.js stays alive as long as there are active handles. If PM2 disconnect is not called, the process hangs.
**How to avoid:** Always call `pm2.disconnect()` before `exit()` in Ink's `useApp`. Alternatively, use `process.exit(0)` after `waitUntilExit()` resolves.
**Warning signs:** CLI command hangs after printing output; must Ctrl+C to exit.

---

## Code Examples

### Nested subcommand structure — contacts with sub-subcommands
```typescript
// Source: Commander.js official docs + betterstack.com guide
import { Command } from 'commander';

export function addContactsCommand(program: Command): void {
  const cmd = new Command('contacts').description('Manage contacts');

  cmd
    .command('list')
    .description('List all contacts')
    .action(async () => { /* ... */ });

  cmd
    .command('add <jid>')
    .description('Add a new contact')
    .option('-n, --name <name>', 'Contact display name')
    .option('-m, --mode <mode>', 'Response mode (off|draft|auto)', 'draft')
    .action(async (jid: string, opts: { name?: string; mode: string }) => { /* ... */ });

  cmd
    .command('remove <jid>')
    .description('Remove a contact')
    .action(async (jid: string) => { /* ... */ });

  cmd
    .command('configure <jid>')
    .description('Update contact settings')
    .option('-m, --mode <mode>', 'Response mode (off|draft|auto)')
    .option('-i, --instructions <text>', 'Custom instructions for AI')
    .action(async (jid: string, opts) => { /* ... */ });

  program.addCommand(cmd);
}
```

### Ink table output (synchronous data)
```typescript
// Source: Ink docs — Box + Text with flexbox layout
import React from 'react';
import { Box, Text } from 'ink';
import { renderToString } from 'ink';

interface ContactRow {
  jid: string;
  name: string | null;
  mode: string;
}

function ContactsTable({ rows }: { rows: ContactRow[] }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={30}><Text bold>JID</Text></Box>
        <Box width={20}><Text bold>Name</Text></Box>
        <Box width={10}><Text bold>Mode</Text></Box>
      </Box>
      {rows.map((r) => (
        <Box key={r.jid}>
          <Box width={30}><Text>{r.jid}</Text></Box>
          <Box width={20}><Text>{r.name ?? '(unnamed)'}</Text></Box>
          <Box width={10}>
            <Text color={r.mode === 'auto' ? 'green' : r.mode === 'draft' ? 'yellow' : 'gray'}>
              {r.mode}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Usage in action handler (synchronous DB + renderToString):
const rows = db.select().from(contacts).all();
const output = renderToString(<ContactsTable rows={rows} />);
process.stdout.write(output + '\n');
```

### Async render pattern for PM2 status
```typescript
// Source: Ink docs — useApp exit + waitUntilExit
import React, { useEffect, useState } from 'react';
import { render, Box, Text, useApp } from 'ink';

function StatusOutput({ onLoad }: { onLoad: () => Promise<StatusData> }) {
  const { exit } = useApp();
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    onLoad().then((d) => {
      setData(d);
      exit();
    }).catch((err) => {
      exit(err);
    });
  }, []);

  if (!data) return <Text dimColor>Loading...</Text>;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>Status: </Text>
        <Text color={data.status === 'online' ? 'green' : 'red'}>{data.status}</Text>
      </Box>
      {data.uptime !== null && (
        <Text>Uptime: {formatUptime(data.uptime)}</Text>
      )}
    </Box>
  );
}

// In action handler:
const { waitUntilExit } = render(<StatusOutput onLoad={getBotStatus} />);
await waitUntilExit();
```

### CLI DB client (skip migrations)
```typescript
// cli/db.ts — minimal DB client without migration runner
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';

const DB_PATH = process.env.DB_PATH ?? './data/bot.db';
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
```

### package.json bin + shell alias setup
```json
// package.json
{
  "bin": {
    "bot": "./cli/bot.ts"
  },
  "scripts": {
    "cli": "tsx cli/bot.ts"
  }
}
```
```bash
# ~/.bashrc for convenient access over SSH
alias bot="npx tsx /home/yuval/whatsapp-bot/cli/bot.ts"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ink requires React 18 | Ink 6.x requires React 19 | Ink 6.0 (2024-2025) | Must install react@19, not react@18 |
| `program.parse()` for all commands | `program.parseAsync()` for async handlers | Commander v11+ | Async handlers silently fail with sync parse |
| ts-node for TypeScript CLI execution | tsx (esbuild-powered, just works) | 2022-2023 | tsx already installed; no config needed |
| Global npm install for CLI tool | Shell alias or `npm run cli` | Always | Simplest for single-server home project |
| Commander v12 (Node 18+) | Commander v14 (Node 20+) | May 2025 | Node 20 already required by this project |

**Deprecated/outdated:**
- `ts-node` for ESM TypeScript: complex ESM configuration; replaced by tsx in this project
- `program.parse()` with async handlers: silently broken; use `parseAsync`
- Ink with React 18: Ink 6+ requires React 19

---

## Open Questions

1. **Config loading in CLI — minimal vs. shared**
   - What we know: `src/config.ts` validates all env vars (including GEMINI_API_KEY, JWT_SECRET) via Zod; missing vars exit with code 1.
   - What's unclear: Whether to create a separate `cli/config.ts` that only reads DB_PATH and IMPORT_DIR, or ensure the CLI is always run in the same shell env as the bot (which already has the .env sourced by PM2).
   - Recommendation: Create a minimal `cli/config.ts` with only the vars the CLI actually uses. This avoids CLI failures if GEMINI_API_KEY is not set in the SSH session environment.

2. **Global `bot` command availability**
   - What we know: `npm link` creates a global symlink; shebang `#!/usr/bin/env tsx` requires tsx on PATH; tsx is in devDependencies (not globally installed).
   - What's unclear: Whether `npm link` works correctly on this server, or if a simpler shell alias approach is better.
   - Recommendation: Shell alias (`alias bot="npx tsx /home/yuval/whatsapp-bot/cli/bot.ts"`) in `~/.bashrc`. Simpler than global install for a home server.

3. **Import command — single file vs. directory scan**
   - What we know: `importChats()` scans a directory for .txt files named as JIDs. The CLI requirement says "import a WhatsApp .txt chat history file for a contact."
   - What's unclear: Whether to copy the file to the import dir and run the existing scanner, or extend `importChats()` to accept a direct file path + JID.
   - Recommendation: Copy-then-scan approach (uses existing code unchanged). Add `--contact <jid>` to derive the filename for the import dir. This matches the existing filename convention without modifying the importer.

---

## Sources

### Primary (HIGH confidence)
- `npm info ink@6.8.0` — confirmed version, React 19 peer dependency, Node 20 requirement
- `npm info commander` — confirmed v14.0.3 as current version
- Commander.js GitHub CHANGELOG — v14 features, Node 20 requirement, TypeScript Argument.parseArg
- Ink GitHub README (via WebFetch) — confirmed `waitUntilExit`, `useApp.exit()`, `renderToString` behavior, one-shot pattern
- Ink GitHub issue #688 — React 19 compatibility (resolved in Ink 6.x series)
- PM2 programmatic API docs (pm2.io) — `pm2.connect`, `pm2.describe`, `pm2_env.status`, `pm2_env.pm_uptime`, `monit.memory`
- Existing project code: `src/db/client.ts`, `src/db/schema.ts`, `src/db/queries/*`, `src/importer/importChats.ts`, `src/api/state.ts`, `src/config.ts`

### Secondary (MEDIUM confidence)
- betterstack.com Commander.js guide — subcommand patterns, action handler structure
- atomicobject.com tsx CLI guide — shebang pattern, `#!/usr/bin/env tsx`
- maxschmitt.me nested subcommands guide — file-per-command pattern
- Ink renderToString docs (via WebSearch) — `useEffect` limitation confirmed (initial render only)
- Commander.js jsDocs.io — TypeScript signatures for `parseAsync`, `addCommand`, `action`

### Tertiary (LOW confidence)
- Various WebSearch results on PM2 jlist JSON structure — cross-verified against official PM2 docs
- WebSearch on SQLite WAL concurrent CLI access — confirms WAL + busy_timeout is the standard approach

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry confirmed all versions; project already has tsx, drizzle, better-sqlite3
- Architecture: HIGH — patterns verified against Commander.js and Ink official docs; consistent with existing project structure
- Pitfalls: HIGH — parse vs parseAsync and renderToString+useEffect confirmed by official docs; PM2 connect flag from official PM2 API docs; SQLite busy_timeout already in the project

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (30 days — stable libraries, slow-moving ecosystem)

# WhatsApp Bot

An AI-powered WhatsApp bot that learns your communication style and replies to contacts in your authentic voice. For groups, it monitors messages, extracts dates to Google Calendar, posts weekly task reminders, handles @mention travel searches, and auto-responds to keyword-triggered messages. Managed through a web dashboard and runs 24/7 on a home server.

## Features

### 1:1 Conversations
- Per-contact reply modes: `off`, `draft` (manual approval), or `auto`
- AI replies in your authentic voice via Gemini with style learning from chat history
- Draft approval flow — bot generates reply, owner approves/rejects via WhatsApp
- Owner commands: snooze/resume contacts with custom durations
- Auto-reply cap (20 consecutive) with automatic fallback to draft mode
- Chat history import from WhatsApp `.txt` exports with style summary generation

### Group Utilities
- Date extraction from messages → automatic Google Calendar event creation
- In-group calendar confirmations with reply-to-delete
- Weekly AI-generated task reminder digests (configurable per group)
- @mention travel search with Gemini intent parsing and Google Search grounding
- Per-group keyword rules with auto-response (fixed text or AI-generated)
- Per-rule cooldown to prevent spam

### Infrastructure
- WhatsApp Web connection via [Baileys](https://github.com/WhiskeySockets/Baileys) v7
- QR code authentication with persistent sessions
- Automatic reconnection with exponential backoff
- SQLite database with WAL mode (Drizzle ORM)
- Fastify API server serving the React dashboard as a static SPA
- JWT-based dashboard authentication
- PM2 process management for 24/7 operation
- Structured JSON logging (Pino)

## Tech Stack

- **Runtime:** Node.js >= 20, TypeScript (ESNext)
- **WhatsApp:** @whiskeysockets/baileys v7
- **AI:** Google Gemini 2.5 Flash
- **API Server:** Fastify 5
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **Dashboard:** React 19 + Vite + shadcn/ui + TanStack Query
- **Calendar:** Google Calendar API (GCP service account)
- **Validation:** Zod
- **Logging:** Pino
- **Process Manager:** PM2

## Setup

```bash
# Install dependencies
npm install

# Build the dashboard
cd dashboard && npm install && npx vite build && cd ..

# Copy and configure environment variables
cp .env.example .env

# Generate and run database migrations
npm run db:generate
npm run db:migrate
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | — | Google Gemini API key (required) |
| `USER_JID` | — | Bot owner's WhatsApp JID (required) |
| `JWT_SECRET` | — | Min 32 chars, for dashboard auth (required) |
| `DASHBOARD_PASSWORD` | — | Min 6 chars, dashboard login (required) |
| `OWNER_EXPORT_NAME` | — | Owner's display name in WhatsApp exports (required) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | — | Path to GCP service account JSON for Calendar API |
| `NODE_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug` |
| `AUTH_DIR` | `./data/auth` | Baileys session credentials path |
| `DB_PATH` | `./data/bot.db` | SQLite database path |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model ID |
| `IMPORT_DIR` | `./data/imports` | Directory for WhatsApp chat export `.txt` files |
| `API_PORT` | `3000` | API server port |
| `API_HOST` | `100.124.47.99` | API server bind address |

## Usage

```bash
# Development (watch mode)
npm run dev

# Production
npm start

# PM2 (always-on)
pm2 start ecosystem.config.cjs
pm2 save
```

On first run, scan the QR code displayed in the terminal (or in the dashboard) with your WhatsApp mobile app. The session persists across restarts.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full ASCII diagram. Summary:

```
WhatsApp ←→ Baileys Socket ←→ Message Handler
                                  ├─→ 1:1 Pipeline (Gemini AI replies, drafts)
                                  └─→ Group Pipeline
                                        ├─ Travel @mention search
                                        ├─ Keyword auto-response
                                        ├─ Reply-to-delete calendar events
                                        └─ Date extraction → Google Calendar

Fastify API Server ←→ SQLite (Drizzle ORM)
       ↕
React Dashboard (static SPA)
```

## Project Structure

```
src/
├── index.ts                 # Entry point & startup orchestrator
├── config.ts                # Environment config (Zod validated)
├── whatsapp/
│   ├── connection.ts        # Baileys socket & auth state
│   ├── reconnect.ts         # Reconnection & backoff logic
│   └── sender.ts            # Message sending with typing delay
├── pipeline/
│   └── messageHandler.ts    # Main message router (1:1 + group)
├── groups/
│   ├── groupMessagePipeline.ts  # Group handler chain & date extraction
│   ├── travelHandler.ts     # @mention travel search orchestrator
│   ├── travelParser.ts      # Gemini travel intent extraction
│   ├── travelSearch.ts      # Google search integration
│   ├── travelFormatter.ts   # Travel results formatting
│   ├── dateExtractor.ts     # Gemini date extraction (Zod schema)
│   ├── keywordHandler.ts    # Keyword rule matching & auto-response
│   └── reminderScheduler.ts # Weekly digest cron scheduler
├── ai/
│   └── gemini.ts            # Gemini reply generation & style analysis
├── calendar/
│   └── calendarService.ts   # Google Calendar API integration
├── db/
│   ├── schema.ts            # Drizzle schema (7 tables)
│   ├── client.ts            # SQLite initialization & migrations
│   └── queries/             # Query modules per entity
├── api/
│   ├── server.ts            # Fastify server setup
│   ├── state.ts             # Global state & pub/sub
│   ├── plugins/             # CORS, JWT, static serving
│   └── routes/              # REST endpoints
├── importer/
│   └── importChats.ts       # WhatsApp chat export parser
└── types/

dashboard/src/
├── main.tsx                 # React entry point
├── router.tsx               # Client-side routing
├── api/client.ts            # API client with JWT
├── pages/                   # Login, Overview, Contacts, Drafts, Groups
├── components/              # Feature & UI components
└── hooks/                   # Data fetching hooks (TanStack Query)
```

## Database

7 tables managed by Drizzle ORM:

| Table | Purpose |
|-------|---------|
| `messages` | 1:1 chat history |
| `contacts` | Contact registry, AI config, reply mode |
| `drafts` | Pending message approvals |
| `groups` | Group config (reminders, calendar, members) |
| `groupMessages` | Group chat history |
| `calendarEvents` | Created calendar events with confirmation tracking |
| `keywordRules` | Per-group auto-response rules |

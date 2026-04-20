# WhatsApp Bot

An advanced AI-powered WhatsApp bot that learns your communication style, manages your tasks, and handles group utilities. It monitors messages, extracts events to Google Calendar, syncs commitments to Google Tasks/Microsoft To Do, sends scheduled messages, and provides voice interaction. Managed through a web dashboard and runs 24/7 on a home server.

## Features

### 1:1 Conversations & Personal Assistant
- **Authentic Voice Replies:** AI replies in your voice via Gemini 1.5 Flash, with optional **Voice Message (TTS)** support using ElevenLabs.
- **Reply Modes:** ,  (manual approval), or .
- **Actionables & Commitments:** Automatically detects commitments made to you or tasks you mention. Syncs approved items to **Google Tasks** or **Microsoft To Do**.
- **Scheduled Messages:** Send one-time or recurring (Cron-based) messages. Supports text, AI-generated, or Voice (TTS) content.
- **Personal Event Detection:** Detects event mentions in any chat and proposes adding them to your personal Google Calendar.
- **Snooze/Resume:** Temporarily silence the bot for specific contacts.
- **Chat History Import:** Learn style from WhatsApp `.txt` exports with automated style summary generation.

### Group Utilities
- **Date Extraction:** Automatically extracts event dates from group chats and creates Google Calendar events.
- **In-group Confirmations:** Interactive calendar confirmations with reply-to-delete functionality.
- **Weekly Task Digests:** AI-generated weekly summaries of group tasks and action items.
- **@mention Travel Search:** Intent parsing for travel requests with real-time Google Search grounding.
- **Keyword Auto-Responders:** Per-group rules for fixed text or AI-generated responses with spam protection.

### Infrastructure
- **WhatsApp Web Engine:** Powered by [Baileys](https://github.com/WhiskeySockets/Baileys) v7 with QR authentication.
- **Process Management:** Runs 24/7 using PM2 with automatic reconnection and exponential backoff.
- **Database:** SQLite with WAL mode, managed via Drizzle ORM for high performance.
- **Dashboard:** Modern React 19 SPA for real-time monitoring, draft approval, and configuration.
- **Logging:** Structured JSON logging via Pino.

## Tech Stack

- **Runtime:** Node.js >= 20, TypeScript (ESNext)
- **WhatsApp:** @whiskeysockets/baileys v7
- **AI/LLM:** Google Gemini 1.5 Flash
- **Voice (TTS):** ElevenLabs API
- **API Server:** Fastify 5
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **Dashboard:** React 19 + Vite + shadcn/ui + TanStack Query
- **Integrations:** Google Calendar API, Google Tasks API, Microsoft Graph API (To Do)
- **Scheduling:** node-cron
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

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key (required) |
| `USER_JID` | Bot owner's WhatsApp JID |
| `OWNER_EXPORT_NAME` | User's name in WhatsApp export files |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for Voice TTS |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Default Voice ID for ElevenLabs |
| `JWT_SECRET` | Min 32 chars, for dashboard auth |
| `DASHBOARD_PASSWORD` | Dashboard login password |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to GCP service account JSON |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | For Google Tasks / Personal Calendar OAuth |
| `MS_CLIENT_ID/SECRET` | For Microsoft To Do integration |
| `DB_PATH` | Path to SQLite database (default: `./data/bot.db`) |
| `API_PORT` | API server port (default: `3000`) |

## Usage

```bash
# Development
npm run dev

# Production
npm start

# PM2 (Always-on)
pm2 start ecosystem.config.cjs
pm2 save
```

## Architecture

```
WhatsApp ←→ Baileys Socket ←→ Message Handler
                                  ├─→ 1:1 Pipeline (Voice, AI, Drafts)
                                  ├─→ Actionables (Commitments, Tasks, Sync)
                                  ├─→ Scheduler (Scheduled Messages, Cron)
                                  └─→ Group Pipeline (Travel, Calendar, Keywords)

Fastify API Server ←→ SQLite (Drizzle ORM)
       ↕
React Dashboard (static SPA)
```

## Project Structure

```
src/
├── whatsapp/        # Connection, Auth state, and Message Sending
├── pipeline/        # Central Message Routing Logic
├── ai/              # Gemini Integration (Style, Replies, Parsing)
├── voice/           # ElevenLabs TTS & Audio Transcoding
├── actionables/     # Commitment & Task Detection Services
├── todo/            # Google Tasks & MS To Do API Integrations
├── scheduler/       # Scheduled & Recurring Message Logic
├── reminders/       # Personal Reminder & Task Notification Services
├── groups/          # Group features (Travel, Calendar, Weekly Digest)
├── calendar/        # Google Calendar Service Integration
├── db/              # Drizzle Schema, Migrations, and Queries
├── api/             # Fastify REST API & Dashboard Serving
├── importer/        # WhatsApp Chat Export Parsing
└── approval/        # Draft Approval & UI/Template logic
```

## Database Tables (Drizzle)

- `messages`: 1:1 chat history for style learning.
- `contacts`: Settings, reply modes, and Voice IDs per contact.
- `drafts`: Pending message approvals.
- `actionables`: Unified lifecycle for detected commitments and tasks.
- `scheduled_messages`: One-time and recurring (cron) message queue.
- `groups`: Configuration and utility toggles for group chats.
- `calendar_events`: Track created group events for confirmations.
- `personal_pending_events`: Staging for personal calendar proposals.
- `keyword_rules`: Per-group auto-responder configurations.

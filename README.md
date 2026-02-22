# WhatsApp Bot

An AI-powered WhatsApp bot that learns your communication style and replies to contacts in your authentic voice. Connects via the WhatsApp Web API so contacts can't tell the bot apart from you.

## Features

- WhatsApp Web connection via [Baileys](https://github.com/WhiskeySockets/Baileys)
- QR code authentication with persistent sessions
- Automatic reconnection with exponential backoff
- SQLite message and contact storage (Drizzle ORM)
- Per-contact mode control: `off`, `draft`, or `auto` reply
- PM2 process management for 24/7 operation
- Structured JSON logging (Pino)

## Tech Stack

- **Runtime:** Node.js >= 20, TypeScript (ESNext)
- **WhatsApp:** @whiskeysockets/baileys
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **Validation:** Zod
- **Logging:** Pino
- **Process Manager:** PM2

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env

# Generate and run database migrations
npm run db:generate
npm run db:migrate
```

## Environment Variables

| Variable    | Default          | Description                          |
|-------------|------------------|--------------------------------------|
| `NODE_ENV`  | `development`    | `development` or `production`        |
| `LOG_LEVEL` | `info`           | `silent`, `error`, `warn`, `info`, `debug` |
| `AUTH_DIR`  | `./data/auth`    | Baileys session credentials path     |
| `DB_PATH`   | `./data/bot.db`  | SQLite database path                 |

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

On first run, scan the QR code displayed in the terminal with your WhatsApp mobile app. The session persists across restarts.

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Environment config (Zod validated)
├── whatsapp/
│   ├── connection.ts     # Baileys socket & auth state
│   └── reconnect.ts      # Reconnection & backoff logic
├── db/
│   ├── schema.ts         # Drizzle schema (messages, contacts)
│   └── client.ts         # SQLite initialization & migrations
├── pipeline/             # Message processing (WIP)
└── types/
```

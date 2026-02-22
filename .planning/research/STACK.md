# Stack Research

**Domain:** WhatsApp AI Bot (impersonation / auto-reply)
**Researched:** 2026-02-22
**Overall Confidence:** MEDIUM — WhatsApp layer is MEDIUM (unofficial API, fast-moving); AI and backend layers are HIGH.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 20 LTS (min v18) | Runtime | LTS with long support window; Baileys and whatsapp-web.js both require v18+. Node 20 adds native fetch, better ESM support. |
| TypeScript | 5.x | Language | Baileys v7 ships full TypeScript types; type safety is essential given the complexity of WhatsApp message event shapes. |
| `@whiskeysockets/baileys` | 7.0.0-rc.9 (latest) | WhatsApp Web connection | Pure WebSocket implementation — no Puppeteer/browser, ~50 MB RAM vs 300-600 MB for whatsapp-web.js. Supports multi-device natively. Only active fork since original author removed their repo. |
| `@google/genai` | 1.42.0 | Gemini AI inference | The official GA SDK replacing the deprecated `@google/generative-ai` (EOL Aug 31 2025). Supports gemini-2.5-flash model directly. |
| Fastify | 5.x | Web dashboard API server | 3-4x faster than Express in benchmarks; first-class TypeScript and JSON schema support; ideal for a co-located API + dashboard backend. |
| React + Vite | React 19 / Vite 6 | Web dashboard UI | Largest ecosystem for admin UIs; most admin component libraries (shadcn/ui, Radix, Ant Design) target React. Vite provides fast HMR. |
| Drizzle ORM + better-sqlite3 | Drizzle 0.38.x / better-sqlite3 11.x | Persistent storage | SQLite is the right choice for a single home server — zero network overhead, no daemon. Drizzle gives TypeScript-native schema + migrations without heavy abstraction. |
| PM2 | 5.x | Process management / persistent service | Developer-friendly process manager for Node.js; `pm2 startup` generates a systemd unit automatically. Cluster mode, log rotation, and `pm2 save` for reboot persistence. Preferred over raw systemd for Node.js services. |

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.x | Schema validation | Validate incoming dashboard requests, Gemini responses, and WhatsApp message payloads before acting on them. |
| `pino` | 9.x | Structured logging | Fast JSON logger with Fastify native integration. Essential for diagnosing WhatsApp connection drops and AI response issues. |
| `dotenv` | 16.x | Environment config | Load `GEMINI_API_KEY` and other secrets from `.env`; never hardcode. |
| `node-cron` | 3.x | Scheduled tasks | Periodic tasks: prune old message history, re-check pending drafts, session health checks. |
| `ws` | 8.x | WebSocket (dashboard live updates) | Push real-time status updates from bot process to dashboard — connection state, last message received, pending approvals. |
| `jsonwebtoken` | 9.x | Dashboard auth | Simple JWT-based auth for the local dashboard (no external auth service needed for home server). |
| `@tanstack/react-query` | 5.x | Dashboard data fetching | Server-state management for the React dashboard; handles caching, polling, and optimistic updates out of the box. |
| `shadcn/ui` | latest | Dashboard UI components | Un-opinionated, copy-paste React components built on Radix + Tailwind. Best choice for a custom admin panel without locking into a bloated component framework. |
| `tailwindcss` | 4.x | Dashboard styling | Required by shadcn/ui; pairs with Vite natively. |

---

### Development Tools

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| `tsx` | 4.x | TypeScript execution (dev) | Runs `.ts` files directly in development without a separate build step; faster feedback than `ts-node`. |
| `vitest` | 2.x | Testing | Native ESM support, fast, Vite-compatible. Required because Baileys v7 moves to ESM-only. |
| `eslint` + `@typescript-eslint` | ESLint 9.x | Linting | Enforce code quality; catch async/await misuse common in WhatsApp event handlers. |
| `tsup` | 8.x | Build (bot process) | Bundles the TypeScript bot process into a single CJS/ESM output for PM2 to run. |

---

## Installation

```bash
# Core runtime
npm init -y
npm pkg set type="module"   # Baileys v7 requires ESM

# WhatsApp layer
npm i @whiskeysockets/baileys

# AI layer
npm i @google/genai

# Backend / API
npm i fastify @fastify/cors @fastify/static @fastify/jwt

# Storage
npm i drizzle-orm better-sqlite3
npm i -D drizzle-kit @types/better-sqlite3

# Utilities
npm i zod pino pino-pretty dotenv node-cron ws jsonwebtoken

# Dashboard (React + Vite, in a /dashboard subdirectory)
npm create vite@latest dashboard -- --template react-ts
cd dashboard && npm i @tanstack/react-query tailwindcss shadcn-ui

# Dev tools
npm i -D typescript tsx tsup vitest eslint @typescript-eslint/parser @types/node
```

> **Node.js version on Ubuntu:** Install via `nvm` (`nvm install 20 && nvm alias default 20`) rather than `apt` to get a current LTS version. Ubuntu 24.04's apt Node is typically older.

```bash
# PM2 (global install)
npm i -g pm2
pm2 start dist/bot.js --name whatsapp-bot
pm2 startup   # generates systemd unit
pm2 save      # persists process list across reboots
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| WhatsApp library | `@whiskeysockets/baileys` | `whatsapp-web.js` | whatsapp-web.js uses Puppeteer (300-600 MB RAM, 5-10s startup). On a home server running 24/7, the resource difference is significant. Baileys runs at ~50 MB. |
| WhatsApp library | `@whiskeysockets/baileys` | `venom-bot` | Venom-bot is also Puppeteer-based. Less active maintenance than Baileys. |
| AI SDK | `@google/genai` | `@google/generative-ai` | Deprecated — Google ends all support August 31 2025. Do not use for greenfield. |
| Database | SQLite (Drizzle) | PostgreSQL | PostgreSQL adds operational overhead (daemon, networking, backups) for a single home server with one user. SQLite is sufficient and simpler. |
| Database ORM | Drizzle | Prisma | Prisma generates a binary engine (~50 MB) and is overkill for a single-server SQLite setup. Drizzle is lightweight, SQL-native, and has no runtime magic. |
| Process manager | PM2 | Raw systemd unit | PM2 provides `pm2 logs`, `pm2 monit`, and cluster mode — significantly better DX for a solo developer. PM2 still uses systemd under the hood for boot persistence. |
| Dashboard framework | React + Vite | SvelteKit | Svelte has fewer admin UI libraries and component ecosystems. React's shadcn/ui and Radix ecosystem are more complete for a dashboard with tables, modals, and forms. |
| Dashboard framework | React + Vite | Next.js | Next.js SSR overhead is unnecessary for a local home server dashboard. Vite + React SPA served statically by Fastify is simpler and avoids the Next.js server runtime. |
| Web framework | Fastify | Express | Express is slower and lacks native TypeScript types. For a greenfield 2026 project, Fastify has no downside over Express for this use case. |

---

## What NOT to Use

### `@google/generative-ai` (old SDK)
Google has officially ended support for this package as of August 31 2025. Any tutorial or example still referencing `import { GoogleGenerativeAI } from "@google/generative-ai"` is outdated. Use `@google/genai` exclusively.

### `whatsapp-web.js` for a resource-constrained home server
The Puppeteer dependency inflates RAM to 300-600 MB and causes 5-10 second startup delays. On a home Ubuntu server also running other services, this is wasteful. Baileys solves this with a native WebSocket implementation.

### WhatsApp Business Cloud API (Meta's official API)
Requires a verified business phone number, Meta approval, and per-message fees. Not compatible with personal WhatsApp accounts. The project goal (impersonating a personal user) requires the Web API approach.

### `venom-bot` or `botmaker`
Both are Puppeteer-based (same resource problems as whatsapp-web.js) and have less active community maintenance than Baileys in 2025-2026.

### Node.js built-in SQLite (node:sqlite, added in Node 22)
Still experimental as of Node 22. No ORM integration, no migration tooling. Use Drizzle + better-sqlite3 for production-quality storage.

### Redis for session storage
Adds a network daemon with no benefit on a single home server. SQLite file-based auth state (Baileys' `useMultiFileAuthState`) or a custom SQLite auth store is sufficient.

---

## Key Risk: WhatsApp Account Ban

**Confidence: HIGH — this is a real and documented risk.**

Using Baileys (or any unofficial WhatsApp Web API) on a personal account violates WhatsApp's Terms of Service. Meta has automated detection for bot-like behavior. The risk profile in 2026:

- **Detection triggers:** High message volume, uniform message timing, unsolicited outbound messages to non-contacts, running 24/7 without human-like gaps.
- **Mitigation for this use case:** The bot replies only to selected contacts (not bulk outreach), uses human-like reply delays, and responds to inbound messages — this is lower-risk than outbound spam bots.
- **Worst case:** Account permanently banned. Use a secondary/dedicated WhatsApp account, not your primary personal account.
- **2026 policy note:** Meta banned general-purpose AI chatbots on the *Business* Platform from January 15 2026. This policy applies to the official Business API, not personal accounts using the Web API. However, overall enforcement posture is tightening.

---

## Sources

- [GitHub: WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) — official Baileys repository
- [Baileys Documentation](https://baileys.wiki/docs/intro/) — official wiki (v7, work in progress)
- [Baileys v7 Migration Guide](https://baileys.wiki/docs/migration/to-v7.0.0/) — ESM migration, JID restructuring, auth state changes
- [npm: @whiskeysockets/baileys](https://www.npmjs.com/package/@whiskeysockets/baileys) — current version 7.0.0-rc.9
- [npm: @google/genai](https://www.npmjs.com/package/@google/genai) — current version 1.42.0
- [Gemini API Pricing 2026](https://ai.google.dev/gemini-api/docs/pricing) — gemini-2.5-flash pricing
- [npm: whatsapp-web.js](https://www.npmjs.com/package/whatsapp-web.js) — current version 1.34.6
- [PM2 vs systemd comparison](https://www.xeg.io/shared-searches/why-pm2-is-preferred-over-systemctl-for-nodejs-applications-67078e84899198cfc914d3f5) — Node.js process management tradeoffs
- [Express vs Fastify 2025](https://medium.com/codetodeploy/express-or-fastify-in-2025-whats-the-right-node-js-framework-for-you-6ea247141a86) — framework comparison
- [Node.js ORM comparison 2025](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/) — Drizzle vs Prisma
- [WhatsApp unofficial API risk analysis](https://www.bot.space/blog/whatsapp-api-vs-unofficial-tools-a-complete-risk-reward-analysis-for-2025) — ban risk documentation
- [Meta 2026 AI chatbot policy](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) — general-purpose bot restrictions
- [BrightCoding: Building with Baileys 2025](https://www.blog.brightcoding.dev/2025/08/28/building-whatsapp-bots-integrations-with-baileys/) — practical Baileys integration guide

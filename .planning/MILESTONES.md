# Milestones

## v1.0 Foundation (Shipped: 2026-02-22)

**Phases completed:** 3 phases (1-3), 9 plans
**LOC:** ~1,500 TypeScript (backend)

**Key accomplishments:**
- WhatsApp connection via Baileys with QR auth, session persistence, and auto-reconnect
- Gemini AI response engine with per-contact context isolation and persona system prompts
- Draft queue with pending/approved/rejected lifecycle for supervised replies
- Style learning from imported WhatsApp .txt chat exports with Gemini style summaries
- Auto-reply mode with 20-reply cap, 5s cooldown, and snooze/resume commands
- Contact whitelist with per-contact mode, relationship context, and custom instructions

---

## v1.1 Dashboard & Groups (Shipped: 2026-02-24)

**Phases completed:** 4 phases (6-9), 13 plans
**Timeline:** 2 days (2026-02-22 to 2026-02-24)
**LOC:** ~7,700 TypeScript (3,570 backend + 3,254 dashboard + 880 CLI)
**Commits:** 65

**Key accomplishments:**
- Fastify REST API with JWT auth, SSE live status, and static dashboard serving
- React SPA dashboard (Vite + shadcn/ui + TanStack Query) for managing contacts, drafts, groups, and bot connection status with QR re-auth
- Commander.js + Ink CLI for server-side management of contacts, groups, drafts, and chat imports over SSH
- Group message monitoring with Google Calendar integration — Gemini date extraction, per-group calendars, in-group confirmations, reply-to-delete
- Weekly AI-inferred task reminder scheduler with node-cron per-group jobs and language-matched posting
- @mention travel search with Gemini intent parsing, Google Search grounding, rich card formatting, reply chain follow-ups, and per-group rate limiting

---


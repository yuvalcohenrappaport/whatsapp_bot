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


## v1.2 Group Auto-Response (Shipped: 2026-02-25)

**Phases completed:** 2 phases (10-11), 4 plans
**Timeline:** 1 day (2026-02-24 to 2026-02-25)
**LOC:** ~8,700 TypeScript (+~1,000 from v1.1)
**Commits:** 11

**Key accomplishments:**
- Keyword rules DB schema, query layer, and CRUD REST API for per-group auto-response configuration
- Keyword matching engine with case-insensitive contains and optional regex, per-rule cooldown, and first-match-wins strategy
- AI-generated responses via Gemini with custom system prompt per rule, integrated into the group message pipeline
- Dashboard keyword rule management UI — create, edit, toggle, delete rules with match count and last triggered stats
- Group picker from WhatsApp participating groups for dashboard rule assignment

---


## v1.3 Voice Responses (Shipped: 2026-03-02)

**Phases completed:** 5 phases (12-16), 9 plans
**Timeline:** 1 day (2026-03-01 to 2026-03-02)
**LOC:** ~9,200 TypeScript (+~500 from v1.2)

**Key accomplishments:**
- ElevenLabs voice infrastructure with API validation, voice clone, and ffmpeg-static binary
- Transcription (STT) via ElevenLabs Scribe v2 and TTS via eleven_v3 with cloned Hebrew voice
- Full voice pipeline: voice message → transcribe → Gemini reply → TTS → PTT voice note send
- Draft queue voice integration with lazy TTS at approval (no audio generated until ✅)
- Per-contact voice toggle via dashboard and CLI, hot-reloaded without restart

---

## v1.4 Travel Agent (Shipped: 2026-03-02)

**Phases completed:** 5 phases (17-21), 12 plans
**Timeline:** 1 day (2026-03-02)
**LOC:** ~6,500 TypeScript (src/) — +6,583 / -201 lines changed
**Commits:** 51

**Key accomplishments:**
- Pipeline audit and bugfix — grounding URL extraction, reply chain framing, fromMe guard reorder, NaN date filter
- Trip memory system — always-listening context accumulator with pre-filter, debounce, Gemini classifier, and structured decision persistence
- Suggest-then-confirm itinerary — calendar additions propose before adding, with reply-based confirm/reject lifecycle and 30-min TTL
- Enriched travel search — Maps Grounding with ratings/reviews/addresses, compact formatter, booking domain labels, queryType-based result counts
- Travel intelligence — open item tracking in weekly digest with auto-resolution, proactive destination-aware suggestions with rate limiting
- History recall — "@bot what did we decide?" queries answered from stored decisions + FTS5 chat history search

---


## v1.8 Task Approval & Context Enrichment (Shipped: 2026-04-20)

**Phases completed:** 35 phases, 93 plans, 23 tasks

**Key accomplishments:**
- (none recorded)

---


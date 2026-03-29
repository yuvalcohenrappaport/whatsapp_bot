# WhatsApp Bot

## What This Is

An AI-powered WhatsApp bot that impersonates the user in private conversations and provides group utilities. It connects to WhatsApp via Baileys, learns the user's communication style from chat history, and replies to selected contacts automatically or via draft approval. For groups, it monitors messages, extracts dates to Google Calendar with suggest-then-confirm flow, posts weekly task reminders with trip status, responds to @mention travel searches with Maps Grounding, auto-responds to keyword-triggered messages, remembers trip decisions across conversations, and proactively suggests activities when destinations are confirmed. Managed through a web dashboard, CLI, and runs 24/7 on a home server. Supports voice replies via ElevenLabs voice clone.

## Core Value

The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## Current Milestone: v1.6 Scheduled Replies

**Goal:** Let the owner schedule messages to any contact or group from the dashboard, with support for text, voice, and AI-generated content on one-off or recurring schedules.

**Target features:**
- Dashboard form to schedule messages (pick recipient, write content, set date/time)
- Three message types: plain text, voice note (ElevenLabs TTS), AI-generated (Gemini prompt at send time)
- Recurring schedules (daily/weekly/monthly)
- Dashboard management page to view, edit, and cancel scheduled messages
- WhatsApp self-chat notification before each send with cancel option

## Current State

**Shipped:** v1.0 Foundation + v1.1 Dashboard & Groups + v1.2 Group Auto-Response + v1.3 Voice Responses + v1.4 Travel Agent + v1.5 Personal Assistant
**Codebase:** ~6,500 LOC TypeScript (src/)
**Tech stack:** Baileys v7 + Gemini 2.5 Flash + Fastify 5 + React 19 + shadcn/ui + Drizzle/SQLite + Commander.js/Ink + googleapis + ElevenLabs

## Requirements

### Validated

- ✓ WhatsApp connection with QR auth, session persistence, auto-reconnect — v1.0
- ✓ Gemini AI replies with per-contact context isolation and persona prompts — v1.0
- ✓ Draft queue (pending/approved/rejected) with WhatsApp approval commands — v1.0
- ✓ Style learning from imported .txt chat exports — v1.0
- ✓ Auto-reply mode with safety guardrails (cap, cooldown, snooze) — v1.0
- ✓ Contact whitelist with mode, relationship, and custom instructions — v1.0
- ✓ Web dashboard for contacts, drafts, groups, connection status, QR re-auth — v1.1
- ✓ CLI for contacts, groups, drafts, imports, calendar members — v1.1
- ✓ Group message monitoring with Google Calendar date extraction — v1.1
- ✓ Per-group calendars shared with member emails — v1.1
- ✓ In-group calendar confirmations with reply-to-delete — v1.1
- ✓ Weekly AI task reminder scheduler — v1.1
- ✓ @mention travel search with Gemini intent parsing and Google Search grounding — v1.1
- ✓ Per-group keyword rules with contains and regex matching — v1.2
- ✓ Fixed text and AI-generated auto-responses with per-rule cooldown — v1.2
- ✓ Keyword handler integrated into group pipeline (after travel, before date extraction) — v1.2
- ✓ Dashboard UI for creating, editing, toggling, and deleting keyword rules — v1.2
- ✓ Dashboard displays rule match count and last triggered time — v1.2
- ✓ Voice message transcription via ElevenLabs Scribe v2 — v1.3
- ✓ Voice response generation (TTS) with cloned Hebrew voice via ElevenLabs eleven_v3 — v1.3
- ✓ Per-contact voice reply toggle with dashboard and CLI controls — v1.3
- ✓ Voice replies follow existing draft queue mode with lazy TTS at approval — v1.3
- ✓ Pipeline audit: travel search URLs fixed, calendar extraction bugs resolved — v1.4
- ✓ Trip memory: structured decision storage with always-listening context accumulation — v1.4
- ✓ Chat history recall: "@bot what did we decide?" answered from stored decisions + FTS5 — v1.4
- ✓ Open question tracking with auto-resolution and weekly digest surfacing — v1.4
- ✓ Suggest-then-confirm calendar flow replacing silent auto-add — v1.4
- ✓ Enriched calendar events with location, description, and links — v1.4
- ✓ Maps Grounding search with ratings, reviews, addresses, and booking labels — v1.4
- ✓ Proactive destination-aware activity suggestions with rate limiting — v1.4
- ✓ Trip-aware weekly digest with open questions and trip status section — v1.4
- ✓ Universal calendar event detection from all chats (private + group) — v1.5
- ✓ Suggest-then-confirm flow for detected events — v1.5
- ✓ Smart reminders via WhatsApp messages and calendar events — v1.5
- ✓ Commitment detection with proactive follow-up reminders — v1.5
- ✓ Microsoft To Do sync via Graph API with auto-detected tasks — v1.5

### Active

- [ ] Dashboard form to create scheduled messages with recipient, content, and date/time
- [ ] Plain text scheduled message delivery at specified time
- [ ] Voice note scheduled messages via ElevenLabs TTS
- [ ] AI-generated scheduled messages (Gemini generates from prompt at send time)
- [ ] Recurring schedule support (daily/weekly/monthly)
- [ ] Dashboard page to view, edit, and cancel scheduled messages
- [ ] WhatsApp self-chat pre-send notification with cancel option
- [ ] Restart-safe persistence (DB-backed scheduling)

### Out of Scope

- Bot replying conversationally in groups — groups are utility-only (calendar, reminders, travel search, keyword auto-response, trip memory)
- Media/image responses — text replies only
- Mobile app — web dashboard via Tailscale is sufficient
- Multiple WhatsApp accounts — single account only
- Fine-tuning a local LLM — Gemini few-shot prompting achieves quality without training
- Bulk messaging / outreach — triggers WhatsApp bans
- Booking/purchasing through the bot — bot finds options, users book themselves
- Cross-group global keyword rules — per-group only for simplicity
- Rule chains (one rule triggers another) — single match, single response
- Voice replies in groups — groups are utility-only; voice is for private impersonation
- Real-time voice calls — far beyond current Baileys capabilities
- Full booking integration (reservations) — requires OAuth, payment handling, API partnerships
- Expense splitting / budget tracking — Splitwise does this well
- Flight/hotel price monitoring — requires continuous polling of external APIs
- WhatsApp reaction-based voting — reaction events unreliable in Baileys
- "Plan the whole trip" wizard flows — group chats are non-linear
- Rich media maps/photo galleries — WhatsApp text-only constraints
- Automatic cross-calendar deduplication — requires reading personal calendars

## Context

- Runs on yuval-server (Ubuntu 24.04 LTS, always-on home dev server)
- User connects from macOS via Tailscale
- Gemini API for all LLM inference (style matching, date extraction, travel parsing, weekly digests, keyword AI responses, trip classification, history recall, proactive suggestions)
- ElevenLabs API for voice clone TTS and audio transcription (v1.3)
- Baileys v7.0.0-rc.9 with Platform.MACOS patch (WhatsApp rejects Platform.WEB)
- SQLite with WAL mode for concurrent reads during group message processing
- GCP service account for Google Calendar API access
- FTS5 virtual table for full-text search across group message history
- 12 DB migrations (0000-0011), hand-written after 0010 (FTS5 incompatible with drizzle-kit)
- Zero new npm packages added in v1.4 (all features built on existing deps)

## Constraints

- **API**: Gemini API — user's explicit choice
- **WhatsApp**: Unofficial Web API (Baileys) — risk of account restrictions; monitor RC stability
- **Platform**: Must run on Ubuntu 24.04 (yuval-server)
- **Privacy**: All chat data stays local on the server, never sent to third parties except Gemini API for inference and ElevenLabs API for voice processing
- **Voice**: ElevenLabs API — voice clone TTS and transcription
- **Cost**: Pre-filter non-travel messages in JS before Gemini calls — prevents cost explosion ($1-3/month vs $15-40/month)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Gemini API for LLM | User preference | ✓ Good — handles all AI tasks |
| Baileys v7 (unofficial WhatsApp) | Only way to automate personal WhatsApp | ⚠️ Revisit — RC stability, needed Platform.MACOS patch |
| Fastify 5 over Express | First-class TypeScript, serves static dashboard | ✓ Good |
| GCP service account for Calendar | Avoids 7-day OAuth2 token expiry | ✓ Good |
| Gemini Google Search grounding | Cheerio scraping broken (Google returns JS-rendered pages) | ✓ Good — replaced by Maps Grounding in v1.4 |
| Per-contact mode toggle | Flexibility between auto and supervised | ✓ Good |
| shadcn/ui + Tailwind 4 | Fast dashboard development with good defaults | ✓ Good |
| Commander.js + Ink for CLI | Rich terminal UI for SSH management | ✓ Good |
| node-cron inside process | PM2 cron_restart kills WhatsApp session | ✓ Good |
| Callback registration pattern | Extensible pipeline without modifying messageHandler | ✓ Good |
| Non-terminal keyword handler | Keyword match + date extraction can both fire on same message | ✓ Good |
| ElevenLabs for voice | Single API for both directions, high-quality Hebrew voice cloning | ✓ Good |
| Maps Grounding for travel search | Structured place data with ratings/addresses | ✓ Good — replaced Google Search grounding |
| Suggest-then-confirm for calendar | User control over what gets added to calendar | ✓ Good — eliminated silent auto-adds |
| Pre-filter before Gemini classifier | JS keyword check prevents $15-40/month API cost | ✓ Good — $1-3/month with filter |
| In-memory proactive rate limits | No new DB tables, acceptable restart behavior | ✓ Good — simplicity over persistence |
| FTS5 for chat history search | SQLite built-in, no external search engine | ✓ Good — fast recall queries |
| Hand-written migrations after 0010 | FTS5 virtual tables incompatible with drizzle-kit | ✓ Good — never run db:generate after 0010 |

---
*Last updated: 2026-03-30 after v1.6 Scheduled Replies milestone started*

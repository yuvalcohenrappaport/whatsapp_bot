# WhatsApp Bot

## What This Is

An AI-powered WhatsApp bot that impersonates the user in private conversations and provides group utilities. It connects to WhatsApp via Baileys, learns the user's communication style from chat history, and replies to selected contacts automatically or via draft approval. For groups, it monitors messages, extracts dates to Google Calendar, posts weekly task reminders, responds to @mention travel searches, and auto-responds to keyword-triggered messages with fixed text or AI-generated replies. Managed through a web dashboard, CLI, and runs 24/7 on a home server.

## Core Value

The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## Current Milestone: v1.3 Voice Responses

**Goal:** Enable the bot to receive voice messages, transcribe them, generate replies, and respond with AI-generated voice messages using a cloned voice via ElevenLabs.

**Target features:**
- Incoming voice message transcription via ElevenLabs
- AI text reply generation via Gemini (existing pipeline)
- Text-to-speech with cloned Hebrew voice via ElevenLabs
- Send voice response as WhatsApp audio message
- Per-contact voice reply toggle (on/off)
- Draft queue integration (follows contact's existing mode)
- Dashboard/CLI support for voice settings

## Current State

**Shipped:** v1.0 Foundation + v1.1 Dashboard & Groups + v1.2 Group Auto-Response
**Codebase:** ~8,700 LOC TypeScript (backend ~4,500 + dashboard ~3,300 + CLI ~880)
**Tech stack:** Baileys v7 + Gemini 2.5 Flash + Fastify 5 + React 19 + shadcn/ui + Drizzle/SQLite + Commander.js/Ink + googleapis

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

### Active

- [ ] Voice message transcription via ElevenLabs API
- [ ] Voice response generation (TTS) with cloned Hebrew voice via ElevenLabs
- [ ] Per-contact voice reply toggle
- [ ] Voice replies follow existing draft queue mode
- [ ] Dashboard and CLI voice settings management

### Out of Scope

- Bot replying conversationally in groups — groups are utility-only (calendar, reminders, travel search, keyword auto-response)
- Media/image responses — text replies only
- Mobile app — web dashboard via Tailscale is sufficient
- Multiple WhatsApp accounts — single account only
- Fine-tuning a local LLM — Gemini few-shot prompting achieves quality without training
- Bulk messaging / outreach — triggers WhatsApp bans
- Booking/purchasing through the bot — bot finds options, users book themselves
- Cross-group global keyword rules — per-group only for simplicity
- Rule chains (one rule triggers another) — single match, single response

## Context

- Runs on yuval-server (Ubuntu 24.04 LTS, always-on home dev server)
- User connects from macOS via Tailscale
- Gemini API for all LLM inference (style matching, date extraction, travel parsing, weekly digests, keyword AI responses)
- ElevenLabs API for voice clone TTS and audio transcription (v1.3)
- Baileys v7.0.0-rc.9 with Platform.MACOS patch (WhatsApp rejects Platform.WEB)
- SQLite with WAL mode for concurrent reads during group message processing
- GCP service account for Google Calendar API access

## Constraints

- **API**: Gemini API — user's explicit choice
- **WhatsApp**: Unofficial Web API (Baileys) — risk of account restrictions; monitor RC stability
- **Platform**: Must run on Ubuntu 24.04 (yuval-server)
- **Privacy**: All chat data stays local on the server, never sent to third parties except Gemini API for inference and ElevenLabs API for voice processing
- **Voice**: ElevenLabs API — voice clone TTS and transcription

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Gemini API for LLM | User preference | ✓ Good — handles all AI tasks (replies, extraction, parsing, digests, keyword AI responses) |
| Baileys v7 (unofficial WhatsApp) | Only way to automate personal WhatsApp | ⚠️ Revisit — RC stability, needed Platform.MACOS patch |
| Fastify 5 over Express | First-class TypeScript, serves static dashboard | ✓ Good |
| GCP service account for Calendar | Avoids 7-day OAuth2 token expiry | ✓ Good |
| Gemini Google Search grounding | Cheerio scraping broken (Google returns JS-rendered pages) | ✓ Good — returns real URLs and prices |
| Per-contact mode toggle | Flexibility between auto and supervised | ✓ Good |
| shadcn/ui + Tailwind 4 | Fast dashboard development with good defaults | ✓ Good |
| Commander.js + Ink for CLI | Rich terminal UI for SSH management | ✓ Good |
| node-cron inside process | PM2 cron_restart kills WhatsApp session | ✓ Good |
| Callback registration pattern | Extensible pipeline without modifying messageHandler | ✓ Good |
| Non-terminal keyword handler | Keyword match + date extraction can both fire on same message | ✓ Good |
| In-memory cooldown map | Per-rule cooldown resets on restart — acceptable for keyword rules | ✓ Good |
| Dialog inside Sheet via Radix Portal | Avoids z-index conflicts; form renders to document.body | ✓ Good |

| ElevenLabs for voice (TTS + transcription) | Single API for both directions, high-quality Hebrew voice cloning | — Pending |

---
*Last updated: 2026-02-28 after v1.3 milestone started*

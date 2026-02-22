# WhatsApp Bot

## What This Is

An AI-powered WhatsApp bot that impersonates the user in conversations. It connects to WhatsApp via the Web API, learns the user's communication style from chat history and custom instructions, and replies to selected contacts automatically — or drafts responses for manual approval. Managed through a web dashboard and runs 24/7 on a home server.

## Core Value

The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Connect to WhatsApp via Web API (whatsapp-web.js or Baileys)
- [ ] Receive and process incoming messages in real-time
- [ ] Send replies through WhatsApp on behalf of the user
- [ ] Use Gemini API to generate responses
- [ ] Feed full chat history as context for style matching
- [ ] Import chat history from WhatsApp's built-in export (.txt files)
- [ ] Learn from live messages going forward after initial import
- [ ] Support custom instructions per contact (e.g., "be brief", "use more emoji")
- [ ] Select specific contacts the bot handles
- [ ] Toggle between auto-reply and suggest-and-approve modes per contact
- [ ] Web dashboard for managing contacts, viewing conversations, and approving replies
- [ ] Run as a persistent service on yuval-server (always-on)

### Out of Scope

- Group chat support — complexity of multi-party conversation, defer to later
- Voice messages — text-only for v1
- Media/image responses — text replies only
- Mobile app — web dashboard sufficient
- Multiple WhatsApp accounts — single account only

## Context

- Runs on yuval-server (Ubuntu 24.04 LTS, always-on home dev server)
- User connects from macOS via Tailscale
- Gemini API for LLM inference (user's choice over other providers)
- WhatsApp Web API requires QR code scan for initial authentication, then maintains session
- Chat history provides both style reference and conversation context
- Two modes per contact: fully automatic (bot sends immediately) and suggest-and-approve (user reviews in dashboard before sending)

## Constraints

- **API**: Gemini API — user's explicit choice
- **WhatsApp**: Unofficial Web API (no official WhatsApp Business API) — risk of account restrictions
- **Platform**: Must run on Ubuntu 24.04 (yuval-server)
- **Privacy**: All chat data stays local on the server, never sent to third parties except Gemini API for inference

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Gemini API for LLM | User preference | — Pending |
| WhatsApp Web API (unofficial) | Only way to automate personal WhatsApp | — Pending |
| Web dashboard for management | User wants visual interface to manage contacts and approve replies | — Pending |
| Per-contact mode toggle | Flexibility between full auto and supervised replies | — Pending |

---
*Last updated: 2026-02-22 after initialization*

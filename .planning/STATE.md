# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 3 — Style Learning and Auto Mode

## Current Position

Phase: 3 of 5 (Style Learning and Auto Mode)
Plan: 3 of 3 complete
Status: Phase Complete

Last activity: 2026-02-22 — Plan 03-03 complete (commit `acff62d`) — gap closure: fromMe filter + .run() fixes

Progress: [██████░░░░] 60%

## Performance Metrics

**Phases completed:** 2 of 5
- Phase 1: WhatsApp Foundation — complete
- Phase 2: AI Response Engine — complete

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Baileys over whatsapp-web.js: eliminates Puppeteer, ~50 MB RAM vs 300-600 MB, WebSocket-native
- @google/genai (not @google/generative-ai): old SDK is EOL August 2025
- Fastify over Express: first-class TypeScript, faster, serves dashboard static build
- Drizzle + SQLite: zero operational overhead, no daemon, single-server personal use
- Draft-approval mode first: quality gate before enabling auto-send per contact
- Node.js 20 via nvm: system Node 18 rejected by Baileys; nvm default set to 20.20.0
- Drizzle 0.45 array-style index API: use `(t) => [index(...)]` not deprecated object syntax
- Hand-rolled regex parser for WhatsApp .txt format (no external library): D/M/YY, HH:MM - Author: Message
- Few-shot style examples injected in systemInstruction only (not fake conversation turns)
- 10-message threshold for Gemini style summary generation; fewer messages stored as few-shot pool only
- buildSystemPrompt is async (awaits getStyleExamples DB call); generateReply updated accordingly
- [Phase 03]: 30s cooldown stored in-memory only — ephemeral, resets on restart, not persisted to DB
- [Phase 03]: lastNotifiedJid is module-scoped — always refers to most recently notified contact
- [Phase 03]: Snooze check placed before generateReply so it covers both draft and auto modes from a single guard

### Pending Todos

None yet.

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability in production
- Gemini free tier rate limits (5-15 RPM) may need paid tier under load

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 03-03-PLAN.md — gap closure: fromMe filter + all 12 .run() calls fixed
Resume with: `/gsd:execute-phase 04` (Phase 4 next)
Resume file: .planning/phases/03-style-learning-and-auto-mode/03-03-SUMMARY.md

### What's Built (Phases 1+2)

| Component | Status |
|-----------|--------|
| TypeScript ESM scaffold, Drizzle + SQLite | Done |
| Baileys connection, QR auth, session persistence | Done |
| Reconnect with exponential backoff | Done |
| Message pipeline (filter, dedup, persist) | Done |
| Per-contact modes: off / draft / auto | Done |
| Gemini AI integration (system prompt, 50-msg context) | Done |
| Draft approval via WhatsApp (✅/❌) | Done |
| Typing indicator + human-like delay | Done |
| Chat history importer + style injection | Done |
| Auto-reply guardrails + snooze + live learning | Done |

### Phase 3 Scope (Complete)

| Plan | What it builds |
|------|----------------|
| 03-01 | Chat history importer — parse WhatsApp .txt export, extract user messages, inject as style examples |
| 03-02 | Auto-reply mode and snooze — per-contact auto-send with delay, snooze with expiry |
| 03-03 | Gap closure — fromMe filter in getStyleExamples(), all 12 .run() calls added to messageHandler.ts |

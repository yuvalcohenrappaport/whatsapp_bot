# Roadmap: WhatsApp Bot

## Overview

Build an AI-powered WhatsApp bot that impersonates the user in authentic voice. The journey moves from a solid WhatsApp connection layer (with ban mitigations baked in from day one) through Gemini AI integration in safe draft-approval mode, then style learning and autonomous sending, a full web dashboard for management, and finally production hardening for 24/7 unattended operation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: WhatsApp Foundation** - Authenticated Baileys connection with session persistence, send safety, and deduplication
- [ ] **Phase 2: AI Response Engine** - Gemini integration with per-contact context isolation and draft-approval pipeline
- [ ] **Phase 3: Style Learning and Auto Mode** - Chat history import for style matching and autonomous per-contact sending
- [ ] **Phase 4: Web Dashboard** - React management UI for contacts, drafts, and bot status
- [ ] **Phase 5: Production Hardening** - Alerting, log rotation, and operational readiness for 24/7 unattended use

## Phase Details

### Phase 1: WhatsApp Foundation
**Goal**: The bot reliably connects to WhatsApp, maintains its session, and safely handles messages without triggering a ban
**Depends on**: Nothing (first phase)
**Requirements**: WA-01, WA-02, WA-03, WA-04, WA-05, WA-06, WA-07, OPS-01, OPS-02, OPS-04
**Success Criteria** (what must be TRUE):
  1. User can scan a QR code once and the bot stays authenticated across server reboots without re-scanning
  2. Bot receives incoming WhatsApp text messages in real-time and logs them to the database
  3. Bot can send a text reply through WhatsApp with a randomized human-like delay before sending
  4. Bot automatically reconnects with exponential backoff after a network drop, without user intervention
  5. Bot deduplicates incoming messages so no message is processed twice even under rapid delivery
**Plans**: TBD

Plans:
- [ ] 01-01: Project scaffold — TypeScript ESM monorepo, Drizzle + SQLite schema, PM2 config, environment setup
- [ ] 01-02: Baileys connection — QR auth, session persistence on disk, reconnect with exponential backoff
- [ ] 01-03: Message pipeline — receive, deduplicate, persist messages; send with randomized delay; group JID filter

### Phase 2: AI Response Engine
**Goal**: The bot generates replies in the user's voice using Gemini and queues them for approval before any message is sent
**Depends on**: Phase 1
**Requirements**: AI-01, AI-02, AI-03, AI-05, CM-01, CM-02, CM-03, CM-04
**Success Criteria** (what must be TRUE):
  1. Bot generates a contextually appropriate reply using Gemini when a whitelisted contact sends a message
  2. Generated reply is queued as a draft (pending/approved/rejected) and not sent until explicitly approved
  3. User can configure a contact with relationship context and custom style instructions that are reflected in the AI reply
  4. Bot only replies to contacts on the whitelist — messages from non-whitelisted contacts are silently ignored
  5. Replies from different contacts never bleed into each other's conversation context
**Plans**: TBD

Plans:
- [ ] 02-01: Contact management — whitelist CRUD, per-contact config (mode, enabled, relationship context, custom instructions), SQLite schema
- [ ] 02-02: Gemini AI service — `startChat()` per contact with JID-scoped context isolation, persona system prompt, history window
- [ ] 02-03: Draft queue — pending → approved → sent/rejected lifecycle, draft persistence, message router dispatching to AI service

### Phase 3: Style Learning and Auto Mode
**Goal**: The bot learns the user's writing style from real chat history and can send replies autonomously per contact
**Depends on**: Phase 2
**Requirements**: AI-04, CM-05
**Success Criteria** (what must be TRUE):
  1. User can import a WhatsApp .txt chat export for a contact and the bot uses those messages as style examples in subsequent replies
  2. A contact in auto-reply mode receives a sent reply without any user action, with a randomized delay before sending
  3. User can snooze the bot for a specific contact temporarily so it stops generating drafts or auto-replying
**Plans**: TBD

Plans:
- [ ] 03-01: Chat history importer — parse WhatsApp .txt export format, extract user-sent messages, inject as few-shot style examples into system prompt
- [ ] 03-02: Auto-reply mode and snooze — per-contact auto-send with randomized delay, snooze with expiry, mode switching logic

### Phase 4: Web Dashboard
**Goal**: User can manage contacts, review and approve drafts, and monitor bot status through a browser UI
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05
**Success Criteria** (what must be TRUE):
  1. User can see all active conversations the bot is handling and their latest message in the dashboard
  2. User can approve, edit, or reject a pending draft reply from the dashboard and it sends (or is discarded) accordingly
  3. User can add, remove, or configure contacts on the whitelist without touching the database directly
  4. Dashboard shows current bot connection status (connected/disconnected/reconnecting) at a glance
**Plans**: TBD

Plans:
- [ ] 04-01: Fastify API server — REST endpoints for contacts, drafts, conversations, status; static file serving for dashboard build
- [ ] 04-02: React dashboard foundation — Vite + React + shadcn/ui scaffold, routing, API client (React Query), connection status indicator
- [ ] 04-03: Contact management UI — whitelist view, add/remove/configure contacts, per-contact mode and instruction editing
- [ ] 04-04: Draft approval UI — pending drafts list, inline edit, approve/reject actions, conversation message view

### Phase 5: Production Hardening
**Goal**: The bot runs unattended 24/7 on yuval-server and alerts the user when something goes wrong
**Depends on**: Phase 4
**Requirements**: OPS-03
**Success Criteria** (what must be TRUE):
  1. User receives an alert notification when the bot has been disconnected or silent for an unexpected period
  2. Bot logs are rotated automatically so disk usage does not grow unbounded over weeks of operation
  3. Bot survives a server reboot and resumes processing within one minute without any manual intervention
**Plans**: TBD

Plans:
- [ ] 05-01: Health monitoring and alerting — heartbeat check, disconnect alert, silence detection, notification delivery (push or log-based)
- [ ] 05-02: Operational polish — PM2 log rotation config, startup smoke test, deployment runbook, secrets management checklist

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. WhatsApp Foundation | 0/3 | Not started | - |
| 2. AI Response Engine | 0/3 | Not started | - |
| 3. Style Learning and Auto Mode | 0/2 | Not started | - |
| 4. Web Dashboard | 0/4 | Not started | - |
| 5. Production Hardening | 0/2 | Not started | - |

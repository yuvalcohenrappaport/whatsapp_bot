# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** - Phases 1-3 (complete 2026-02-22); Phases 4-5 superseded by v1.1
- **v1.1 Dashboard & Groups** - Phases 6-9 (in progress)

## Phases

<details>
<summary>v1.0 Foundation (Phases 1-3) - COMPLETE 2026-02-22</summary>

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
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold: TypeScript ESM project, Drizzle + SQLite schema, PM2 config, environment setup
- [x] 01-02-PLAN.md — Baileys connection: QR auth, session persistence on disk, reconnect with exponential backoff
- [x] 01-03-PLAN.md — Message pipeline: receive, deduplicate, persist messages; send with randomized delay; group JID filter

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
**Plans**: 3 plans

Plans:
- [x] 02-01: Contact management — whitelist CRUD, per-contact config (mode, enabled, relationship context, custom instructions), SQLite schema
- [x] 02-02: Gemini AI service — `startChat()` per contact with JID-scoped context isolation, persona system prompt, history window
- [x] 02-03: Draft queue — pending → approved → sent/rejected lifecycle, draft persistence, message router dispatching to AI service

### Phase 3: Style Learning and Auto Mode
**Goal**: The bot learns the user's writing style from real chat history and can send replies autonomously per contact
**Depends on**: Phase 2
**Requirements**: AI-04, CM-05
**Success Criteria** (what must be TRUE):
  1. User can import a WhatsApp .txt chat export for a contact and the bot uses those messages as style examples in subsequent replies
  2. A contact in auto-reply mode receives a sent reply without any user action, with a randomized delay before sending
  3. User can snooze the bot for a specific contact temporarily so it stops generating drafts or auto-replying
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Chat history importer: DB schema extension, WhatsApp .txt parser, Gemini style summary generation, style-aware prompt injection
- [x] 03-02-PLAN.md — Auto-reply guardrails and snooze: 10-reply cap with auto-switch to draft, 30s cooldown, snooze/resume commands via WhatsApp
- [x] 03-03-PLAN.md — Gap closure: fix fromMe filter in getStyleExamples and add missing .run() to all Drizzle writes in messageHandler

</details>

---

### v1.1 Dashboard & Groups (In Progress)

**Milestone Goal:** Add web and CLI dashboards for bot management, and group chat monitoring that extracts dates to Google Calendar with weekly AI-inferred task reminders and travel search via @mention.

- [x] **Phase 6: Web Dashboard** - Fastify REST API and React SPA for managing contacts, drafts, groups, and bot status in the browser
- [x] **Phase 7: CLI Dashboard** - Commander.js + Ink TUI for server-side management of contacts, groups, drafts, and chat history import over SSH
- [x] **Phase 8: Group Monitoring and Calendar** - Group message ingestion, Google Calendar event extraction via Gemini, per-group calendar creation, in-group confirmations, and weekly AI task reminders (completed 2026-02-23)
- [ ] **Phase 9: Travel Search** - @mention-triggered travel search (flights, hotels, restaurants) using Gemini intent parsing and Google search scraping

## Phase Details

### Phase 6: Web Dashboard
**Goal**: User can manage the bot's contacts, drafts, groups, and connection status from a browser without touching the server
**Depends on**: Phase 3 (working bot with contacts, drafts, and session)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. User can open the dashboard in a browser (via Tailscale) and see all active conversations the bot is handling with their latest message
  2. User can approve, edit inline, or reject a pending draft reply from the dashboard and it is sent or discarded accordingly
  3. User can add, remove, or reconfigure a contact on the whitelist from the dashboard without touching the database
  4. Dashboard shows live bot connection status (connected/disconnected/reconnecting) and a QR code re-auth button that triggers re-authentication in the browser
  5. User can add, remove, or configure tracked groups from the dashboard group management page
**Plans**: 4 plans

Plans:
- [x] 06-01-PLAN.md — Fastify API server: groups table schema, shared bot state module, REST endpoints (contacts, drafts, groups, status/SSE, auth), JWT plugin, static file serving
- [x] 06-02-PLAN.md — React dashboard scaffold: Vite 7 + React 19 + shadcn/ui + Tailwind 4 + TanStack Query; app shell (sidebar, topbar, connection badge); API client with JWT; SSE connection status hook
- [x] 06-03-PLAN.md — Contacts and Overview UI: ContactCard + ContactPanel (mode selector, relationship, custom instructions), add-contact picker from recent chats; Overview stat cards
- [x] 06-04-PLAN.md — Drafts and Groups UI: DraftRow inline edit + approve/reject; GroupCard + GroupPanel (emails, reminder day, calendar link); QR re-auth modal; end-to-end verification

### Phase 7: CLI Dashboard
**Goal**: User can manage the bot from an SSH terminal using a one-shot CLI tool without opening a browser
**Depends on**: Phase 6 (shares Fastify API and Drizzle DB layer established in Phase 6)
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07
**Success Criteria** (what must be TRUE):
  1. User can run `bot status` over SSH and see bot connection state, uptime, active contact count, and tracked group count
  2. User can add, remove, or reconfigure contacts and tracked groups entirely from the CLI without the browser
  3. User can view pending drafts and approve or reject them from the CLI with a single command
  4. User can import a WhatsApp .txt chat history file for a contact from the CLI
  5. User can manage group member email addresses for calendar sharing from the CLI
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — CLI scaffold: Commander.js 14 + Ink 6, standalone DB client, reusable Table component, `bot status` command with PM2 programmatic API
- [x] 07-02-PLAN.md — Contact, group, and import commands: `contacts list/add/remove/configure`, `groups list/add/remove/set-reminder`, `import <file> --contact <jid>`
- [x] 07-03-PLAN.md — Draft and calendar commands: `drafts list/approve/reject`, `calendar members list/add/remove --group <jid>`

### Phase 8: Group Monitoring and Calendar
**Goal**: The bot passively monitors designated WhatsApp groups, extracts date mentions into per-group Google Calendars, confirms extractions in-group, and posts weekly AI-inferred task reminders
**Depends on**: Phase 6 (groups DB schema and management API), Phase 7 (CLI group management)
**Requirements**: GRP-01, GRP-02, GRP-03, GRP-04, CAL-01, CAL-02, CAL-03, CAL-04, CAL-05, REM-01, REM-02
**Success Criteria** (what must be TRUE):
  1. Bot receives and persists messages from tracked WhatsApp groups, ignoring its own outgoing messages
  2. When a group message contains a date, the bot creates a calendar event in that group's dedicated Google Calendar with a smart title, correct date/time, and original message as description
  3. After creating a calendar event, the bot sends a confirmation message in the group (e.g., "Added: Flight landing March 15 at 3pm")
  4. Each tracked group has its own Google Calendar shared with configured group member email addresses
  5. Every week the bot posts a read-only AI-inferred summary of unresolved tasks and upcoming commitments into each tracked group
**Plans**: 4 plans

Plans:
- [x] 08-01-PLAN.md — DB schema extensions (group_messages, calendar_events tables, reminderHour column), group message pipeline upgrade (fromMe guard, active-group filter, sender metadata), GCP service account setup
- [x] 08-02-PLAN.md — Google Calendar service module: googleapis + service account JWT auth, createGroupCalendar, createCalendarEvent, shareCalendar, deleteCalendarEvent
- [x] 08-03-PLAN.md — Date extraction pipeline: chrono-node pre-filter, Gemini structured extraction, 10s batch debounce, calendar event creation, in-group confirmation messages, reply-to-delete
- [x] 08-04-PLAN.md — Weekly reminder scheduler: node-cron per-group jobs, Gemini digest generation (events + tasks + notes), language-matched posting, empty-week skip

### Phase 9: Travel Search
**Goal**: Group members can ask the bot for travel recommendations via @mention and receive formatted search results in the group chat
**Depends on**: Phase 8 (group monitoring infrastructure, group message pipeline, `socketRef.sock` for group sends)
**Requirements**: GRP-05, TRAV-01, TRAV-02, TRAV-03, TRAV-04
**Success Criteria** (what must be TRUE):
  1. A group member can @mention the bot with a travel request (flight, hotel, restaurant) and the bot responds in the group
  2. Bot correctly parses destination, dates, and travel type from the @mention message using Gemini
  3. Bot sends a formatted message with 3-5 travel options (name, price, link) directly into the group chat
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — @mention detection and Gemini intent parsing: extend callback to pass mentionedJids, bot identity in state, travel handler with dual mention detection, travelParser with Zod schema structured output
- [ ] 09-02-PLAN.md — Travel search and formatting: cheerio Google scraper with multi-selector cascade, Gemini knowledge fallback, rich card formatter, reply chain tracking, per-group rate limiting

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WhatsApp Foundation | v1.0 | 3/3 | Complete | 2026-02-22 |
| 2. AI Response Engine | v1.0 | 3/3 | Complete | 2026-02-22 |
| 3. Style Learning and Auto Mode | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Web Dashboard | v1.1 | 4/4 | Complete | 2026-02-23 |
| 7. CLI Dashboard | v1.1 | 3/3 | Complete | 2026-02-23 |
| 8. Group Monitoring and Calendar | v1.1 | 4/4 | Complete | 2026-02-23 |
| 9. Travel Search | v1.1 | 1/2 | In progress | - |

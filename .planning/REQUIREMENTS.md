# Requirements: WhatsApp Bot

**Defined:** 2026-02-22
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.0 Requirements (Shipped)

### WhatsApp Connection

- [x] **WA-01**: Bot connects to WhatsApp via Baileys WebSocket API
- [x] **WA-02**: User can authenticate by scanning QR code
- [x] **WA-03**: Session persists across process restarts (no re-scan needed)
- [x] **WA-04**: Bot receives incoming text messages in real-time
- [x] **WA-05**: Bot sends text replies through WhatsApp on behalf of the user
- [x] **WA-06**: Bot automatically reconnects after network interruption
- [x] **WA-07**: Bot simulates typing delay before sending replies (anti-ban)

### AI Response

- [x] **AI-01**: Bot generates replies using Gemini API (gemini-2.5-flash)
- [x] **AI-02**: Bot includes recent conversation context per contact in Gemini requests
- [x] **AI-03**: Bot uses a system prompt with persona instructions for style matching
- [x] **AI-04**: User can import WhatsApp chat export (.txt) for style learning per contact
- [x] **AI-05**: User can set custom instructions per contact (e.g., "be brief", "use emoji")

### Contact Management

- [x] **CM-01**: User can whitelist specific contacts for bot handling
- [x] **CM-02**: User can toggle between auto-reply and draft-approval modes per contact
- [x] **CM-03**: User can enable/disable the bot per contact
- [x] **CM-04**: User can assign relationship context per contact ("close friend", "work colleague")
- [x] **CM-05**: User can snooze the bot for a specific contact temporarily

### Operations

- [x] **OPS-01**: Bot runs as a persistent PM2-managed service on Ubuntu server
- [x] **OPS-02**: Bot session data persists across server reboots
- [x] **OPS-04**: Bot deduplicates messages to prevent double-replies

## v1.1 Requirements

Requirements for milestone v1.1: Dashboard & Groups. Each maps to roadmap phases.

### Web Dashboard

- [ ] **DASH-01**: User can view active conversations the bot is handling
- [ ] **DASH-02**: User can approve, edit, or reject draft replies from the dashboard
- [ ] **DASH-03**: User can manage the contact whitelist from the dashboard (add/remove/configure)
- [ ] **DASH-04**: User can see bot connection status (connected/disconnected/reconnecting)
- [ ] **DASH-05**: User can manage tracked groups from the dashboard (add/remove/configure)
- [ ] **DASH-06**: User can trigger QR re-auth from the browser

### CLI Dashboard

- [ ] **CLI-01**: User can check bot status (connection, uptime, active contacts/groups)
- [ ] **CLI-02**: User can manage contacts from CLI (add/remove/configure mode/instructions)
- [ ] **CLI-03**: User can manage tracked groups from CLI (add/remove, set reminder day)
- [ ] **CLI-04**: User can view recent conversations and pending drafts from CLI
- [ ] **CLI-05**: User can approve or reject drafts from CLI
- [ ] **CLI-06**: User can import WhatsApp chat history (.txt) from CLI
- [ ] **CLI-07**: User can manage group member emails for calendar sharing from CLI

### Group Monitoring

- [ ] **GRP-01**: User can designate WhatsApp groups for the bot to monitor (via dashboard or CLI)
- [ ] **GRP-02**: Bot receives and persists messages from tracked groups
- [ ] **GRP-03**: Bot pre-filters group messages — only messages containing numbers are sent to Gemini for date extraction
- [ ] **GRP-04**: Bot ignores its own outgoing messages in groups (fromMe guard)
- [ ] **GRP-05**: Bot responds to @mentions by name in tracked groups for travel search requests

### Google Calendar

- [ ] **CAL-01**: Bot uses its own dedicated Gmail account for Google Calendar operations
- [ ] **CAL-02**: Bot creates a dedicated Google Calendar for each tracked group
- [ ] **CAL-03**: Gemini extracts dates from group messages and creates calendar events with smart titles, correct date/time, and original message as description
- [ ] **CAL-04**: Bot shares the group calendar with all group members' email addresses
- [ ] **CAL-05**: Bot confirms in the group chat when an event is added to the calendar (e.g., "Added: Flight landing March 15 at 3pm")

### Weekly Reminders

- [ ] **REM-01**: Bot posts a weekly read-only summary into each tracked group on a fixed day
- [ ] **REM-02**: Summary contains AI-inferred unresolved tasks and upcoming commitments from the past week's chat history

### Travel Search

- [ ] **TRAV-01**: Group members can @mention the bot to request travel searches (flights, hotels, restaurants)
- [ ] **TRAV-02**: Bot uses Gemini to parse the search intent (destination, dates, type) from the message
- [ ] **TRAV-03**: Bot scrapes Google search results on the server for the requested travel query
- [ ] **TRAV-04**: Bot sends top 3-5 results to the group (name, price, link) in a formatted message

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Dashboard Enhancements

- **DASH-07**: Real-time WebSocket updates (no page refresh needed)
- **DASH-08**: Activity log / full message history viewer
- **DASH-09**: System prompt editor per contact in the UI

### AI Enhancements

- **AI-06**: Confidence scoring on generated replies
- **AI-07**: Live message learning (accumulate style context over time from live conversations)

### Operations

- **OPS-03**: Bot sends health/heartbeat alerts when it goes silent or disconnects
- **OPS-05**: Gemini API cost tracking and usage dashboard

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Bot replying conversationally in groups | Groups are monitor-only (date extraction, reminders, travel search on @mention) — not conversational |
| Voice messages | Text-only, voice adds transcription complexity |
| Media/image responses | Text replies only, media generation is a separate problem |
| Mobile app | Web dashboard accessible via Tailscale is sufficient |
| Multiple WhatsApp accounts | Single account only |
| Fine-tuning a local LLM | Few-shot prompting with Gemini achieves quality without training infrastructure |
| Bulk messaging / outreach | Anti-feature: triggers WhatsApp bans, violates ToS |
| Interactive task management in groups | Reminders are read-only, no marking tasks done via chat |
| Booking/purchasing through the bot | Bot finds options, users book themselves |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WA-01 through WA-07 | Phase 1 | Complete |
| AI-01 through AI-05 | Phase 2-3 | Complete |
| CM-01 through CM-05 | Phase 2-3 | Complete |
| OPS-01, OPS-02, OPS-04 | Phase 1 | Complete |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |
| DASH-04 | — | Pending |
| DASH-05 | — | Pending |
| DASH-06 | — | Pending |
| CLI-01 | — | Pending |
| CLI-02 | — | Pending |
| CLI-03 | — | Pending |
| CLI-04 | — | Pending |
| CLI-05 | — | Pending |
| CLI-06 | — | Pending |
| CLI-07 | — | Pending |
| GRP-01 | — | Pending |
| GRP-02 | — | Pending |
| GRP-03 | — | Pending |
| GRP-04 | — | Pending |
| GRP-05 | — | Pending |
| CAL-01 | — | Pending |
| CAL-02 | — | Pending |
| CAL-03 | — | Pending |
| CAL-04 | — | Pending |
| CAL-05 | — | Pending |
| REM-01 | — | Pending |
| REM-02 | — | Pending |
| TRAV-01 | — | Pending |
| TRAV-02 | — | Pending |
| TRAV-03 | — | Pending |
| TRAV-04 | — | Pending |

**Coverage:**
- v1.1 requirements: 28 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 28

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-23 after milestone v1.1 definition*

# Requirements: WhatsApp Bot

**Defined:** 2026-02-22
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### WhatsApp Connection

- [ ] **WA-01**: Bot connects to WhatsApp via Baileys WebSocket API
- [ ] **WA-02**: User can authenticate by scanning QR code
- [ ] **WA-03**: Session persists across process restarts (no re-scan needed)
- [ ] **WA-04**: Bot receives incoming text messages in real-time
- [ ] **WA-05**: Bot sends text replies through WhatsApp on behalf of the user
- [ ] **WA-06**: Bot automatically reconnects after network interruption
- [ ] **WA-07**: Bot simulates typing delay before sending replies (anti-ban)

### AI Response

- [ ] **AI-01**: Bot generates replies using Gemini API (gemini-2.5-flash)
- [ ] **AI-02**: Bot includes recent conversation context per contact in Gemini requests
- [ ] **AI-03**: Bot uses a system prompt with persona instructions for style matching
- [ ] **AI-04**: User can import WhatsApp chat export (.txt) for style learning per contact
- [ ] **AI-05**: User can set custom instructions per contact (e.g., "be brief", "use emoji")

### Contact Management

- [ ] **CM-01**: User can whitelist specific contacts for bot handling
- [ ] **CM-02**: User can toggle between auto-reply and draft-approval modes per contact
- [ ] **CM-03**: User can enable/disable the bot per contact
- [ ] **CM-04**: User can assign relationship context per contact ("close friend", "work colleague")
- [ ] **CM-05**: User can snooze the bot for a specific contact temporarily

### Dashboard

- [ ] **DASH-01**: User can view active conversations the bot is handling
- [ ] **DASH-02**: User can approve or reject draft replies in the dashboard
- [ ] **DASH-03**: User can manage the contact whitelist from the dashboard
- [ ] **DASH-04**: User can see bot connection status (connected/disconnected)
- [ ] **DASH-05**: User can edit AI-generated draft replies before sending

### Operations

- [ ] **OPS-01**: Bot runs as a persistent PM2-managed service on Ubuntu server
- [ ] **OPS-02**: Bot session data persists across server reboots
- [ ] **OPS-03**: Bot sends health/heartbeat alerts when it goes silent or disconnects
- [ ] **OPS-04**: Bot deduplicates messages to prevent double-replies

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dashboard Enhancements

- **DASH-06**: System prompt editor per contact in the UI
- **DASH-07**: Real-time WebSocket updates (no page refresh needed)
- **DASH-08**: Activity log / full message history viewer

### AI Enhancements

- **AI-06**: Confidence scoring on generated replies
- **AI-07**: Live message learning (accumulate style context over time from live conversations)

### Operations Enhancements

- **OPS-05**: Gemini API cost tracking and usage dashboard
- **OPS-06**: QR code re-auth via web dashboard (remote re-auth over Tailscale)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Group chat support | Multi-party conversation complexity, defer to later |
| Voice messages | Text-only for v1, voice adds transcription complexity |
| Media/image responses | Text replies only, media generation is a separate problem |
| Mobile app | Web dashboard accessible via Tailscale is sufficient |
| Multiple WhatsApp accounts | Single account only for v1 |
| Fine-tuning a local LLM | Few-shot prompting with Gemini achieves quality without training infrastructure |
| Bulk messaging / outreach | Anti-feature: triggers WhatsApp bans, violates ToS |
| WhatsApp Business API | Using personal account via Baileys, not business platform |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WA-01 | — | Pending |
| WA-02 | — | Pending |
| WA-03 | — | Pending |
| WA-04 | — | Pending |
| WA-05 | — | Pending |
| WA-06 | — | Pending |
| WA-07 | — | Pending |
| AI-01 | — | Pending |
| AI-02 | — | Pending |
| AI-03 | — | Pending |
| AI-04 | — | Pending |
| AI-05 | — | Pending |
| CM-01 | — | Pending |
| CM-02 | — | Pending |
| CM-03 | — | Pending |
| CM-04 | — | Pending |
| CM-05 | — | Pending |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |
| DASH-04 | — | Pending |
| DASH-05 | — | Pending |
| OPS-01 | — | Pending |
| OPS-02 | — | Pending |
| OPS-03 | — | Pending |
| OPS-04 | — | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 0
- Unmapped: 26

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after initial definition*

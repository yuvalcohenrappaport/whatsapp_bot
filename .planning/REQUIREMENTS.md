# Requirements: WhatsApp Bot

**Defined:** 2026-03-30
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.6 Requirements

Requirements for Scheduled Replies milestone. Each maps to roadmap phases.

### Scheduling Core

- [x] **SCHED-01**: User can create a scheduled message with a recipient, content, and future date/time from the dashboard
- [x] **SCHED-02**: Scheduled messages persist in the database and survive bot restarts
- [x] **SCHED-03**: Scheduler uses two-tier pattern (setTimeout for near-term, periodic DB scan for distant)
- [ ] **SCHED-04**: Reconnect dedup guard prevents double-fire after Baileys reconnection
- [x] **SCHED-05**: User can set recurring schedules (daily, weekly, monthly) stored as cron expressions for DST safety

### Message Types

- [ ] **TYPE-01**: User can schedule a plain text message for delivery at a specified time
- [ ] **TYPE-02**: User can schedule a voice note message generated via ElevenLabs TTS at fire time
- [ ] **TYPE-03**: User can schedule an AI-generated message where Gemini generates content from a prompt at fire time using contact style context

### Pre-Send Safety

- [x] **SAFE-01**: Bot sends a self-chat notification before each scheduled send with a cancel option
- [x] **SAFE-02**: Cancel state is persisted in the database (survives PM2 reloads)
- [x] **SAFE-03**: Failed sends are tracked with status and retried automatically

### Dashboard Management

- [x] **DASH-01**: Dashboard page lists all scheduled messages with status indicators
- [ ] **DASH-02**: Dashboard form to create scheduled messages with recipient picker, content input, date/time picker, and recurrence options
- [x] **DASH-03**: User can edit a pending scheduled message from the dashboard
- [x] **DASH-04**: User can cancel/delete a scheduled message from the dashboard
- [x] **DASH-05**: Live cron expression preview via cronstrue shows human-readable schedule description

## Previous Milestones

### v1.5 Requirements (Complete)

- [x] **CAL-01**: Bot detects date/event mentions in private chat messages using Gemini with JS pre-filter
- [x] **CAL-02**: Bot detects date/event mentions in group chat messages (extends existing extraction to all groups)
- [x] **CAL-03**: Detected events are proposed via self-chat with suggest-then-confirm flow
- [x] **CAL-04**: Confirmed events are created in Google Calendar with title, date/time, and source context
- [x] **CAL-05**: CalendarDetectionService extracted as shared module for both private and group pipelines
- [x] **CAL-06**: Duplicate event detection prevents double-creation from forwarded messages
- [x] **REM-01**: User can request reminders via WhatsApp command ("remind me to X at Y")
- [x] **REM-02**: Bot detects commitments in private chats ("I'll send it tomorrow") and suggests follow-up reminders
- [x] **REM-03**: Quick reminders delivered as WhatsApp messages to owner's self-chat
- [x] **REM-04**: Time-specific reminders created as Google Calendar events with notifications
- [x] **REM-05**: Reminders persisted in SQLite with restart recovery and startup catch-up
- [x] **REM-06**: Reminder scheduling uses setTimeout for <24h and periodic DB scan for distant reminders
- [x] **TODO-01**: OAuth2 authorization code flow for Microsoft Graph API via dashboard
- [x] **TODO-02**: Bot auto-detects actionable tasks in private chat messages with pre-filter
- [x] **TODO-03**: Detected tasks proposed via self-chat with suggest-then-confirm flow
- [x] **TODO-04**: Confirmed tasks created in Microsoft To Do via Graph API
- [x] **TODO-05**: Refresh token persisted and auto-renewed with expiry monitoring

## Future Requirements

### Advanced Scheduling

- **ASCHED-01**: Natural language scheduling via WhatsApp ("send happy birthday to Mom at midnight")
- **ASCHED-02**: Template messages with variable interpolation at fire time
- **ASCHED-03**: Batch scheduling (multiple recipients, same message)

### Dashboard Integration

- **DASH-06**: Dashboard controls for calendar detection sensitivity per contact/group
- **ADV-01**: Two-way To Do sync (changes in To Do reflected in bot)
- **ADV-03**: Multi-language commitment detection tuning (Hebrew/English/mixed)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Natural language scheduling via WhatsApp | Dashboard-only for v1.6; WhatsApp commands add complexity |
| Bulk broadcast to multiple recipients | Triggers WhatsApp bans |
| Auto-retry persistent job queue (e.g., BullMQ) | Overkill for single-user bot; simple DB retry is sufficient |
| Scheduled media/image messages | Text and voice only; Baileys media handling is fragile |
| Contact-initiated scheduling | Owner-only in v1.6; contacts requesting timed replies adds scope |
| react-js-cron component | Requires Ant Design peer dep, incompatible with shadcn/Tailwind stack |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHED-01 | Phase 30 | Complete |
| SCHED-02 | Phase 27 | Complete |
| SCHED-03 | Phase 28 | Complete |
| SCHED-04 | Phase 28 | Pending |
| SCHED-05 | Phase 32 | Complete |
| TYPE-01 | Phase 28 | Pending |
| TYPE-02 | Phase 31 | Pending |
| TYPE-03 | Phase 31 | Pending |
| SAFE-01 | Phase 29 | Complete |
| SAFE-02 | Phase 29 | Complete |
| SAFE-03 | Phase 29 | Complete |
| DASH-01 | Phase 30 | Complete |
| DASH-02 | Phase 30 | Pending |
| DASH-03 | Phase 30 | Complete |
| DASH-04 | Phase 30 | Complete |
| DASH-05 | Phase 30 | Complete |

**Coverage:**
- v1.6 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 — traceability filled after roadmap creation*

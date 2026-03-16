# Requirements: WhatsApp Bot

**Defined:** 2026-03-16
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.5 Requirements

Requirements for Personal Assistant milestone. Each maps to roadmap phases.

### Calendar Detection

- [x] **CAL-01**: Bot detects date/event mentions in private chat messages using Gemini with JS pre-filter
- [x] **CAL-02**: Bot detects date/event mentions in group chat messages (extends existing extraction to all groups)
- [x] **CAL-03**: Detected events are proposed via self-chat with suggest-then-confirm flow
- [x] **CAL-04**: Confirmed events are created in Google Calendar with title, date/time, and source context
- [x] **CAL-05**: CalendarDetectionService extracted as shared module for both private and group pipelines
- [x] **CAL-06**: Duplicate event detection prevents double-creation from forwarded messages

### Smart Reminders

- [x] **REM-01**: User can request reminders via WhatsApp command ("remind me to X at Y")
- [ ] **REM-02**: Bot detects commitments in private chats ("I'll send it tomorrow") and suggests follow-up reminders
- [ ] **REM-03**: Quick reminders delivered as WhatsApp messages to owner's self-chat
- [ ] **REM-04**: Time-specific reminders created as Google Calendar events with notifications
- [x] **REM-05**: Reminders persisted in SQLite with restart recovery and startup catch-up
- [x] **REM-06**: Reminder scheduling uses setTimeout for <24h and periodic DB scan for distant reminders

### Microsoft To Do

- [ ] **TODO-01**: OAuth2 authorization code flow for Microsoft Graph API via dashboard
- [ ] **TODO-02**: Bot auto-detects actionable tasks in private chat messages with pre-filter
- [ ] **TODO-03**: Detected tasks proposed via self-chat with suggest-then-confirm flow
- [ ] **TODO-04**: Confirmed tasks created in Microsoft To Do via Graph API
- [ ] **TODO-05**: Refresh token persisted and auto-renewed with expiry monitoring

## Future Requirements

### Dashboard Integration

- **DASH-01**: Dashboard page for viewing and managing upcoming reminders
- **DASH-02**: Dashboard page for Microsoft To Do connection status and task history
- **DASH-03**: Dashboard controls for calendar detection sensitivity per contact/group

### Advanced Detection

- **ADV-01**: Two-way To Do sync (changes in To Do reflected in bot)
- **ADV-02**: Recurring reminder patterns ("remind me every Monday")
- **ADV-03**: Multi-language commitment detection tuning (Hebrew/English/mixed)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full booking integration | Requires OAuth, payment handling, API partnerships |
| Two-way To Do sync | v1.5 is one-way push only; polling adds complexity |
| Voice reminders | Voice is for private impersonation, not utility messages |
| Cross-calendar deduplication | Requires reading personal calendars beyond bot-created events |
| Recurring reminders | Single-fire reminders first; recurring adds scheduling complexity |
| Group chat task detection | Tasks are personal; groups are utility-only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAL-01 | Phase 23 | Complete |
| CAL-02 | Phase 23 | Complete |
| CAL-03 | Phase 23 | Complete |
| CAL-04 | Phase 23 | Complete |
| CAL-05 | Phase 22 | Complete |
| CAL-06 | Phase 23 | Complete |
| REM-01 | Phase 24 | Complete |
| REM-02 | Phase 25 | Pending |
| REM-03 | Phase 24 | Pending |
| REM-04 | Phase 24 | Pending |
| REM-05 | Phase 24 | Complete |
| REM-06 | Phase 24 | Complete |
| TODO-01 | Phase 26 | Pending |
| TODO-02 | Phase 26 | Pending |
| TODO-03 | Phase 26 | Pending |
| TODO-04 | Phase 26 | Pending |
| TODO-05 | Phase 26 | Pending |

**Coverage:**
- v1.5 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 after roadmap creation*

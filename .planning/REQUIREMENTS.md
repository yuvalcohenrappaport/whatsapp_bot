# Requirements: WhatsApp Bot

**Defined:** 2026-03-02
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.4 Requirements

Requirements for Travel Agent milestone. Each maps to roadmap phases.

### Audit

- [x] **AUDIT-01**: Travel search returns correct results with working URLs and follow-up reply chains
- [x] **AUDIT-02**: Calendar date extraction correctly identifies dates, creates events, and handles reply-to-delete

### Trip Memory

- [ ] **MEM-01**: Bot stores confirmed trip decisions (destination, accommodation, activities, transport) in structured DB records
- [ ] **MEM-02**: User can ask "@bot what did we decide about X?" and bot answers from stored decisions + chat history
- [ ] **MEM-03**: Bot detects unanswered questions/commitments in chat and tracks them as open items
- [ ] **MEM-04**: Open items are surfaced in weekly digest until resolved or manually dismissed

### Itinerary

- [ ] **ITIN-01**: Date extraction suggests adding to calendar before auto-adding (suggest-then-confirm via reply)
- [ ] **ITIN-02**: Calendar events include location, description, and relevant links (not just title + date)
- [ ] **ITIN-03**: User can confirm (✅) or reject (❌) a suggestion by replying to the bot's message

### Search

- [ ] **SRCH-01**: Travel search uses Gemini Maps Grounding to return ratings, reviews, hours, and addresses
- [ ] **SRCH-02**: Search returns 5-6 results for accommodation/activity queries (3 for quick queries)
- [ ] **SRCH-03**: Results from booking sites (booking.com, airbnb, etc.) are labeled with a "Book:" prefix

### Intelligence

- [ ] **INTL-01**: Bot proactively suggests activities/tips when a destination is confirmed (rate-limited, max once per destination)
- [ ] **INTL-02**: Weekly digest includes trip status section: confirmed decisions, open questions, upcoming activities
- [ ] **INTL-03**: Proactive suggestions are relevant and not spammy (cooldown, only on new confirmations)

## v1.5 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Passive Detection

- **PASS-01**: Bot passively detects activities/plans mentioned in every group message (not just dates)
- **PASS-02**: Passive detection uses pre-filter to minimize Gemini API calls on irrelevant messages

### Search Enhancements

- **SRCH-04**: Trip context (dates, destination, group size) auto-injected into search queries
- **SRCH-05**: Multi-result comparison format with numbered voting prompt

### Memory Enhancements

- **MEM-05**: Conversation recall from raw chat history without requiring structured decisions

### Voice Enhancements

- **VFUT-01**: Voice reply latency optimization (streaming TTS)
- **VFUT-02**: Voice message support in groups
- **VFUT-03**: Voice style learning from user's voice messages

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full booking integration (reservations) | Requires OAuth, payment handling, API partnerships — bot surfaces links, humans book |
| Expense splitting / budget tracking | Splitwise does this well; WhatsApp text is clunky for financial tracking |
| Flight/hotel price monitoring alerts | Requires continuous polling of external APIs; high infrastructure complexity |
| WhatsApp reaction-based voting | Reaction events unreliable in Baileys; use numbered reply voting instead |
| Group member preference profiles | High onboarding friction; pass recent messages as context instead |
| "Plan the whole trip" wizard flows | Group chats are non-linear; wizard state machines break with multiple participants |
| Rich media maps/photo galleries | WhatsApp text-only; extract text fields and link to Google Maps |
| Automatic cross-calendar deduplication | Requires reading personal calendars; high privacy surface |
| Keyword rules audit | Not being extended in v1.4 |
| Voice replies in groups | Groups are utility-only; voice is for private impersonation |
| Real-time voice calls | Far beyond current Baileys capabilities |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUDIT-01 | Phase 17 | Complete |
| AUDIT-02 | Phase 17 | Complete |
| MEM-01 | Phase 18 | Pending |
| MEM-02 | Phase 18 | Pending |
| MEM-03 | Phase 18 | Pending |
| MEM-04 | Phase 21 | Pending |
| ITIN-01 | Phase 19 | Pending |
| ITIN-02 | Phase 19 | Pending |
| ITIN-03 | Phase 19 | Pending |
| SRCH-01 | Phase 20 | Pending |
| SRCH-02 | Phase 20 | Pending |
| SRCH-03 | Phase 20 | Pending |
| INTL-01 | Phase 21 | Pending |
| INTL-02 | Phase 21 | Pending |
| INTL-03 | Phase 21 | Pending |

**Coverage:**
- v1.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after roadmap creation — all 15 requirements mapped*

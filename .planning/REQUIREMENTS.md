# Requirements: WhatsApp Bot

**Defined:** 2026-02-24
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.2 Requirements

Requirements for milestone v1.2: Group Auto-Response. Per-group keyword monitoring with configurable auto-responses.

### Keyword Rules

- [ ] **KW-01**: User can create keyword rules per tracked group (each rule has a trigger keyword/pattern and a response)
- [ ] **KW-02**: Keyword matching uses case-insensitive contains by default
- [ ] **KW-03**: User can optionally enable regex matching per rule for advanced patterns
- [ ] **KW-04**: User can set a rule's response type to "fixed text" with an exact template message
- [ ] **KW-05**: User can set a rule's response type to "AI-generated" with custom Gemini instructions (e.g., "answer based on this price list: ...")
- [ ] **KW-06**: User can enable or disable individual rules without deleting them
- [ ] **KW-07**: Bot sends the configured response when a group message matches a rule's keyword

### Auto-Response Pipeline

- [ ] **AR-01**: Bot checks incoming group messages against active keyword rules for that group
- [ ] **AR-02**: Per-rule cooldown prevents the same rule from firing repeatedly (configurable interval)
- [ ] **AR-03**: AI-generated responses use Gemini with the rule's custom instructions as system prompt
- [ ] **AR-04**: Auto-response runs after travel handler but before date extraction debounce in the pipeline

### Dashboard Management

- [ ] **DASH-10**: User can view all keyword rules for a group from the dashboard
- [ ] **DASH-11**: User can create, edit, and delete keyword rules from the dashboard
- [ ] **DASH-12**: User can toggle rules on/off from the dashboard
- [ ] **DASH-13**: Dashboard shows rule match count / last triggered time for each rule

## Future Requirements

- **KW-08**: CLI commands for managing keyword rules (bot rules list/add/remove)
- **KW-09**: Rule priority ordering when multiple rules match the same message
- **KW-10**: Scheduled rules (only active during certain hours/days)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-group global rules | Per-group rules only — keeps configuration simple and targeted |
| Rule chains (one rule triggers another) | Over-engineering for v1.2; single match → single response |
| Media responses (images, files) | Text-only responses consistent with existing bot constraints |
| CLI rule management | Deferred to future — dashboard is primary management interface |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| KW-01 | Phase 10 | Pending |
| KW-02 | Phase 10 | Pending |
| KW-03 | Phase 10 | Pending |
| KW-04 | Phase 10 | Pending |
| KW-05 | Phase 10 | Pending |
| KW-06 | Phase 10 | Pending |
| KW-07 | Phase 10 | Pending |
| AR-01 | Phase 10 | Pending |
| AR-02 | Phase 10 | Pending |
| AR-03 | Phase 10 | Pending |
| AR-04 | Phase 10 | Pending |
| DASH-10 | Phase 11 | Pending |
| DASH-11 | Phase 11 | Pending |
| DASH-12 | Phase 11 | Pending |
| DASH-13 | Phase 11 | Pending |

**Coverage:**
- v1.2 requirements: 15 total (KW: 7, AR: 4, DASH: 4)
- Mapped to phases: 15/15
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Traceability updated: 2026-02-24*

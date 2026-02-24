# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [ ] **v1.2 Group Auto-Response** — Phases 10-11 (in progress)

## Phases

<details>
<summary>v1.0 Foundation (Phases 1-3) — SHIPPED 2026-02-22</summary>

- [x] Phase 1: WhatsApp Foundation (3/3 plans) — completed 2026-02-22
- [x] Phase 2: AI Response Engine (3/3 plans) — completed 2026-02-22
- [x] Phase 3: Style Learning and Auto Mode (3/3 plans) — completed 2026-02-22

</details>

<details>
<summary>v1.1 Dashboard & Groups (Phases 6-9) — SHIPPED 2026-02-24</summary>

- [x] Phase 6: Web Dashboard (4/4 plans) — completed 2026-02-23
- [x] Phase 7: CLI Dashboard (3/3 plans) — completed 2026-02-23
- [x] Phase 8: Group Monitoring and Calendar (4/4 plans) — completed 2026-02-23
- [x] Phase 9: Travel Search (2/2 plans) — completed 2026-02-24

</details>

### v1.2 Group Auto-Response (In Progress)

**Milestone Goal:** Per-group keyword monitoring with configurable auto-responses (fixed text or AI-generated), managed from the web dashboard.

- [ ] **Phase 10: Keyword Rules and Auto-Response Pipeline** - Backend data model, matching engine, and pipeline integration for keyword-triggered group responses
- [ ] **Phase 11: Dashboard Rule Management** - Web dashboard UI for creating, editing, toggling, and monitoring keyword rules per group

## Phase Details

### Phase 10: Keyword Rules and Auto-Response Pipeline
**Goal**: Bot automatically responds to group messages that match keyword rules with either fixed text or AI-generated replies
**Depends on**: Phase 9 (existing group message pipeline and infrastructure)
**Requirements**: KW-01, KW-02, KW-03, KW-04, KW-05, KW-06, KW-07, AR-01, AR-02, AR-03, AR-04
**Success Criteria** (what must be TRUE):
  1. User can create a keyword rule for a tracked group (via API/CLI) and the bot sends the configured fixed-text response when a group message contains that keyword
  2. User can create an AI-generated rule with custom instructions and the bot sends a Gemini-generated response using those instructions when triggered
  3. Rules support both case-insensitive contains matching and optional regex matching
  4. A rule that fires does not fire again within its cooldown period, even if matching messages keep arriving
  5. Auto-response runs in the correct pipeline position (after travel handler, before date extraction debounce) and only fires on active/enabled rules
**Plans:** 2 plans

Plans:
- [ ] 10-01-PLAN.md — Database schema, query layer, and REST API for keyword rules
- [ ] 10-02-PLAN.md — Keyword matching engine and pipeline integration

### Phase 11: Dashboard Rule Management
**Goal**: User can fully manage keyword rules for any tracked group through the web dashboard
**Depends on**: Phase 10
**Requirements**: DASH-10, DASH-11, DASH-12, DASH-13
**Success Criteria** (what must be TRUE):
  1. User can open a group in the dashboard and see all keyword rules configured for it, with their current status (enabled/disabled)
  2. User can create a new keyword rule, edit an existing rule, or delete a rule entirely from the dashboard
  3. User can toggle a rule on or off from the dashboard without deleting it
  4. Dashboard displays each rule's match count and last triggered time so user can see which rules are active
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WhatsApp Foundation | v1.0 | 3/3 | Complete | 2026-02-22 |
| 2. AI Response Engine | v1.0 | 3/3 | Complete | 2026-02-22 |
| 3. Style Learning | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Web Dashboard | v1.1 | 4/4 | Complete | 2026-02-23 |
| 7. CLI Dashboard | v1.1 | 3/3 | Complete | 2026-02-23 |
| 8. Group Monitoring & Calendar | v1.1 | 4/4 | Complete | 2026-02-23 |
| 9. Travel Search | v1.1 | 2/2 | Complete | 2026-02-24 |
| 10. Keyword Rules & Pipeline | v1.2 | 0/2 | Planning complete | - |
| 11. Dashboard Rule Management | v1.2 | 0/? | Not started | - |

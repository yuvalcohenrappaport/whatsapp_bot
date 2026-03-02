# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- [x] **v1.3 Voice Responses** — Phases 12-16 (shipped 2026-03-02)
- [ ] **v1.4 Travel Agent** — Phases 17-21 (in progress)

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

<details>
<summary>v1.2 Group Auto-Response (Phases 10-11) — SHIPPED 2026-02-25</summary>

- [x] Phase 10: Keyword Rules and Auto-Response Pipeline (2/2 plans) — completed 2026-02-24
- [x] Phase 11: Dashboard Rule Management (2/2 plans) — completed 2026-02-24

</details>

<details>
<summary>v1.3 Voice Responses (Phases 12-16) — SHIPPED 2026-03-02</summary>

- [x] Phase 12: Voice Infrastructure (3/3 plans) — completed 2026-03-01
- [x] Phase 13: Voice Service Modules (2/2 plans) — completed 2026-03-01
- [x] Phase 14: Core Voice Pipeline (2/2 plans) — completed 2026-03-01
- [x] Phase 15: Draft Queue Voice Integration (1/1 plans) — completed 2026-03-02
- [x] Phase 16: Voice Settings Management (1/1 plans) — completed 2026-03-02

</details>

### v1.4 Travel Agent (Phases 17-21) — IN PROGRESS

**Milestone Goal:** Transform the group bot from a reactive search tool into a persistent travel agent that monitors conversations, builds itineraries in Google Calendar, remembers trip decisions, and proactively suggests activities.

- [x] **Phase 17: Pipeline Audit** - Verify and fix existing group features (travel search, calendar extraction) before extending them (completed 2026-03-02)
- [x] **Phase 18: Trip Memory** - Structured trip decision storage, always-listening context accumulation, and conversation recall (completed 2026-03-02)
- [x] **Phase 19: Itinerary Builder** - Suggest-then-confirm flow for calendar adds, enriched event details (completed 2026-03-02)
- [ ] **Phase 20: Enriched Search** - Maps Grounding upgrade for ratings/hours/addresses, more results, booking labels
- [ ] **Phase 21: Travel Intelligence** - Open item tracking in digest, proactive destination-aware suggestions

## Phase Details

<details>
<summary>v1.3 Voice Responses — Phase Details (SHIPPED)</summary>

### Phase 12: Voice Infrastructure
**Goal**: Voice prerequisites are in place — dependencies installed, credentials configured, DB schema migrated, voice clone validated
**Depends on**: Phase 11 (v1.2 complete)
**Requirements**: (infrastructure prerequisite — enables Phases 13-16)
**Success Criteria** (what must be TRUE):
  1. `@elevenlabs/elevenlabs-js` and `ffmpeg-static` are installed and TypeScript compilation succeeds
  2. `ELEVENLABS_API_KEY` and `ELEVENLABS_DEFAULT_VOICE_ID` are set in `.env` and loaded via config
  3. `voiceReplyEnabled` (boolean, default false) and `voiceId` (nullable text) columns exist on the `contacts` table after Drizzle migration
  4. `ffmpeg-static` binary path resolves at runtime (verified via console.log test)
  5. Voice clone produces acceptable Hebrew pronunciation on 5 test sentences verified in ElevenLabs UI
**Plans**: 3 plans

Plans:
- [x] 12-01-PLAN.md — Install deps, extend config/schema/settings (completed 2026-03-01)
- [x] 12-02-PLAN.md — Run migration, create voice client module, wire startup validation (completed 2026-03-01)
- [x] 12-03-PLAN.md — Create voice clone in ElevenLabs UI, add real credentials, verify bot startup (completed 2026-03-01)

### Phase 13: Voice Service Modules
**Goal**: Standalone transcription and TTS modules exist, are integration-tested against the ElevenLabs API, and are ready to be imported by the pipeline
**Depends on**: Phase 12
**Requirements**: VOICE-02, VOICE-04
**Success Criteria** (what must be TRUE):
  1. `src/voice/transcriber.ts` accepts an OGG/Opus Buffer and returns a Hebrew transcript string via ElevenLabs Scribe v2
  2. `src/voice/tts.ts` accepts a text string and returns an OGG/Opus Buffer (with OGG container) via ElevenLabs eleven_v3 + ffmpeg wrap
  3. A test script verifies both modules end-to-end against the live ElevenLabs API without touching messageHandler
  4. Hebrew TTS output sounds natural on 5 test sentences (eleven_v3 model confirmed, not eleven_multilingual_v2 or turbo)
**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Create transcriber.ts (STT) and tts.ts (TTS) voice service modules (completed 2026-03-01)
- [x] 13-02-PLAN.md — Integration test script and Hebrew TTS quality verification (completed 2026-03-01)

### Phase 14: Core Voice Pipeline
**Goal**: When a whitelisted contact sends a voice message, the bot automatically transcribes it, generates a reply, and sends a PTT voice note back (or a text reply if voice is disabled for that contact)
**Depends on**: Phase 13
**Requirements**: VOICE-01, VOICE-03, VOICE-05, CONF-02
**Success Criteria** (what must be TRUE):
  1. A voice message from a whitelisted contact (voice enabled, auto mode) triggers: audio download, transcription, Gemini reply, TTS synthesis, PTT send — end-to-end in one pipeline
  2. The sent audio renders as a voice note bubble on a real phone (not a file attachment) — confirming `ptt: true` and OGG container are correct
  3. A whitelisted contact with `voiceReplyEnabled: false` who sends a voice message receives a text reply (transcript used as input to Gemini, reply sent as text)
  4. The `recording` presence indicator fires immediately when a voice message is received
  5. Existing text message path is completely unchanged — text messages still generate text replies as before
**Plans**: 2 plans

Plans:
- [x] 14-01-PLAN.md — Add sendVoiceWithDelay to sender.ts and wire voice branch into messageHandler.ts (completed 2026-03-01)
- [x] 14-02-PLAN.md — Enable voice for test contact and verify end-to-end on real phone (completed 2026-03-01)

### Phase 15: Draft Queue Voice Integration
**Goal**: Voice replies for contacts in draft mode create reviewable text drafts, show the incoming voice transcript, and synthesize audio only at owner approval
**Depends on**: Phase 14
**Requirements**: DRAFT-01, DRAFT-02, DRAFT-03
**Success Criteria** (what must be TRUE):
  1. A voice message from a contact in draft mode creates a text draft (not audio) with the proposed reply
  2. The owner's approval notification message includes the voice message transcript so the reply can be reviewed in context
  3. Approving a voice draft with `✅` triggers TTS synthesis at that moment and sends the PTT voice note
  4. Rejecting a voice draft with `❌` discards it with no cleanup required (no audio file was ever created)
**Plans**: 1 plan

Plans:
- [x] 15-01-PLAN.md — Add isVoice column to drafts, wire transcript notification, and lazy TTS at approval (completed 2026-03-02)

### Phase 16: Voice Settings Management
**Goal**: User can enable or disable voice replies per contact via the dashboard and CLI without SSH access to the server
**Depends on**: Phase 12 (schema), Phase 14 (pipeline reads the toggle)
**Requirements**: CONF-01, MGMT-01, MGMT-02
**Success Criteria** (what must be TRUE):
  1. Dashboard contacts page shows a voice reply toggle per contact that persists when saved
  2. CLI `contact` command accepts a `--voice` flag to enable or disable voice replies for a contact
  3. Changing the toggle in dashboard or CLI takes effect on the next voice message from that contact (no restart required)
**Plans**: 1 plan

Plans:
- [x] 16-01-PLAN.md — Wire voiceReplyEnabled to API route, dashboard toggle, and CLI flag (completed 2026-03-02)

</details>

### Phase 17: Pipeline Audit
**Goal**: Existing group pipeline features (travel search, calendar date extraction) are verified against real group messages and any bugs are fixed before new features are layered on top
**Depends on**: Phase 16 (v1.3 complete)
**Requirements**: AUDIT-01, AUDIT-02
**Success Criteria** (what must be TRUE):
  1. A travel search @mention returns a formatted result with at least one working URL that opens to the correct destination page
  2. Reply-chain follow-up to a travel search result triggers a refined search (not an unhandled message)
  3. A message with a date (e.g., "נסיעה ב-15 לאפריל") produces a Google Calendar event with the correct title, date, and in-group confirmation message
  4. Replying to the bot's calendar confirmation with the designated delete reply removes the event from Google Calendar
**Plans**: 2 plans

Plans:
- [x] 17-01-PLAN.md — Audit travel search: URL validity, reply chain, error handling (completed 2026-03-02)
- [x] 17-02-PLAN.md — Audit calendar extraction: date parsing, event creation, reply-to-delete (completed 2026-03-02)

### Phase 18: Trip Memory
**Goal**: The bot accumulates and persists trip decisions from group conversations, answers recall questions about past decisions, and tracks open questions the group has not resolved
**Depends on**: Phase 17
**Requirements**: MEM-01, MEM-02, MEM-03
**Success Criteria** (what must be TRUE):
  1. After a group conversation where accommodation or destination is decided, the bot's DB contains a `tripDecisions` record with the correct type, value, and group ID
  2. A user sends "@bot what did we decide about the hotel?" and the bot replies with the stored decision (or closest match from chat history) without a live travel search
  3. Messages containing open questions or unresolved commitments ("does anyone know if the place is kosher?") result in a tracked open item in the DB
  4. The always-listening context accumulator does not call Gemini for messages that contain no travel signals (pre-filter working)
**Plans**: 3 plans

Plans:
- [x] 18-01-PLAN.md — DB schema: tripContexts and tripDecisions tables, searchGroupMessages FTS query (completed 2026-03-02)
- [x] 18-02-PLAN.md — tripContextManager.ts: debounce buffer, Gemini classifier, DB upsert at pipeline step [3.5] (completed 2026-03-02)
- [x] 18-03-PLAN.md — Conversation recall: history_search queryType in travelParser + travelHandler dispatch (completed 2026-03-02)

### Phase 19: Itinerary Builder
**Goal**: The bot suggests calendar additions for detected activities before adding them, enriches calendar events with location and links, and routes group member replies to confirm or reject each suggestion
**Depends on**: Phase 17 (calendar extraction working), Phase 18 (trip context available)
**Requirements**: ITIN-01, ITIN-02, ITIN-03
**Success Criteria** (what must be TRUE):
  1. A message with a trip activity and date triggers a bot suggestion message ("Add 'Dinner at Isrotel' on April 15 to calendar? Reply ✅ or ❌") instead of a silent calendar add
  2. Replying ✅ to the bot's suggestion creates a Google Calendar event; replying ❌ dismisses it with no event created
  3. The created event contains location and description fields (not just title and date) when the source message includes that information
  4. A suggestion expires after 30 minutes with no group member response — no calendar event is created
**Plans**: 3 plans

Plans:
- [x] 19-01-PLAN.md — Foundation: DB schema + migration for pending suggestions, dateExtractor Zod v4 + enriched fields, calendarService location param, export pipeline helpers (completed 2026-03-02)
- [x] 19-02-PLAN.md — suggestionTracker.ts: pending suggestions Map with TTL, suggest/confirm/reject lifecycle, deduplication, startup DB restore (completed 2026-03-02)
- [x] 19-03-PLAN.md — Pipeline integration: wire handleConfirmReject + createSuggestion into groupMessagePipeline, replace direct calendar-add (completed 2026-03-02)

### Phase 20: Enriched Search
**Goal**: Travel search returns richer results with ratings, hours, and addresses via Maps Grounding, returns more results for accommodation and activity queries, and labels booking-ready links
**Depends on**: Phase 17 (audit confirms existing search baseline)
**Requirements**: SRCH-01, SRCH-02, SRCH-03
**Success Criteria** (what must be TRUE):
  1. An @mention accommodation search returns 5-6 results, each including rating, review count, and address alongside the URL
  2. An @mention quick query (e.g., "coffee near the hotel") returns 3 results
  3. Results from booking.com, airbnb.com, or similar booking domains are prefixed with "Book:" in the formatted output
  4. If Maps Grounding returns no structured data, the bot falls back to Google Search grounding and still returns a result
**Plans**: 2 plans

Plans:
- [x] 20-01-PLAN.md — Maps Grounding primary path, updated SearchResult type, queryType-based result count, travelParser Zod v4 fix (completed 2026-03-02)
- [ ] 20-02-PLAN.md — Compact one-liner formatter, booking domain 🛒 labels, wire intent.queryType in travelHandler

### Phase 21: Travel Intelligence
**Goal**: Open trip questions surface in the weekly digest until resolved, and the bot proactively suggests activities when a new destination is confirmed — rate-limited so it never spams the group
**Depends on**: Phase 18 (trip memory working and calibrated), Phase 19 (suggest-then-confirm working)
**Requirements**: MEM-04, INTL-01, INTL-02, INTL-03
**Success Criteria** (what must be TRUE):
  1. The weekly digest message includes a "Trip Status" section listing confirmed decisions and any open questions that have not been resolved
  2. A resolved open item (answered in chat and re-classified by the context manager) no longer appears in the digest
  3. When a destination is confirmed for the first time, the bot sends one proactive suggestion message with relevant activities or tips — and does not send another for the same destination
  4. The bot does not send proactive messages more than 3 times per day per group, regardless of how many new destinations are confirmed
**Plans**: TBD

Plans:
- [ ] 21-01-PLAN.md — Open item lifecycle: MEM-04 surfacing in weekly digest, resolution detection in tripContextManager
- [ ] 21-02-PLAN.md — Proactive trigger: destination-confirmed signal, per-group cooldown (2h), daily cap (3/day), 90% confidence gate

## Progress

**Execution Order:** 17 → 18 → 19 → 20 → 21

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WhatsApp Foundation | v1.0 | 3/3 | Complete | 2026-02-22 |
| 2. AI Response Engine | v1.0 | 3/3 | Complete | 2026-02-22 |
| 3. Style Learning | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Web Dashboard | v1.1 | 4/4 | Complete | 2026-02-23 |
| 7. CLI Dashboard | v1.1 | 3/3 | Complete | 2026-02-23 |
| 8. Group Monitoring & Calendar | v1.1 | 4/4 | Complete | 2026-02-23 |
| 9. Travel Search | v1.1 | 2/2 | Complete | 2026-02-24 |
| 10. Keyword Rules & Pipeline | v1.2 | 2/2 | Complete | 2026-02-24 |
| 11. Dashboard Rule Management | v1.2 | 2/2 | Complete | 2026-02-24 |
| 12. Voice Infrastructure | v1.3 | 3/3 | Complete | 2026-03-01 |
| 13. Voice Service Modules | v1.3 | 2/2 | Complete | 2026-03-01 |
| 14. Core Voice Pipeline | v1.3 | 2/2 | Complete | 2026-03-01 |
| 15. Draft Queue Voice Integration | v1.3 | 1/1 | Complete | 2026-03-02 |
| 16. Voice Settings Management | v1.3 | 1/1 | Complete | 2026-03-02 |
| 17. Pipeline Audit | v1.4 | 2/2 | Complete | 2026-03-02 |
| 18. Trip Memory | v1.4 | Complete    | 2026-03-02 | 2026-03-02 |
| 19. Itinerary Builder | v1.4 | Complete    | 2026-03-02 | 2026-03-02 |
| 20. Enriched Search | v1.4 | 1/2 | In progress | - |
| 21. Travel Intelligence | v1.4 | 0/2 | Not started | - |

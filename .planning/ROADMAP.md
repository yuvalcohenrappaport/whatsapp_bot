# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Voice Responses** — Phases 12-16 (in progress)

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

### 🚧 v1.3 Voice Responses (Phases 12-16)

**Milestone Goal:** Enable the bot to receive voice messages, transcribe them, generate replies, and respond with AI-generated voice messages using a cloned Hebrew voice via ElevenLabs.

- [x] **Phase 12: Voice Infrastructure** - Install deps, configure ElevenLabs credentials, migrate DB schema, validate voice clone
- [x] **Phase 13: Voice Service Modules** - Build transcriber and TTS pure-function modules with isolated ElevenLabs API testing
- [ ] **Phase 14: Core Voice Pipeline** - Wire voice path into messageHandler — receive, transcribe, reply, send PTT voice note
- [ ] **Phase 15: Draft Queue Voice Integration** - Voice replies follow draft mode with lazy TTS and transcript preview
- [ ] **Phase 16: Voice Settings Management** - Dashboard and CLI controls for per-contact voice reply toggle

## Phase Details

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
- [ ] 14-01-PLAN.md — Add sendVoiceWithDelay to sender.ts and wire voice branch into messageHandler.ts
- [ ] 14-02-PLAN.md — Enable voice for test contact and verify end-to-end on real phone

### Phase 15: Draft Queue Voice Integration
**Goal**: Voice replies for contacts in draft mode create reviewable text drafts, show the incoming voice transcript, and synthesize audio only at owner approval
**Depends on**: Phase 14
**Requirements**: DRAFT-01, DRAFT-02, DRAFT-03
**Success Criteria** (what must be TRUE):
  1. A voice message from a contact in draft mode creates a text draft (not audio) with the proposed reply
  2. The owner's approval notification message includes the voice message transcript so the reply can be reviewed in context
  3. Approving a voice draft with `✅` triggers TTS synthesis at that moment and sends the PTT voice note
  4. Rejecting a voice draft with `❌` discards it with no cleanup required (no audio file was ever created)
**Plans**: TBD

Plans:
- [ ] 15-01: TBD

### Phase 16: Voice Settings Management
**Goal**: User can enable or disable voice replies per contact via the dashboard and CLI without SSH access to the server
**Depends on**: Phase 12 (schema), Phase 14 (pipeline reads the toggle)
**Requirements**: CONF-01, MGMT-01, MGMT-02
**Success Criteria** (what must be TRUE):
  1. Dashboard contacts page shows a voice reply toggle per contact that persists when saved
  2. CLI `contact` command accepts a `--voice` flag to enable or disable voice replies for a contact
  3. Changing the toggle in dashboard or CLI takes effect on the next voice message from that contact (no restart required)
**Plans**: TBD

Plans:
- [ ] 16-01: TBD

## Progress

**Execution Order:** 12 → 13 → 14 → 15 → 16

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
| 14. Core Voice Pipeline | v1.3 | 0/2 | Not started | - |
| 15. Draft Queue Voice Integration | v1.3 | 0/? | Not started | - |
| 16. Voice Settings Management | v1.3 | 0/? | Not started | - |

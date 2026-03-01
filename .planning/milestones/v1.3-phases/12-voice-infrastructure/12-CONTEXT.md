# Phase 12: Voice Infrastructure - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Install dependencies (ElevenLabs SDK, ffmpeg-static), configure API credentials, migrate DB schema with voice columns on contacts, and validate the voice clone produces acceptable Hebrew. This phase is pure setup — no message handling or pipeline changes.

</domain>

<decisions>
## Implementation Decisions

### Voice clone setup
- Use ElevenLabs Instant Voice Cloning (IVC) — upload a few short audio clips, clone ready in seconds
- Recording via Voice Memos on iPhone — quick and convenient, decent quality
- Clone created manually in ElevenLabs web UI — bot only stores and uses the voice ID
- Quality bar: recognizable as Yuval — people who know him would say "that sounds like Yuval"

### Config & credentials
- API key in `.env` file (same pattern as GEMINI_API_KEY), voice ID also in `.env` as default
- Per-contact voice ID stored in DB (voiceId column on contacts) — allows future flexibility
- Validate ElevenLabs connection at startup — check API key + voice ID are valid, log warning if not
- If ElevenLabs is down or API key invalid, fall back to text replies (transcribe fails → skip voice, TTS fails → send text instead)
- ElevenLabs usage/quota not needed in dashboard — check ElevenLabs dashboard directly if needed

### Contact voice defaults
- Voice replies default to OFF for new contacts — opt-in per contact
- One global cloned voice used for all contacts (voice ID from config), but per-contact voiceId column exists in DB for future flexibility
- Contacts with voice OFF still get transcribed + text reply (don't ignore voice messages)
- Global voice on/off toggle exists as master switch — can disable all voice replies without changing per-contact settings

### Claude's Discretion
- Exact startup validation implementation (retry logic, timeout)
- ffmpeg-static import approach (CJS vs ESM compatibility)
- Migration naming convention
- Error logging format for ElevenLabs failures

</decisions>

<specifics>
## Specific Ideas

- Voice clone validation is a manual step — done in ElevenLabs UI before Phase 13 starts, not automated
- Fallback to text on any voice pipeline failure is critical — the bot should never silently drop a message just because ElevenLabs is having issues
- The global toggle allows quickly disabling voice during testing or if ElevenLabs quota is low

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-voice-infrastructure*
*Context gathered: 2026-03-01*

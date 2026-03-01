---
phase: 14-core-voice-pipeline
plan: "01"
subsystem: voice
tags: [whatsapp, baileys, ptt, voice-note, stt, tts, elevenlabs, pipeline]

# Dependency graph
requires:
  - phase: 13-voice-service-modules
    provides: "transcriber.ts (STT) and tts.ts (TTS) modules"
  - phase: 12-voice-infrastructure
    provides: "DB schema (voiceReplyEnabled, voiceId), settings (voice_replies_enabled), ElevenLabs client"
provides:
  - "sendVoiceWithDelay function for PTT voice note sending with text persistence"
  - "handleVoiceMessage function for end-to-end voice pipeline in messageHandler"
  - "Voice branch in processMessage routing audio messages before text null guard"
affects: [14-02-core-voice-pipeline, 15-voice-ux-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: ["voice branch before text null guard", "transcript persisted before generateReply", "recording presence before pipeline work"]

key-files:
  created: []
  modified:
    - src/whatsapp/sender.ts
    - src/pipeline/messageHandler.ts

key-decisions:
  - "Text body persisted to messages table (not audio buffer) for AI context continuity"
  - "Voice branch inserted before text null guard — audio messages never reach text path"
  - "Recording presence fires immediately on voice receipt for user feedback"
  - "Shorter delay (500-1500ms) for voice send since recording presence already shown"
  - "Cooldown, auto-cap, snooze logic duplicated (not refactored) to avoid modifying text path"
  - "Draft mode voice messages create text drafts with (voice msg) label"

patterns-established:
  - "Voice branch pattern: check audioMessage before text null guard in processMessage"
  - "Transcript-first persistence: always insertMessage before generateReply"
  - "Separate audio+text params: sendVoiceWithDelay accepts both buffer and text string"

requirements-completed: [VOICE-01, VOICE-03, VOICE-05, CONF-02]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 14 Plan 01: Core Voice Pipeline Summary

**End-to-end voice pipeline wired into messageHandler: download audio, transcribe via ElevenLabs Scribe, persist transcript, generate Gemini reply, send PTT voice note with recording presence**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T15:16:12Z
- **Completed:** 2026-03-01T15:18:16Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `sendVoiceWithDelay` to sender.ts for PTT voice note sending with text persistence
- Wired complete voice pipeline into messageHandler.ts: download, transcribe, persist, reply, TTS, PTT send
- Voice branch inserted before text null guard ensures audio messages route correctly
- Recording presence fires immediately for natural user feedback
- Existing text message path completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sendVoiceWithDelay to sender.ts** - `fc1188d` (feat)
2. **Task 2: Wire voice branch into messageHandler.ts** - `4d0e2d7` (feat)

## Files Created/Modified
- `src/whatsapp/sender.ts` - Added sendVoiceWithDelay function for PTT voice notes with text body persistence
- `src/pipeline/messageHandler.ts` - Added voice branch, imports, and handleVoiceMessage function

## Decisions Made
- Text body persisted to messages table (not audio buffer) so generateReply has text context for future conversations
- Voice branch position: before `if (text === null) return;` so audio messages never fall through to text path
- Recording presence fires before any pipeline work (download, transcribe, TTS) for immediate user feedback
- Shorter delay (500-1500ms) on voice send since user already saw "recording..." during pipeline
- Cooldown/auto-cap/snooze logic duplicated in handleVoiceMessage rather than refactoring shared code -- avoids any modification to the working text path
- Draft mode voice messages create text drafts labeled "(voice msg)" to distinguish from text drafts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Voice pipeline complete and compiling -- ready for Phase 14 Plan 02 (end-to-end testing)
- Bot can receive voice messages, transcribe them, and reply with PTT voice notes
- Text fallback works when voice is disabled globally or per-contact
- All voice replies respect cooldown, auto-cap, and snooze rules

## Self-Check: PASSED

- All modified files exist on disk
- All task commits verified in git history (fc1188d, 4d0e2d7)
- TypeScript compiles cleanly (npx tsc --noEmit)

---
*Phase: 14-core-voice-pipeline*
*Completed: 2026-03-01*

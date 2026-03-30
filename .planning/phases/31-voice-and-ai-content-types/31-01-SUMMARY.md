---
phase: 31-voice-and-ai-content-types
plan: 01
subsystem: scheduler
tags: [p-queue, elevenlabs, gemini, tts, ptt, audio, concurrency, timeout]

# Dependency graph
requires:
  - phase: 30-dashboard-crud
    provides: scheduledMessageService.ts with text-only fireMessage pipeline
  - phase: 12-voice-infrastructure
    provides: textToSpeech function in src/voice/tts.ts
  - phase: 08-gemini-ai
    provides: buildSystemPrompt in src/ai/gemini.ts
provides:
  - resolveContent() helper dispatching text/voice/ai types at fire time
  - sendVoiceWithTimeout() for PTT audio with DB persistence
  - ttsQueue singleton enforcing ElevenLabs concurrency:1
  - exported buildSystemPrompt for external callers
  - type-aware fireMessage with single content resolution before recipient loop
  - [AI Prompt] label in pre-send notification preview for AI messages
affects: [voice-send, ai-content, scheduled-messages, fire-pipeline]

# Tech tracking
tech-stack:
  added: [p-queue@9.1.0]
  patterns:
    - Promise.race with explicit timeout for all external service calls (TTS, Gemini, Baileys)
    - Module-level singleton queue for concurrency control
    - Content resolution once before recipient loop (not per-recipient)

key-files:
  created: []
  modified:
    - src/ai/gemini.ts
    - src/scheduler/scheduledMessageService.ts
    - package.json

key-decisions:
  - "resolveContent called once before recipient loop — single TTS buffer shared across all recipients"
  - "ttsQueue is module-level singleton (not per-call) — global concurrency enforcement across all fires"
  - "Content resolution failure routes through handleFailedMessage — consistent retry behavior"
  - "sendVoiceWithTimeout persists sourceText (not audio binary) to messages DB — preserves AI context continuity"

patterns-established:
  - "Promise.race timeout pattern: const timeout = new Promise<never>((_, reject) => setTimeout(reject, ms)); return Promise.race([op, timeout]);"
  - "insertMessage().run() call pattern for DB persistence after send (same as sender.ts)"

requirements-completed: [TYPE-02, TYPE-03]

# Metrics
duration: 18min
completed: 2026-03-30
---

# Phase 31 Plan 01: Voice and AI Content Types Summary

**Voice (TTS via ElevenLabs) and AI (Gemini) content resolution added to scheduled message fire pipeline with p-queue concurrency:1 and 30s Promise.race timeouts**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-30T13:14:15Z
- **Completed:** 2026-03-30T13:32:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `resolveContent()` helper resolves text/voice/ai types at fire time with 30s timeouts
- `sendVoiceWithTimeout()` sends PTT audio (audio/ogg; codecs=opus) and persists sourceText to messages DB
- `ttsQueue` module-level singleton enforces ElevenLabs concurrency:1 across all concurrent fires
- `buildSystemPrompt` exported from gemini.ts for use in resolveContent
- `fireMessage` resolves content once before recipient loop (single TTS call for multi-recipient voice messages)
- Pre-send notification shows `[AI Prompt]` prefix in content preview for AI message type

## Task Commits

Each task was committed atomically:

1. **Task 1: Export buildSystemPrompt and add resolveContent + sendVoiceWithTimeout** - `82e9fdd` (feat)
2. **Task 2: Wire type-aware dispatch into fireMessage and update notification label** - `d5a5647` (feat)

**Plan metadata:** (see docs commit below)

## Files Created/Modified
- `src/ai/gemini.ts` - Exported buildSystemPrompt (one-word change: `async function` -> `export async function`)
- `src/scheduler/scheduledMessageService.ts` - Added imports, ttsQueue, TTS/AI timeout constants, ResolvedContent type, resolveContent(), sendVoiceWithTimeout(), type-aware fireMessage dispatch, [AI Prompt] preview label
- `package.json` / `package-lock.json` - Added p-queue@9.1.0 dependency

## Decisions Made
- resolveContent called once before recipient loop — single TTS buffer shared across all recipients (consistent with plan spec)
- sendVoiceWithTimeout persists sourceText (not audio binary) to messages DB — same pattern as sender.ts sendVoiceWithDelay
- Content resolution failure routes through handleFailedMessage — consistent retry behavior for all failure modes
- ttsQueue is module-level singleton ensuring global concurrency enforcement regardless of how many fires happen concurrently

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- p-queue was not in package.json; installed as part of Task 1 as specified in plan action.
- Pre-existing TypeScript error in `cli/bot.ts` (rootDir mismatch) was present before this plan and is out of scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Voice and AI content types fully wired into fire pipeline
- ttsQueue concurrency can be increased if ElevenLabs plan tier allows higher concurrency (currently :1 is conservative)
- Phase 31 Plan 02 can proceed (if any) — fire pipeline is complete for all three message types

---
*Phase: 31-voice-and-ai-content-types*
*Completed: 2026-03-30*

---
phase: 12-voice-infrastructure
plan: "01"
subsystem: infra
tags: [elevenlabs, ffmpeg, voice, tts, config, schema, drizzle]

# Dependency graph
requires: []
provides:
  - "@elevenlabs/elevenlabs-js and ffmpeg-static npm packages installed"
  - "ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID Zod env fields in config.ts"
  - "voiceReplyEnabled and voiceId columns on contacts table in schema.ts"
  - "voice_replies_enabled global toggle default in settings.ts DEFAULTS"
affects:
  - 12-02-PLAN.md
  - 12-03-PLAN.md
  - 13-voice-synthesis
  - 14-voice-transcription
  - 15-voice-draft-flow
  - 16-voice-controls

# Tech tracking
tech-stack:
  added:
    - "@elevenlabs/elevenlabs-js ^2.37.0 — ElevenLabs TTS/STT SDK"
    - "ffmpeg-static ^5.3.0 — bundled ffmpeg binary for audio processing"
  patterns:
    - "z.string() for required env vars in Zod schema (no .optional())"
    - "integer({ mode: 'boolean' }).notNull().default(false) for boolean DB columns"
    - "settings DEFAULTS Record<string, string> for key-value global toggles"

key-files:
  created: []
  modified:
    - "package.json — added two voice dependencies"
    - "src/config.ts — added ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID"
    - "src/db/schema.ts — added voiceReplyEnabled and voiceId to contacts table"
    - "src/db/queries/settings.ts — added voice_replies_enabled to DEFAULTS"

key-decisions:
  - "Both ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID are required (z.string(), no .optional()) — process exits if missing, consistent with GEMINI_API_KEY pattern"
  - "voiceId is nullable text (no .notNull()) — allows per-contact voice override in future phases without forcing immediate value"
  - "Global voice toggle stored in existing settings key-value store as voice_replies_enabled — no new table needed"

patterns-established:
  - "Voice config follows existing required-env-var pattern from GEMINI_API_KEY"
  - "Voice boolean columns use integer({ mode: 'boolean' }) pattern consistent with fromMe, processed, active, enabled"

requirements-completed: [voice-infra-deps, voice-infra-config, voice-infra-schema, voice-infra-toggle]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 12 Plan 01: Voice Infrastructure Foundation Summary

**ElevenLabs SDK and ffmpeg-static installed, Zod env schema extended with TTS credentials, contacts table extended with voice columns, and global voice toggle seeded in settings store**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-01T08:08:32Z
- **Completed:** 2026-03-01T08:10:07Z
- **Tasks:** 2
- **Files modified:** 4 (package.json, config.ts, schema.ts, settings.ts)

## Accomplishments
- Installed @elevenlabs/elevenlabs-js and ffmpeg-static; both resolve cleanly via dynamic import
- Extended Zod env schema in config.ts with ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID as required fields
- Added voiceReplyEnabled (integer boolean, notNull, default false) and voiceId (nullable text) to the contacts table schema
- Added voice_replies_enabled: 'false' to settings DEFAULTS as the global master voice switch

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @elevenlabs/elevenlabs-js and ffmpeg-static** - `1d8c69f` (chore)
2. **Task 2: Add ElevenLabs config, voice columns, and settings default** - `58689a2` (feat)

## Files Created/Modified
- `package.json` — added @elevenlabs/elevenlabs-js ^2.37.0 and ffmpeg-static ^5.3.0 to dependencies
- `src/config.ts` — ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID added after LMS_MODEL in Zod schema
- `src/db/schema.ts` — voiceReplyEnabled and voiceId columns added to contacts table after consecutiveAutoCount
- `src/db/queries/settings.ts` — voice_replies_enabled: 'false' added to DEFAULTS

## Decisions Made
- Both ElevenLabs env vars are required (not optional) — consistent with existing GEMINI_API_KEY pattern; process exits at startup if missing, providing early failure rather than runtime surprises
- voiceId is nullable with no .notNull() — allows per-contact voice override to remain null until a contact's voice is configured in a later phase
- Global voice toggle uses the existing settings key-value store (not a new table) — already established pattern, sufficient for a simple boolean toggle

## Deviations from Plan

None - plan executed exactly as written.

**Note:** `npx tsc --noEmit` reveals a pre-existing tsconfig issue (rootDir: ./src conflicts with cli/**/* include pattern). This is out-of-scope for this plan — not caused by these changes. Logged to deferred items.

## Issues Encountered
- Pre-existing TypeScript config issue (rootDir: ./src but cli/**/* in include) produces two TS6059 errors. This predates these changes and is unrelated to the voice infrastructure additions. Deferred.

## User Setup Required
**External services require manual configuration (covered in Plan 12-03):**
- Add ELEVENLABS_API_KEY to .env
- Add ELEVENLABS_DEFAULT_VOICE_ID to .env
- Run database migration (Plan 12-02) to apply voiceReplyEnabled and voiceId columns to live DB

## Next Phase Readiness
- Plan 12-02 (database migration) can now run — schema changes are staged in schema.ts
- Plan 12-03 (.env setup + validation) can guide adding ElevenLabs credentials
- All subsequent voice plans (13-16) have their dependency foundation in place

---
*Phase: 12-voice-infrastructure*
*Completed: 2026-03-01*

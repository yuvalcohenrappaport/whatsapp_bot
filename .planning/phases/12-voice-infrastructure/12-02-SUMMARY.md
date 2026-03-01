---
phase: 12-voice-infrastructure
plan: "02"
subsystem: infra
tags: [elevenlabs, drizzle, migration, sqlite, voice, client, startup-validation]

# Dependency graph
requires:
  - "12-01 — ElevenLabs deps installed, config/schema extended"
provides:
  - "drizzle/0007_whole_lethal_legion.sql migration for voice columns"
  - "Migration applied to data/bot.db — contacts has voice_reply_enabled and voice_id"
  - "src/voice/client.ts — ElevenLabsClient singleton and validateElevenLabsConnection"
  - "src/index.ts — startup validator wired into main() after initDb()"
affects:
  - 12-03-PLAN.md
  - 13-voice-synthesis
  - 14-voice-transcription
  - 15-voice-draft-flow
  - 16-voice-controls

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ElevenLabsClient instantiated with explicit apiKey from config (not env directly)"
    - "Startup validators: non-fatal, short timeout (5s), maxRetries 0"
    - "Drizzle generate+migrate workflow for schema evolution"

key-files:
  created:
    - "drizzle/0007_whole_lethal_legion.sql — ALTER TABLE contacts ADD voice_reply_enabled, ADD voice_id"
    - "drizzle/meta/0007_snapshot.json — Drizzle schema snapshot"
    - "src/voice/client.ts — ElevenLabsClient singleton and validateElevenLabsConnection function"
  modified:
    - "drizzle/meta/_journal.json — updated with migration 0007 entry"
    - "src/index.ts — import and call validateElevenLabsConnection after initDb()"

key-decisions:
  - "Migration SQL generated via db:generate (not hand-written) — ensures correct SQLite integer DEFAULT 0 syntax vs hand-written DEFAULT false which fails"
  - "Startup validator is strictly non-fatal — return value intentionally unused; failure logged as warning, bot continues text-only"
  - "voices.get(voiceId) used for validation — confirms both API key validity (auth) and voice ID existence in a single call"

requirements-completed: [voice-infra-client, voice-infra-validation, voice-infra-migration]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 12 Plan 02: ElevenLabs Client and DB Migration Summary

**Drizzle migration generated and applied adding voice columns to contacts, ElevenLabsClient singleton created with startup connection validator wired non-fatally into main()**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-01T08:12:51Z
- **Completed:** 2026-03-01T08:14:28Z
- **Tasks:** 2
- **Files created:** 3 (migration SQL, snapshot, client.ts)
- **Files modified:** 2 (_journal.json, index.ts)

## Accomplishments

- Ran `npm run db:generate` — produced `drizzle/0007_whole_lethal_legion.sql` with correct SQLite ALTER TABLE syntax for both voice columns
- Ran `npm run db:migrate` — applied migration to `data/bot.db`; contacts table verified to have `voice_reply_enabled` (INTEGER, NOT NULL, default false) and `voice_id` (TEXT, nullable)
- Created `src/voice/client.ts` with `elevenLabsClient` singleton (explicit apiKey from config) and `validateElevenLabsConnection` (5s timeout, maxRetries 0, non-fatal)
- Updated `src/index.ts` to import and call `validateElevenLabsConnection(logger)` immediately after `initDb()` — result intentionally discarded, failure only warns

## Task Commits

Each task was committed atomically:

1. **Task 1: Generate and apply Drizzle migration for voice columns** - `3ee06e9` (chore)
2. **Task 2: Create src/voice/client.ts and wire startup validator into index.ts** - `36b4050` (feat)

## Files Created/Modified

- `drizzle/0007_whole_lethal_legion.sql` — Migration with `ALTER TABLE contacts ADD voice_reply_enabled integer DEFAULT false NOT NULL` and `ALTER TABLE contacts ADD voice_id text`
- `drizzle/meta/_journal.json` — Updated with idx 7 entry for the new migration
- `drizzle/meta/0007_snapshot.json` — Drizzle schema snapshot post-migration
- `src/voice/client.ts` — New module: `elevenLabsClient` singleton and `validateElevenLabsConnection` function
- `src/index.ts` — Import added at line 18, call added at line 34 inside `main()` after `initDb()`

## Decisions Made

- Migration SQL generated via `db:generate`, not hand-written: SQLite requires `DEFAULT 0` for integer boolean columns — hand-written `DEFAULT false` causes syntax error; Drizzle generates the correct form
- Startup validator is non-fatal by design: return value is explicitly discarded with a comment; Phase 13+ will check ElevenLabs availability via settings toggle and try/catch on actual TTS calls
- `voices.get(voiceId)` confirms API key auth and voice ID existence in one call — efficient for startup validation

## Deviations from Plan

None - plan executed exactly as written.

**Note:** `npx tsc --noEmit` still shows the two pre-existing TS6059 errors (rootDir: ./src conflicts with cli/**/* include pattern). These predate these changes and are unrelated to voice infrastructure. No voice-specific TypeScript errors were introduced.

## Next Phase Readiness

- Plan 12-03 (.env setup) can now guide adding `ELEVENLABS_API_KEY` and `ELEVENLABS_DEFAULT_VOICE_ID` to `.env`
- The startup validator will run automatically on next bot start — ElevenLabs credentials required or startup will warn (non-fatal)
- All voice infrastructure dependencies are now in place for Phase 13 (voice synthesis)

---
*Phase: 12-voice-infrastructure*
*Completed: 2026-03-01*

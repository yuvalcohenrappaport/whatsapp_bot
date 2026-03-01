# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** v1.3 Voice Responses — Phase 14 complete, ready for Phase 15

## Current Position

Phase: 14 of 16 (Core Voice Pipeline) -- COMPLETE
Plan: 2 of 2 complete
Status: Phase complete
Last activity: 2026-03-01 — 14-02 complete — voice pipeline verified end-to-end on real device

Progress: [████████░░░░░░░░░░░░] 40% (v1.3 — Phase 14 complete, 3/5 phases done)

## Performance Metrics

**Velocity:**
- Total plans completed: 33 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 7)
- v1.2 shipped in 1 day (4 plans, 11 commits)

**Cumulative:**
- 3 milestones shipped in 4 days
- 11 phases, 26 plans total

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Recent decisions for v1.3:
- ElevenLabs for both STT (Scribe v2) and TTS (eleven_v3) — single API key, Hebrew support confirmed
- Lazy TTS generation — audio synthesized at draft approval time, never stored on disk before approval
- ffmpeg-static (bundled binary) — eliminates system dependency on ffmpeg; lossless OGG container wrap only
- `ptt: true` flag mandatory — without it audio sends as file attachment, not voice note bubble

Decisions from 12-01:
- Both ELEVENLABS_API_KEY and ELEVENLABS_DEFAULT_VOICE_ID are required (z.string(), no .optional()) — early failure on startup, consistent with GEMINI_API_KEY pattern
- voiceId is nullable text (no .notNull()) — allows per-contact voice override to remain null until configured
- Global voice toggle stored in existing settings key-value store as voice_replies_enabled — no new table needed

Decisions from 12-02:
- Migration SQL generated via db:generate (not hand-written) — SQLite requires DEFAULT 0 for integer boolean; hand-written DEFAULT false causes syntax error
- Startup validator is non-fatal by design — return value intentionally discarded; Phase 13+ handles ElevenLabs availability via settings toggle and try/catch on TTS calls
- voices.get(voiceId) used for startup validation — confirms both API key auth and voice ID existence in a single call

Decisions from 12-03:
- .env is gitignored so Task 1 produces no git commit — intentional; credentials must never be committed
- ffmpeg-static bundled binary at node_modules/ffmpeg-static/ffmpeg confirmed functional via Node.js module probe
- Voice clone quality gate: Hebrew must sound recognizable as user's voice using eleven_multilingual_v2 model

Decisions from 13-01:
- Cast STT response to SpeechToTextChunkResponseModel — union type narrowing needed since we never use multichannel/webhook modes

Decisions from 13-02:
- STT round-trip validates non-empty output only — exact text match not expected due to TTS-to-STT lossy conversion
- User confirmed Hebrew TTS quality acceptable for production use (eleven_v3 model with cloned voice)

Decisions from 14-01:
- Text body persisted to messages table (not audio buffer) for AI context continuity
- Voice branch inserted before text null guard — audio messages never reach text path
- Recording presence fires immediately before pipeline work for user feedback
- Shorter delay (500-1500ms) for voice send since recording presence already shown
- Cooldown/auto-cap/snooze duplicated in handleVoiceMessage to avoid modifying text path
- Draft mode voice messages create text drafts with "(voice msg)" label

Decisions from 14-02:
- Used better-sqlite3 directly (not drizzle ORM) for DB utility scripts since sqlite3 CLI is not installed
- pm2 confirmed as bot process manager — used pm2 restart for code reload
- Voice pipeline verified working end-to-end on real phone with Hebrew PTT voice note bubble

### Pending Todos

None.

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package (WhatsApp rejects Platform.WEB)
- Voice clone must be trained on clean MP3 at 192kbps+, NOT WhatsApp OGG — validate in ElevenLabs UI before Phase 13
- ~~ffmpeg-static ESM import needs runtime verification in Phase 12 (CJS-first package)~~ RESOLVED: resolves to /home/yuval/whatsapp-bot/node_modules/ffmpeg-static/ffmpeg
- ~~Hebrew STT accuracy with real informal speech may exceed 10-20% WER benchmark — test in Phase 14~~ RESOLVED: verified in 14-02 real device test, transcription worked correctly

## Session Continuity

Last session: 2026-03-01
Stopped at: Completed 14-02-PLAN.md — Phase 14 complete, voice pipeline verified end-to-end
Resume with: Plan Phase 15 (Draft Queue Voice Integration)
Resume file: .planning/phases/14-core-voice-pipeline/14-02-SUMMARY.md

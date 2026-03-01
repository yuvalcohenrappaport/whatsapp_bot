---
phase: 13-voice-service-modules
plan: "01"
subsystem: voice
tags: [stt, tts, elevenlabs, ffmpeg, opus]
dependency_graph:
  requires: [src/voice/client.ts, src/config.ts, ffmpeg-static]
  provides: [transcribe, textToSpeech]
  affects: [14-voice-pipeline]
tech_stack:
  added: []
  patterns: [ReadableStream-to-Buffer, ffmpeg-spawn-with-EPIPE-handling, WithMetadata-file-upload]
key_files:
  created:
    - src/voice/transcriber.ts
    - src/voice/tts.ts
  modified: []
decisions:
  - "Cast STT response to SpeechToTextChunkResponseModel — union type narrowing needed since we never use multichannel/webhook modes"
metrics:
  duration: ~3m
  completed: 2026-03-01T14:14:44Z
---

# Phase 13 Plan 01: Voice Service Modules Summary

STT via ElevenLabs Scribe v2 (Hebrew) and TTS via eleven_v3 with ffmpeg MP3-to-OGG/Opus transcode

## What Was Done

### Task 1: STT Transcriber Module
- **Commit:** db45021
- **File:** src/voice/transcriber.ts
- Created `transcribe(audioBuffer: Buffer, logger: pino.Logger): Promise<string>`
- Uses `scribe_v2` model with `languageCode: 'heb'` (ISO-639-3 for Hebrew)
- WithMetadata file wrapper: `{ data: audioBuffer, filename: 'audio.ogg', contentType: 'audio/ogg' }`
- Imports shared `elevenLabsClient` singleton from `./client.js`
- Casts response to `SpeechToTextChunkResponseModel` to access `.text` (union type)

### Task 2: TTS Module with ffmpeg Transcode
- **Commit:** 759a0f2
- **File:** src/voice/tts.ts
- Created `textToSpeech(text: string, logger: pino.Logger): Promise<Buffer>`
- Three-stage pipeline:
  1. ElevenLabs TTS API call with `eleven_v3` model, `mp3_44100_128` output format
  2. `streamToBuffer()` helper collects `ReadableStream<Uint8Array>` into Buffer using `getReader()` loop
  3. `transcodeToOgg()` spawns ffmpeg with args `['-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', 'pipe:1']`
- EPIPE-safe stdin handler: swallows `EPIPE` errors (expected if ffmpeg closes stdin early)
- ffmpegPath null check before spawn
- Imports from `./client.js`, `../config.js`, `ffmpeg-static`, `child_process`

## Verification Results

- Both files exist and compile cleanly (`npx tsc --noEmit` shows only pre-existing TS6059 rootDir warning)
- Correct imports: both use `'./client.js'` extension
- Correct models: transcriber uses `scribe_v2`, TTS uses `eleven_v3`
- Correct language code: transcriber uses `'heb'` (ISO-639-3)
- ffmpeg uses `-i pipe:0` without `-f` for input format auto-detection
- Neither module creates its own ElevenLabsClient

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added SpeechToTextChunkResponseModel type cast**
- **Found during:** Task 1
- **Issue:** `SpeechToTextConvertResponse` is a union of 3 types (`SpeechToTextChunkResponseModel | MultichannelSpeechToTextResponseModel | SpeechToTextWebhookResponseModel`). Only the chunk response model has a `.text` property directly accessible. Without narrowing, TypeScript cannot access `.text`.
- **Fix:** Cast `await` result to `SpeechToTextChunkResponseModel` since we never use multichannel or webhook modes. Imported the type from `@elevenlabs/elevenlabs-js/api`.
- **Files modified:** src/voice/transcriber.ts
- **Commit:** db45021

## Commits

| Order | Hash    | Message                                              |
| ----- | ------- | ---------------------------------------------------- |
| 1     | db45021 | feat(13-01): add STT transcriber module              |
| 2     | 759a0f2 | feat(13-01): add TTS module with ffmpeg OGG transcode |

## Self-Check: PASSED

- FOUND: src/voice/transcriber.ts
- FOUND: src/voice/tts.ts
- FOUND: 13-01-SUMMARY.md
- FOUND: commit db45021
- FOUND: commit 759a0f2

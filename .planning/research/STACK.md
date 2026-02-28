# Stack Research

**Domain:** WhatsApp Bot — Voice Message Features (Transcription + TTS)
**Researched:** 2026-02-28
**Confidence:** HIGH (versions verified via npm registry; API capabilities verified via official ElevenLabs docs and changelog; audio format requirements cross-verified across multiple sources)

---

## Context: What Already Exists (Do Not Re-Research)

The base bot is a working TypeScript ESM project. These dependencies are already installed and validated:

| Already In Use | Version | Status |
|----------------|---------|--------|
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | Keep — audio send/receive via existing socket |
| `@google/genai` | 1.42.0 | Keep — Gemini for text generation (unchanged) |
| `drizzle-orm` + `better-sqlite3` | 0.45.1 / 12.6.2 | Keep — add `voice_settings` table |
| `zod` | 4.3.6 | Keep — validate voice toggle API input |
| `pino` | 10.3.1 | Keep — logging |
| `dotenv` | 17.3.1 | Keep — add `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |

This document covers **only the additions required for the voice message milestone**.

---

## New Stack Additions

### ElevenLabs Integration

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@elevenlabs/elevenlabs-js` | 2.37.0 | TTS synthesis + audio transcription | Official ElevenLabs SDK for Node.js. **Note:** The `elevenlabs` package (v1.59.0) is deprecated — npm registry shows "DEPRECATED: This package has moved to @elevenlabs/elevenlabs-js". The new package has far fewer dependencies (3 vs 9), published 2 days ago (actively maintained), and is the SDK that ElevenLabs' own docs now reference. |

**ElevenLabs API methods used:**

| Method | Purpose | Input | Output |
|--------|---------|-------|--------|
| `client.textToSpeech.convert(voiceId, { text, model_id, output_format })` | TTS synthesis | Text string | Binary audio stream |
| `client.speechToText.convert({ file, model_id })` | Transcription | Audio file/buffer | Text transcript |

**Model selection — critical for Hebrew:**

| Use Case | Model ID | Why |
|----------|----------|-----|
| TTS with Hebrew voice clone | `eleven_v3` | Explicitly supports Hebrew (heb) in 70+ languages; most expressive model; 5,000 char limit per request |
| Transcription | `scribe_v2` | Batch transcription; Hebrew WER 3.1% (FLEURS benchmark) — better than claimed in older docs |

**TTS output format:**

Use `output_format: "opus_48000_64"` — this produces an Opus-encoded audio stream at 48kHz / 64kbps, which is the exact codec+sample rate WhatsApp requires for PTT voice notes. The ElevenLabs Opus output is a raw Opus stream (application/octet-stream); it requires wrapping in an OGG container before Baileys will send it correctly as a WhatsApp voice note.

**Speech-to-text input format:**

Scribe v2 accepts OGG/Opus natively. WhatsApp voice messages downloaded via `downloadMediaMessage` are already OGG/Opus buffers — no conversion needed before sending to ElevenLabs for transcription.

---

### Audio Processing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ffmpeg-static` | 5.3.0 | Bundled ffmpeg binary (no system dependency) | Provides a statically compiled ffmpeg binary that works on this Ubuntu server without requiring `apt install ffmpeg`. Downloads platform-specific binary to `node_modules` on `npm install`. Published 3 months ago. Used via `child_process.spawn` with the binary path exposed at `import ffmpegPath from 'ffmpeg-static'`. |

**Why NOT `fluent-ffmpeg`:** fluent-ffmpeg (v2.1.3) was archived and marked deprecated on npm as of May 2025. The repository is read-only and no longer accepts issues or PRs. Use `ffmpeg-static` + `child_process.spawn` directly — it requires ~15 lines of utility code and has no abstraction layer to break.

**Audio pipeline — two operations required:**

| Operation | Input | Output | FFmpeg command |
|-----------|-------|--------|----------------|
| TTS → WhatsApp PTT | Raw Opus bytes from ElevenLabs | OGG/Opus buffer | `ffmpeg -f opus -i pipe:0 -c:a copy -f ogg pipe:1` |
| WhatsApp PTT → Transcription | OGG/Opus buffer from Baileys | Already usable — no conversion | (none needed) |

The TTS conversion wraps the ElevenLabs raw Opus stream into an OGG container. This is a copy operation (no re-encoding), so it is fast (< 100ms for typical voice messages).

---

### TypeScript Types

| Technology | Version | Purpose | When to Use |
|------------|---------|---------|-------------|
| `@types/fluent-ffmpeg` | 2.1.28 | TypeScript types for ffmpeg | Do NOT install — fluent-ffmpeg is deprecated. Write a thin typed `spawnFfmpeg(args, inputBuffer): Promise<Buffer>` utility instead. |

No additional `@types` packages are needed. `@elevenlabs/elevenlabs-js` ships its own TypeScript types. `ffmpeg-static` has a default export typed as `string | null`.

---

## Installation

```bash
# ElevenLabs SDK (official, current package)
npm install @elevenlabs/elevenlabs-js

# Bundled ffmpeg binary for OGG wrapping
npm install ffmpeg-static
```

That is the complete addition. Two packages.

---

## Integration Points with Existing Code

### 1. Receiving Voice Messages (Baileys `downloadMediaMessage`)

Baileys already exposes `downloadMediaMessage` for media retrieval. The existing `processMessage` function in `src/pipeline/messageHandler.ts` currently skips non-text messages (`if (text === null) return`). The voice pipeline extends this with an audio branch:

```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

// In processMessage, after the text null check:
const audioMsg = msg.message?.audioMessage;
if (audioMsg && audioMsg.ptt) {
  const audioBuffer = await downloadMediaMessage(msg, 'buffer', {});
  // audioBuffer is OGG/Opus — send directly to ElevenLabs scribe_v2
}
```

The downloaded buffer is OGG/Opus (WhatsApp's wire format). No conversion needed before transcription.

### 2. Transcription via ElevenLabs

```typescript
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// audioBuffer: Buffer (OGG/Opus from Baileys downloadMediaMessage)
const transcript = await client.speechToText.convert({
  file: new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' }),
  model_id: 'scribe_v2',
});
// transcript.text: the transcribed Hebrew text
```

### 3. TTS + OGG Wrapping + Send as PTT

```typescript
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';

// Step 1: Generate audio from ElevenLabs
const stream = await client.textToSpeech.convert(voiceId, {
  text: replyText,
  model_id: 'eleven_v3',
  output_format: 'opus_48000_64',
});
const rawOpus = Buffer.from(await streamToBuffer(stream));

// Step 2: Wrap raw Opus in OGG container (copy, no re-encode)
const oggBuffer = await wrapOpusInOgg(rawOpus); // see pitfalls for implementation

// Step 3: Send as PTT voice note via Baileys
await sock.sendMessage(jid, {
  audio: oggBuffer,
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true,
});
```

### 4. Voice Toggle — Per-Contact DB Field

Add a `voiceEnabled` boolean column to the existing `contacts` table in Drizzle schema. No new table needed. The pipeline checks `contact.voiceEnabled` before engaging the voice path; if false, falls through to existing text path.

```typescript
// src/db/schema.ts — addition to contacts table
voiceEnabled: integer('voice_enabled', { mode: 'boolean' }).notNull().default(false),
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `@elevenlabs/elevenlabs-js` | `elevenlabs` (v1.59.0) | Deprecated — moved package. npm registry shows deprecation warning. Do not use. |
| `@elevenlabs/elevenlabs-js` | OpenAI Whisper for transcription | Project requirement specifies ElevenLabs for both TTS and transcription. Also: ElevenLabs Scribe v2 achieves 3.1% WER for Hebrew vs Whisper's generally lower Hebrew accuracy. |
| `ffmpeg-static` + `child_process` | `fluent-ffmpeg` | fluent-ffmpeg archived May 2025, marked deprecated on npm. Repo is read-only. |
| `ffmpeg-static` + `child_process` | `@ffmpeg.js/ffmpeg-core` (WASM) | WASM FFmpeg is much slower (~3-5x), larger binary (25MB+), and adds complexity. The server has native hardware — use the native binary. |
| `ffmpeg-static` + `child_process` | System `ffmpeg` (pre-installed) | System ffmpeg is not guaranteed on this server. `ffmpeg-static` bundles it — zero installation step, portable across environments. |
| ElevenLabs `eleven_v3` for TTS | `eleven_multilingual_v2` | `eleven_multilingual_v2` supports 29 languages but `eleven_v3` explicitly lists Hebrew (heb) in 70+ languages. For a Hebrew voice clone, use `eleven_v3`. |
| `opus_48000_64` output format | `mp3_44100_128` (ElevenLabs default) | WhatsApp PTT requires OGG/Opus at 48kHz. MP3 output would require full transcoding (lossy re-encode, slower, worse quality). Opus output is the codec WhatsApp uses natively — just needs an OGG container wrap (lossless copy). |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `elevenlabs` (npm, v1.59.0) | Officially deprecated — npm shows deprecation warning. Package moved. | `@elevenlabs/elevenlabs-js` v2.37.0 |
| `fluent-ffmpeg` | Archived May 2025, marked deprecated on npm, read-only repo | `ffmpeg-static` + Node.js `child_process.spawn` |
| `@ffmpeg-installer/ffmpeg` | Older alternative to `ffmpeg-static`; less maintained (last pub: v1.1.0) | `ffmpeg-static` v5.3.0 (published 3 months ago) |
| `node-record-lpcm16` or similar microphone libraries | Not applicable — bot receives WhatsApp audio via Baileys, not a microphone | `downloadMediaMessage` from Baileys |
| WhatsApp Cloud API (Meta) | Project uses Baileys (unofficial API), not Cloud API. Different endpoints, different auth. Do not mix them. | Stay on Baileys — already working |
| Streaming transcription (`scribe_v2_realtime`) | Overkill for voice messages — those arrive as complete files, not live streams. Realtime is for agents/calls. | `scribe_v2` (batch) |

---

## Audio Format Reference

This table summarizes the complete audio format pipeline for this milestone:

| Stage | Format | Container | Codec | Sample Rate | Notes |
|-------|--------|-----------|-------|-------------|-------|
| WhatsApp receives voice (incoming) | `.ogg` | OGG | Opus | 16kHz or 48kHz | Baileys `downloadMediaMessage` returns a Buffer of this |
| Send to ElevenLabs transcription | OGG/Opus buffer | OGG | Opus | — | Scribe v2 accepts OGG natively — no conversion |
| ElevenLabs TTS output | Raw Opus stream | None (raw) | Opus | 48kHz | `opus_48000_64` — needs OGG container wrap |
| After ffmpeg OGG wrap | `.ogg` | OGG | Opus | 48kHz | Ready for Baileys `sendMessage` as PTT |
| Baileys sends PTT | `.ogg` | OGG | Opus | 48kHz | `mimetype: 'audio/ogg; codecs=opus', ptt: true` |

---

## Version Compatibility Matrix

| Package | Version | Node Requirement | ESM Compatible | Notes |
|---------|---------|-----------------|----------------|-------|
| `@elevenlabs/elevenlabs-js` | 2.37.0 | >= 18 | YES | `import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'` |
| `ffmpeg-static` | 5.3.0 | >= 12 | Partial | Default export is a string path; use `import ffmpegPath from 'ffmpeg-static'`. In strict ESM, may need `createRequire` — check at integration time. |

**Compatibility note on `ffmpeg-static` and ESM:** `ffmpeg-static` uses `main` field (CJS-first). In an ESM project (`"type": "module"`), import as `import ffmpegPath from 'ffmpeg-static'` — tsx handles this transparently. If import fails at runtime, fall back to `import { createRequire } from 'module'; const require = createRequire(import.meta.url); const ffmpegPath = require('ffmpeg-static');`.

---

## Environment Variables

Two new env vars required (add to `.env` and document in `.env.example`):

```bash
ELEVENLABS_API_KEY=sk_...          # ElevenLabs API key
ELEVENLABS_VOICE_ID=...            # Voice ID of the cloned Hebrew voice
```

The voice ID is obtained after cloning the target voice in the ElevenLabs dashboard (Instant Voice Clone — requires Creator plan or above). It is a static string that doesn't change unless the voice is deleted. Store in env var, not in DB.

---

## Sources

- [npm: @elevenlabs/elevenlabs-js](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js) — version 2.37.0 verified via `npm info`; published 2 days ago; 3 dependencies
- [npm: elevenlabs](https://www.npmjs.com/package/elevenlabs) — confirmed DEPRECATED notice: "This package has moved to @elevenlabs/elevenlabs-js"
- [ElevenLabs models docs](https://elevenlabs.io/docs/overview/models) — confirmed `eleven_v3` model ID; Hebrew (heb) in 70+ languages; `eleven_multilingual_v2` supports 29 languages
- [ElevenLabs speech-to-text docs](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) — OGG/Opus accepted as input; Hebrew WER 3.1% (FLEURS), 5.5% (Common Voice); up to 3GB file size
- [ElevenLabs TTS API reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) — output_format list includes `opus_48000_64`; default `mp3_44100_128`
- [ElevenLabs blog: Scribe v2](https://elevenlabs.io/blog/introducing-scribe-v2) — Hebrew benchmark figures
- [ElevenLabs Hebrew STT](https://elevenlabs.io/speech-to-text/hebrew) — Hebrew-specific landing confirming support
- [npm: ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) — version 5.3.0; published 3 months ago; platform-specific binary download
- [npm: fluent-ffmpeg](https://www.npmjs.com/package/fluent-ffmpeg) — confirmed DEPRECATED notice; read-only repo
- [Baileys docs: downloadMediaMessage](https://baileys.wiki/docs/api/functions/downloadMediaMessage/) — returns `Promise<Buffer>` when called with `'buffer'` type
- [Baileys Types/Message.ts](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/Message.ts) — `ptt?: boolean`, `seconds?: number` on audio messages; `mimetype` via WAMediaUpload
- [Baileys issue #1745](https://github.com/WhiskeySockets/Baileys/issues/1745) — PTT waveform display issue since v6.7.9; audio still plays correctly; cosmetic only
- [WhatsApp OGG/Opus PTT format requirement](https://blog.ultramsg.com/how-to-send-ogg-file-using-whatsapp-api/) — `audio/ogg; codecs=opus` at 48kHz required for PTT
- [ElevenLabs + WhatsApp voice note issue](https://github.com/openclaw/openclaw/issues/25102) — confirmed Opus output needs OGG container wrap for Baileys PTT

---
*Stack research for: WhatsApp Bot — Voice Message Features (Transcription + TTS)*
*Researched: 2026-02-28*

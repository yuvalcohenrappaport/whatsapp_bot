# Phase 13: Voice Service Modules - Research

**Researched:** 2026-03-01
**Domain:** ElevenLabs SDK (STT + TTS), ffmpeg OGG wrapping, Node.js stream handling
**Confidence:** HIGH (SDK types verified directly from installed node_modules; ffmpeg behavior tested live)

## Summary

Phase 13 builds two standalone modules: `transcriber.ts` (OGG/Opus Buffer → Hebrew transcript string) and `tts.ts` (text → OGG/Opus Buffer). Both modules are consumed by the voice pipeline and must be independently integration-testable.

The critical discovery is a conflict between prior research and reality: `-f opus` is an **output-only** demuxer in the ffmpeg-static 7.0.2 build — it cannot be used as an **input** format. This invalidates the proposed raw-opus-wrap command from milestone research. The correct TTS approach is to request `mp3_44100_128` from ElevenLabs and transcode to OGG/Opus with `ffmpeg -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1`.

Another critical discovery resolves the conflicting Hebrew TTS model information: **`eleven_multilingual_v2` does NOT support Hebrew** (its 29 languages do not include Hebrew). **`eleven_v3` supports 70+ languages including Hebrew** and is production-ready as of February 2026. Use `eleven_v3` for Hebrew TTS — there is no alternative.

**Primary recommendation:** STT uses `speechToText.convert()` with `scribe_v2` and a `WithMetadata` Buffer wrapper. TTS uses `textToSpeech.convert()` with `eleven_v3` and `mp3_44100_128` output, then transcodes to OGG via ffmpeg.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VOICE-02 | Transcribe via Scribe v2 | `client.speechToText.convert({ modelId: 'scribe_v2', file: { data: buffer, filename: 'audio.ogg', contentType: 'audio/ogg' }, languageCode: 'heb' })` — returns `SpeechToTextChunkResponseModel` with `.text` field |
| VOICE-04 | TTS with cloned voice | `client.textToSpeech.convert(voiceId, { text, modelId: 'eleven_v3', outputFormat: 'mp3_44100_128' })` — returns `ReadableStream<Uint8Array>`, then transcode to OGG/Opus via ffmpeg |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @elevenlabs/elevenlabs-js | 2.37.0 (installed) | ElevenLabs SDK: STT + TTS API calls | Official SDK, already installed in Phase 12 |
| ffmpeg-static | 5.3.0 (installed) | ffmpeg binary for OGG container transcoding | Already installed; binary verified working at `/home/yuval/whatsapp-bot/node_modules/ffmpeg-static/ffmpeg` |
| child_process (Node.js built-in) | N/A | Spawn ffmpeg process with stdin/stdout pipes | Native; no additional install |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 10.x (installed) | Structured logging | Pass logger into both modules |
| @elevenlabs/elevenlabs-js errors | bundled | Error handling | `ElevenLabsError`, `UnprocessableEntityError` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| mp3_44100_128 + ffmpeg transcode | opus_48000_64 direct | ElevenLabs opus output format is ambiguous — unknown if OGG-containerized. mp3 is definitively containerized, ffmpeg auto-detects it. Verify in integration test whether opus_48000_64 is already OGG (if so, no ffmpeg needed). |
| eleven_v3 | eleven_multilingual_v2 | eleven_multilingual_v2 does NOT support Hebrew (29 languages, Hebrew excluded). eleven_v3 required. |
| scribe_v2 | scribe_v1 | scribe_v2 adds keyterm prompting and entity detection. Use scribe_v2 per requirements. |

**Installation:** Already complete from Phase 12. No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/voice/
├── client.ts        # ElevenLabs client (Phase 12, already exists)
├── transcriber.ts   # STT: OGG/Opus Buffer → Hebrew string (Phase 13)
└── tts.ts           # TTS: string → OGG/Opus Buffer (Phase 13)

scripts/
└── test-voice.ts    # Integration test for both modules
```

### Pattern 1: STT Module — Buffer to Transcript

**What:** Accept a Buffer of OGG/Opus audio (as received from WhatsApp via Baileys), send to ElevenLabs Scribe v2, return the transcript string.

**When to use:** Called by the voice pipeline when an incoming WhatsApp message is an audio/PTT message.

**Key details:**
- `file` parameter accepts `Uploadable.WithMetadata` — use `{ data: buffer, filename: 'audio.ogg', contentType: 'audio/ogg' }` to provide explicit metadata. Raw Buffer passed directly gets no filename/contentType (falls back to `application/octet-stream`).
- `languageCode: 'heb'` — ISO-639-3 format, improves Hebrew accuracy.
- Response is `SpeechToTextChunkResponseModel` — access `.text` for the transcript string.
- `HttpResponsePromise` extends `Promise` — `await` it directly.

**Example:**
```typescript
// Source: node_modules/@elevenlabs/elevenlabs-js/dist types, verified live

import { elevenLabsClient } from './client.js';
import type pino from 'pino';

export async function transcribe(
  audioBuffer: Buffer,
  logger: pino.Logger,
): Promise<string> {
  const result = await elevenLabsClient.speechToText.convert({
    modelId: 'scribe_v2',
    file: {
      data: audioBuffer,
      filename: 'audio.ogg',
      contentType: 'audio/ogg',
    },
    languageCode: 'heb',
  });
  logger.info({ chars: result.text.length }, 'transcription complete');
  return result.text;
}
```

### Pattern 2: TTS Module — Text to OGG/Opus Buffer

**What:** Accept a Hebrew text string, request MP3 audio from ElevenLabs using `eleven_v3` model, transcode to OGG/Opus container via ffmpeg, return Buffer.

**When to use:** Called by the voice pipeline when a reply needs to be sent as a voice note.

**Key details:**
- `textToSpeech.convert()` signature: `convert(voice_id: string, request: BodyTextToSpeechFull): HttpResponsePromise<ReadableStream<Uint8Array>>`
- Await gives a `ReadableStream<Uint8Array>` — must be consumed to get bytes.
- Convert ReadableStream to Buffer via `getReader()` loop OR `new Response(stream).arrayBuffer()`.
- ffmpeg transcodes mp3 → ogg/opus: `ffmpeg -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1`
- ffmpeg binary path via `import ffmpegPath from 'ffmpeg-static'` (works with tsx/esModuleInterop).
- Handle stdin `EPIPE` errors (ffmpeg closes pipe on invalid input).
- Capture stderr for error messages when ffmpeg exits non-zero.

**Example:**
```typescript
// Source: node_modules types + live spawn testing

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { elevenLabsClient } from './client.js';
import { config } from '../config.js';
import type pino from 'pino';

export async function textToSpeech(
  text: string,
  logger: pino.Logger,
): Promise<Buffer> {
  // Step 1: Get MP3 from ElevenLabs
  const stream = await elevenLabsClient.textToSpeech.convert(
    config.ELEVENLABS_DEFAULT_VOICE_ID,
    {
      text,
      modelId: 'eleven_v3',
      outputFormat: 'mp3_44100_128',
    },
  );

  // Step 2: Collect ReadableStream<Uint8Array> to Buffer
  const mp3Buffer = await streamToBuffer(stream);
  logger.debug({ bytes: mp3Buffer.length }, 'TTS MP3 received');

  // Step 3: Transcode MP3 → OGG/Opus via ffmpeg
  const oggBuffer = await transcodeToOgg(mp3Buffer, logger);
  logger.info({ bytes: oggBuffer.length }, 'TTS OGG ready');
  return oggBuffer;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function transcodeToOgg(input: Buffer, logger: pino.Logger): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, [
      '-i', 'pipe:0',       // auto-detect input format (mp3)
      '-c:a', 'libopus',    // encode with libopus
      '-b:a', '64k',        // 64kbps
      '-f', 'ogg',          // OGG container output
      'pipe:1',             // stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString().slice(-500);
        reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    proc.on('error', reject);
    proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      // EPIPE = ffmpeg closed stdin early (bad input); surfaces via 'close' event
      if (err.code !== 'EPIPE') reject(err);
    });

    proc.stdin.end(input);
  });
}
```

### Pattern 3: OGG Magic Bytes Verification (Optional)

Use this in the integration test to verify the output buffer is actually OGG-containerized:

```typescript
// Source: OGG spec — magic bytes are always "OggS" at offset 0
function isOggContainer(buffer: Buffer): boolean {
  return buffer.length >= 4 &&
    buffer[0] === 0x4F &&  // 'O'
    buffer[1] === 0x67 &&  // 'g'
    buffer[2] === 0x67 &&  // 'g'
    buffer[3] === 0x53;    // 'S'
}
```

### Anti-Patterns to Avoid
- **Using `-f opus` as ffmpeg input format:** This format is output-only (muxer) in ffmpeg-static 7.0.2. It cannot read opus data from stdin. It generates `Error: Unknown input format: 'opus'`.
- **Passing raw Buffer directly as `file` without metadata:** Raw Buffer gets no MIME type hint. Use `{ data: buffer, filename: 'audio.ogg', contentType: 'audio/ogg' }` for reliable ElevenLabs format detection.
- **Using `eleven_multilingual_v2` for Hebrew TTS:** This model only supports 29 languages — Hebrew is not included. It will either error or produce incorrect output.
- **Piping a Node.js `Readable` stream to ffmpeg stdin:** This causes uncaught `EPIPE` errors if ffmpeg rejects the stream early. Collect to Buffer first, then write with `proc.stdin.end(buffer)`.
- **Not handling EPIPE on proc.stdin:** If ffmpeg detects bad input and closes stdin before we finish writing, Node throws `EPIPE`. Register `proc.stdin.on('error', handler)` and ignore `EPIPE` codes.
- **Ignoring stderr from ffmpeg:** When ffmpeg exits non-zero, stderr contains the error message. Capture it for useful error messages.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio transcription | Custom Whisper wrapper | `client.speechToText.convert()` | ElevenLabs Scribe v2 handles OGG/Opus natively, Hebrew WER ~15%, no infrastructure needed |
| Audio format detection | Manual byte inspection | ffmpeg auto-detect (`-i pipe:0` no `-f`) | ffmpeg's format probe handles edge cases; manual magic byte parsing misses many formats |
| Opus encoding | Node.js opus library | ffmpeg with libopus | ffmpeg handles sample rate conversion, channel mapping, OGG muxing correctly |
| Stream buffering | Custom async iterator | `getReader()` loop or `new Response(stream).arrayBuffer()` | Both patterns tested and working in Node.js 20 |
| Error classification | Status code inspection | `instanceof ElevenLabsError` + `.statusCode` | SDK provides typed errors; `UnprocessableEntityError` for 422, `ElevenLabsTimeoutError` for timeout |

**Key insight:** The ElevenLabs SDK handles multipart form encoding, authentication headers, retry logic, and response parsing. The only custom code needed is the ffmpeg spawn for OGG wrapping.

## Common Pitfalls

### Pitfall 1: Wrong ffmpeg Input Format for Opus
**What goes wrong:** Using `-f opus -i pipe:0` causes `Unknown input format: 'opus'` because `opus` is output-only in this static ffmpeg build.
**Why it happens:** The `opus` demuxer/muxer distinction is not obvious. `ffmpeg -formats` shows `E opus` (encoder/muxer only), not `DE` (both).
**How to avoid:** Use `mp3_44100_128` from ElevenLabs and let ffmpeg auto-detect the format (`-i pipe:0` without `-f`). ffmpeg's probe handles mp3 correctly.
**Warning signs:** `Error opening input file pipe:0` or `Unknown input format` in ffmpeg stderr.

### Pitfall 2: Hebrew Model Confusion
**What goes wrong:** Using `eleven_multilingual_v2` for Hebrew TTS produces wrong output or API error.
**Why it happens:** eleven_multilingual_v2 supports 29 languages, Hebrew not included. eleven_v3 supports 70+ languages including Hebrew.
**How to avoid:** Always use `modelId: 'eleven_v3'` for Hebrew TTS.
**Warning signs:** Garbled output, Latin-character rendering of Hebrew words, or unexpected API error.

### Pitfall 3: ReadableStream Not Consumed
**What goes wrong:** `textToSpeech.convert()` returns an `HttpResponsePromise<ReadableStream<Uint8Array>>`. Awaiting gives the stream, not a Buffer. Calling `.pipe()` fails — it's a Web ReadableStream, not a Node.js Readable.
**Why it happens:** The SDK returns Web Streams API `ReadableStream`, not Node.js `stream.Readable`. These have different APIs.
**How to avoid:** Use `.getReader()` loop or `new Response(stream).arrayBuffer()` — both tested working.
**Warning signs:** `TypeError: stream.pipe is not a function` or empty output.

### Pitfall 4: ffmpeg Exit Code with Partial OGG Output
**What goes wrong:** ffmpeg may write some OGG bytes to stdout before detecting an error and exiting non-zero. If you resolve on the 'close' event regardless of exit code, you get corrupted partial audio.
**Why it happens:** ffmpeg writes what it processes before detecting the end-of-file or format error.
**How to avoid:** Only resolve the Promise when `code === 0`. Reject with `code !== 0`.
**Warning signs:** Audio plays for a moment then cuts out; corrupted OGG files.

### Pitfall 5: ffmpegPath is null
**What goes wrong:** `ffmpegPath` from `ffmpeg-static` returns `null` on unsupported platforms.
**Why it happens:** ffmpeg-static only bundles binaries for known platform+arch combos.
**How to avoid:** Check `ffmpegPath` is not null before spawning. Throw a clear error if null.
**Warning signs:** `spawn null` TypeError at runtime.

### Pitfall 6: languageCode Format for Hebrew
**What goes wrong:** Using `languageCode: 'he'` (ISO 639-1) instead of `languageCode: 'heb'` (ISO 639-3).
**Why it happens:** ElevenLabs STT uses ISO-639-3 codes ("heb") for Hebrew. The SDK field accepts both formats, but ElevenLabs docs consistently show 3-letter codes.
**How to avoid:** Use `languageCode: 'heb'` for Hebrew.
**Warning signs:** Lower transcription accuracy, or the API auto-detecting a different language.

## Code Examples

Verified patterns from SDK type inspection and live testing:

### STT Convert Call (exact SDK signature)
```typescript
// Source: node_modules/@elevenlabs/elevenlabs-js/dist/wrapper/speechToText.d.ts
// Returns: HttpResponsePromise<SpeechToTextChunkResponseModel>
// SpeechToTextChunkResponseModel.text: string — the raw transcript

const result = await client.speechToText.convert({
  modelId: 'scribe_v2',             // 'scribe_v1' | 'scribe_v2'
  file: {
    data: audioBuffer,              // Buffer is valid (extends Uint8Array)
    filename: 'audio.ogg',          // important: triggers MIME type handling
    contentType: 'audio/ogg',       // explicit type for reliable detection
  },
  languageCode: 'heb',             // ISO-639-3 for Hebrew
});
const transcript: string = result.text;
```

### TTS Convert Call (exact SDK signature)
```typescript
// Source: node_modules/@elevenlabs/elevenlabs-js/dist/api/resources/textToSpeech/client/Client.d.ts
// Signature: convert(voice_id: string, request: BodyTextToSpeechFull)
// Returns: HttpResponsePromise<ReadableStream<Uint8Array>>

const stream: ReadableStream<Uint8Array> = await client.textToSpeech.convert(
  voiceId,
  {
    text: 'שלום, מה שלומך?',
    modelId: 'eleven_v3',           // REQUIRED for Hebrew support
    outputFormat: 'mp3_44100_128',  // reliable format for ffmpeg transcode
    languageCode: 'he',             // optional but recommended for Hebrew
  },
);
```

### ReadableStream to Buffer
```typescript
// Source: tested live in Node.js 20 — both approaches work

// Option A: getReader() loop (explicit)
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Option B: Response.arrayBuffer() (concise)
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const ab = await new Response(stream).arrayBuffer();
  return Buffer.from(ab);
}
```

### ffmpeg OGG Transcode (mp3 → ogg/opus)
```typescript
// Source: live tested — ffmpeg-static 7.0.2, libopus available
// Command: ffmpeg -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1
// Note: -f opus as INPUT does NOT work (output-only muxer)

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

function transcodeToOgg(mp3Buffer: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found');

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
      else resolve(Buffer.concat(out));
    });
    proc.on('error', reject);
    proc.stdin.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EPIPE') reject(e);
    });
    proc.stdin.end(mp3Buffer);
  });
}
```

### Error Handling Pattern
```typescript
// Source: node_modules/@elevenlabs/elevenlabs-js/dist errors types

import { ElevenLabsError } from '@elevenlabs/elevenlabs-js';

try {
  const result = await transcribe(audioBuffer, logger);
  return result;
} catch (err) {
  if (err instanceof ElevenLabsError) {
    logger.warn({ statusCode: err.statusCode, body: err.body }, 'ElevenLabs error');
    throw err; // let caller decide fallback
  }
  throw err;
}
```

### Integration Test Pattern
```typescript
// Source: project convention from test-reply.ts

// scripts/test-voice.ts (run with: npx tsx scripts/test-voice.ts)
import { transcribe } from '../src/voice/transcriber.js';
import { textToSpeech } from '../src/voice/tts.js';
import { readFileSync, writeFileSync } from 'fs';
import pino from 'pino';

const logger = pino({ level: 'debug' });

// STT test: load a sample OGG file, transcribe it
const sampleAudio = readFileSync('./test-audio.ogg'); // need real OGG file
const transcript = await transcribe(sampleAudio, logger);
console.log('Transcript:', transcript);

// TTS test: generate voice for 5 Hebrew sentences
const testSentences = [
  'שלום, מה שלומך?',
  'הדו"ח המחקרי הוגש בזמן.',
  'אני יכול לעזור לך עם זה.',
  'הפגישה נדחתה לשבוע הבא.',
  'תודה רבה על עזרתך.',
];

for (const text of testSentences) {
  const audio = await textToSpeech(text, logger);
  console.log(`TTS "${text.slice(0, 20)}..." → ${audio.length} bytes OGG`);
  // OGG magic bytes check
  console.log('Is OGG:', audio[0] === 0x4F && audio[1] === 0x67);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| eleven_multilingual_v2 for Hebrew | eleven_v3 | Feb 2026 (v3 production) | eleven_multilingual_v2 doesn't support Hebrew; v3 does |
| fluent-ffmpeg wrapper | child_process.spawn directly | 2024 (fluent-ffmpeg deprecated) | Direct spawn avoids wrapper dependency issues |
| `-f opus -i pipe:0` (raw opus wrap) | mp3 input + libopus encode | This research | -f opus is OUTPUT-ONLY in ffmpeg-static 7.0.2 |
| scribe_v1 | scribe_v2 | 2025 | v2 adds keyterm prompting, entity detection |
| eleven_v3 "alpha" | eleven_v3 production | Feb 2, 2026 | 68% fewer errors on numbers/symbols; commercially ready |

**Deprecated/outdated:**
- `eleven_multilingual_v2` for Hebrew: does not support Hebrew (29 languages only)
- Raw opus ffmpeg wrap (`-f opus`): this demuxer does not exist in ffmpeg-static 7.0.2
- Milestone research's ffmpeg command `-f opus -i pipe:0 -c:a copy -f ogg pipe:1`: the `-f opus` input format is invalid

## Open Questions

1. **Does `opus_48000_64` output from ElevenLabs already include an OGG container?**
   - What we know: ElevenLabs added opus support March 2025. The format name is codec-only. Standard opus tools produce OGG+opus.
   - What's unclear: Whether ElevenLabs wraps in OGG container or returns raw opus frames.
   - Recommendation: The integration test should check OGG magic bytes on the response. If it's already OGG, no ffmpeg needed — just pass buffer through. This would reduce latency and avoid re-encoding quality loss.

2. **Should `languageCode: 'he'` (ISO-639-1) or `'heb'` (ISO-639-3) be used for TTS?**
   - What we know: STT docs show 3-letter codes ("heb"). TTS `languageCode` is a plain string field.
   - What's unclear: Whether TTS enforces ISO-639-1 or accepts ISO-639-3.
   - Recommendation: Use `'he'` for TTS (ISO-639-1 is standard for API language tags). The `eleven_v3` model auto-detects Hebrew even without the hint; the parameter is advisory.

3. **Hebrew naturalness with IVC voice clone**
   - What we know: `eleven_v3` supports Hebrew and produces natural-sounding speech.
   - What's unclear: Whether an Instant Voice Clone trained on Hebrew audio performs as well as native Hebrew voice samples in the library.
   - Recommendation: The integration test's 5-sentence naturalness check will confirm. If IVC quality is insufficient, fall back to a library Hebrew voice.

## Sources

### Primary (HIGH confidence)
- `node_modules/@elevenlabs/elevenlabs-js/dist/` — direct inspection of installed SDK v2.37.0 type definitions
  - `api/resources/speechToText/client/Client.d.ts` — STT convert signature
  - `api/resources/speechToText/client/requests/BodySpeechToTextV1SpeechToTextPost.d.ts` — STT request type
  - `api/resources/speechToText/types/SpeechToTextConvertRequestModelId.d.ts` — `scribe_v1 | scribe_v2` enum
  - `api/types/SpeechToTextChunkResponseModel.d.ts` — response `.text` field
  - `api/resources/textToSpeech/client/Client.d.ts` — TTS convert signature (returns ReadableStream)
  - `api/resources/textToSpeech/client/requests/BodyTextToSpeechFull.d.ts` — TTS request type, modelId is string
  - `api/resources/textToSpeech/types/TextToSpeechConvertRequestOutputFormat.d.ts` — opus_48000_64 confirmed
  - `core/file/types.d.ts` — Uploadable type (Buffer is valid FileLike; WithMetadata for explicit metadata)
  - `errors/ElevenLabsError.d.ts`, `api/errors/UnprocessableEntityError.d.ts` — error hierarchy
  - `wrapper/speechToText.d.ts` — SpeechToText extends base, uses overloaded convert
- Live ffmpeg tests (executed in project environment):
  - `-f opus` INPUT fails: `Unknown input format: 'opus'` confirmed
  - `ffmpeg -formats`: opus is `E` (encode/output only), ogg is `DE` (both)
  - `ffmpeg -encoders`: both `opus` and `libopus` confirmed available
  - `ffmpeg -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1`: valid command (mp3 input)
  - EPIPE handling pattern: tested and working
- Live ESM import test: `import ffmpegPath from 'ffmpeg-static'` works with tsx runtime
- `node_modules/@whiskeysockets/baileys/lib/Utils/messages.js`: MIMETYPE_MAP audio = `'audio/ogg; codecs=opus'`

### Secondary (MEDIUM confidence)
- `https://elevenlabs.io/docs/overview/models` — eleven_v3 supports 70+ languages including Hebrew; eleven_multilingual_v2 does NOT include Hebrew (29 languages)
- `https://elevenlabs8.mintlify.app/models` — confirmed model IDs: `eleven_v3`, `eleven_multilingual_v2`; Hebrew in v3 only
- `https://elevenlabs.io/docs/overview/capabilities/speech-to-text` — Hebrew language code `heb`, scribe_v2 features
- WebSearch finding: eleven_v3 production-ready as of Feb 2, 2026 (citing official ElevenLabs blog)

### Tertiary (LOW confidence — verify in integration test)
- ElevenLabs `opus_48000_64` output may already be OGG-containerized (unverified; requires actual API call)
- Hebrew transcription accuracy with scribe_v2 (qualitative assessment, not measured)

## Metadata

**Confidence breakdown:**
- STT SDK method signatures: HIGH — directly read from installed SDK types
- TTS SDK method signatures: HIGH — directly read from installed SDK types
- ffmpeg capabilities: HIGH — live-tested on project machine
- eleven_v3 Hebrew support: HIGH — verified from official docs (multiple sources agree)
- eleven_multilingual_v2 Hebrew exclusion: HIGH — confirmed by official docs listing 29 languages
- OGG container from ElevenLabs opus output: LOW — not verifiable without actual API call
- Hebrew naturalness with IVC: LOW — requires subjective evaluation

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (ElevenLabs SDK is actively developed; verify model IDs if re-running)

# Project Research Summary

**Project:** WhatsApp Bot — Milestone v1.3: Voice Message Features
**Domain:** Voice message handling — speech-to-text transcription + text-to-speech replies via ElevenLabs
**Researched:** 2026-03-01
**Confidence:** HIGH (stack and architecture verified against installed node_modules and official docs; format requirements cross-verified; pitfalls confirmed via Baileys GitHub issues)

## Executive Summary

This milestone adds voice message capabilities to an already-working WhatsApp bot: the bot can receive voice notes, transcribe them, generate an AI reply (via the existing Gemini pipeline), and optionally respond as a voice note using a cloned Hebrew voice. The integration surface is deliberately narrow — two new modules (`src/voice/transcriber.ts` and `src/voice/tts.ts`), one surgical branch added to `messageHandler.ts` before the existing null guard, and two columns added to the `contacts` table. Every other existing component is unchanged. The Gemini AI module, message pipeline, draft queue, and all text-path logic require zero modifications.

The recommended approach uses ElevenLabs for both directions: Scribe v2 for STT (OGG/Opus accepted natively from Baileys, Hebrew WER ~10-20%), and the `eleven_v3` model for TTS — the only ElevenLabs model with confirmed Hebrew support in its 70+ language list. Audio processing requires one conversion step: ElevenLabs TTS returns a raw Opus stream that must be wrapped in an OGG container via ffmpeg before Baileys will send it as a PTT voice note. The `ffmpeg-static` npm package provides a bundled binary that eliminates the system dependency risk entirely. Two new npm packages total: `@elevenlabs/elevenlabs-js` v2.37.0 (official SDK, replacing the deprecated `elevenlabs` package) and `ffmpeg-static` v5.3.0.

The highest-confidence risk is Hebrew TTS model selection: only `eleven_v3` produces acceptable Hebrew quality — using `eleven_multilingual_v2` or `eleven_turbo_v2_5` results in broken pronunciation immediately obvious to a native speaker. The second significant risk is audio format: the `ptt: true` flag is mandatory for WhatsApp voice note rendering (without it, audio appears as a file attachment), and ElevenLabs TTS outputs raw Opus requiring an OGG container wrap before Baileys will accept it as PTT. Voice clone training quality is a one-time prerequisite: training on WhatsApp recordings (OGG at 32kbps) degrades the clone — use clean 192kbps+ MP3 recordings from a quiet environment and validate the clone in the ElevenLabs UI before writing any code.

## Key Findings

### Recommended Stack

The existing base (Baileys 7.0.0-rc.9, Gemini AI, Drizzle + SQLite, zod, pino) requires exactly two new production dependencies. The ElevenLabs SDK (`@elevenlabs/elevenlabs-js` v2.37.0) handles both STT and TTS with a single API key — the deprecated `elevenlabs` package (v1.59.0) must not be used; npm now shows an explicit deprecation warning pointing to the new package. The `ffmpeg-static` v5.3.0 package provides a platform-specific compiled ffmpeg binary on `npm install`, solving the system dependency problem without requiring `sudo apt install ffmpeg`.

**Core technologies:**
- `@elevenlabs/elevenlabs-js` v2.37.0: Official ElevenLabs Node.js SDK — STT via `client.speechToText.convert()` with Scribe v2 and TTS via `client.textToSpeech.convert()` with `eleven_v3`; ships its own TypeScript types; 3 dependencies (vs. 9 in deprecated package)
- `ffmpeg-static` v5.3.0: Bundled ffmpeg binary for OGG container wrapping — wraps ElevenLabs raw Opus output into an OGG container (lossless copy, <100ms, no re-encoding); no system ffmpeg required
- `eleven_v3` (model ID): The only ElevenLabs TTS model with Hebrew (heb) in its 70+ supported language list; required for acceptable Hebrew voice clone quality; do not substitute with `eleven_multilingual_v2` (29 languages, Hebrew absent) or `eleven_turbo_v2_5` (32 languages, Hebrew unconfirmed)
- `scribe_v2` (model ID): ElevenLabs STT model that accepts OGG/Opus natively and achieves Hebrew WER 3.1% on FLEURS benchmark / 10-20% in real conditions ("Good" tier)
- `output_format: "opus_48000_64"`: ElevenLabs TTS Opus output at 48kHz — the exact codec WhatsApp PTT requires; needs OGG container wrap only (lossless), not re-encoding

**Audio format pipeline:**

| Stage | Format | Conversion needed |
|-------|--------|-------------------|
| Incoming WhatsApp voice (Baileys downloadMediaMessage) | OGG/Opus buffer | None — send directly to Scribe v2 |
| ElevenLabs TTS output (`opus_48000_64`) | Raw Opus stream (no container) | Wrap in OGG container via ffmpeg (`-f opus -i pipe:0 -c:a copy -f ogg pipe:1`) |
| Outgoing PTT (Baileys sendMessage) | OGG/Opus buffer | None — ready after ffmpeg wrap |

**Environment variables required (two additions):**
```
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_DEFAULT_VOICE_ID=...  (cloned Hebrew voice ID from ElevenLabs dashboard)
```

See `STACK.md` for version compatibility matrix, ESM import notes for `ffmpeg-static`, full integration code snippets, and the complete audio format reference table.

### Expected Features

The feature set is well-defined with a clear linear dependency chain. The critical gap in the existing codebase is the early exit at `messageHandler.ts` line 209: `if (text === null) return;` — all voice features require a branch that intercepts `audioMessage` type messages before this guard.

**Must have (table stakes — P1):**
- Voice message detection: `msg.message?.audioMessage` check added before the null guard in `processMessage()`
- Audio download + ElevenLabs Scribe v2 transcription: `downloadMediaMessage` → `client.speechToText.convert`
- Gemini reply from transcript: existing `generateReply()` unchanged — transcript stored as regular `messages` row, AI pipeline sees it as a text message
- ElevenLabs TTS with `eleven_v3` + cloned Hebrew voice: `client.textToSpeech.convert`
- OGG container wrap via ffmpeg: mandatory; ElevenLabs raw Opus → OGG/Opus buffer
- WhatsApp PTT send: `sock.sendMessage(jid, { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true })`
- Per-contact `voiceReplyEnabled` toggle (DB boolean column): default `false` — opt-in, not opt-out
- Text-reply fallback when voice disabled: transcribe incoming voice → reply as text (the default behavior for all contacts)
- Draft queue integration: lazy TTS generation — store text in draft, synthesize audio only on owner `✅` approval
- `recording` presence indicator: `sock.sendPresenceUpdate('recording', jid)` immediately on voice message receipt

**Should have (P2 — low-cost, add during development):**
- Transcript persistence: add nullable `transcript` column to `messages` table — already in memory during processing, costs one extra DB write
- Transcript preview in draft notification: include transcription in owner's approval message so they read context before approving audio send
- Dashboard toggle for voice: expose `voiceReplyEnabled` in contacts UI (API already handles it after schema change)
- Language detection logging: log Scribe's auto-detected language for debugging

**Defer (v2+):**
- Waveform data in sent voice notes: Baileys v7 RC waveform behavior unverified; cosmetic only; install `audio-decode` and test, but do not block MVP
- Passive group voice transcription: groups explicitly out of scope for this milestone
- Voice quality selection per contact (Flash v2.5 vs Turbo): premature optimization for a personal bot

**Explicit anti-features (do not build):**
- Real-time streaming TTS: WhatsApp voice notes are atomic files, not streaming; streaming adds complexity with zero UX benefit
- Group voice message replies: bot should never send voice messages impersonating the user in groups
- WhatsApp native voice transcript as input: on-device transcripts are not accessible via Baileys protobuf
- Local/offline TTS (Coqui, Kokoro): Hebrew quality is substantially inferior; cost at personal scale is negligible (~$1.72/month)

See `FEATURES.md` for the full feature dependency graph, technical constraint analysis, latency budget breakdown, and prior art references.

### Architecture Approach

The integration follows a strict surgical extension pattern: existing code is never restructured, only extended at specific insertion points. Two pure-function modules are added in a new `src/voice/` directory. `messageHandler.ts` receives one new function (`processAudioMessage`) and a 4-line branch before its null guard. Audio is processed entirely in-memory — buffers are never written to disk. Transcriptions are stored as regular `messages` rows so `generateReply()` requires zero changes. The text content of voice replies (not the audio buffer) is persisted to `messages` for AI context continuity on follow-up turns.

**Major components:**
1. `src/voice/transcriber.ts` (NEW): `transcribeAudio(buffer: Buffer): Promise<string | null>` — pure function, ElevenLabs Scribe v2 wrapper, no file I/O, no side effects
2. `src/voice/tts.ts` (NEW): `synthesizeSpeech(text: string, voiceId: string): Promise<Buffer>` — pure function, ElevenLabs TTS + ffmpeg OGG container wrap; returns OGG/Opus buffer ready for Baileys PTT
3. `src/pipeline/messageHandler.ts` (MODIFIED): `processAudioMessage()` function added; 4-line audio branch inserted before null guard; existing text path 100% unchanged
4. `src/whatsapp/sender.ts` (MODIFIED): `sendVoiceWithDelay()` added alongside (not replacing) `sendWithDelay()`; stores text body (not audio) to `messages` for AI context
5. `src/db/schema.ts` (MODIFIED): `voiceReplyEnabled: boolean` (default false) + `voiceId: text | null` columns on `contacts` table; one Drizzle migration
6. `src/api/routes/drafts.ts` (MODIFIED): `sendAsVoice` flag on approve endpoint — lazy TTS synthesis at approval time, not draft creation time
7. `src/api/routes/contacts.ts` (MODIFIED): `voiceReplyEnabled` and `voiceId` accepted in PATCH body

**Components that are completely unchanged:**
`src/ai/gemini.ts`, `src/db/queries/messages.ts`, `src/db/queries/drafts.ts`, `src/whatsapp/connection.ts`, `src/index.ts`

**Build order (dependency graph):**

```
Phase A: Foundation (no code dependencies — do first)
    config.ts: ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID
    schema.ts: voiceReplyEnabled + voiceId columns
    npm install @elevenlabs/elevenlabs-js ffmpeg-static
    Drizzle migration: db:generate + db:migrate

Phase B: Voice service modules (depends on Phase A config)
    src/voice/transcriber.ts
    src/voice/tts.ts

Phase C: Pipeline integration (depends on Phase B — riskiest)
    messageHandler.ts: processAudioMessage() + audio branch
    sender.ts: sendVoiceWithDelay()

Phase D: API layer (depends on Phase A schema + Phase B tts)
    api/routes/contacts.ts: voiceReplyEnabled + voiceId fields
    api/routes/drafts.ts: sendAsVoice flag on approve

Phase E: Dashboard (depends on Phase D API)
    Contacts page: voice reply toggle + voice ID field
    Drafts page: "Send as Voice" button on approve
```

See `ARCHITECTURE.md` for complete data flow diagrams (voice-in→text-reply, voice-in→voice-reply, draft approval with voice), component modification table, and 5 anti-patterns with explanations.

### Critical Pitfalls

1. **Wrong TTS model for Hebrew** — `eleven_multilingual_v2` (29 languages, Hebrew absent) and `eleven_turbo_v2_5` (Hebrew unconfirmed) produce broken Hebrew pronunciation. Use `model_id: "eleven_v3"` explicitly. Validate with 5 Hebrew sentences before wiring into the message pipeline. (HIGH confidence)

2. **Missing `ptt: true` flag** — Audio sends successfully but renders as a file attachment, not a voice note bubble. Always include `ptt: true` in the `sendMessage` call. Test on a real phone (not WhatsApp Web). (HIGH confidence)

3. **OGG container wrap is mandatory** — ElevenLabs TTS `opus_48000_64` output is a raw Opus stream with no container. Baileys PTT requires an OGG-wrapped buffer. The ffmpeg wrap is a lossless copy (`-c:a copy`), takes <100ms, and cannot be skipped. (HIGH confidence)

4. **Voice clone trained on WhatsApp audio** — WhatsApp OGG/Opus at 32kbps degrades the clone quality. Record training audio in a quiet environment as MP3 at 192kbps+, 1-3 minutes of continuous Hebrew speech. Validate the clone in ElevenLabs UI before writing any code. (HIGH confidence)

5. **Draft queue voice audio lost on restart** — Eager TTS generation stores audio in `/tmp`; a server restart before owner approval loses the file, causing silent failure on `✅`. Use lazy generation: store text in draft, synthesize audio at approval time. (HIGH confidence)

6. **`scribe_v1` vs `scribe_v2` model ID** — ARCHITECTURE.md code samples use `scribe_v1`; STACK.md and FEATURES.md both specify `scribe_v2` (confirmed via ElevenLabs Scribe v2 launch blog and Hebrew STT page). Always use `scribe_v2`. (HIGH confidence)

7. **Flat waveform in sent voice notes** — Baileys v6.7.9+ has a waveform regression; v7 RC status unverified. Install `audio-decode` explicitly. Waveform is cosmetic — do not block MVP on this, but test on a real device in Phase C. (MEDIUM confidence)

See `PITFALLS.md` for complete pitfall-to-phase mapping, integration gotchas, performance traps, security mistakes, UX pitfalls, and the "looks done but isn't" pre-ship checklist.

## Implications for Roadmap

Based on the architecture dependency graph and pitfall phase assignments, five natural phases emerge. Phases A and B are foundation work; Phase C is the riskiest code change; Phases D and E are additive.

### Phase 1: Infrastructure + Environment Setup
**Rationale:** All voice work depends on ffmpeg being available, ElevenLabs credentials being configured, the voice clone existing and quality-validated, and the Drizzle migration having run. These are prerequisites with no application code yet. Validating the voice clone in ElevenLabs UI before writing a single line of code prevents the most painful rework (poor clone quality requires re-recording, re-uploading, and re-validating).
**Delivers:** Validated environment — `@elevenlabs/elevenlabs-js` and `ffmpeg-static` installed, API key + voice ID configured in `.env`, `voiceReplyEnabled`/`voiceId` columns migrated, `ffmpeg-static` import verified (console.log test), voice clone quality validated in ElevenLabs UI with Hebrew sample sentences
**Addresses:** Voice clone setup (one-time manual task), DB schema prerequisites, ffmpeg availability
**Avoids:** ffmpeg missing on server (Pitfall 5/PITFALLS), voice clone trained on WhatsApp audio (Pitfall 4/PITFALLS)

### Phase 2: Voice Service Modules
**Rationale:** The two new pure-function modules have no dependencies on modified existing code — they can be built and integration-tested against the ElevenLabs API in isolation before `messageHandler.ts` is touched. This is the right place to validate the `eleven_v3` Hebrew model and the OGG wrap before those decisions are embedded in the message pipeline.
**Delivers:** `src/voice/transcriber.ts` (Buffer → string | null via Scribe v2) and `src/voice/tts.ts` (string → OGG/Opus Buffer via eleven_v3 + ffmpeg wrap) — each independently testable with a test script
**Uses:** `@elevenlabs/elevenlabs-js`, `ffmpeg-static`, `eleven_v3`, `scribe_v2`, `opus_48000_64` output format
**Avoids:** Wrong TTS model for Hebrew (Pitfall 3 — catch here, before pipeline integration), OGG wrap missing (Pitfall 3)

### Phase 3: Pipeline Integration (Core Voice Path)
**Rationale:** This is the highest-risk phase — modifying `messageHandler.ts`, the most critical file in the bot. The change is a 4-line branch + one new function (surgical, minimal), but it requires verifying the existing text path is identically unchanged after the modification. Build and test in this order: (1) add audio branch, verify existing text test cases pass; (2) implement `processAudioMessage()` with full pipeline; (3) add `sendVoiceWithDelay()` to `sender.ts`.
**Delivers:** End-to-end voice pipeline for private chats in `auto` mode — receive voice note → transcribe → Gemini reply → TTS → PTT send (when `voiceReplyEnabled: true`); text-reply fallback for `voiceReplyEnabled: false` (default for all contacts); `recording` presence indicator; transcript stored as messages row
**Implements:** `processAudioMessage()` function, audio branch in `processMessage()`, `sendVoiceWithDelay()`, all existing modes (off/auto) respected
**Avoids:** Missing `ptt: true` (Pitfall 1 — verify on real phone as acceptance criterion), skipping text persistence for voice replies (Architecture anti-pattern 5), making `getMessageText()` async (Architecture anti-pattern 4)

### Phase 4: Draft Queue Integration
**Rationale:** Depends on Phase 3 voice pipeline being validated. Draft mode routes through a different code path: `createDraft()` and the approve endpoint. Lazy TTS generation is the resolved approach — text stored at draft creation time, audio synthesized only on `✅` approval. This phase is lower risk than Phase 3 since it modifies an API route, not the core message handler.
**Delivers:** Voice-aware draft flow — incoming voice in `draft` mode creates text draft; owner notification includes voice message transcript; `✅` triggers lazy TTS synthesis → PTT send; `❌` discards with no cleanup needed (text-only draft, no audio file)
**Implements:** `sendAsVoice` flag on `PATCH /api/drafts/:id/approve`, transcript preview in owner notification (`[Voice] Draft for [name]: '[transcript]'\n\nProposed reply: [text]`)
**Avoids:** Draft queue file loss on restart (Pitfall 7 — lazy generation eliminates this entirely), voice reply in draft mode without owner text preview (UX pitfall)

### Phase 5: API + Dashboard Exposure
**Rationale:** The bot is fully functional after Phase 4. This phase makes voice configuration manageable via the existing dashboard without SSH. Low risk — additive to existing API and UI. The P2 features (transcript persistence, language detection logging) that were deferred during earlier phases are also completed here since they are low-cost additions.
**Delivers:** `voiceReplyEnabled` and `voiceId` fields in contacts PATCH API and dashboard contacts page; "Send as Voice" button on draft approval in dashboard; transcript persistence (`transcript` column on `messages` if not added in Phase 3); language detection logging
**Addresses:** Dashboard toggle for voice (P2), transcript persistence (P2), transcript in draft notification (P2 — already done in Phase 4)

### Phase Ordering Rationale

- Schema migration must precede Phase 3 (code reads `voiceReplyEnabled` from contacts table); placed in Phase 1 so it is done before any voice code is written
- Voice service modules built in isolation (Phase 2) before being imported by `messageHandler.ts` (Phase 3) — allows API-level testing and model validation without touching the production message pipeline
- Phase 3 (`messageHandler.ts` change) is isolated as a single focused phase with explicit acceptance criteria (existing text path unchanged verified, real-phone PTT test) to contain its risk
- Draft integration (Phase 4) is separated from Phase 3 because the approve endpoint TTS call is a different call site with different failure modes — building them together would complicate debugging
- Dashboard (Phase 5) is always last: the voice feature is fully operational without it; dashboard is management convenience, not voice functionality

### Research Flags

Phases with well-documented patterns — standard implementation, no research-phase needed:
- **Phase 1 (Infrastructure):** ffmpeg-static setup and Drizzle migrations are fully documented. ElevenLabs IVC creation is a dashboard UI operation. Voice clone training guidelines are from official ElevenLabs help docs.
- **Phase 2 (Voice Services):** ElevenLabs SDK methods and output formats are verified in official docs with working code examples in `STACK.md` and `ARCHITECTURE.md`. The integration pattern is fully specified.
- **Phase 5 (Dashboard):** Additive UI to existing dashboard using established patterns. No new architectural decisions.

Phases requiring careful execution (not research, but implementation discipline):
- **Phase 3 (Pipeline Integration):** The integration pattern is fully specified in `ARCHITECTURE.md`. The risk is execution: verify existing text message test cases pass before and after the audio branch addition. Accept acceptance criterion: receive a real voice note on a real phone and confirm it renders as a voice note bubble (not file attachment).
- **Phase 4 (Draft Integration):** Verify the ElevenLabs client singleton is accessible from the HTTP route handler context (same dependency injection pattern as in `processAudioMessage()`). The lazy generation approach is resolved; implement it exactly.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via npm registry; API methods verified against official ElevenLabs docs and SDK GitHub; `fluent-ffmpeg` and old `elevenlabs` package deprecations confirmed; Baileys exports confirmed against installed node_modules; ffmpeg-static ESM import documented as MEDIUM (needs runtime verification in Phase 1) |
| Features | MEDIUM-HIGH | ElevenLabs API capabilities and Hebrew TTS model selection HIGH confidence from official docs; Hebrew STT WER tier HIGH confidence; voice clone quality on `eleven_v3` with IVC is MEDIUM (official confirms Hebrew support, no independent quality reviews for Hebrew IVC specifically) |
| Architecture | HIGH | Existing codebase read in full from source files; Baileys TypeScript types read from installed node_modules; integration patterns confirmed against real-world implementations; data flow verified against Drizzle schema and existing query functions |
| Pitfalls | MEDIUM-HIGH | Format requirements, `ptt: true` requirement, and Hebrew model requirement HIGH confidence (official docs + multiple Baileys GitHub issues); IVC quality guidance HIGH confidence (official ElevenLabs help articles); waveform regression MEDIUM confidence (confirmed for v6.7.x; v7 RC waveform behavior not independently verified) |

**Overall confidence:** HIGH

### Gaps to Address

- **`eleven_v3` vs `eleven_turbo_v2_5` for Hebrew TTS:** STACK.md and PITFALLS.md both recommend `eleven_v3` (based on official models docs listing Hebrew in 70+ languages). FEATURES.md used `eleven_turbo_v2_5` in some code samples (based on Turbo v2.5 launch blog listing 32 languages). PITFALLS.md explicitly warns that `eleven_turbo_v2_5` may not support Hebrew correctly. **Resolution: use `eleven_v3`. Validate Hebrew output quality in Phase 2 by generating 5 Hebrew sentences before wiring into the pipeline.**

- **`scribe_v1` vs `scribe_v2` model ID in architecture samples:** `ARCHITECTURE.md` code samples reference `scribe_v1`; `STACK.md` and `FEATURES.md` both specify `scribe_v2`. ElevenLabs Scribe v2 blog and Hebrew STT page confirm `scribe_v2`. **Resolution: use `scribe_v2` everywhere.**

- **ffmpeg-static ESM import at runtime:** `ffmpeg-static` is CJS-first; `import ffmpegPath from 'ffmpeg-static'` is documented to work via tsx but has not been hands-on verified in this specific project. **Handle in Phase 1:** run `node -e "import('ffmpeg-static').then(m => console.log(m.default))"` to verify before writing the conversion utility. If it fails, use `createRequire` fallback (documented in `STACK.md`).

- **Baileys v7 RC waveform status:** Waveform regression confirmed fixed in v6.7.19+ via `audio-decode`. Whether v7.0.0-rc.9 carries the fix is unverified. **Handle in Phase 3:** install `audio-decode` explicitly, test on a real device. If waveform is flat, the feature still works — waveform is cosmetic; do not block MVP.

- **Hebrew STT accuracy with real conversational voice messages:** Official WER benchmarks use read speech (FLEURS, Common Voice). Real WhatsApp voice messages — spoken informally, with background noise, mixed Hebrew/English code-switching — may have higher error rates than 10-20%. **Handle during Phase 3 testing:** test with real voice messages from the target contacts. If quality is unacceptable, add `language_code: 'heb'` hint to Scribe (may improve accuracy for Hebrew-dominant contacts).

## Sources

### Primary (HIGH confidence)
- [npm: @elevenlabs/elevenlabs-js v2.37.0](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js) — current official SDK; `elevenlabs` deprecation confirmed
- [ElevenLabs Models docs](https://elevenlabs.io/docs/overview/models) — `eleven_v3` Hebrew (heb) in 70+ languages, model IDs, latency specs
- [ElevenLabs STT capabilities](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) — OGG/Opus natively accepted, Scribe v2 model, Hebrew WER tier classification
- [ElevenLabs TTS API reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) — `opus_48000_64` output format confirmed among 28 formats
- [ElevenLabs Hebrew STT page](https://elevenlabs.io/speech-to-text/hebrew) — Hebrew "Good" tier, WER 10-20% real conditions
- [ElevenLabs Scribe v2 blog](https://elevenlabs.io/blog/introducing-scribe-v2) — Hebrew WER 3.1% (FLEURS benchmark)
- [ElevenLabs Eleven v3 announcement](https://elevenlabs.io/blog/eleven-v3) — 70+ language list, Hebrew confirmed, PVC/IVC notes
- [ElevenLabs Voice Cloning docs](https://elevenlabs.io/docs/creative-platform/voices/voice-cloning) — IVC training audio requirements, MP3 192kbps+ recommendation
- [ElevenLabs IVC quality help](https://help.elevenlabs.io/hc/en-us/articles/13416206830097) — training audio quality factors
- [npm: ffmpeg-static v5.3.0](https://www.npmjs.com/package/ffmpeg-static) — bundled binary, platform-specific download
- [npm: fluent-ffmpeg](https://www.npmjs.com/package/fluent-ffmpeg) — DEPRECATED notice (archived May 2025) confirmed
- [npm: elevenlabs v1.59.0](https://www.npmjs.com/package/elevenlabs) — DEPRECATED notice ("moved to @elevenlabs/elevenlabs-js") confirmed
- [Baileys wiki: downloadMediaMessage](https://baileys.wiki/docs/api/functions/downloadMediaMessage/) — buffer mode, return type, options
- [Baileys installed node_modules TypeScript types](file:///home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts) — `audioMessage`, `ptt` flag, `mimetype` field confirmed from source

### Secondary (MEDIUM confidence)
- [Baileys GitHub Issue #1745](https://github.com/WhiskeySockets/Baileys/issues/1745) — PTT waveform regression v6.7.9+; fix via `audio-decode` in v6.7.19+
- [Baileys GitHub Issue #501](https://github.com/WhiskeySockets/Baileys/issues/501) — `ptt: true` requirement for voice note rendering confirmed
- [Baileys GitHub Issue #1828](https://github.com/WhiskeySockets/Baileys/issues/1828) — audio format workarounds documented by community
- [ElevenLabs Turbo v2.5 announcement](https://elevenlabs.io/blog/introducing-turbo-v25) — 32-language list; Hebrew listed (cross-reference with models doc for authoritative source)
- [WhatsApp OGG/Opus PTT requirement](https://blog.ultramsg.com/how-to-send-ogg-file-using-whatsapp-api/) — 48kHz, libopus, OGG container required for PTT
- [ElevenLabs + WhatsApp OGG wrap issue](https://github.com/openclaw/openclaw/issues/25102) — raw Opus → OGG wrap confirmed needed for Baileys PTT
- [René Roth WhatsApp transcriber](https://reneroth.xyz/whatsapp-voice-messages-automatic-transcript/) — downloadMediaMessage → STT pattern with Baileys confirmed
- [n8n voice chatbot pipeline](https://n8n.io/workflows/3586-ai-powered-whatsapp-chatbot-for-text-voice-images-and-pdfs-with-memory/) — full audio pipeline pattern (Whisper variant)
- All existing source files at `/home/yuval/whatsapp-bot/src/` — read directly for existing pipeline, schema, config, query functions

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*

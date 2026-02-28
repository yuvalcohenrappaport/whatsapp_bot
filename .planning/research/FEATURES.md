# Feature Research

**Domain:** WhatsApp AI Bot — Milestone 3: Voice Message Support
**Researched:** 2026-03-01
**Confidence:** MEDIUM-HIGH — ElevenLabs API capabilities verified via official docs. Baileys audio APIs verified via official wiki and community patterns. Format requirements (OGG/Opus) verified via multiple sources. Hebrew TTS model support HIGH confidence. Voice clone + Hebrew quality flag is MEDIUM (no direct quality reviews found; official docs confirm support but lack specifics).

---

## Context: What Is Already Built

Phases 1 and 2 are complete. The bot already has:
- Baileys v7 WhatsApp connection with QR auth and session persistence
- Full message pipeline (receive, dedup, persist to SQLite via Drizzle)
- Per-contact modes: `off` / `draft` / `auto`
- Gemini AI responses with per-contact context isolation (50-message window)
- Draft approval via WhatsApp (owner replies ✅/❌ to pending reply)
- Chat history import from `.txt` export + style injection into system prompt
- Auto-reply with randomized send delay + snooze
- Group monitoring with calendar extraction (Milestone 2 complete)

**Critical gap exposed by this milestone:** The existing `processMessage` function in `src/pipeline/messageHandler.ts` returns immediately on non-text messages (line 209: `if (text === null) return;`). Voice messages are `audioMessage` type and produce `text === null`. The entire pipeline is text-only. Voice support requires branching before this early return.

This milestone adds:
1. Voice message receipt and ElevenLabs transcription (speech-to-text)
2. Gemini text reply generation (reuses existing pipeline)
3. ElevenLabs TTS with cloned Hebrew voice (text-to-speech)
4. WhatsApp voice note send (OGG/Opus format)
5. Per-contact voice reply toggle and draft queue integration

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are non-negotiable for this milestone to feel complete. Missing any makes the voice feature feel broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Detect incoming voice messages** | Without detection, voice messages are silently ignored — the bot appears broken | LOW | `msg.message?.audioMessage` check in `processMessage`. Add branch before the `text === null` return. Voice messages have `pttMessage` = true for native voice notes, or `audioMessage` for regular audio. Both should be handled. |
| **Download voice message audio** | Without download, there is nothing to transcribe | LOW | `downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })` from Baileys. Returns a `Buffer`. Audio is OGG/Opus encoded — WhatsApp's native format. |
| **Transcribe voice to text via ElevenLabs Scribe** | Transcription is the foundation of the feature — without it, no AI reply is possible | MEDIUM | `client.speechToText.convert({ file: audioBuffer, model_id: 'scribe_v2', language_code: 'heb' })`. SDK: `@elevenlabs/elevenlabs-js` v2.37.0. Scribe v2 supports OGG/Opus natively — no format conversion needed for transcription. Hebrew WER is 10-20% ("Good" tier). Async — plan for 1-3s per voice note. |
| **Generate AI text reply from transcript** | Without this, transcription is pointless — no reply to send | LOW | Reuse existing `generateReply()` in `src/ai/gemini.ts` with the transcript as the message body. Transcript is treated as if the contact sent a text message. No Gemini changes needed. |
| **Convert AI text to speech via ElevenLabs TTS** | Without TTS, the bot cannot send a voice reply — defeats the purpose | MEDIUM | Use `eleven_turbo_v2_5` model for Hebrew (confirmed supported, ~250-300ms latency). Use cloned voice ID. Output format: MP3, then convert to OGG/Opus for WhatsApp. SDK: `client.textToSpeech.convert({ voice_id, model_id: 'eleven_turbo_v2_5', text, output_format: 'mp3_44100_128' })`. Returns audio buffer. |
| **Convert TTS output to OGG/Opus for WhatsApp PTT** | WhatsApp requires OGG/Opus with libopus codec for voice notes. Sending MP3 as PTT fails on Android. | MEDIUM | ElevenLabs returns MP3 by default. Must convert: `fluent-ffmpeg` (in-memory stream) → libopus codec, 48000Hz, mono, 32kbps bitrate. System `ffmpeg` binary required on Ubuntu server. Alternatively, request `output_format: 'pcm_44100'` from ElevenLabs and encode directly — but fluent-ffmpeg from MP3 is simpler. |
| **Send voice note as WhatsApp PTT** | Without this, the voice reply never arrives | LOW | `sock.sendMessage(jid, { audio: oggBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })`. The `ptt: true` flag marks it as a voice note (shown with waveform UI in WhatsApp). Without `ptt: true`, it appears as a regular audio attachment. |
| **Per-contact voice reply toggle** | Contacts may not want voice replies; the toggle must be per-contact | LOW | Add `voiceReplyEnabled: boolean` column to `contacts` DB table (Drizzle schema update + migration). Default: `false` (opt-in, not opt-out — conservative default). Expose toggle in dashboard and CLI. |
| **Respect draft queue mode for voice replies** | Without this, voice replies bypass the safety mechanism and auto-send without approval | MEDIUM | In `draft` mode: save generated TTS audio to disk (or SQLite BLOB), create draft record with `type: 'voice'` and `audioPath` field. Owner approves ✅ → bot sends the cached OGG file. Owner rejects ❌ → delete cached audio. Existing draft approval flow needs audio-aware branch. |
| **Fallback to text reply when voice is disabled** | If per-contact voice is off but bot receives a voice message, it should still transcribe and reply as text | LOW | If `voiceReplyEnabled === false`: transcribe the incoming voice, generate text reply, send as text message (existing pipeline). User still gets a reply; just not a voice one. This is the default behavior. |

---

### Differentiators (Competitive Advantage)

Features that make the voice capability meaningfully better. Not required for MVP but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Cloned Hebrew voice (Instant Voice Cloning)** | The reply sounds like the actual user, not a generic TTS voice. The "impersonation" illusion extends to voice. | MEDIUM | Create IVC via ElevenLabs dashboard or `POST /v1/voices/add` with 1-2 min of clean audio samples. Requires `ELEVENLABS_VOICE_ID` env var. Recommend `eleven_turbo_v2_5` model (Hebrew confirmed, ~250-300ms latency). IVC with `eleven_v3` is LOW confidence — v3 PVC support is noted as "not fully optimized." Use Turbo v2.5. |
| **Transcript stored alongside message** | Owner can read what a voice message said without listening; useful for audit trail and context window | LOW | Store `transcript` text in `messages` table (add nullable `transcript` column). Transcript is the Gemini input, so it's already in memory — persist it as part of `insertMessage`. No additional API calls. |
| **Include transcript in draft notification to owner** | When in draft mode, owner sees the transcript of the incoming voice message alongside the pending audio reply | LOW | Extend owner notification message: "Voice message from [contact]: '[transcript]'\n\nProposed reply: [text draft]\nSend as voice? ✅/❌". Draft preview is text, owner hears the context before approving audio send. |
| **Configurable reply format per contact (voice or text)** | Some contacts want voice back; others prefer text. Owner controls this per-contact. | LOW | The `voiceReplyEnabled` toggle is the mechanism. Dashboard exposes it. No extra complexity beyond the table-stakes toggle. Listed as differentiator because the UX of per-contact granularity is what separates this from crude global on/off switches. |
| **Waveform inclusion in sent voice notes** | WhatsApp shows a visual waveform for voice notes; providing it makes the note look authentic | LOW | Baileys supports `waveform: number[]` in the audio message. Known issue: waveform display broke in Baileys v6.7.9+ (Baileys GitHub issue #1745). Current v7 status unclear. Attempt to generate waveform from audio amplitude; skip if it causes issues. Cosmetic — do not block MVP on this. |
| **Language detection for incoming voice messages** | ElevenLabs Scribe auto-detects language when `language_code` is omitted. If a contact sends in English, the transcript is still accurate — no need to hardcode Hebrew. | LOW | Omit `language_code` parameter on first attempt; Scribe will auto-detect. Log detected language. For Hebrew-dominant contacts, optionally hardcode `heb` to improve accuracy (10-20% WER "good" tier vs. potentially lower auto-detect accuracy). |
| **Async voice processing with "processing" indicator** | For long voice messages (30s+), ElevenLabs transcription + Gemini + TTS pipeline may take 5-10s. Sending "typing" indicator first sets expectations. | LOW | `sock.sendPresenceUpdate('recording', jid)` — WhatsApp shows "recording..." status while the bot generates a voice reply. Send this immediately on voice message receipt, before starting the pipeline. Clear it when audio is sent. Meaningful UX improvement at zero cost. |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Real-time streaming TTS** | Reduce perceived latency; stream audio as it generates | WhatsApp voice notes are atomic — the user presses play on the complete file. Streaming TTS produces fragmented audio chunks, not a single OGG file. WhatsApp has no streaming audio UI. The complexity is significant (WebSocket + chunk accumulation + OGG header injection) with zero UX benefit. | Use batch TTS API (`client.textToSpeech.convert`) which returns the complete audio buffer. 250-300ms TTS latency is acceptable for async WhatsApp use. |
| **Professional Voice Cloning (PVC) for Hebrew** | PVC produces higher quality clones | PVC requires 30-180 minutes of recorded audio (impractical for most users) and is "not fully optimized" for the `eleven_v3` model (official source). The `eleven_v3` model is required for best Hebrew quality, but PVC + v3 is a known degraded combination. Also, PVC requires a Creator+ ElevenLabs subscription. | Use Instant Voice Cloning (IVC) with 1-2 minutes of clean Hebrew audio. IVC on `eleven_turbo_v2_5` is confirmed to support Hebrew and provides good quality. IVC is available on all paid plans. |
| **Speech-to-speech (voice changer) bypass** | Skip transcription → Gemini → TTS; instead convert incoming voice directly to user's voice | ElevenLabs Voice Changer API transforms a voice into a target voice but does not change the spoken content — it speaks the same words in the cloned voice. The bot cannot alter what the contact said; it needs Gemini to generate a new reply. S2S cannot replace the transcription + AI + TTS pipeline. | Maintain the full pipeline: transcription → AI → TTS. |
| **Local/offline TTS (Coqui, Kokoro)** | Avoid API costs; run on home server | Hebrew quality from open-source TTS is substantially inferior to ElevenLabs for a cloned voice. Coqui TTS has very limited Hebrew support. Kokoro v1 does not include Hebrew. Running local TTS adds GPU/CPU load to the home server (already running bot + PM2). The cost of ElevenLabs for personal bot usage is negligible (~$0.30/1000 chars TTS + ~$0.0067/min STT). | Use ElevenLabs. At a realistic 10 voice interactions/day at average 20 chars each, TTS cost is ~$0.06/month. |
| **Whisper/Groq for transcription** | Lower cost or local transcription alternative | Whisper (local) requires ffmpeg conversion of WhatsApp OGG first (extra step + complexity). Groq Whisper API is faster but Hebrew quality is lower than ElevenLabs Scribe v2 (WER "Good" for Hebrew on Scribe). Since ElevenLabs is already used for TTS, using the same vendor for STT keeps the integration simpler (one SDK, one API key, one billing account). | ElevenLabs Scribe v2. If cost becomes an issue (unlikely at personal scale), Groq Whisper is the fallback. |
| **Voice message transcription-only mode (no voice reply)** | Just transcribe incoming voice and send the transcript back as text to the owner | The "fallback to text reply when voice is disabled" table-stakes feature already handles this. A separate "transcription-only mode" is redundant with the per-contact `voiceReplyEnabled` toggle. Adding a third mode (off / text-reply / voice-reply) increases UI complexity with marginal gain. | Use `voiceReplyEnabled: false` (default) — this already triggers text reply from transcript. No separate mode needed. |
| **Group voice message handling** | Groups also have voice messages; bot reads groups | Bot should NEVER send voice messages to groups as the user. The same "don't impersonate in groups" principle from Milestone 2 applies to voice. Group voice messages should be silently ignored or, at most, transcribed passively for context (a v2+ feature). | Private chat voice messages only. Groups are out of scope for this milestone. |
| **WhatsApp's native voice transcript feature as input** | WhatsApp iOS 17+ transcribes voice messages natively on-device; could use that text | The native WhatsApp transcript is presented in the UI but is not accessible programmatically via Baileys. It lives in the client app, not in the message protobuf that Baileys receives. Baileys sees only the raw audio bytes. | Download and transcribe via ElevenLabs — the audio is always available via Baileys regardless of what the WhatsApp app shows. |

---

## Feature Dependencies

```
[Existing Message Pipeline] (Done)
    └──gates──> [Voice Message Detection]
                    └──requires──> [Baileys audioMessage check + early-return bypass]
                    └──requires──> [downloadMediaMessage API]
                                       └──required by──> [ElevenLabs STT Transcription]
                                                             └──required by──> [Gemini Reply Generation (existing)]
                                                                                   └──required by──> [ElevenLabs TTS Generation]
                                                                                                         └──required by──> [OGG/Opus Format Conversion]
                                                                                                                               └──required by──> [WhatsApp PTT Send]

[Per-Contact voiceReplyEnabled toggle]
    └──required by──> [Voice pipeline branch vs. text-reply fallback]
    └──required by──> [Draft queue voice-mode branch]

[ElevenLabs Voice Clone Setup (one-time ops)]
    └──required by──> [ElevenLabs TTS Generation]
    └──provides──> [ELEVENLABS_VOICE_ID env var]

[ffmpeg binary on system]
    └──required by──> [OGG/Opus Format Conversion]
    └──installed via──> [apt install ffmpeg] on Ubuntu server

[@elevenlabs/elevenlabs-js SDK]
    └──required by──> [ElevenLabs STT]
    └──required by──> [ElevenLabs TTS]

[Draft Queue (Done)]
    └──extends──> [Voice draft storage] (audio file + draft DB record)
    └──extends──> [Draft approval → audio send]

[messages table] (Done)
    └──extends──> [transcript column addition]
    └──extends──> [audioPath column for draft voice files]
```

### Dependency Notes

- **ffmpeg binary is an OS-level dependency:** Not an npm package. Must be installed on the Ubuntu server (`sudo apt install ffmpeg`). `fluent-ffmpeg` npm package is the Node.js wrapper. Both are needed. This is a setup step, not a runtime dependency — document in README.

- **Voice clone must be created before the feature works end-to-end:** The `ELEVENLABS_VOICE_ID` env var must be set. This is a one-time setup task: record 1-2 min of clean Hebrew audio, upload via ElevenLabs dashboard or IVC API, copy the returned `voice_id`. Not automated by the bot.

- **Draft voice storage requires a temp directory or DB BLOB:** When in draft mode, the generated OGG audio must be persisted until the owner approves/rejects. Options: temp file path (e.g., `data/voice-drafts/{draftId}.ogg`) or SQLite BLOB. File path is simpler and avoids large BLOBs in SQLite. Cleanup on reject.

- **ElevenLabs STT accepts OGG natively:** WhatsApp voice messages are OGG/Opus. ElevenLabs Scribe v2 accepts OGG as input. No format conversion is needed for transcription. The conversion step (ffmpeg) is only needed on the output side (ElevenLabs TTS → WhatsApp).

- **Turbo v2.5 is the correct TTS model for Hebrew + voice clone:** Flash v2.5 is not confirmed to support Hebrew in the 32-language list. Eleven v3 supports Hebrew but PVC is "not fully optimized" on v3. Turbo v2.5 explicitly supports Hebrew and supports IVC. Use model ID `eleven_turbo_v2_5`.

---

## MVP Definition

### Launch With (v1 — voice milestone MVP)

Minimum set for the voice feature to be useful and safe. Focuses on the core pipeline first.

- [ ] **Voice message detection** — Extend `processMessage` to handle `audioMessage`/`audioMessage` types; do not return early on audio.
- [ ] **Download + ElevenLabs transcription** — `downloadMediaMessage` → `client.speechToText.convert` → transcript string.
- [ ] **Gemini reply from transcript** — Pass transcript as message body to existing `generateReply()`. No changes to Gemini module.
- [ ] **ElevenLabs TTS with cloned voice** — `client.textToSpeech.convert` with `eleven_turbo_v2_5` + Hebrew voice clone ID.
- [ ] **OGG/Opus conversion via fluent-ffmpeg** — Convert MP3 TTS output to OGG/Opus for WhatsApp PTT compatibility.
- [ ] **WhatsApp PTT send** — `sock.sendMessage(jid, { audio: oggBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })`.
- [ ] **Per-contact `voiceReplyEnabled` toggle** — Add DB column; default false. Wiring to existing contact management.
- [ ] **Text-reply fallback when voice disabled** — When `voiceReplyEnabled === false`, transcribe voice and reply as text. This is the default behavior until owner enables voice per-contact.
- [ ] **Draft queue integration** — In draft mode, save audio to disk and record draft; await owner ✅/❌ before sending.
- [ ] **`typing` / `recording` presence indicator** — Send `sock.sendPresenceUpdate('recording', jid)` at start of voice pipeline for UX.

### Add After Validation (v1.x)

Add once the core pipeline is proven stable in production.

- [ ] **Transcript persistence** — Add `transcript` column to `messages` table; store transcript when processing voice messages. Enables audit trail and improves Gemini context for follow-up messages.
- [ ] **Transcript preview in draft notification** — Include transcript in the owner's draft notification message so they can read what was said before approving audio send.
- [ ] **Dashboard toggle for per-contact voice** — Expose `voiceReplyEnabled` in the web dashboard contact list. Currently managed via CLI only.
- [ ] **Language detection logging** — Log the language Scribe auto-detects for incoming voice messages. Useful for debugging Hebrew vs. other language contacts.

### Future Consideration (v2+)

- [ ] **Waveform data in sent voice notes** — Requires generating amplitude waveform from audio buffer. Low value; broken in some Baileys versions. Defer until verified working in v7.
- [ ] **Passive group voice transcription** — Transcribe voice messages in monitored groups for context, without replying. Useful as group monitoring enhancement but not core to this milestone.
- [ ] **Voice quality selection per contact** — Allow choosing Flash v2.5 (lower latency) vs Turbo v2.5 (better quality) per contact. Premature optimization for a personal bot.
- [ ] **Trim silence from TTS output** — ElevenLabs occasionally adds silence padding. ffmpeg can strip it. Nice-to-have for naturalness; not blocking.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Voice message detection | HIGH | LOW | P1 |
| Audio download + ElevenLabs STT | HIGH | LOW | P1 |
| Gemini reply from transcript | HIGH | LOW (reuse) | P1 |
| ElevenLabs TTS with cloned voice | HIGH | MEDIUM | P1 |
| OGG/Opus conversion (ffmpeg) | HIGH | MEDIUM | P1 |
| WhatsApp PTT send | HIGH | LOW | P1 |
| Per-contact voiceReplyEnabled toggle | HIGH | LOW | P1 |
| Text-reply fallback | HIGH | LOW | P1 |
| Draft queue integration (voice) | HIGH | MEDIUM | P1 |
| `recording` presence indicator | MEDIUM | LOW | P1 |
| Transcript persistence | MEDIUM | LOW | P2 |
| Transcript in draft notification | MEDIUM | LOW | P2 |
| Dashboard toggle for voice | MEDIUM | LOW | P2 |
| Language detection logging | LOW | LOW | P2 |
| Waveform in sent voice notes | LOW | MEDIUM | P3 |
| Voice quality selection per contact | LOW | LOW | P3 |

**Priority key:**
- P1: Required for this milestone to be declared complete
- P2: Should ship in this milestone; add during development (low cost)
- P3: Future milestone

---

## Technical Constraints Affecting Feature Design

### 1. Audio Format: OGG/Opus is Mandatory for WhatsApp PTT (HIGH confidence)

WhatsApp voice notes must be OGG format with the Opus codec (`libopus`). Specs: 48000Hz sample rate, mono, ~32kbps bitrate. Sending MP3 with `ptt: true` works on WhatsApp Web but fails silently on Android mobile clients — the recipient never receives the audio. Multiple community reports confirm this is a persistent issue.

**Implementation requirement:** ElevenLabs TTS outputs MP3 by default. Must always convert via ffmpeg before sending as PTT. ffmpeg binary required on Ubuntu server (`sudo apt install ffmpeg`). Use `fluent-ffmpeg` npm package for Node.js streaming conversion.

**Alternatively:** ElevenLabs TTS supports `output_format: 'pcm_44100'` (raw PCM). ffmpeg can encode PCM → OGG/Opus. Or request `opus_48000_32` if available (check API docs at time of implementation). Using an ElevenLabs Opus output format directly would eliminate the MP3 intermediate step.

### 2. Hebrew TTS Model Selection (HIGH confidence — model ID confirmed)

**Use `eleven_turbo_v2_5`.** This is the correct model for Hebrew voice replies with a cloned voice:
- Hebrew is in the 32 supported languages for Turbo v2.5 (confirmed in launch announcement)
- Instant Voice Cloning (IVC) works with Turbo v2.5
- Latency: ~250-300ms (acceptable for async WhatsApp use)
- Model ID: `eleven_turbo_v2_5`

**Do not use:**
- `eleven_flash_v2_5` — Hebrew not confirmed in its 32-language list (Flash added Hungarian, Norwegian, Vietnamese over Turbo; Hebrew not mentioned)
- `eleven_v3` — Supports Hebrew TTS but PVC/IVC "not fully optimized" on v3; higher latency, no spec provided
- `eleven_multilingual_v2` — 29 languages, Hebrew not in the list

### 3. ElevenLabs STT: Hebrew is "Good" not "Excellent" (HIGH confidence)

Scribe v2 classifies Hebrew (code: `heb`) in the "Good" tier: WER 10-20%. This means roughly 1 in 10 words may be incorrect. For casual WhatsApp messages, this is acceptable — Gemini can handle slightly noisy input and will infer intent from context. For short voice messages (5-15 seconds), errors are few in absolute terms.

**Mitigation:** Always store the raw transcript. If reply quality issues emerge, the transcript log will show transcription errors for debugging.

### 4. End-to-End Latency Budget (MEDIUM confidence — estimated from component specs)

A realistic estimate for the full voice pipeline:
- Baileys voice message detection: ~0ms (event-driven)
- `downloadMediaMessage` (audio buffer): ~200-800ms (network, message size)
- ElevenLabs Scribe transcription: ~1,000-3,000ms (batch API, not realtime)
- Gemini reply generation: ~500-1,500ms (existing pipeline)
- ElevenLabs TTS synthesis: ~250-300ms (Turbo v2.5)
- ffmpeg OGG conversion: ~100-300ms (local, CPU-bound)
- `sock.sendMessage` (audio upload + send): ~500-1,500ms (network)

**Total estimated: 2.5-7.5 seconds end-to-end.** This is longer than text reply (~1-3s) but acceptable for WhatsApp voice — users know voice processing takes a moment. The `recording` presence indicator (sent immediately on receipt) sets expectations.

WhatsApp's own voice transcript feature (iOS/Android, late 2024) does not include Hebrew on Android; iOS 17+ includes Hebrew. This validates that Hebrew voice processing has inherent latency — users who use voice for Hebrew are accustomed to it.

### 5. ElevenLabs Pricing at Personal Bot Scale (HIGH confidence)

At realistic personal bot usage (10 voice interactions/day, ~30s average voice message, ~80 char average TTS reply):
- **STT:** 10 × 0.5 min × $0.40/hr = ~$0.033/day = ~$1/month
- **TTS:** 10 × 80 chars × $0.30/1,000 chars = ~$0.024/day = ~$0.72/month
- **Total voice costs:** ~$1.72/month at 10 interactions/day

This is negligible for a personal use case. No optimization needed. ElevenLabs free tier provides limited monthly characters/minutes — check current plan limits at time of implementation.

### 6. Voice Clone Setup is a One-Time Manual Task (HIGH confidence)

The bot does not automate voice clone creation. The user (owner) must:
1. Record 1-2 minutes of clean Hebrew audio (no background noise, no reverb, one speaker)
2. Upload to ElevenLabs dashboard → Voices → Add Voice → Instant Voice Cloning
3. Copy the `voice_id` from the created voice
4. Set `ELEVENLABS_VOICE_ID=<voice_id>` in the bot's `.env`

Audio format for cloning: MP3 at 192kbps or above (ElevenLabs recommendation). WAV is accepted but provides no quality improvement. Recording in Hebrew is required for Hebrew language quality — the model adapts to the language of the sample.

---

## Prior Art Analysis

| Approach | Reference | What It Shows | Our Approach |
|----------|-----------|---------------|--------------|
| Voice transcription bot | [René Roth's WhatsApp transcriber](https://reneroth.xyz/whatsapp-voice-messages-automatic-transcript/) — Baileys + Deepgram STT, sends transcripts to an inbox group | Confirms Baileys `downloadMediaMessage` → STT API pattern works. Uses Deepgram (competitor to ElevenLabs Scribe). | Same Baileys download pattern; use ElevenLabs Scribe instead of Deepgram for Hebrew quality and vendor consolidation. |
| Voice chatbot pipeline | n8n workflow: WhatsApp audio → Whisper → AI → TTS | Confirms the full pipeline is achievable. n8n uses Groq Whisper for speed. | Same pipeline but integrated into existing Node.js bot. ElevenLabs Scribe for Hebrew accuracy over Whisper. |
| PTT send format | WhatsApp-web.js PR #1956 — auto-convert audio to OGG/Opus | Confirms OGG/Opus is mandatory for PTT. FFmpeg conversion is the established solution. | Apply same conversion. |
| Hebrew STT | ElevenLabs Scribe v2 Hebrew page — "Good" tier WER 10-20% | Confirms Hebrew is supported and quality level. | Use Scribe v2 with optional `language_code: 'heb'` for better accuracy. |
| Hebrew TTS | ElevenLabs Turbo v2.5 — 32 languages including Hebrew | Confirms model and language support. | Use `eleven_turbo_v2_5`, IVC voice ID. |
| WhatsApp native voice transcripts | [WhatsApp Blog, Nov 2024](https://blog.whatsapp.com/introducing-voice-message-transcripts) — native on-device transcript in select languages; Hebrew supported on iOS 17+ | Context: Hebrew voice is a real use case WhatsApp is investing in. Native feature runs on-device and is not accessible via Baileys. | ElevenLabs Scribe via bot pipeline; entirely separate from native WhatsApp transcription. |

---

## Sources

- [ElevenLabs: Speech-to-Text overview](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) — Scribe v2 models, language support, OGG input support (HIGH confidence — official docs)
- [ElevenLabs: Speech-to-Text convert endpoint](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) — request parameters, `model_id`, `language_code`, response format (HIGH confidence — official API reference)
- [ElevenLabs: Models overview](https://elevenlabs.io/docs/overview/models) — `eleven_v3`, `eleven_turbo_v2_5`, `eleven_flash_v2_5`, Hebrew support, latency specs (HIGH confidence — official docs)
- [ElevenLabs: Introducing Turbo v2.5](https://elevenlabs.io/blog/introducing-turbo-v25) — 32-language list including Hebrew, latency ~250-300ms (HIGH confidence — official announcement)
- [ElevenLabs: Eleven v3 launch](https://elevenlabs.io/blog/eleven-v3) — 70+ languages, Hebrew included, PVC/IVC notes (HIGH confidence — official)
- [ElevenLabs: IVC API reference](https://elevenlabs.io/docs/api-reference/voices/ivc/create) — voice clone creation endpoint, `voice_id` response (HIGH confidence — official API)
- [ElevenLabs: Hebrew STT page](https://elevenlabs.io/speech-to-text/hebrew) — Hebrew "Good" tier classification, WER 10-20% (HIGH confidence — official product page)
- [Baileys: downloadMediaMessage API](https://baileys.wiki/docs/api/functions/downloadMediaMessage/) — function signature, buffer/stream modes (HIGH confidence — official Baileys wiki)
- [Baileys GitHub Issue #1745](https://github.com/WhiskeySockets/Baileys/issues/1745) — waveform display broken in v6.7.9+ (MEDIUM confidence — community issue report)
- [WhatsApp Blog: Voice Message Transcripts, Nov 2024](https://blog.whatsapp.com/introducing-voice-message-transcripts) — native transcript feature context; Hebrew on iOS 17+ (HIGH confidence — official Meta blog)
- [npm: @elevenlabs/elevenlabs-js](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js) — v2.37.0, official SDK (HIGH confidence — npm registry)
- [WhatsApp OGG/Opus format requirement](https://blog.ultramsg.com/how-to-send-ogg-file-using-whatsapp-api/) — 48kHz, mono, libopus required for PTT (MEDIUM confidence — community article, corroborated by multiple sources)
- [fluent-ffmpeg: node-fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) — Node.js FFmpeg wrapper for audio conversion (HIGH confidence — official repo)
- [ElevenLabs pricing: Scribe launch tweet](https://x.com/elevenlabsio/status/1894821482104266874) — $0.40/hr STT pricing (HIGH confidence — official ElevenLabs account)
- [ElevenLabs IVC requirements](https://help.elevenlabs.io/hc/en-us/articles/13440435385105) — 1-2 min MP3, do not exceed 3 min, 192kbps recommended (MEDIUM confidence — help article, 403 at time of research; corroborated by multiple secondary sources)
- [Voice chatbot WhatsApp pipeline reference](https://n8n.io/workflows/3586-ai-powered-whatsapp-chatbot-for-text-voice-images-and-pdfs-with-memory/) — n8n implementation showing full audio pipeline (MEDIUM confidence — community workflow)

---
*Feature research for: WhatsApp Bot — Voice Message Support Milestone*
*Researched: 2026-03-01*

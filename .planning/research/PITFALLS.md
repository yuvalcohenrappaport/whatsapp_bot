# Pitfalls Research

**Domain:** WhatsApp Bot — Milestone v1.3: Voice Message Handling (ElevenLabs TTS + Transcription)
**Researched:** 2026-02-28
**Confidence:** MEDIUM-HIGH — Format requirements and Baileys audio issues verified via GitHub issues and community sources. ElevenLabs rate limits and Hebrew support verified via official docs. Latency numbers verified across multiple sources. Some voice clone quality specifics inferred from official documentation.

---

> **Scope note:** This document covers pitfalls specific to adding voice features to the existing bot. Pre-existing pitfalls from previous milestones (ban risk, session loss, SQLite busy_timeout, OAuth token rotation, group event loop) are not repeated — they remain valid. This file extends that prior context.

---

## Critical Pitfalls

Mistakes that cause user-facing failures, silent audio breakage, or mandatory rewrites.

---

### Pitfall 1: OGG/Opus Audio Sent Without PTT Flag Appears as Inline File, Not Voice Note

**What goes wrong:**
The audio plays correctly when the recipient clicks it, but WhatsApp renders it as a media attachment (file icon with filename) instead of the expected voice note bubble with waveform. The recipient sees a filename like `audio.ogg` and has to tap to expand — it does not feel like a voice message at all.

**Why it happens:**
Baileys distinguishes between audio-as-attachment and audio-as-voice-note at the message type level, not the file format level. The difference is the `ptt: true` flag in the `sendMessage` call. Developers often send `{ audio: buffer, mimetype: 'audio/ogg; codecs=opus' }` thinking the format makes it a voice note. It does not.

**How to avoid:**
Always send voice replies with `ptt: true` explicitly set:
```typescript
await sock.sendMessage(jid, {
  audio: Buffer.from(audioBytes),
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true,
});
```
Test by receiving the message on a real phone and confirming it renders as a voice note bubble with the audio waveform, not as a file attachment.

**Warning signs:**
- Recipients see a file icon/attachment rather than the circular play button characteristic of voice notes
- WhatsApp shows a filename rather than duration
- Audio plays only when tapped, with no waveform

**Phase to address:** Voice send phase — verify on a real device before calling the feature complete.

**Confidence:** HIGH — confirmed via Baileys GitHub issues #501, #1120, #1828 and multiple community implementations.

---

### Pitfall 2: PTT Waveform Missing — Voice Note Sends but Shows Flat Line

**What goes wrong:**
Voice messages send successfully and play correctly, but the waveform visualization is a flat horizontal line instead of the dynamic waveform that real voice messages show. The message feels uncanny and obviously synthetic — users notice immediately.

**Why it happens:**
Baileys versions 6.7.9 through approximately 6.7.18 had a regression where waveform generation was broken. The fix requires the `audio-decode` package to be installed, which Baileys uses internally to generate the 64-byte waveform array from the raw audio. If `audio-decode` is missing or the Baileys version is in the broken range, waveform is silently omitted.

The current project uses Baileys v7 (rc.9). This is in an RC phase — the waveform behavior in v7.x rc series needs explicit verification, as the RC may carry the regression or have introduced new audio-decode requirements.

**How to avoid:**
- Install `audio-decode` as an explicit project dependency (not just as a transitive dep):
  ```bash
  npm install audio-decode
  ```
- After sending the first voice message, receive it on a real phone and visually confirm the waveform animates when played — not a flat line.
- If the waveform is still flat, generate it manually from the PCM data before sending:
  ```typescript
  // 64-point amplitude analysis, normalized to 0-31 per WhatsApp spec
  const waveform = generateWaveformFromPCM(pcmData); // [12, 31, 8, 25, ...]
  await sock.sendMessage(jid, { audio: buffer, mimetype: '...', ptt: true, waveform });
  ```

**Warning signs:**
- Voice notes render with a flat/straight horizontal line instead of a wave pattern
- Baileys logging shows no `waveform` property in the outgoing message object

**Phase to address:** Voice send phase — waveform test must be part of acceptance criteria.

**Confidence:** MEDIUM-HIGH — regression confirmed in Baileys GitHub issue #1745; fix via `audio-decode` confirmed by community contributor on v6.7.19+. Behavior in v7 RC series not independently verified.

---

### Pitfall 3: ElevenLabs Hebrew TTS Only Supported by Eleven v3 — Wrong Model Breaks Quality

**What goes wrong:**
If the TTS call uses `eleven_multilingual_v2`, `eleven_turbo_v2_5`, or `eleven_flash_v2_5`, Hebrew text gets silently romanised, mispronounced, or hallucinated. The output sounds like a foreign speaker attempting Hebrew phonetics rather than a native Hebrew voice. The user sends voice messages that sound nothing like them.

**Why it happens:**
Hebrew is only natively supported by the **Eleven v3** model (`model_id: "eleven_v3"`). The older multilingual v2 model officially lists 29 languages — Hebrew is not among them. Turbo v2.5 and Flash v2.5 support 32 languages including some Semitic languages, but Hebrew is documented as supported only in v3. Developers copy-paste multilingual v2 examples (the most documented model) and never test Hebrew output quality.

**How to avoid:**
- Use `model_id: "eleven_v3"` for all Hebrew TTS calls.
- Pass `language_code: "he"` explicitly to enforce Hebrew processing (language enforcement is supported on Turbo and Flash v2.5, but v3 is the correct model for Hebrew quality).
- Test the voice clone output with a sample Hebrew sentence containing nikud-less words before deploying — poor Hebrew rendering is immediately obvious to a native speaker.
- Do not use the `eleven_flash_v2_5` model for Hebrew even though its latency is attractive (75ms claimed) — verify Hebrew quality explicitly if switching models.

**Warning signs:**
- TTS output contains English-like pronunciation of Hebrew words
- Letters like `ח`, `ע`, `צ` are mispronounced or omitted
- The output sounds like a non-native Hebrew speaker reading phonetically

**Phase to address:** ElevenLabs integration phase — first TTS API call must use `eleven_v3` for Hebrew; validate before wiring into the message pipeline.

**Confidence:** HIGH — verified via ElevenLabs official models documentation (elevenlabs.io/docs/overview/models). v3 is the only model with Hebrew (heb) in its documented language list.

---

### Pitfall 4: Voice Clone (IVC) Trained on WhatsApp Audio Has Degraded Quality

**What goes wrong:**
The instant voice clone is created using WhatsApp voice note recordings as training audio. The resulting clone sounds like the person but with a tinny, compressed quality that is noticeably worse than the actual voice. Short sentences in Hebrew come out robotic or drop syllables.

**Why it happens:**
WhatsApp compresses voice messages to OGG/Opus format at 32kbps mono. ElevenLabs recommends training audio at 192kbps MP3 or higher, recorded cleanly in a quiet environment. WhatsApp's codec compression specifically targets speech intelligibility, not voice fidelity — it introduces artifacts that the voice clone model learns and reproduces. Additionally, Instant Voice Clone (IVC) trained on less than 1 minute of audio yields noticeably lower quality; WhatsApp voice messages are typically 5–30 seconds each, so a small sample is easily insufficient.

**How to avoid:**
- Record training audio directly (not via WhatsApp): use the macOS Voice Memos app or any uncompressed recording, saved as MP3 at 192kbps+ or WAV.
- Target 1–3 minutes of continuous speech in Hebrew — reading from a text works well. Keep each training file under 3 minutes (more offers diminishing returns and can hurt quality according to ElevenLabs docs).
- Do not use WhatsApp audio exports as training material.
- After creating the IVC, generate 5–10 sample Hebrew sentences and listen critically before using the voice in production.
- Professional Voice Clone (PVC) requires 30+ minutes of audio and is not yet optimized for Eleven v3 as of early 2026 — stick with IVC until PVC + v3 is generally available.

**Warning signs:**
- Clone sounds thin or compressed compared to the user's real voice
- Specific Hebrew phonemes (`ר`, `ח`, `ע`) sound unnatural
- Short sentences drop trailing syllables

**Phase to address:** Voice clone setup phase — before any code is written, validate the clone quality independently via the ElevenLabs UI.

**Confidence:** HIGH — ElevenLabs official documentation explicitly recommends MP3 at 192kbps+ and states that low-quality samples with artifacts are reproduced by the clone. WhatsApp OGG/Opus at 32kbps is clearly below the recommended quality threshold.

---

### Pitfall 5: Audio Format Mismatch — FFmpeg Not on System Path Causes Silent Failure

**What goes wrong:**
ElevenLabs TTS returns MP3 audio. WhatsApp voice notes require OGG/Opus. The conversion step calls `ffmpeg` via `child_process.spawn`. On the development machine, FFmpeg is installed and works. On yuval-server (Ubuntu 24.04), it may be absent or installed at a non-standard path. The spawn call fails with `ENOENT` or `spawn ffmpeg ENOENT` — but if the error is not caught and surfaced, the voice pipeline silently falls back to no response or crashes the message handler.

**Why it happens:**
FFmpeg is not bundled with Node.js. The project currently has no FFmpeg dependency. Developers test locally (where FFmpeg is often installed via Homebrew on macOS) and assume it exists everywhere. On a minimal Ubuntu server install, `ffmpeg` may not be present.

**How to avoid:**
- Add FFmpeg installation to the server setup checklist:
  ```bash
  sudo apt install -y ffmpeg
  ffmpeg -version  # verify
  ```
- Alternatively, use `fluent-ffmpeg` npm package — it provides a wrapper but still needs system FFmpeg. Or use `ffmpeg-static` which bundles a static FFmpeg binary:
  ```bash
  npm install ffmpeg-static
  ```
  Then set the FFmpeg path explicitly:
  ```typescript
  import ffmpegPath from 'ffmpeg-static';
  import { execFile } from 'child_process';
  // use ffmpegPath as the binary
  ```
- Add a startup check: at bot startup, verify `ffmpeg` is available and log a clear error if not.
- Wrap all FFmpeg calls in try/catch and surface errors with context: `'FFmpeg conversion failed: ENOENT — is ffmpeg installed?'`

**Warning signs:**
- `Error: spawn ffmpeg ENOENT` in bot logs
- Voice pipeline logs show TTS succeeded but no audio message sent
- The error only appears on the server, not in local development

**Phase to address:** Voice infrastructure phase — verify FFmpeg availability before writing the conversion module.

**Confidence:** HIGH — standard Node.js operational concern; `ffmpeg-static` pattern is well-documented and common in voice processing Node.js projects.

---

### Pitfall 6: Temp Audio Files Accumulate on Disk — No Cleanup on Failure Paths

**What goes wrong:**
The voice pipeline creates temporary files: downloaded voice note from WhatsApp, converted OGG file for transcription, TTS output MP3, converted OGG for sending. Each successful message cleans up after itself. But when any step fails (network error, FFmpeg crash, ElevenLabs 429), the finally/catch path either doesn't run or runs after the file reference is lost. After 1 week, `/tmp` or the app temp directory contains hundreds of orphaned `.ogg` and `.mp3` files.

**Why it happens:**
Async pipelines with multiple steps are difficult to clean up correctly. If cleanup is done only in the success path, failure paths leak. If cleanup is done in `finally`, but the temp file path variable is scoped inside a nested try/catch, the `finally` block can't access it. The bot runs 24/7 and processes many messages — even one leaked file per message adds up quickly.

**How to avoid:**
- Always create temp files with a single entry point that returns a disposer:
  ```typescript
  async function withTempFile<T>(
    ext: string,
    fn: (path: string) => Promise<T>
  ): Promise<T> {
    const path = `/tmp/bot-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    try {
      return await fn(path);
    } finally {
      await fs.unlink(path).catch(() => {}); // suppress "file not found" errors
    }
  }
  ```
- Use this wrapper for every temp file in the voice pipeline — never create temp files outside of a disposer pattern.
- Add a startup cleanup: on bot start, delete any `/tmp/bot-audio-*` files older than 1 hour (leftover from the previous run that crashed).
- Monitor disk usage in the server's `/tmp` directory — add to PM2 health checks.

**Warning signs:**
- `ls /tmp/bot-audio-*` grows on a running server
- Disk usage for the bot's `/tmp` area increases monotonically
- Error logs show FFmpeg or ElevenLabs failures but no corresponding temp file cleanup logs

**Phase to address:** Voice infrastructure phase — temp file lifecycle must be designed before the first audio conversion is written.

**Confidence:** HIGH — standard async resource management concern; pattern applies to all temporary file usage in the voice pipeline.

---

### Pitfall 7: Draft Queue Only Stores Text — Voice Drafts Require File Persistence

**What goes wrong:**
The existing draft queue stores `body: text` in SQLite. When a voice draft is created, the generated audio file is stored in `/tmp`. The user receives a notification and replies `✅` to approve 2 hours later. By then, the temp file has been cleaned up (either by design or by a server restart), and the bot tries to send the audio but finds no file — the draft is approved but nothing is sent, or it crashes.

**Why it happens:**
Text drafts are zero-cost to hold indefinitely — they live in the database. Audio drafts need a file on disk. If the audio file is generated eagerly (at draft creation time) and stored only as a temp file, it won't survive across server restarts or temp directory cleanups. The draft approval flow (`✅` in the owner's chat) was not designed with file-backed payloads in mind.

**How to avoid:**
Two valid approaches:
1. **Lazy audio generation**: Store only the text in the draft (as now). When `✅` is approved, generate the TTS audio at that moment and send it immediately. Draft queue stays text-only. Slight delay on approval (~500ms for TTS generation) but no file management complexity.
2. **Persistent audio storage**: Generate audio at draft creation time. Store it to a non-temp directory (e.g., `./data/voice-drafts/{draft-id}.ogg`). Store the file path in the drafts table. Clean up when the draft is actioned (sent or rejected).

**Recommended:** Lazy generation (option 1) — simpler, no schema migration, no file lifecycle complexity. The slight approval delay is acceptable.

**Warning signs (if eager generation is chosen):**
- `ENOENT: no such file or directory` when actioning a voice draft after a server restart
- Approved drafts produce no audio being sent, no error visible to owner
- `/tmp/voice-draft-*.ogg` files persisting beyond draft approval

**Phase to address:** Draft queue integration phase — decide the lazy-vs-eager approach before writing any draft-related voice code.

**Confidence:** HIGH — directly implied by the existing draft schema (`body` is text-only) and the temp file lifecycle analysis above.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `eleven_multilingual_v2` for Hebrew TTS | Faster/cheaper per character | Hebrew output is wrong; users notice immediately | Never |
| Storing voice clone ID in `.env` only | Simple setup | Forgotten during environment changes; no audit trail | Dev only; store in DB or config |
| Creating temp files without a cleanup wrapper | Faster to write | Disk fills up over days of operation | Never in production |
| Eager voice generation for drafts (without persistent storage) | Avoids re-generation latency | Audio lost after restart; approved drafts send nothing | Never without persistent storage |
| Sending audio without `ptt: true` | Works as audio attachment | Users don't see voice note UX; voice clone benefit lost | Never for voice replies |
| Skipping waveform verification on a real device | Faster testing | Flat-line waveform ships; uncanny valley effect for recipients | Never |
| One-shot FFmpeg conversion (no retry) | Simple code | ElevenLabs output format changes or subtle audio artifacts silently break conversion | Acceptable in MVP; add validation before v1.4 |

---

## Integration Gotchas

Common mistakes when connecting to external services in this voice pipeline.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ElevenLabs TTS (Hebrew) | Using `eleven_multilingual_v2` or `eleven_turbo_v2_5` | Use `eleven_v3` for Hebrew; pass `language_code: "he"` |
| ElevenLabs TTS API | Not handling 429 concurrency limit | Wrap TTS calls with retry + exponential backoff; Free tier allows only 2–4 concurrent Multilingual calls |
| ElevenLabs STT (Scribe) | Assuming Hebrew word error rate is like English | Hebrew STT has 10–20% WER on Scribe v2 per official benchmarks; treat transcriptions as noisy input to Gemini |
| ElevenLabs STT | Sending raw WhatsApp OGG directly to STT | Works, but strip the WhatsApp-specific Opus container first; convert to 16kHz mono before sending for best accuracy |
| ElevenLabs IVC training | Using WhatsApp voice recordings as training audio | Use clean studio-quality recordings at 192kbps+ MP3; WhatsApp's OGG at 32kbps degrades the clone |
| FFmpeg conversion | Assuming FFmpeg exists on server | Install `ffmpeg-static` npm package or add FFmpeg to server setup checklist; add startup validation |
| Baileys audio send | Sending `{ audio, mimetype }` without `ptt: true` | Always include `ptt: true` for voice notes; without it, message renders as file attachment |
| Baileys audio send | Missing `audio-decode` npm dependency | Install `audio-decode` explicitly; Baileys uses it to generate waveform data for PTT messages |
| ElevenLabs STT | Sending full audio including silence | Trim leading/trailing silence before STT — reduces token usage and improves accuracy on short messages |

---

## Performance Traps

Patterns that work fine in testing but degrade in production.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Awaiting full TTS audio generation before sending | 800ms–2s delay added to every voice response (Multilingual v2); Turbo v2.5 adds ~300ms | Use Turbo v2.5 or Flash for latency-sensitive paths; note Hebrew requires v3 which may have higher latency | Every single voice reply |
| Sequential: transcribe → generate text → TTS → convert → send (no timeout) | Message handler blocked for 3–5s total; subsequent messages queue | Add an overall timeout (e.g., 8s) and fall back to text-only response if voice pipeline exceeds it | Anytime ElevenLabs has elevated latency |
| Re-generating TTS for same draft body on each `✅` retry | Double API cost if user re-sends approval | Cache TTS result in memory for the draft lifetime (or use lazy generation) | Repeated approval attempts |
| Storing all voice message transcriptions in SQLite `messages.body` | Table rows grow large; existing message context for Gemini includes transcribed voice noise | Keep transcriptions as a separate field or table; do not pollute style learning data with voice transcription artifacts |  After ~50 voice messages from a contact |
| ElevenLabs Free tier: 2 concurrent Multilingual requests | 429 errors during normal conversation | Upgrade to Starter tier ($5/mo) before deploying; Free tier is testing-only at any meaningful message volume | 3+ simultaneous voice replies needed |

---

## Security Mistakes

Domain-specific security concerns for voice processing.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging ElevenLabs API key in error messages | API key leaked to log files | Never log the key string; log `ELEVENLABS_API_KEY is set/unset` as boolean only |
| Storing voice clone ID in plaintext `.env` committed to git | Voice clone can be used by anyone with API access | Keep in `.env` (gitignored, chmod 600); never commit |
| Sending voice message audio to any non-private contact | Voice clone of owner exposed to unintended parties | Respect the per-contact voice toggle; always check `contact.voiceEnabled` before TTS generation |
| Transcribed voice message content sent to both Gemini and ElevenLabs | User's contact's speech sent to two external APIs | Inform in project docs; acceptable for personal use but worth noting for privacy audit |
| Temp audio files world-readable in `/tmp` | Other processes on the server can read voice content | Set file permissions to 600 when creating temp files: use `fs.writeFile(path, data, { mode: 0o600 })` |

---

## UX Pitfalls

User experience mistakes specific to voice features.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Voice reply always generated regardless of contact's conversation style | Contacts who mostly send text receive an unexpected voice message | Respect the per-contact `voiceEnabled` toggle; default it to `off` for all existing contacts |
| Voice message sent in draft mode without owner preview | Owner cannot hear the audio before approving — approves blind | Use lazy TTS generation: show the text draft as usual, generate audio only on `✅` approval; owner sees the text first |
| No fallback when ElevenLabs is down | Voice-enabled contact messages get no reply at all | If TTS fails after retry, fall back to text reply; never silently drop the reply |
| Transcription errors corrupt Gemini context | Garbled transcription ("כן בסדר" → "can beside") feeds Gemini a wrong message and generates a non-sequitur reply | Pass the voice message context as `[voice message, transcribed: "<text>"]` to Gemini; include a reliability note in the system prompt |
| Very long voice messages transcribed and fed entirely to Gemini | Prompt becomes huge; latency spikes; Gemini may lose context | Truncate transcription input at ~500 words before passing to Gemini for reply generation |

---

## "Looks Done But Isn't" Checklist

Things that pass local testing but break in real use.

- [ ] **Voice message sends** but appears as a file attachment, not a voice note — verify `ptt: true` is set and test on a real phone (not WhatsApp Web)
- [ ] **Audio waveform is flat** even though the message plays — install `audio-decode`, verify on a real device that the waveform animates
- [ ] **TTS sounds good in English** but Hebrew is mispronounced — confirm model is `eleven_v3`, not `eleven_multilingual_v2` or `eleven_turbo_v2_5`
- [ ] **Voice clone approved via ElevenLabs UI** but was trained on WhatsApp recordings — retrain with clean studio-quality audio
- [ ] **FFmpeg converts correctly on macOS** but fails on yuval-server with `ENOENT` — install FFmpeg on the server before deploying
- [ ] **Draft approval (`✅`) sends text but not voice** — verify TTS is called at approval time (lazy) or that the audio file still exists (eager)
- [ ] **Temp files clean up in the success path** but not when ElevenLabs throws 429 — verify cleanup runs in `finally`, not just on success
- [ ] **Voice reply enabled for a contact** in auto mode, but sending a 3s voice clip for every reply feels spammy — add a minimum message length threshold before generating voice (e.g., only generate voice if reply is > 20 words or > 10 seconds of speech)
- [ ] **ElevenLabs API key set** in `.env` but `audio-decode` not installed — bot starts but first voice send crashes silently

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong model used for Hebrew TTS (non-v3) | LOW | Change `model_id` in config to `eleven_v3`; no migration needed |
| Temp files accumulated on disk | LOW | `rm /tmp/bot-audio-* && rm ./data/voice-drafts/*.ogg`; add cleanup to startup |
| Voice clone trained on WhatsApp audio (poor quality) | MEDIUM | Delete the IVC in ElevenLabs UI; record clean audio; recreate the IVC; update the `VOICE_ID` config |
| Flat waveform shipped to users | LOW | Install `audio-decode`, redeploy; affected messages cannot be retroactively fixed |
| FFmpeg not on server, voice pipeline broken | LOW | `sudo apt install ffmpeg` or install `ffmpeg-static`; redeploy |
| Draft approved but audio file gone (restart) | LOW | Re-approve draft after fix is deployed (lazy generation); contact receives text fallback in the interim |
| ElevenLabs API key exhausted (character quota) | MEDIUM | Upgrade plan; in the meantime, disable voice toggle for all contacts and fall back to text replies |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `ptt: true` missing → file attachment | Voice send phase (first task) | Receive on real phone; confirm voice note bubble renders |
| Flat waveform | Voice send phase | Check waveform on real device; not WhatsApp Web |
| Wrong model for Hebrew TTS | ElevenLabs integration phase | Generate 5 Hebrew sentences; listen for native quality |
| Poor voice clone quality (WhatsApp audio training) | Voice clone setup phase (before coding) | Validate IVC in ElevenLabs UI before first API call |
| FFmpeg missing on server | Voice infrastructure phase | Add startup check; verify on yuval-server pre-deployment |
| Temp file accumulation | Voice infrastructure phase | Run bot for 24h; verify `/tmp` does not grow |
| Draft queue file loss | Draft integration phase | Restart bot mid-draft; verify `✅` approval still works |
| Hebrew STT accuracy 10–20% WER | Transcription phase | Test with real voice messages containing Hebrew slang |
| ElevenLabs Free tier concurrency | ElevenLabs integration phase | Upgrade to Starter before production; Free tier is testing-only |
| Voice reply in draft mode (blind approve) | Draft integration phase | Use lazy TTS; text shown to owner first, audio generated on `✅` |

---

## Sources

- [ElevenLabs Models Documentation](https://elevenlabs.io/docs/overview/models) — HIGH confidence — Hebrew supported only in Eleven v3; concurrency limits table per tier
- [ElevenLabs Voice Cloning Documentation](https://elevenlabs.io/docs/creative-platform/voices/voice-cloning) — HIGH confidence — IVC quality requirements and training audio recommendations
- [ElevenLabs — Tips for Good Quality Voice Clones (Help)](https://help.elevenlabs.io/hc/en-us/articles/13416206830097-Are-there-any-tips-to-get-good-quality-cloned-voices) — HIGH confidence — MP3 192kbps+ recommendation, quality factors
- [ElevenLabs — Voice Cloning File Formats (Help)](https://help.elevenlabs.io/hc/en-us/articles/13440435385105-What-files-do-you-accept-for-voice-cloning) — HIGH confidence — accepted formats and bitrate guidance
- [ElevenLabs — PVC Language Support (Help)](https://help.elevenlabs.io/hc/en-us/articles/19569659818129-What-languages-are-supported-with-Professional-Voice-Cloning-PVC) — HIGH confidence — PVC not yet optimized for Eleven v3
- [ElevenLabs — How many TTS requests can I make? (Help)](https://help.elevenlabs.io/hc/en-us/articles/14312733311761-How-many-Text-to-Speech-requests-can-I-make-and-can-I-increase-it) — MEDIUM confidence (403 on direct fetch; concurrency limits confirmed via models doc)
- [Baileys GitHub Issue #1745 — PTT Waveform Regression](https://github.com/WhiskeySockets/Baileys/issues/1745) — MEDIUM confidence — regression confirmed in v6.7.9, fix via `audio-decode` in v6.7.19+
- [Baileys GitHub Issue #1828 — Audio Bug](https://github.com/WhiskeySockets/Baileys/issues/1828) — MEDIUM confidence — audio format workarounds documented by community
- [Baileys GitHub Issue #501 — Can't Send Audio Messages](https://github.com/WhiskeySockets/Baileys/issues/501) — MEDIUM confidence — PTT flag requirement confirmed
- [Smallest.ai TTS Benchmark 2025](https://smallest.ai/blog/tts-benchmark-2025-smallestai-vs-elevenlabs-report) — MEDIUM confidence — practical ElevenLabs latency ~350ms (US) vs. claimed 75ms
- [ElevenLabs Latency Optimization (Official)](https://elevenlabs.io/docs/best-practices/latency-optimization) — MEDIUM confidence (page returned 404 on direct fetch; data inferred from models doc and official blog posts)
- [WhatsApp PTT OGG/Opus Format Requirements](https://www.wappbiz.com/blogs/voice-messages-using-whatsapp-api/) — MEDIUM confidence — FFmpeg parameters for WhatsApp-compatible Opus conversion
- [ElevenLabs Eleven v3 Blog Announcement](https://elevenlabs.io/blog/eleven-v3) — HIGH confidence — v3 as the model supporting 70+ languages including Hebrew

---
*Pitfalls research for: WhatsApp Bot Milestone v1.3 — Voice Message Handling*
*Researched: 2026-02-28*

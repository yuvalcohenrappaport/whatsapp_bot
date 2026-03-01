# Phase 14: Core Voice Pipeline - Research

**Researched:** 2026-03-01
**Domain:** Baileys v7 media download API, WhatsApp PTT send, presence indicators, messageHandler.ts integration
**Confidence:** HIGH (all findings verified directly from installed Baileys source at `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys`)

## Summary

Phase 14 wires together three existing Phase 13 modules (`transcriber.ts`, `tts.ts`, `client.ts`) into `messageHandler.ts`. The change is a branch inserted at line 209, right after `if (text === null) return;` — instead of discarding non-text messages, the handler checks for `msg.message?.audioMessage` and routes to the voice pipeline.

The critical implementation discovery is that `downloadMediaMessage` is the correct Baileys API (exported directly from `@whiskeysockets/baileys`), called with `type: 'buffer'` to get a `Buffer` directly — no streaming gymnastics required. The incoming audio's `ptt` field on `msg.message?.audioMessage.ptt` indicates whether it was sent as a voice note vs. a regular audio file attachment, but for triggering the voice pipeline the discriminator is simply presence of `audioMessage` (any audio triggers pipeline).

The PTT send format is verified: `sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })`. Baileys maps this to an `AudioMessage` proto with `ptt: true` internally. The `recording` presence type is confirmed in Baileys source — it sends a `<composing media="audio">` chatstate node, which WhatsApp renders as the "recording..." microphone indicator.

The transcript must be persisted to the messages table (via `insertMessage`) before calling `generateReply`, because `generateReply` reads recent messages from the DB to build context. This is the same pattern used for text messages.

**Primary recommendation:** Insert the voice branch as a guard immediately after `text === null` check. Download audio with `downloadMediaMessage(msg, 'buffer', {})`, transcribe, persist transcript, check `voiceReplyEnabled` + global toggle, branch to PTT send or text send.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VOICE-01 | Bot receives and downloads incoming voice messages from whitelisted contacts | `msg.message?.audioMessage` presence check; `downloadMediaMessage(msg, 'buffer', {})` returns Buffer directly |
| VOICE-03 | Bot generates AI text reply from transcription using existing Gemini pipeline | `generateReply(contactJid)` reads from messages DB — transcript must be persisted via `insertMessage` first with the same `contactJid` |
| VOICE-05 | Bot sends voice reply as WhatsApp PTT voice note (OGG/Opus, ptt: true) | `sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })` — verified from Baileys type definitions |
| CONF-02 | Contacts with voice disabled still get text replies to voice messages | `contact.voiceReplyEnabled` boolean field (schema verified); when false, call `sendWithDelay` with the reply text instead of PTT send |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @whiskeysockets/baileys | 7.0.0-rc.9 (installed) | `downloadMediaMessage`, `sendMessage` with PTT, `sendPresenceUpdate('recording')` | Already in use; all required APIs confirmed present |
| transcriber.ts (Phase 13) | local | `transcribe(buffer, logger): Promise<string>` | Already implemented and tested |
| tts.ts (Phase 13) | local | `textToSpeech(text, logger): Promise<Buffer>` — returns OGG/Opus | Already implemented and tested |
| insertMessage (db/queries/messages.ts) | local | Persist transcript body to DB so generateReply has context | Already used in existing text path |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| getSetting (db/queries/settings.ts) | local | `getSetting('voice_replies_enabled')` — returns 'true' or 'false' string | Check global master switch before attempting any voice pipeline |
| getContact (db/queries/contacts.ts) | local | Returns `{ voiceReplyEnabled: boolean, voiceId: string | null, ... }` | Per-contact voice flag check |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `downloadMediaMessage(msg, 'buffer', {})` | `downloadContentFromMessage` + manual buffer assembly | `downloadMediaMessage` wraps the lower-level API and handles reupload retries; always prefer it |
| Sending `ptt: true` only | Also setting `mimetype: 'audio/ogg; codecs=opus'` | Baileys has a default mimetype for audio but explicitly setting it prevents ambiguity and matches the MIMETYPE_MAP constant in Baileys source |

**Installation:** No new packages required. All needed modules are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/pipeline/
└── messageHandler.ts    # MODIFY: insert voice branch at line 209

src/voice/               # ALREADY EXISTS (Phase 13)
├── client.ts            # ElevenLabs singleton (no changes)
├── transcriber.ts       # transcribe() (no changes)
└── tts.ts               # textToSpeech() (no changes)
```

### Pattern 1: Voice Branch Insertion Point

**What:** Replace the early-return `if (text === null) return;` with a branch that routes audio messages to the voice pipeline before falling through to the text path.

**When to use:** Any time `msg.message?.audioMessage` is truthy (covers both PTT voice notes and regular audio file attachments from a contact).

**Example:**
```typescript
// Source: messageHandler.ts line 207-209 (current code)
async function processMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  const text = getMessageText(msg);

  // NEW: voice branch — handle before the text === null guard
  const audioMsg = msg.message?.audioMessage;
  if (audioMsg && !msg.key.fromMe) {
    const remoteJid = getRemoteJid(msg);
    if (remoteJid && !remoteJid.endsWith('@g.us')) {
      await handleVoiceMessage(sock, msg, remoteJid);
      return;
    }
  }

  if (text === null) return; // skip non-text messages
  // ... rest of existing text path unchanged
```

### Pattern 2: downloadMediaMessage Usage

**What:** Download the encrypted audio payload from WhatsApp servers and decrypt it into a Node.js Buffer.

**Signature (verified from Baileys types):**
```typescript
// Source: /node_modules/@whiskeysockets/baileys/lib/Utils/messages.d.ts
downloadMediaMessage<Type extends "buffer" | "stream">(
  message: WAMessage,
  type: Type,
  options: MediaDownloadOptions,  // MediaDownloadOptions = { startByte?, endByte?, options? }
  ctx?: DownloadMediaMessageContext  // optional: { reuploadRequest, logger }
): Promise<Type extends "buffer" ? Buffer : Transform>
```

**Usage:**
```typescript
// Source: verified from Baileys Utils/messages.d.ts and messages.js
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;
```

**Note:** Pass `{}` for options (all fields are optional). The `ctx` parameter (4th arg) provides reupload retry capability — omitting it means a 410/404 from WhatsApp CDN will throw instead of retry. For Phase 14, omit `ctx` for simplicity; add reupload support in a follow-on if needed.

### Pattern 3: Detect Voice Note vs. Audio Attachment

**What:** The incoming `audioMessage` has a `ptt` boolean field. Use it for logging/metrics, but do NOT gate the voice pipeline on it — treat all audio from a whitelisted contact the same.

```typescript
// Source: /node_modules/@whiskeysockets/baileys/WAProto/index.d.ts line 5541
interface IAudioMessage {
  ptt?: (boolean|null);  // true = voice note, false/null = audio file
  seconds?: (number|null);
  mimetype?: (string|null);
  // ...
}

// Detection pattern:
const audioMsg = msg.message?.audioMessage;
const isPtt = audioMsg?.ptt === true;  // true for voice notes
logger.debug({ isPtt, seconds: audioMsg?.seconds }, 'audio message received');
```

### Pattern 4: Send PTT Voice Note

**What:** Send an OGG/Opus buffer as a WhatsApp voice note bubble.

**Verified from Baileys types:**
```typescript
// Source: /node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts lines 126-130
// AnyMediaMessageContent includes:
{
  audio: WAMediaUpload;
  ptt?: boolean;      // if true, renders as voice note bubble
  seconds?: number;   // optional duration
}
// WAMediaUpload includes: Buffer | { url: string } | { stream: Readable }
// mimetype is a top-level optional field on AnyMediaMessageContent

// Usage:
await sock.sendMessage(contactJid, {
  audio: oggBuffer,
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true,
});
```

**Baileys internal behavior (verified from messages.js line 16):**
- Default mimetype for audio type is `'audio/ogg; codecs=opus'` — Baileys MIMETYPE_MAP
- Setting `ptt: true` triggers waveform computation (Baileys reads audio waveform from the buffer)
- No manual `seconds` field needed — Baileys computes duration automatically

### Pattern 5: `recording` Presence Indicator

**What:** Send the "recording..." microphone indicator to the contact before starting the voice pipeline.

**Verified from Baileys Socket/chats.js lines 519-520:**
```typescript
// Baileys internally translates 'recording' to:
// <chatstate><composing media="audio"/></chatstate>
// This renders as the microphone/recording indicator in WhatsApp

await sock.presenceSubscribe(contactJid);
await sock.sendPresenceUpdate('recording', contactJid);
// ... run pipeline ...
await sock.sendPresenceUpdate('paused', contactJid);
```

**WAPresence type (verified from Types/Chat.d.ts line 17):**
```typescript
type WAPresence = 'unavailable' | 'available' | 'composing' | 'recording' | 'paused';
```

### Pattern 6: Global Voice Toggle Check

**What:** `getSetting('voice_replies_enabled')` returns a string `'true'` or `'false'`. Default in DEFAULTS map is `'false'` (verified from settings.ts line 7).

```typescript
// Source: src/db/queries/settings.ts
import { getSetting } from '../db/queries/settings.js';

const globalVoiceEnabled = getSetting('voice_replies_enabled') === 'true';
if (!globalVoiceEnabled) {
  // Fall back to text reply with transcript
}
```

### Pattern 7: Per-Contact Voice Flag

**What:** `contact.voiceReplyEnabled` is a boolean (drizzle `mode: 'boolean'` over SQLite integer). Verified from schema.ts line 30-33.

```typescript
// Source: src/db/schema.ts lines 30-33
// voiceReplyEnabled: integer('voice_reply_enabled', { mode: 'boolean' }).notNull().default(false)

const contact = getContact(contactJid);
const voiceForContact = contact?.voiceReplyEnabled ?? false;
```

### Pattern 8: Transcript Persistence Before generateReply

**What:** `generateReply(contactJid)` reads the messages table via `getRecentMessages`. The transcript must be written to the DB before calling `generateReply` so it appears in the context window.

```typescript
// Source: src/ai/gemini.ts line 178 — generateReply reads DB
// Source: src/db/queries/messages.ts — insertMessage API

insertMessage({
  id: msg.key.id!,
  contactJid,
  fromMe: false,
  body: transcript,     // the transcribed text
  timestamp,
}).run();

// Now generateReply will include the transcript in context
const reply = await generateReply(contactJid);
```

### Pattern 9: handleVoiceMessage Full Flow

```typescript
async function handleVoiceMessage(
  sock: WASocket,
  msg: WAMessage,
  contactJid: string,
): Promise<void> {
  // 1. Auto-create contact if new
  const pushName = msg.pushName ?? null;
  upsertContact(contactJid, pushName);

  // 2. Check contact mode — skip if off
  const contact = getContact(contactJid);
  const mode = contact?.mode ?? 'off';
  if (mode === 'off') return;

  // 3. Snooze check
  if (isSnoozeActive(contact ?? {})) return;

  // 4. Signal "recording" presence
  await sock.presenceSubscribe(contactJid);
  await sock.sendPresenceUpdate('recording', contactJid);

  // 5. Download audio
  const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;

  // 6. Transcribe
  const transcript = await transcribe(audioBuffer, logger);

  // 7. Persist transcript to DB (so generateReply has context)
  const timestamp = /* compute from msg.messageTimestamp */;
  insertMessage({
    id: msg.key.id!,
    contactJid,
    fromMe: false,
    body: transcript,
    timestamp,
  }).run();

  // 8. Generate AI reply
  const reply = await generateReply(contactJid);
  if (!reply) {
    await sock.sendPresenceUpdate('paused', contactJid);
    return;
  }

  // 9. Check voice flags
  const globalVoiceOn = getSetting('voice_replies_enabled') === 'true';
  const contactVoiceOn = contact?.voiceReplyEnabled ?? false;

  if (globalVoiceOn && contactVoiceOn && mode === 'auto') {
    // 10a. TTS + PTT send
    const oggBuffer = await textToSpeech(reply, logger);
    await sock.sendPresenceUpdate('paused', contactJid);
    await sock.sendMessage(contactJid, {
      audio: oggBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });
    // Track auto reply
    lastAutoReplyTime.set(contactJid, Date.now());
    incrementAutoCount(contactJid).run();
  } else {
    // 10b. Text reply fallback (voice disabled for contact or globally)
    await sock.sendPresenceUpdate('paused', contactJid);
    await sendWithDelay(sock, contactJid, reply);
  }
}
```

### Anti-Patterns to Avoid

- **Checking `ptt: true` on incoming to gate the pipeline:** WhatsApp sometimes delivers voice notes without `ptt: true` depending on client version. Gate on `audioMessage` presence, not `ptt` field.
- **Calling `generateReply` before `insertMessage`:** `generateReply` reads the DB — if transcript isn't persisted yet, the AI sees no incoming message and may generate a contextless reply or return null.
- **Omitting `presenceSubscribe` before `sendPresenceUpdate`:** The existing `sendWithDelay` pattern always calls `presenceSubscribe` first. Follow the same pattern for `recording` presence.
- **Using `downloadContentFromMessage` directly:** It returns a `Transform` stream and requires manual buffer accumulation. Use `downloadMediaMessage` with `'buffer'` type instead.
- **Applying cooldown to voice pipeline identically to text:** The cooldown check (`isCoolingDown`) is appropriate to apply, but presence update (`recording`) should fire immediately, before the cooldown check, so the user sees feedback.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio decryption | Custom AES-256-CBC decrypt | `downloadMediaMessage` | WhatsApp uses a multi-step media key derivation (HKDF); Baileys handles it |
| OGG/Opus encoding | Direct libopus Node bindings | `textToSpeech` from Phase 13 | Already implemented with ffmpeg-static |
| Transcription | Direct ElevenLabs HTTP | `transcribe` from Phase 13 | Already implemented with proper error handling |
| Buffer from stream | Manual for-await chunk collection | `downloadMediaMessage(msg, 'buffer', {})` | Baileys provides this directly |

**Key insight:** Phase 13 already built the hard parts. Phase 14 is purely wiring — download → transcribe → persist → reply → send. Do not re-implement any voice service logic.

## Common Pitfalls

### Pitfall 1: TypeScript Type Assertion for downloadMediaMessage Return

**What goes wrong:** TypeScript cannot infer the conditional type `Type extends "buffer" ? Buffer : Transform` when called with a string literal. Compilation error: `Type 'Buffer | Transform' is not assignable to type 'Buffer'`.

**Why it happens:** TypeScript conditional type narrowing on generic parameters has limits with `as const` inference.

**How to avoid:** Use explicit type assertion: `const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;`

**Warning signs:** TypeScript error about `Buffer | Transform` assignment.

### Pitfall 2: Missing presenceSubscribe Before sendPresenceUpdate

**What goes wrong:** `sendPresenceUpdate('recording', jid)` sends to a JID the socket hasn't subscribed to. May silently fail or send to wrong node.

**Why it happens:** WhatsApp requires presence subscription before chatstate updates per the Baileys implementation pattern (verified — `sendWithDelay` in sender.ts calls `presenceSubscribe` first).

**How to avoid:** Always call `await sock.presenceSubscribe(contactJid)` before `await sock.sendPresenceUpdate('recording', contactJid)`.

### Pitfall 3: Transcript Not Persisted Before generateReply

**What goes wrong:** `generateReply` returns null or generates a contextless reply because the messages table has no record of the incoming voice message.

**Why it happens:** `generateReply` calls `getRecentMessages(contactJid, 50)` which reads the DB. If transcript isn't inserted, `recentMessages.length === 0` and the function returns null immediately.

**How to avoid:** Call `insertMessage({ id, contactJid, fromMe: false, body: transcript, timestamp }).run()` before `generateReply`.

### Pitfall 4: Voice Pipeline Runs for Own Messages (fromMe)

**What goes wrong:** Bot tries to download and transcribe its own sent voice notes (if `fromMe: true` and `audioMessage` present). Causes noise and wasted API calls.

**Why it happens:** The voice branch fires before the `fromMe` check in the existing text path.

**How to avoid:** Check `!msg.key.fromMe` in the voice branch guard before routing to `handleVoiceMessage`.

### Pitfall 5: Group Audio Messages Hit Voice Pipeline

**What goes wrong:** Voice notes in tracked group chats attempt to enter the voice pipeline, which has no group-aware logic.

**Why it happens:** Voice branch fires before the group check.

**How to avoid:** Check `!remoteJid.endsWith('@g.us')` before routing to `handleVoiceMessage`. Group audio should be silently ignored (same as group text messages in non-tracked groups).

### Pitfall 6: PTT Send Fails With Wrong mimetype

**What goes wrong:** Audio renders as a document/file attachment, not a voice note bubble.

**Why it happens:** `ptt: true` alone may not be enough without the correct mimetype in some Baileys versions or WhatsApp clients.

**How to avoid:** Always set both `ptt: true` AND `mimetype: 'audio/ogg; codecs=opus'` explicitly. The OGG buffer from `textToSpeech` is already OGG/Opus containerized by ffmpeg (verified from tts.ts).

## Code Examples

Verified patterns from official sources (Baileys installed source):

### Import Pattern for downloadMediaMessage
```typescript
// Source: /node_modules/@whiskeysockets/baileys/lib/Utils/index.d.ts → re-exports from messages.d.ts
// Source: /node_modules/@whiskeysockets/baileys/lib/index.d.ts → re-exports Utils/index
import { downloadMediaMessage } from '@whiskeysockets/baileys';
```

### Audio Message Detection
```typescript
// Source: WAProto/index.d.ts — IAudioMessage interface
const audioMsg = msg.message?.audioMessage;
if (audioMsg && !msg.key.fromMe) {
  // Has audio and not sent by us
}
// audioMsg.ptt === true means it was a voice note (vs audio file)
// audioMsg.seconds — duration in seconds
// audioMsg.mimetype — e.g. 'audio/ogg; codecs=opus'
```

### Download to Buffer
```typescript
// Source: lib/Utils/messages.d.ts line 85
// downloadMediaMessage<"buffer">(...) returns Promise<Buffer>
const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;
```

### Send PTT Voice Note
```typescript
// Source: lib/Types/Message.d.ts lines 126-141 — AnyMediaMessageContent.audio
await sock.sendMessage(contactJid, {
  audio: oggBuffer,          // Buffer from textToSpeech()
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true,                 // renders as voice note bubble
});
```

### Recording Presence
```typescript
// Source: lib/Types/Chat.d.ts — WAPresence type
// Source: lib/Socket/chats.js line 519 — 'recording' → composing media="audio"
await sock.presenceSubscribe(contactJid);
await sock.sendPresenceUpdate('recording', contactJid);
// After reply sent:
await sock.sendPresenceUpdate('paused', contactJid);
```

### Global Voice Toggle
```typescript
// Source: src/db/queries/settings.ts — getSetting returns string | null
// Default for 'voice_replies_enabled' is 'false' (settings.ts DEFAULTS)
const globalVoiceEnabled = getSetting('voice_replies_enabled') === 'true';
```

### Contact voiceReplyEnabled
```typescript
// Source: src/db/schema.ts line 30-33
// integer('voice_reply_enabled', { mode: 'boolean' }).notNull().default(false)
const contact = getContact(contactJid);
const voiceForContact = contact?.voiceReplyEnabled ?? false;
// contact?.voiceId — per-contact ElevenLabs voice ID override (nullable)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `downloadContentFromMessage` + buffer assembly | `downloadMediaMessage(msg, 'buffer', {})` | Available in Baileys v4+ | Simpler, handles reupload retry |
| `sendMessage({ audio: buffer, ptt: true })` with default mimetype | Explicitly set `mimetype: 'audio/ogg; codecs=opus'` | Always correct | Prevents rendering as file attachment |
| Per-contact voice without global toggle | Global `voice_replies_enabled` setting + per-contact `voiceReplyEnabled` | Phase 12/13 design | Two-level enable: global off = all contacts get text |

## Open Questions

1. **Auto-cap and cooldown behavior for voice auto-replies**
   - What we know: Text auto-replies use `isCoolingDown` and `AUTO_CAP` cap with `incrementAutoCount`
   - What's unclear: Should voice pipeline also enforce cooldown and cap, or is it separate?
   - Recommendation: Apply the same cooldown/cap logic to voice auto-replies (treat voice same as text for rate limiting). The `recording` presence fires before cooldown check since it's immediate feedback.

2. **draft mode behavior for voice messages**
   - What we know: Phase 15 handles draft integration for voice. VOICE-01 through VOICE-05 are Phase 14 scope (auto mode only).
   - What's unclear: For Phase 14, what happens when `mode === 'draft'`?
   - Recommendation: For `mode === 'draft'`, send text reply via existing draft flow (transcript as the incoming body, reply as draft). This is consistent with CONF-02 — contacts without voice get text. Phase 15 adds proper voice draft queue.

3. **reuploadRequest context for downloadMediaMessage**
   - What we know: The 4th `ctx` parameter to `downloadMediaMessage` provides `reuploadRequest` for retrying expired CDN links (410/404).
   - What's unclear: The `reuploadRequest` callback requires `sock.requestMediaUpload` or equivalent — not documented clearly.
   - Recommendation: Omit `ctx` for Phase 14. If CDN expiry becomes an issue in production, add reupload support. The bot processes messages in near-real-time so CDN links should still be valid.

## Sources

### Primary (HIGH confidence)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Utils/messages.d.ts` — `downloadMediaMessage` signature
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Utils/messages.js` — `downloadMediaMessage` implementation (lines 790-836)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts` — `AnyMediaMessageContent` with audio/ptt fields (lines 126-130)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Types/Chat.d.ts` — `WAPresence` type (line 17)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Socket/chats.js` — `sendPresenceUpdate` with `'recording'` → `composing media="audio"` (lines 492-524)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/WAProto/index.d.ts` — `IAudioMessage` with `ptt` field (lines 5535-5553)
- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Utils/messages-media.d.ts` — `toBuffer`, `downloadContentFromMessage` (line 39, 88)
- `/home/yuval/whatsapp-bot/src/db/schema.ts` — `voiceReplyEnabled` column (lines 30-33)
- `/home/yuval/whatsapp-bot/src/db/queries/settings.ts` — `getSetting` and DEFAULTS with `voice_replies_enabled: 'false'`
- `/home/yuval/whatsapp-bot/src/db/queries/contacts.ts` — `getContact` return type
- `/home/yuval/whatsapp-bot/src/pipeline/messageHandler.ts` — existing code structure, insertion point at line 209
- `/home/yuval/whatsapp-bot/src/voice/transcriber.ts` — `transcribe(audioBuffer, logger)` signature
- `/home/yuval/whatsapp-bot/src/voice/tts.ts` — `textToSpeech(text, logger): Promise<Buffer>` signature

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all verified from installed Baileys source and existing project files
- Architecture: HIGH — insertion point and flow derived from reading actual messageHandler.ts
- Pitfalls: HIGH — derived from reading actual Baileys implementation code

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (Baileys is rc, check for API changes if upgrading version)

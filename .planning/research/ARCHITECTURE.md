# Architecture Research: Voice Feature Integration

**Domain:** Voice message handling for existing WhatsApp AI bot
**Researched:** 2026-02-28
**Confidence:** HIGH (existing codebase read in full; Baileys API verified from installed node_modules; ElevenLabs API confirmed via official docs)

---

## Context: Existing Architecture (Verified from Source)

Before describing what changes, here is what currently exists as verified by reading every relevant source file.

### Current Message Pipeline

```
Baileys WebSocket
    |
    | messages.upsert event
    v
createMessageHandler(sock)          [src/pipeline/messageHandler.ts]
    |
    | processMessage(sock, msg)
    v
getMessageText(msg)                 [returns null for non-text -- EARLY EXIT]
    |
    | text = conversation ?? extendedTextMessage.text ?? null
    v
Route by JID type:
    +-- @g.us --> group pipeline (groupMessageCallback)
    +-- fromMe + USER_JID --> handleOwnerCommand (snooze, approve/reject)
    +-- fromMe --> persist + resetAutoCount (live learning)
    +-- incoming contact message -->
            insertMessage()
            upsertContact()
            generateReply(contactJid)    [src/ai/gemini.ts]
                |
                v
            mode === 'auto'  --> sendWithDelay(sock, jid, text)
            mode === 'draft' --> createDraft() + notify owner via WhatsApp
```

### Key Existing Patterns to Preserve

**`getMessageText(msg)` is the gatekeeper.** It returns `null` for anything that is not `conversation` or `extendedTextMessage.text`. Voice messages have an `audioMessage` field instead -- they currently return `null` and are silently dropped at line 209 of `messageHandler.ts`: `if (text === null) return;`

**`sendWithDelay()`** currently calls `sock.sendMessage(jid, { text })` -- text only.

**Draft body** is stored as `text` in the `drafts` table. The `body` column is `text('body').notNull()`.

**Contact mode** is `'off' | 'draft' | 'auto'` -- voice feature respects this existing mode unchanged.

**`insertMessage()`** currently stores `body: text` -- transcription text replaces the audio content here.

**`generateReply()`** reads from `getRecentMessages(contactJid, 50)` -- all messages, including transcriptions stored as text, feed the AI context automatically.

---

## What Voice Integration Requires

### New Signal: `msg.message?.audioMessage`

Baileys exposes incoming voice messages through `msg.message?.audioMessage`. When `ptt === true`, it is a WhatsApp voice note. When `ptt === false`, it is an audio file attachment. Handle both identically -- both warrant transcription.

Detection (verified from Baileys TypeScript types in installed node_modules):
```typescript
const audioMsg = msg.message?.audioMessage;
const hasAudio = audioMsg != null;
const isVoiceNote = audioMsg?.ptt === true;
```

### Downloading Audio from Baileys

`downloadMediaMessage` is confirmed exported in installed `@whiskeysockets/baileys` 7.0.0-rc.9 (verified via `node -e "require('@whiskeysockets/baileys')"` in the project):

```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const buffer: Buffer = await downloadMediaMessage(
  msg,
  'buffer',
  {},
  { reuploadRequest: sock.updateMediaMessage },
);
```

Returns a `Buffer` of the raw OGG/Opus bytes. No intermediate file needed.

### Audio Format: No Conversion Required

WhatsApp voice messages use **OGG container with Opus codec** (`audio/ogg; codecs=opus`). ElevenLabs Scribe explicitly supports `audio/ogg` and `audio/opus` -- confirmed via official ElevenLabs speech-to-text documentation listing 18 supported audio formats including both OGG and Opus. **FFmpeg conversion is not needed and should not be introduced** (FFmpeg is not installed on this server, confirmed via `which ffmpeg` returning nothing).

### Sending PTT Back via Baileys

```typescript
await sock.sendMessage(jid, {
  audio: oggOpusBuffer,                    // Buffer from ElevenLabs TTS
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true,                               // Appears as voice note in WhatsApp
});
```

ElevenLabs TTS supports Opus output (`opus_48000_32`, `opus_48000_64` formats) -- the API returns binary OGG/Opus audio directly. Baileys accepts this buffer with `ptt: true`.

Known cosmetic issue: Baileys v6.7.9+ (including 7.0.0-rc.9) may show flat waveform on PTT messages. The message plays correctly -- waveform visualization is cosmetic only.

---

## New Components Required

### 1. `src/voice/transcriber.ts` -- NEW

Wraps ElevenLabs Scribe. Takes a `Buffer`, returns `string | null`. Pure function, no file I/O.

```typescript
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../config.js';

export async function transcribeAudio(buffer: Buffer): Promise<string | null> {
  const client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });
  const blob = new Blob([buffer], { type: 'audio/ogg' });
  const result = await client.speechToText.convert({
    file: blob,
    modelId: 'scribe_v1',
    // languageCode omitted -- auto-detect handles Hebrew + English
  });
  return result.text?.trim() || null;
}
```

Buffer in, transcription string out. The caller (messageHandler) owns the lifecycle -- no disk writes in this module.

### 2. `src/voice/tts.ts` -- NEW

Wraps ElevenLabs TTS. Takes `string` + voice ID, returns `Buffer`. Pure function.

```typescript
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../config.js';

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

export async function synthesizeSpeech(text: string, voiceId: string): Promise<Buffer> {
  const client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });
  const stream = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: 'eleven_multilingual_v2',
    outputFormat: 'opus_48000_32',    // OGG/Opus -- WhatsApp-compatible
  });
  return streamToBuffer(stream);
}
```

`outputFormat: 'opus_48000_32'` produces OGG/Opus directly. Baileys receives this buffer with `mimetype: 'audio/ogg; codecs=opus'` and `ptt: true`.

### 3. Modified `src/pipeline/messageHandler.ts` -- SURGICAL EXTENSION

Two changes with minimal surface area. The existing text path is entirely unchanged.

**Change 1: In `processMessage()`, add audio branch before the null guard:**

```typescript
async function processMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  let text = getMessageText(msg);

  // NEW: handle audio messages (voice notes and audio files)
  if (text === null && msg.message?.audioMessage) {
    await processAudioMessage(sock, msg);
    return;
  }

  if (text === null) return;   // existing guard -- all other non-text dropped
  // ... rest of existing logic: 100% unchanged ...
}
```

**Change 2: Add `processAudioMessage()` function to the module:**

```typescript
async function processAudioMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  const remoteJid = getRemoteJid(msg);
  if (!remoteJid) return;
  if (remoteJid.endsWith('@g.us')) return;   // groups: skip (no voice handling in groups)
  if (msg.key.fromMe) return;                // own audio messages: skip

  const timestamp = /* existing timestamp extraction logic */ Date.now();

  const contactJid = remoteJid;
  upsertContact(contactJid, msg.pushName ?? null);

  const contact = getContact(contactJid);
  const mode = contact?.mode ?? 'off';
  if (mode === 'off') return;
  if (isSnoozeActive(contact ?? {})) return;

  // Download audio buffer
  const audioBuffer = await downloadMediaMessage(
    msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage }
  );

  // Transcribe -- ElevenLabs Scribe
  const transcription = await transcribeAudio(audioBuffer);
  if (!transcription) return;

  // Store transcription as regular message (feeds generateReply context)
  insertMessage({
    id: msg.key.id!,
    contactJid,
    fromMe: false,
    body: transcription,
    timestamp,
  }).run();

  // Generate AI text reply (generateReply is UNCHANGED -- reads from messages table)
  const replyText = await generateReply(contactJid);
  if (!replyText) return;

  // Determine reply format
  const voiceReplyEnabled = contact?.voiceReplyEnabled ?? false;
  const voiceId = contact?.voiceId ?? config.ELEVENLABS_DEFAULT_VOICE_ID;

  if (mode === 'auto') {
    if (isCoolingDown(contactJid)) return;

    // Auto cap check + counter logic (reuse existing pattern)

    if (voiceReplyEnabled) {
      const audioReply = await synthesizeSpeech(replyText, voiceId);
      await sendVoiceWithDelay(sock, contactJid, audioReply, replyText);
    } else {
      await sendWithDelay(sock, contactJid, replyText);
    }
    lastAutoReplyTime.set(contactJid, Date.now());
    incrementAutoCount(contactJid).run();

  } else if (mode === 'draft') {
    const draftId = createDraft(contactJid, msg.key.id!, replyText);
    const name = contact?.name ?? contactJid;
    lastNotifiedJid = contactJid;
    await sock.sendMessage(config.USER_JID, {
      text: `[Voice] Draft for ${name}:\n\n${replyText}\n\nReply \u2705 to send | \u274c to reject`,
    });
    logger.info({ draftId, contactJid }, 'Draft created for voice message');
  }
}
```

### 4. Modified `src/whatsapp/sender.ts` -- EXTENDED

Add `sendVoiceWithDelay()` alongside existing `sendWithDelay()`. The existing function is untouched.

```typescript
export async function sendVoiceWithDelay(
  sock: WASocket,
  jid: string,
  audioBuffer: Buffer,
  textBody: string,    // spoken text -- persisted to messages table for AI context
): Promise<void> {
  await sock.presenceSubscribe(jid);
  await sock.sendPresenceUpdate('recording', jid);   // 'recording' = voice composing indicator

  const delay = randomDelay(1500, 4000);
  await sleep(delay);

  await sock.sendPresenceUpdate('paused', jid);

  const sent = await sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
  });

  if (sent?.key?.id) {
    insertMessage({
      id: sent.key.id,
      contactJid: jid,
      fromMe: true,
      body: textBody,        // text stored -- not the audio buffer
      timestamp: Date.now(),
    }).run();
  }
}
```

The `body` stored is always the text that was spoken, never the audio file. This preserves style learning: the AI reads text on both sides of the conversation regardless of how it was delivered.

### 5. Schema changes -- `src/db/schema.ts` EXTENDED

Two columns added to the `contacts` table. Drizzle migration handles the ALTER TABLE:

```typescript
export const contacts = sqliteTable('contacts', {
  // ... all existing columns unchanged ...
  voiceReplyEnabled: integer('voice_reply_enabled', { mode: 'boolean' }).default(false),
  voiceId: text('voice_id'),   // ElevenLabs voice ID for this contact; null = use default
});
```

No new tables. Audio is transient (never stored to disk). Transcriptions are stored as regular `messages` rows. The draft system stores text body regardless of whether a voice reply will be sent.

The `settings` table (already exists as key/value) stores the default voice ID without schema changes:
```typescript
setSetting('default_voice_id', 'ELEVENLABS_VOICE_ID_HERE');
```

### 6. Config additions -- `src/config.ts` EXTENDED

```typescript
const envSchema = z.object({
  // ... all existing fields unchanged ...
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'), // ElevenLabs Rachel
});
```

---

## Complete Data Flow

### Voice In --> Text Reply (default path)

```
Contact sends voice note
    |
    v
Baileys messages.upsert event
    |
    v
processMessage() in messageHandler.ts
    |
    | msg.message?.audioMessage present, text === null
    v
processAudioMessage()
    |
    | downloadMediaMessage() --> Buffer (OGG/Opus, in-memory only)
    v
transcribeAudio(buffer)           [src/voice/transcriber.ts]
    |
    | ElevenLabs Scribe v1 REST API (POST /v1/speech-to-text)
    | Sends OGG buffer directly as Blob -- no format conversion
    v
transcription: string
    |
    | insertMessage({ body: transcription, fromMe: false })
    | Buffer garbage collected after this point
    v
generateReply(contactJid)         [src/ai/gemini.ts -- COMPLETELY UNCHANGED]
    |
    | reads getRecentMessages() including transcription as text
    v
replyText: string
    |
    | voiceReplyEnabled === false OR mode === 'draft'
    v
sendWithDelay(sock, jid, replyText)         [text reply -- existing function]
    OR
createDraft(contactJid, msgId, replyText)   [draft -- existing function]
```

### Voice In --> Voice Reply

```
[same through generateReply()]
    |
    | voiceReplyEnabled === true AND mode === 'auto'
    v
synthesizeSpeech(replyText, voiceId)  [src/voice/tts.ts]
    |
    | ElevenLabs TTS API (POST /v1/text-to-speech/{voice_id})
    | outputFormat: 'opus_48000_32' --> OGG/Opus Buffer
    v
audioBuffer: Buffer
    |
    v
sendVoiceWithDelay(sock, jid, audioBuffer, replyText)
    |
    | sock.sendPresenceUpdate('recording', jid)
    | sleep(1500-4000ms)
    | sock.sendMessage(jid, { audio: audioBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' })
    | insertMessage({ body: replyText, fromMe: true })   <-- text stored, not audio
    v
Contact receives voice note
```

### Draft Approval with Voice Send Option

The draft queue stores **text only** (existing schema unchanged). The approval endpoint receives a `sendAsVoice: boolean` flag added to the request body. If true, it synthesizes audio before sending. If false, existing text send behavior:

```typescript
// PATCH /api/drafts/:id/approve
const { body, sendAsVoice } = request.body as { body: string; sendAsVoice?: boolean };

if (sendAsVoice) {
  const contact = db.select().from(contacts).where(eq(contacts.jid, draft.contactJid)).get();
  const voiceId = contact?.voiceId ?? config.ELEVENLABS_DEFAULT_VOICE_ID;
  const audioBuffer = await synthesizeSpeech(body, voiceId);
  await sock.sendMessage(draft.contactJid, {
    audio: audioBuffer,
    ptt: true,
    mimetype: 'audio/ogg; codecs=opus',
  });
  insertMessage({ id: randomUUID(), contactJid: draft.contactJid, fromMe: true, body, timestamp: Date.now() }).run();
} else {
  await sock.sendMessage(draft.contactJid, { text: body });
}
await markDraftSent(id);
```

---

## Component Summary: New vs Modified vs Unchanged

| Component | Status | Nature of Change |
|-----------|--------|-----------------|
| `src/voice/transcriber.ts` | NEW | ElevenLabs STT wrapper -- pure function |
| `src/voice/tts.ts` | NEW | ElevenLabs TTS wrapper -- pure function |
| `src/pipeline/messageHandler.ts` | MODIFIED | Add `processAudioMessage()` function; add audio branch in `processMessage()` before null guard; existing text path untouched |
| `src/whatsapp/sender.ts` | MODIFIED | Add `sendVoiceWithDelay()` alongside existing `sendWithDelay()` |
| `src/db/schema.ts` | MODIFIED | Add `voiceReplyEnabled`, `voiceId` columns to contacts table |
| `src/config.ts` | MODIFIED | Add `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` |
| `src/api/routes/drafts.ts` | MODIFIED | Add `sendAsVoice` flag to approve endpoint; conditional TTS call |
| `src/api/routes/contacts.ts` | MODIFIED | Accept `voiceReplyEnabled` and `voiceId` in PATCH body |
| `src/ai/gemini.ts` | UNCHANGED | `generateReply()` reads from messages table; transcriptions look like text |
| `src/db/queries/messages.ts` | UNCHANGED | `insertMessage()` used as-is for transcriptions |
| `src/db/queries/drafts.ts` | UNCHANGED | Draft stores text body; approval path change is in routes only |
| `src/db/queries/contacts.ts` | UNCHANGED (interface) | Drizzle infers new columns automatically after schema change |
| `src/whatsapp/connection.ts` | UNCHANGED | No socket configuration changes needed |
| `src/index.ts` | UNCHANGED | No new subsystem to initialize |
| Dashboard contacts page | MODIFIED (lightly) | Add voice reply toggle + voice ID input field |
| Dashboard drafts page | MODIFIED (lightly) | Add "Send as Voice" button on approve action |
| CLI | UNCHANGED | Voice is dashboard/API-managed; no CLI changes needed |

---

## Recommended Project Structure (additions only)

```
src/
+-- voice/                          NEW DIRECTORY
|   +-- transcriber.ts              ElevenLabs STT: Buffer -> string
|   +-- tts.ts                      ElevenLabs TTS: string -> Buffer
+-- pipeline/
|   +-- messageHandler.ts           MODIFIED: add audio branch + processAudioMessage()
+-- whatsapp/
|   +-- sender.ts                   MODIFIED: add sendVoiceWithDelay()
+-- db/
|   +-- schema.ts                   MODIFIED: 2 new contacts columns
+-- config.ts                       MODIFIED: ELEVENLABS_* env vars
+-- api/
    +-- routes/
        +-- drafts.ts               MODIFIED: sendAsVoice flag on approve
        +-- contacts.ts             MODIFIED: voiceReplyEnabled, voiceId in PATCH

data/
  (no audio/ directory -- audio processed in-memory, never written to disk)
```

---

## Architectural Patterns

### Pattern 1: Audio as Ephemeral In-Memory Data

**What:** Download audio buffer, transcribe, discard the buffer. Never write OGG files to disk.

**When to use:** Always for this use case. WhatsApp voice notes are typically 10-120 seconds, producing 50-500KB buffers. Processing in-memory is simpler, faster, and avoids all file cleanup complexity.

**Trade-offs:** A crash mid-transcription loses the audio. Acceptable -- the WhatsApp message is already delivered to the device, and the contact's message history still exists in WhatsApp if needed.

```typescript
const buffer = await downloadMediaMessage(msg, 'buffer', {}, opts);
const text = await transcribeAudio(buffer);
// buffer eligible for GC from here
```

### Pattern 2: Transcription Stored as Regular Text Message

**What:** Store the transcribed text in the `messages` table with `body = transcription`. Treat it identically to a typed text message for all downstream processing.

**Why this is the only correct approach:** `generateReply()` reads from `getRecentMessages(contactJid, 50)`. If transcriptions are stored in a separate location, the AI has no context from voice exchanges and generates incoherent replies. By storing transcriptions in `messages`, the entire AI pipeline requires zero changes.

**Trade-offs:** No distinction in the DB between typed and spoken messages. Not needed -- the AI reply quality is unchanged either way.

### Pattern 3: Text Stored for Voice Replies

**What:** When the bot sends a voice reply, persist the **text** (what was said) to the `messages` table -- not the audio buffer.

**Why this matters:** `generateReply()` builds AI context from `messages.body`. If voice reply bodies were empty or null, the AI loses track of what it said and generates inconsistent follow-ups.

**Example:**
```typescript
// sendVoiceWithDelay stores the text, not the audio:
insertMessage({ id: sent.key.id, contactJid: jid, fromMe: true, body: textBody, timestamp }).run();
```

### Pattern 4: Surgical Branch Before Existing Guard

**What:** Add the audio handling branch in `processMessage()` immediately before the `if (text === null) return` guard, not after and not inside it.

**Why:** This is the least invasive integration point. The existing guard still handles all non-text, non-audio messages (reactions, documents, etc.) exactly as before. Only audio messages are intercepted.

```typescript
// BEFORE existing guard:
if (text === null && msg.message?.audioMessage) {
  await processAudioMessage(sock, msg);
  return;
}
if (text === null) return;  // existing -- all other non-text dropped
// ... existing text path: untouched ...
```

### Pattern 5: Per-Contact Voice Configuration with Global Default

**What:** Store `voiceId` (ElevenLabs voice ID) on the contact row. Fall back to `config.ELEVENLABS_DEFAULT_VOICE_ID` when null.

**When:** When `voiceReplyEnabled === true` for a contact.

**Trade-offs:** Requires per-contact configuration in the dashboard for custom voices. Default voice covers all contacts without individual setup.

---

## Integration Points

### External Services

| Service | Integration Pattern | Confidence | Notes |
|---------|---------------------|------------|-------|
| ElevenLabs Scribe v1 | `client.speechToText.convert({ file: Blob, modelId: 'scribe_v1' })` via `@elevenlabs/elevenlabs-js` | MEDIUM | SDK method signature confirmed via official GitHub + DeepWiki; OGG/Opus format support confirmed via official docs. Hands-on test pending. |
| ElevenLabs TTS | `client.textToSpeech.convert(voiceId, { outputFormat: 'opus_48000_32' })` via `@elevenlabs/elevenlabs-js` | MEDIUM | Output format list confirmed via official API docs (28 formats, Opus included). TTS returns ReadableStream -- needs buffer assembly. |
| Baileys download | `downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })` | HIGH | Confirmed exported in installed node_modules; download pattern from real-world implementations. |
| Baileys send PTT | `sock.sendMessage(jid, { audio: Buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' })` | HIGH | Type confirmed from Baileys TypeScript definitions in installed node_modules. Known cosmetic waveform issue in 7.x is non-breaking. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `messageHandler` --> `voice/transcriber` | Direct async function call | Synchronous call within `processAudioMessage()` |
| `messageHandler` --> `voice/tts` | Direct async function call | Only when `voiceReplyEnabled && mode === 'auto'` |
| `api/routes/drafts` --> `voice/tts` | Direct async function call | Only on `sendAsVoice: true` approval |
| `voice/*` --> `config` | Module import | Same pattern as `gemini.ts` using `config.GEMINI_API_KEY` |
| Existing text path | Entirely unchanged | All existing text message handling proceeds as before; zero coupling to voice code |

---

## Build Order (Dependency Graph)

Dependencies flow in this order. Each phase unblocks the next.

```
Phase A: Foundation (no dependencies -- do these first)
    +-- config.ts: add ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID
    +-- schema.ts: add voiceReplyEnabled + voiceId columns to contacts
    +-- npm install @elevenlabs/elevenlabs-js
    +-- Drizzle migration: db:generate + db:migrate

Phase B: Voice services (depends on Phase A config)
    +-- src/voice/transcriber.ts    (depends on config, ElevenLabs SDK)
    +-- src/voice/tts.ts            (depends on config, ElevenLabs SDK)

Phase C: Pipeline integration (depends on Phase B)
    +-- messageHandler.ts: add processAudioMessage()  (depends on transcriber + tts + schema)
    +-- sender.ts: add sendVoiceWithDelay()            (depends on tts)

Phase D: API layer (depends on Phase A schema + Phase B tts)
    +-- api/routes/contacts.ts: voiceReplyEnabled, voiceId fields in PATCH
    +-- api/routes/drafts.ts: sendAsVoice flag on approve endpoint

Phase E: Dashboard (depends on Phase D -- API endpoints must exist)
    +-- Contacts page: voice reply toggle + voice ID field
    +-- Drafts page: "Send as Voice" button on approve
```

**Rationale for this ordering:**

1. Schema first -- Drizzle migration must run before any code accesses `voiceReplyEnabled`
2. Voice services before pipeline -- `processAudioMessage()` imports both transcriber and tts
3. Pipeline before API -- the draft approval TTS call is the same module as the pipeline TTS call; test it in the pipeline first
4. API before dashboard -- dashboard calls API endpoints that must exist
5. Dashboard last -- additive to existing UI; the bot works fully without dashboard changes

**Phase C is the riskiest.** It modifies `messageHandler.ts`, the most critical file in the bot. The change is surgical (one new function, one 4-line branch), but it warrants careful testing: verify that existing text messages still process identically after the change, before testing audio handling.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Writing Audio Files to Disk

**What people do:** Write OGG files to `data/audio/`, process them, then schedule cleanup.

**Why it's wrong:** Creates a cleanup job, a file-naming scheme, and a failure mode (disk full, cleanup fails, stale files accumulate). WhatsApp voice notes are 50KB-2MB -- easily handled in-memory.

**Do this instead:** `downloadMediaMessage(msg, 'buffer')` -- stay in-memory. Node.js GC handles cleanup automatically.

### Anti-Pattern 2: Converting Audio Format Before Transcription

**What people do:** Run FFmpeg to convert OGG/Opus to WAV before sending to the STT API.

**Why it's wrong:** (a) FFmpeg is not installed on this server. (b) ElevenLabs Scribe explicitly supports `audio/ogg` and `audio/opus`. Adding a conversion step introduces a system dependency (FFmpeg) and a processing step with no benefit.

**Do this instead:** Send the OGG buffer directly as a `Blob` with `type: 'audio/ogg'`. If transcription fails for format reasons (which the docs say won't happen), investigate then -- don't pre-optimize.

### Anti-Pattern 3: Separate Storage for Voice Transcriptions

**What people do:** Create a `voice_transcriptions` table and join it when building AI context.

**Why it's wrong:** `generateReply()` reads from `getRecentMessages(contactJid, 50)` in the `messages` table. Transcriptions stored elsewhere are invisible to the AI. The AI loses voice context and generates incoherent follow-ups.

**Do this instead:** Store transcriptions as `body` in the existing `messages` table. The AI sees them as text messages and maintains full conversation context.

### Anti-Pattern 4: Making `getMessageText()` Async for Transcription

**What people do:** Extend the text extraction function to return transcriptions (requiring it to become async).

**Why it's wrong:** `getMessageText()` is synchronous and called at the top of `processMessage()`. Making it async would restructure the entire control flow. Transcription takes 200-1000ms and belongs in its own branch, not in the message text extraction step.

**Do this instead:** Add a separate `processAudioMessage()` function and branch before the null guard -- parallel path, not merged.

### Anti-Pattern 5: Skipping Text Persistence for Voice Replies

**What people do:** Call `sock.sendMessage()` with audio and omit `insertMessage()` for the sent message.

**Why it's wrong:** The AI uses `getRecentMessages()` to build conversation context. If voice replies aren't persisted as text, the AI doesn't know what it said on the previous turn and produces inconsistent follow-ups.

**Do this instead:** Always call `insertMessage({ body: textBody, fromMe: true })` after sending a voice reply, where `textBody` is the text that was synthesized.

---

## Scaling Considerations

This is a personal bot (single user, ~20-100 contacts). Scaling concern is API latency, not throughput.

| Concern | At personal scale | Notes |
|---------|------------------|-------|
| STT latency | +200-800ms per voice message | Added to existing processing time; acceptable for async WhatsApp replies |
| TTS latency | +500-1500ms per voice reply | Only when voiceReplyEnabled; stacked on top of existing `sendWithDelay` 1.5-4s |
| Simultaneous transcriptions | 1-3 maximum likely | Contacts are unlikely to send voice messages simultaneously |
| ElevenLabs API costs | STT billed per audio hour; TTS billed per character | At personal bot scale, negligible |
| Audio buffer memory | 50KB-2MB per in-flight message | Trivial; GC'd within seconds of transcription completing |
| ElevenLabs rate limits | Not documented in official docs | Unlikely to hit at personal scale |

---

## Sources

- `downloadMediaMessage` -- confirmed exported in `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/index.js` (runtime inspection via `node -e`)
- Baileys audio message types -- `/home/yuval/whatsapp-bot/node_modules/@whiskeysockets/baileys/lib/Types/Message.d.ts` lines 126-130 (read directly from installed node_modules)
- Baileys PTT send pattern -- confirmed from Baileys TypeScript type `{ audio: WAMediaUpload; ptt?: boolean; }` in Message.d.ts; community-confirmed pattern from [WhiskeySockets/Baileys issues](https://github.com/WhiskeySockets/Baileys/issues/501)
- ElevenLabs STT supported formats -- [ElevenLabs Speech-to-Text capabilities](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) -- OGG and Opus explicitly listed among 18 supported audio formats (HIGH confidence)
- ElevenLabs TTS output formats -- [ElevenLabs TTS API reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) -- 28 output formats confirmed including `opus_48000_32` (HIGH confidence)
- ElevenLabs Node.js SDK -- [elevenlabs/elevenlabs-js GitHub](https://github.com/elevenlabs/elevenlabs-js); package `@elevenlabs/elevenlabs-js`; methods `client.speechToText.convert()` and `client.textToSpeech.convert()` (MEDIUM confidence -- SDK docs verified, not hands-on tested)
- fluent-ffmpeg archived May 2025 -- [fluent-ffmpeg/node-fluent-ffmpeg GitHub](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg); FFmpeg not installed on server (verified via shell)
- [René Roth: WhatsApp voice transcription with Baileys](https://reneroth.xyz/whatsapp-voice-messages-automatic-transcript/) -- `downloadMediaMessage()` buffer download pattern (MEDIUM confidence)
- All existing source files -- read directly from `/home/yuval/whatsapp-bot/src/` (HIGH confidence)

---
*Architecture research for: Voice feature integration -- WhatsApp bot (subsequent milestone)*
*Researched: 2026-02-28*

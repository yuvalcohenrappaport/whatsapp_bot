import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { insertMessage } from '../db/queries/messages.js';
import {
  getContact,
  upsertContact,
  updateContactMode,
  setSnoozeUntil,
  incrementAutoCount,
  resetAutoCount,
} from '../db/queries/contacts.js';
import {
  createDraft,
  getLatestPendingDraft,
  markDraftSent,
  markDraftRejected,
} from '../db/queries/drafts.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { sendWithDelay, sendVoiceWithDelay } from '../whatsapp/sender.js';
import { transcribe } from '../voice/transcriber.js';
import { textToSpeech } from '../voice/tts.js';
import { getSetting } from '../db/queries/settings.js';
import { generateReply } from '../ai/gemini.js';
import { getGroup } from '../db/queries/groups.js';
import { insertGroupMessage } from '../db/queries/groupMessages.js';

const logger = pino({ level: config.LOG_LEVEL });

// --- Module-level state ---

/** In-memory map of JID → timestamp (ms) of last auto-reply. Ephemeral — resets on restart. */
const lastAutoReplyTime = new Map<string, number>();

/** In-memory map of JID → timestamp (ms) of first auto-reply in current counting window. */
const autoCountWindowStart = new Map<string, number>();

/** Minimum milliseconds between auto-replies to the same contact. */
const COOLDOWN_MS = 5_000; // 5 seconds

/** Maximum consecutive auto-replies before switching to draft mode. */
const AUTO_CAP = 20;

/** Auto-reply counter resets after this many milliseconds. */
const AUTO_COUNT_RESET_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Tracks which contact the bot most recently sent a notification about.
 * Used to know which contact to snooze/resume when the user replies "snooze" or "resume".
 * Module-scoped — always refers to the most recently notified contact.
 */
let lastNotifiedJid: string | null = null;

// --- Group message callback hook ---

/** Callback for downstream pipeline (e.g., date extraction, travel search) to process group messages. */
let groupMessageCallback: ((
  groupJid: string,
  msg: { id: string; senderJid: string; senderName: string | null; body: string; timestamp: number },
  quotedMessageId: string | null,
  mentionedJids: string[],
) => void) | null = null;

/** Register a callback to be invoked after each group message is persisted. */
export function setGroupMessageCallback(
  cb: typeof groupMessageCallback,
) {
  groupMessageCallback = cb;
}

// --- Helper functions ---

function getMessageText(msg: WAMessage): string | null {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    null
  );
}

function getRemoteJid(msg: WAMessage): string | null {
  const jid = msg.key.remoteJid;
  if (!jid) return null;
  if (jid === 'status@broadcast') return null;
  return jid;
}

/**
 * Parse a "snooze" command text and return duration in milliseconds, or null if no match.
 * Supported: "snooze" (1h default), "snooze 2h", "snooze 30m", "snooze 1d"
 */
function parseSnoozeCommand(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'snooze') return 60 * 60 * 1000; // 1 hour default

  const match = trimmed.match(/^snooze\s+(\d+)(m|h|d)$/i);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  return null;
}

/** Returns true if the contact is currently snoozed. */
function isSnoozeActive(contact: { snoozeUntil?: number | null }): boolean {
  if (contact.snoozeUntil == null) return false;
  return Date.now() < contact.snoozeUntil;
}

/** Returns true if the contact is within the cooldown window for auto-replies. */
function isCoolingDown(jid: string): boolean {
  const lastTime = lastAutoReplyTime.get(jid);
  if (lastTime === undefined) return false;
  return Date.now() - lastTime < COOLDOWN_MS;
}

/**
 * Handle commands sent by the bot owner to their own WhatsApp number.
 * Covers: snooze, resume/unsnooze, draft approval (✅/❌).
 * Returns true if the text was a recognised command (even if no draft was pending).
 */
async function handleOwnerCommand(
  sock: WASocket,
  text: string,
): Promise<boolean> {
  const trimmed = text.trim().toLowerCase();

  // --- Snooze command ---
  const snoozeMs = parseSnoozeCommand(trimmed);
  if (snoozeMs !== null) {
    if (!lastNotifiedJid) {
      await sock.sendMessage(config.USER_JID, {
        text: 'No recent contact to snooze. Send a message first to get a notification.',
      });
      return true;
    }
    const until = Date.now() + snoozeMs;
    setSnoozeUntil(lastNotifiedJid, until).run();
    const name = getContact(lastNotifiedJid)?.name ?? lastNotifiedJid;
    const durationLabel = text.replace(/snooze\s*/i, '').trim() || '1h';
    await sock.sendMessage(config.USER_JID, {
      text: `Snoozed ${name} for ${durationLabel}.`,
    });
    return true;
  }

  // --- Resume / unsnooze command ---
  if (trimmed === 'resume' || trimmed === 'unsnooze') {
    if (!lastNotifiedJid) {
      await sock.sendMessage(config.USER_JID, {
        text: 'No recent contact to resume.',
      });
      return true;
    }
    setSnoozeUntil(lastNotifiedJid, null).run();
    const name = getContact(lastNotifiedJid)?.name ?? lastNotifiedJid;
    await sock.sendMessage(config.USER_JID, {
      text: `Resumed notifications for ${name}.`,
    });
    return true;
  }

  // --- Draft approval (✅ / ❌) ---
  const approvalTrimmed = text.trim();
  if (approvalTrimmed !== '✅' && approvalTrimmed !== '❌') return false;

  const draft = getLatestPendingDraft();
  if (!draft) {
    await sock.sendMessage(config.USER_JID, {
      text: 'No pending drafts to action.',
    });
    return true;
  }

  if (approvalTrimmed === '✅') {
    markDraftSent(draft.id);
    await sendWithDelay(sock, draft.contactJid, draft.body);
    // Reset auto count on draft approval per locked decision
    resetAutoCount(draft.contactJid).run();
    await sock.sendMessage(config.USER_JID, {
      text: `Sent to ${draft.contactJid}.`,
    });
  } else {
    markDraftRejected(draft.id);
    await sock.sendMessage(config.USER_JID, {
      text: 'Draft rejected.',
    });
  }

  return true;
}

/**
 * Creates the messages.upsert event handler.
 */
export function createMessageHandler(sock: WASocket) {
  return async ({ messages }: { messages: WAMessage[] }) => {
    for (const msg of messages) {
      try {
        await processMessage(sock, msg);
      } catch (err) {
        logger.error({ err, msgId: msg.key.id }, 'Error processing message');
      }
    }
  };
}

async function processMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  const text = getMessageText(msg);

  // Voice branch — handle audio messages before the text null guard
  const audioMsg = msg.message?.audioMessage;
  if (audioMsg && !(msg.key.fromMe ?? false)) {
    const remoteJid = getRemoteJid(msg);
    if (remoteJid && !remoteJid.endsWith('@g.us')) {
      await handleVoiceMessage(sock, msg, remoteJid);
      return;
    }
  }

  if (text === null) return; // skip non-text messages

  const remoteJid = getRemoteJid(msg);
  if (!remoteJid) return; // skip broadcasts

  const fromMe = msg.key.fromMe ?? false;

  // Compute timestamp early — needed for both incoming and outgoing message persistence
  const timestamp = msg.messageTimestamp
    ? typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp * 1000
      : Number(msg.messageTimestamp) * 1000
    : Date.now();

  // Group messages: persist tracked group messages with sender info
  if (remoteJid.endsWith('@g.us')) {
    // Only process messages from tracked, active groups
    const group = getGroup(remoteJid);
    if (!group || group.active !== true) {
      return; // Silently drop non-tracked/inactive group messages
    }

    // Extract sender info from Baileys group message structure
    const senderJid = msg.key.participant ?? '';
    const senderName = msg.pushName ?? null;

    // Extract reply/mention context (needed for travel handler even on fromMe)
    const quotedMessageId =
      msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? null;
    const mentionedJids: string[] =
      (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid as string[] | undefined) ?? [];

    // Skip persistence and date extraction for own messages,
    // but still invoke the downstream pipeline callback so travel @mentions work
    // (the bot runs on the user's own account, so user messages are fromMe)
    if (fromMe) {
      groupMessageCallback?.(
        remoteJid,
        { id: msg.key.id!, senderJid, senderName, body: text, timestamp },
        quotedMessageId,
        mentionedJids,
      );
      return;
    }

    // Persist to dedicated groupMessages table
    insertGroupMessage({
      id: msg.key.id!,
      groupJid: remoteJid,
      senderJid,
      senderName,
      fromMe,
      body: text,
      timestamp,
    }).run();

    // Invoke downstream pipeline callback (e.g., date extraction, travel search)
    groupMessageCallback?.(
      remoteJid,
      { id: msg.key.id!, senderJid, senderName, body: text, timestamp },
      quotedMessageId,
      mentionedJids,
    );

    return;
  }

  const contactJid = remoteJid;

  // Self-message to own chat: route to owner command handler (draft approval, snooze, etc.)
  if (fromMe && contactJid === config.USER_JID) {
    await handleOwnerCommand(sock, text);
    return;
  }

  // Outgoing messages to regular contacts: persist for live style learning and reset auto count
  if (fromMe) {
    if (contactJid !== config.USER_JID) {
      insertMessage({
        id: msg.key.id!,
        contactJid,
        fromMe: true,
        body: text,
        timestamp,
      }).run();
      resetAutoCount(contactJid).run();
      logger.debug(
        { contactJid },
        'Persisted manual message for live learning, reset auto count',
      );
    }
    return;
  }

  // --- Incoming message from a contact ---

  // Persist incoming message (dedup via onConflictDoNothing)
  insertMessage({
    id: msg.key.id!,
    contactJid,
    fromMe: false,
    body: text,
    timestamp,
  }).run();

  // Auto-create contact if new
  const pushName = msg.pushName ?? null;
  upsertContact(contactJid, pushName);

  // Route by contact mode
  const contact = getContact(contactJid);
  const mode = contact?.mode ?? 'off';

  if (mode === 'off') return;

  // Snooze check — applies to both draft and auto modes.
  // Message is already persisted above; just skip reply generation.
  if (isSnoozeActive(contact ?? {})) {
    logger.debug({ contactJid }, 'Contact snoozed — skipping reply generation');
    return;
  }

  const reply = await generateReply(contactJid);
  if (!reply) return;

  if (mode === 'auto') {
    // Check cooldown
    if (isCoolingDown(contactJid)) {
      logger.debug({ contactJid }, 'Cooldown active — skipping auto-reply');
      return;
    }

    // Reset counter if 30-minute window has elapsed
    const windowStart = autoCountWindowStart.get(contactJid);
    if (windowStart && Date.now() - windowStart >= AUTO_COUNT_RESET_MS) {
      resetAutoCount(contactJid).run();
      autoCountWindowStart.delete(contactJid);
      logger.debug({ contactJid }, 'Auto-reply counter reset (30min window elapsed)');
    }

    // Check consecutive cap
    const freshContact = getContact(contactJid);
    const autoCount = freshContact?.consecutiveAutoCount ?? 0;
    if (autoCount >= AUTO_CAP) {
      // Cap reached — switch to draft mode, notify owner
      updateContactMode(contactJid, 'draft');
      resetAutoCount(contactJid).run();
      const name = contact?.name ?? contactJid;
      lastNotifiedJid = contactJid;
      await sock.sendMessage(config.USER_JID, {
        text: `Paused auto-reply for ${name} after ${AUTO_CAP} replies — switching to draft mode. Reply 'snooze 1h' to pause ${name}.`,
      });
      logger.info(
        { contactJid },
        'Auto-reply cap reached — switched to draft mode',
      );
      return;
    }

    // All clear — send auto-reply
    await sendWithDelay(sock, contactJid, reply);
    lastAutoReplyTime.set(contactJid, Date.now());
    if (!autoCountWindowStart.has(contactJid)) {
      autoCountWindowStart.set(contactJid, Date.now());
    }
    incrementAutoCount(contactJid).run();
  } else if (mode === 'draft') {
    const draftId = createDraft(contactJid, msg.key.id!, reply);
    const name = contact?.name ?? contactJid;
    lastNotifiedJid = contactJid;
    await sock.sendMessage(config.USER_JID, {
      text: `Draft for ${name}:\n\n${reply}\n\nReply \u2705 to send | \u274c to reject | 'snooze 1h' to pause ${name}`,
    });
    logger.info({ draftId, contactJid }, 'Draft created for approval');
  }
}

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
  if (isSnoozeActive(contact ?? {})) {
    logger.debug({ contactJid }, 'Contact snoozed — skipping voice reply');
    return;
  }

  // 4. Signal "recording" presence immediately (user feedback)
  await sock.presenceSubscribe(contactJid);
  await sock.sendPresenceUpdate('recording', contactJid);

  try {
    // 5. Download audio from WhatsApp servers
    const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;
    logger.debug({ contactJid, bytes: audioBuffer.length, ptt: msg.message?.audioMessage?.ptt }, 'voice message downloaded');

    // 6. Transcribe to text
    const transcript = await transcribe(audioBuffer, logger);
    if (!transcript || transcript.trim().length === 0) {
      logger.warn({ contactJid }, 'Empty transcription — skipping reply');
      await sock.sendPresenceUpdate('paused', contactJid);
      return;
    }
    logger.info({ contactJid, transcriptLength: transcript.length }, 'voice message transcribed');

    // 7. Compute timestamp for persistence
    const timestamp = msg.messageTimestamp
      ? typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp * 1000
        : Number(msg.messageTimestamp) * 1000
      : Date.now();

    // 8. Persist transcript to DB — BEFORE generateReply (it reads from DB)
    insertMessage({
      id: msg.key.id!,
      contactJid,
      fromMe: false,
      body: transcript,
      timestamp,
    }).run();

    // 9. Generate AI reply
    const reply = await generateReply(contactJid);
    if (!reply) {
      await sock.sendPresenceUpdate('paused', contactJid);
      return;
    }

    // 10. Determine voice vs text reply
    const globalVoiceOn = getSetting('voice_replies_enabled') === 'true';
    const contactVoiceOn = contact?.voiceReplyEnabled ?? false;

    if (mode === 'auto') {
      // Cooldown check
      if (isCoolingDown(contactJid)) {
        logger.debug({ contactJid }, 'Cooldown active — skipping voice auto-reply');
        await sock.sendPresenceUpdate('paused', contactJid);
        return;
      }

      // Reset counter if 30-minute window has elapsed
      const windowStart = autoCountWindowStart.get(contactJid);
      if (windowStart && Date.now() - windowStart >= AUTO_COUNT_RESET_MS) {
        resetAutoCount(contactJid).run();
        autoCountWindowStart.delete(contactJid);
        logger.debug({ contactJid }, 'Auto-reply counter reset (30min window elapsed)');
      }

      // Check consecutive cap
      const freshContact = getContact(contactJid);
      const autoCount = freshContact?.consecutiveAutoCount ?? 0;
      if (autoCount >= AUTO_CAP) {
        // Cap reached — switch to draft mode, notify owner
        updateContactMode(contactJid, 'draft');
        resetAutoCount(contactJid).run();
        const name = contact?.name ?? contactJid;
        lastNotifiedJid = contactJid;
        await sock.sendPresenceUpdate('paused', contactJid);
        await sock.sendMessage(config.USER_JID, {
          text: `Paused auto-reply for ${name} after ${AUTO_CAP} replies — switching to draft mode. Reply 'snooze 1h' to pause ${name}.`,
        });
        logger.info({ contactJid }, 'Auto-reply cap reached — switched to draft mode');
        return;
      }

      // All clear — send reply
      if (globalVoiceOn && contactVoiceOn) {
        // Voice reply: TTS + PTT send
        const oggBuffer = await textToSpeech(reply, logger);
        await sendVoiceWithDelay(sock, contactJid, oggBuffer, reply);
      } else {
        // Text fallback: voice disabled globally or for this contact
        await sock.sendPresenceUpdate('paused', contactJid);
        await sendWithDelay(sock, contactJid, reply);
      }

      // Track auto reply (same as text path)
      lastAutoReplyTime.set(contactJid, Date.now());
      if (!autoCountWindowStart.has(contactJid)) {
        autoCountWindowStart.set(contactJid, Date.now());
      }
      incrementAutoCount(contactJid).run();

    } else if (mode === 'draft') {
      // Draft mode: always create text draft (Phase 15 adds voice drafts)
      await sock.sendPresenceUpdate('paused', contactJid);
      const draftId = createDraft(contactJid, msg.key.id!, reply);
      const name = contact?.name ?? contactJid;
      lastNotifiedJid = contactJid;
      await sock.sendMessage(config.USER_JID, {
        text: `Draft for ${name} (voice msg):\n\n${reply}\n\nReply \u2705 to send | \u274c to reject | 'snooze 1h' to pause ${name}`,
      });
      logger.info({ draftId, contactJid }, 'Voice draft created for approval');
    }
  } catch (err) {
    logger.error({ err, contactJid }, 'Voice pipeline error');
    await sock.sendPresenceUpdate('paused', contactJid);
  }
}

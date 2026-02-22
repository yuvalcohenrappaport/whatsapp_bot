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
import { sendWithDelay } from '../whatsapp/sender.js';
import { generateReply } from '../ai/gemini.js';

const logger = pino({ level: config.LOG_LEVEL });

// --- Module-level state ---

/** In-memory map of JID → timestamp (ms) of last auto-reply. Ephemeral — resets on restart. */
const lastAutoReplyTime = new Map<string, number>();

/** Minimum milliseconds between auto-replies to the same contact. */
const COOLDOWN_MS = 30_000; // 30 seconds

/** Maximum consecutive auto-replies before switching to draft mode. */
const AUTO_CAP = 10;

/**
 * Tracks which contact the bot most recently sent a notification about.
 * Used to know which contact to snooze/resume when the user replies "snooze" or "resume".
 * Module-scoped — always refers to the most recently notified contact.
 */
let lastNotifiedJid: string | null = null;

// --- Helper functions ---

function getMessageText(msg: WAMessage): string | null {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    null
  );
}

function getContactJid(msg: WAMessage): string | null {
  const jid = msg.key.remoteJid;
  if (!jid) return null;
  // Skip groups and status broadcasts
  if (jid.endsWith('@g.us') || jid === 'status@broadcast') return null;
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
    markDraftSent(draft.id).run();
    await sendWithDelay(sock, draft.contactJid, draft.body);
    // Reset auto count on draft approval per locked decision
    resetAutoCount(draft.contactJid).run();
    await sock.sendMessage(config.USER_JID, {
      text: `Sent to ${draft.contactJid}.`,
    });
  } else {
    markDraftRejected(draft.id).run();
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
  if (text === null) return; // skip non-text messages

  const contactJid = getContactJid(msg);
  if (!contactJid) return; // skip groups / broadcasts

  const fromMe = msg.key.fromMe ?? false;

  // Compute timestamp early — needed for both incoming and outgoing message persistence
  const timestamp = msg.messageTimestamp
    ? typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp * 1000
      : Number(msg.messageTimestamp) * 1000
    : Date.now();

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
  upsertContact(contactJid, pushName).run();

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

    // Check consecutive cap
    const autoCount = contact?.consecutiveAutoCount ?? 0;
    if (autoCount >= AUTO_CAP) {
      // Cap reached — switch to draft mode, notify owner
      updateContactMode(contactJid, 'draft').run();
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

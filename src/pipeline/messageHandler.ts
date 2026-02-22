import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { insertMessage } from '../db/queries/messages.js';
import { getContact, upsertContact } from '../db/queries/contacts.js';
import {
  createDraft,
  getLatestPendingDraft,
  markDraftSent,
  markDraftRejected,
} from '../db/queries/drafts.js';
import { sendWithDelay } from '../whatsapp/sender.js';
import { generateReply } from '../ai/gemini.js';

const logger = pino({ level: config.LOG_LEVEL });

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

async function handleDraftApproval(
  sock: WASocket,
  text: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (trimmed !== '✅' && trimmed !== '❌') return false;

  const draft = getLatestPendingDraft();
  if (!draft) {
    await sock.sendMessage(config.USER_JID, {
      text: 'No pending drafts to action.',
    });
    return true;
  }

  if (trimmed === '✅') {
    markDraftSent(draft.id);
    await sendWithDelay(sock, draft.contactJid, draft.body);
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
  if (text === null) return; // skip non-text messages

  const contactJid = getContactJid(msg);
  if (!contactJid) return; // skip groups / broadcasts

  const fromMe = msg.key.fromMe ?? false;

  // Self-message: check for draft approval (✅/❌)
  if (fromMe && contactJid === config.USER_JID) {
    await handleDraftApproval(sock, text);
    return;
  }

  // Skip our own outgoing messages
  if (fromMe) return;

  // Persist incoming message (dedup via onConflictDoNothing)
  const timestamp = msg.messageTimestamp
    ? typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp * 1000
      : Number(msg.messageTimestamp) * 1000
    : Date.now();

  insertMessage({
    id: msg.key.id!,
    contactJid,
    fromMe: false,
    body: text,
    timestamp,
  });

  // Auto-create contact if new
  const pushName = msg.pushName ?? null;
  upsertContact(contactJid, pushName);

  // Route by contact mode
  const contact = getContact(contactJid);
  const mode = contact?.mode ?? 'off';

  if (mode === 'off') return;

  const reply = await generateReply(contactJid);
  if (!reply) return;

  if (mode === 'auto') {
    await sendWithDelay(sock, contactJid, reply);
  } else if (mode === 'draft') {
    const draftId = createDraft(contactJid, msg.key.id!, reply);
    const name = contact?.name ?? contactJid;
    await sock.sendMessage(config.USER_JID, {
      text: `Draft for ${name}:\n\n${reply}\n\nReply ✅ to send | ❌ to reject`,
    });
    logger.info({ draftId, contactJid }, 'Draft created for approval');
  }
}

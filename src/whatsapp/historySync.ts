import type { WAMessage, Chat, Contact } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { insertMessage } from '../db/queries/messages.js';
import { upsertContact } from '../db/queries/contacts.js';

const logger = pino({ level: config.LOG_LEVEL });

function getMessageText(msg: WAMessage): string | null {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    null
  );
}

/**
 * Handles the `messaging-history.set` event from Baileys.
 * Stores DM messages (both sides) into the messages table for style learning.
 */
export function handleHistorySync({
  messages,
  contacts,
  chats,
  progress,
  syncType,
}: {
  messages: WAMessage[];
  contacts: Contact[];
  chats: Chat[];
  progress?: number | null;
  syncType?: number | null;
}) {
  let stored = 0;
  let skipped = 0;

  for (const msg of messages) {
    const jid = msg.key.remoteJid;
    if (!jid) continue;

    // Skip groups, broadcasts, status
    if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

    // Skip own JID (self-chat)
    if (jid === config.USER_JID) continue;

    const text = getMessageText(msg);
    if (!text) continue;

    const fromMe = msg.key.fromMe ?? false;
    const timestamp = msg.messageTimestamp
      ? typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp * 1000
        : Number(msg.messageTimestamp) * 1000
      : 0;

    // Skip messages with no real timestamp
    if (timestamp === 0) {
      skipped++;
      continue;
    }

    try {
      insertMessage({
        id: msg.key.id!,
        contactJid: jid,
        fromMe,
        body: text,
        timestamp,
      }).run();
      stored++;
    } catch {
      skipped++;
    }
  }

  // Upsert contacts from history sync
  for (const contact of contacts) {
    if (!contact.id) continue;
    if (contact.id.endsWith('@g.us') || contact.id === 'status@broadcast') continue;
    const name = contact.notify || contact.name || null;
    if (name) {
      upsertContact(contact.id, name);
    }
  }

  logger.info(
    { stored, skipped, totalMessages: messages.length, contactCount: contacts.length, progress, syncType },
    'History sync batch processed',
  );
}

import type { WASocket } from '@whiskeysockets/baileys';
import { insertMessage } from '../db/queries/messages.js';

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a message with a human-like typing delay.
 * Shows "composing" presence, waits 1.5–4s, sends, then persists to DB.
 */
export async function sendWithDelay(
  sock: WASocket,
  jid: string,
  text: string,
): Promise<void> {
  await sock.presenceSubscribe(jid);
  await sock.sendPresenceUpdate('composing', jid);

  const delay = randomDelay(1500, 4000);
  await sleep(delay);

  await sock.sendPresenceUpdate('paused', jid);

  const sent = await sock.sendMessage(jid, { text });

  if (sent?.key?.id) {
    insertMessage({
      id: sent.key.id,
      contactJid: jid,
      fromMe: true,
      body: text,
      timestamp: Date.now(),
    });
  }
}

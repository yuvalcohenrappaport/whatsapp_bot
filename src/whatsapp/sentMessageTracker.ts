/**
 * Tracks message IDs the bot itself sent via sock.sendMessage.
 *
 * The bot runs on the owner's WhatsApp account, so any message the bot sends
 * (confirmations, travel-handler responses, briefings) comes back through
 * messages.upsert with fromMe=true — same as messages the owner types in
 * WhatsApp UI. We need a way to distinguish "bot wrote this" from "owner
 * wrote this" so the trip-decision classifier (and similar fromMe-gated
 * paths) can ingest the owner's messages without echoing the bot's own
 * outgoing text back into itself.
 *
 * Hook is installed once in src/index.ts at socket creation: sock.sendMessage
 * is monkey-patched so every successful send registers the returned msgId here.
 */

const TTL_MS = 5 * 60 * 1000; // 5 min — feedback loops resolve well within this
const sent = new Map<string, NodeJS.Timeout>();

export function markBotSent(msgId: string): void {
  const existing = sent.get(msgId);
  if (existing) clearTimeout(existing);
  sent.set(
    msgId,
    setTimeout(() => sent.delete(msgId), TTL_MS),
  );
}

export function isBotSent(msgId: string): boolean {
  return sent.has(msgId);
}

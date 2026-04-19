/**
 * Bucket-flush side of the Phase 41 approval UX.
 *
 * `sendBucketPreview(actionableIds)` is registered as the debounce bucket's
 * flush callback (wired in Plan 41-04's init). It:
 *
 *   1. Reads the actionables from the DB, filters to still-pending ones
 *      (an item can flip to approved/rejected between enqueue and flush if
 *      a different code path touched it — though today nothing does).
 *   2. Composes one preview via `composePreview` using the shared language
 *      + contactName from the first item (all items in a bucket come from
 *      the same sourceContactJid by construction).
 *   3. Sends one WhatsApp message to `config.USER_JID` via the live socket.
 *   4. Annotates every bucketed actionable with the sent message's id so
 *      the Plan 41-03 quoted-reply matcher can find them.
 *
 * Errors are logged and swallowed — a failed preview send should not crash
 * the bot and does not roll back the pending_approval actionables (they stay
 * in the DB; a future digest can resurface them).
 */
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import {
  getActionableById,
  updateActionablePreviewMsgId,
} from '../db/queries/actionables.js';
import { composePreview, type PreviewItem } from './previewTemplates.js';

const logger = pino({ level: config.LOG_LEVEL });

/** Max snippet length pushed into the preview — matches composePreview contract. */
const SNIPPET_MAX = 100;

export async function sendBucketPreview(
  actionableIds: string[],
): Promise<void> {
  if (actionableIds.length === 0) return;

  const items = actionableIds
    .map((id) => getActionableById(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .filter((a) => a.status === 'pending_approval');

  if (items.length === 0) {
    logger.info(
      { actionableIds },
      'Bucket flush: no still-pending actionables — no-op',
    );
    return;
  }

  // All items in a bucket come from the same sourceContactJid by construction,
  // so language + contactName are consistent across items.
  const language = (items[0].detectedLanguage ?? 'en') as 'he' | 'en';
  const contactName = items[0].sourceContactName ?? null;

  const previewItems: PreviewItem[] = items.map((a) => ({
    task: a.task,
    contactName: a.sourceContactName,
    snippet: truncate(a.sourceMessageText ?? '', SNIPPET_MAX),
  }));

  const messageText = composePreview(previewItems, language, contactName);

  const sock = getState().sock;
  if (!sock) {
    logger.warn(
      { actionableIds, count: items.length },
      'No sock available — cannot send preview',
    );
    return;
  }

  try {
    const sent = await sock.sendMessage(config.USER_JID, {
      text: messageText,
    });
    const previewMsgId = sent?.key?.id;
    if (!previewMsgId) {
      logger.error(
        { actionableIds, count: items.length },
        'sendMessage returned no key.id — preview sent but not trackable',
      );
      return;
    }
    // Annotate every bucketed actionable with the preview msg id so the
    // quoted-reply matcher in Plan 41-03 can find them by the quoted id.
    for (const a of items) {
      updateActionablePreviewMsgId(a.id, previewMsgId);
    }
    logger.info(
      {
        previewMsgId,
        count: items.length,
        language,
        contactName,
      },
      'Sent actionables preview',
    );
  } catch (err) {
    logger.error(
      { err, actionableIds, count: items.length },
      'Failed to send actionables preview',
    );
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

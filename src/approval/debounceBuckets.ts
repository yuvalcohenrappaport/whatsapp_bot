/**
 * Per-source-chat debounce buckets for the WhatsApp approval UX (Phase 41).
 *
 * Detected actionables are enqueued via `enqueueForPreview(actionableId,
 * sourceContactJid)`. A bucket is keyed by `sourceContactJid` and accumulates
 * ids until 2 minutes pass with no new enqueues for that key — the window is
 * reset on every enqueue. When the window closes, the registered flush
 * callback is invoked with the bucket's id list and the bucket is cleared.
 *
 * The flush callback is wired separately (see Plan 41-04 init) to decouple
 * scheduling (this module) from the actual send path (src/approval/
 * previewSender.ts). If no callback is registered, the flush is a no-op —
 * ids just drop on the floor, which is intentional for dark_launch and for
 * tests that don't care about the send side.
 *
 * No DB, no I/O, no WhatsApp calls. Pure in-process scheduling.
 */
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ level: config.LOG_LEVEL });

const DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes per 40-CONTEXT.md

interface Bucket {
  actionableIds: string[];
  timer: NodeJS.Timeout;
  sourceContactJid: string;
}

const buckets = new Map<string, Bucket>();

export type FlushCallback = (actionableIds: string[]) => void | Promise<void>;

let flushCallback: FlushCallback | null = null;

/**
 * Register the function invoked when a bucket's debounce window closes.
 * Call once at bot init (wired in Plan 41-04). Overwrites any previously
 * registered callback.
 */
export function setFlushCallback(cb: FlushCallback): void {
  flushCallback = cb;
}

/**
 * Add an actionable id to the bucket for its source chat, (re-)starting the
 * 2-minute debounce window. Safe to call at high rate — every call resets
 * the timer so the flush fires 2 minutes after the LAST enqueue.
 */
export function enqueueForPreview(
  actionableId: string,
  sourceContactJid: string,
): void {
  const existing = buckets.get(sourceContactJid);
  if (existing) {
    clearTimeout(existing.timer);
    existing.actionableIds.push(actionableId);
    existing.timer = setTimeout(
      () => void flush(sourceContactJid),
      DEBOUNCE_MS,
    );
    logger.info(
      {
        sourceContactJid,
        actionableId,
        bucketSize: existing.actionableIds.length,
      },
      'Enqueued actionable for preview (reset timer)',
    );
    return;
  }

  const bucket: Bucket = {
    actionableIds: [actionableId],
    sourceContactJid,
    timer: setTimeout(() => void flush(sourceContactJid), DEBOUNCE_MS),
  };
  buckets.set(sourceContactJid, bucket);
  logger.info(
    { sourceContactJid, actionableId, bucketSize: 1 },
    'Enqueued actionable for preview (new bucket)',
  );
}

async function flush(sourceContactJid: string): Promise<void> {
  const bucket = buckets.get(sourceContactJid);
  if (!bucket) return;
  buckets.delete(sourceContactJid);
  logger.info(
    { sourceContactJid, count: bucket.actionableIds.length },
    'Flushing preview bucket',
  );
  if (!flushCallback) return;
  try {
    await flushCallback(bucket.actionableIds);
  } catch (err) {
    // Log and swallow — a failed flush should not crash the bot.
    logger.error(
      { err, sourceContactJid, count: bucket.actionableIds.length },
      'Flush callback threw — bucket dropped',
    );
  }
}

// ─── Test-only helpers ────────────────────────────────────────────────────────

/** Test-only: clear all buckets and their timers. */
export function __resetBucketsForTest(): void {
  for (const bucket of buckets.values()) clearTimeout(bucket.timer);
  buckets.clear();
  flushCallback = null;
}

/** Test-only: inspect bucket state. */
export function __getBucketForTest(jid: string): Bucket | undefined {
  return buckets.get(jid);
}

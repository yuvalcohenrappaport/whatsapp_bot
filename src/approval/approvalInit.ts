/**
 * Approval-system init for Phase 41.
 *
 * Called from `src/index.ts` once the Baileys sock is connected. Responsibilities:
 *
 *   1. Register the debounce-bucket flush callback so Plan 41-02's
 *      `enqueueForPreview` actually results in a preview send.
 *   2. Start (or restart) the hourly 7-day expiry scan from Plan 41-04 Task 1.
 *   3. On the very first successful run, send the one-time "first-boot digest"
 *      to self-chat counting existing pending actionables, then flush that
 *      backlog through the normal 2-minute debounce pipeline so each source
 *      chat gets a batched preview. After the digest message succeeds, BOTH
 *      the digest-posted flag AND the detection-pipeline gate flip atomically
 *      — existing servers (which stored `dark_launch` back in Phase 40)
 *      upgrade to `interactive` mode the moment the digest fires.
 *
 * Idempotent across reconnects — only the first call runs the digest; later
 * calls still re-register the flush callback + restart the expiry scan (both
 * are safe-to-restart operations).
 */
import pino from 'pino';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { getPendingActionables } from '../db/queries/actionables.js';
import { getState } from '../api/state.js';
import {
  setFlushCallback,
  enqueueForPreview,
} from './debounceBuckets.js';
import { sendBucketPreview } from './previewSender.js';
import { startExpiryScan } from './expiryScan.js';

const logger = pino({ level: config.LOG_LEVEL });

let initialized = false;

/**
 * Wire the approval subsystem. Safe to call on every reconnect — the digest
 * runs only once per process lifetime (and only once per server lifetime,
 * via the persisted `v1_8_approval_digest_posted` flag).
 */
export async function initApprovalSystem(): Promise<void> {
  // Always re-register the flush callback — cheap, overwrites any previous
  // registration, and is required after a reconnect since the bucket module
  // itself holds the callback reference across reconnects (no-op but defensive).
  setFlushCallback(sendBucketPreview);

  // Start (or restart) the hourly expiry scan — startExpiryScan clears the
  // previous interval before installing a new one, so this is idempotent.
  startExpiryScan();

  if (initialized) {
    logger.info('Approval system re-initialized after reconnect');
    return;
  }
  initialized = true;

  // First-boot digest: gated by the persisted setting so a restart NEVER
  // re-fires the digest. Flag is flipped below only after the digest message
  // succeeds — so a failed digest retries on the next boot.
  if (getSetting('v1_8_approval_digest_posted') !== 'true') {
    await runFirstBootDigest();
  }

  logger.info('Approval system initialized');
}

/**
 * One-time first-boot digest. Sends a short count message to self-chat in
 * the language of the most-recent pending actionable, then enqueues every
 * pending actionable into its source-chat debounce bucket so the existing
 * backlog flows through the normal batched-preview path.
 *
 * On a successful send, atomically flips:
 *   - v1_8_approval_digest_posted → 'true' (gate closed for this server)
 *   - v1_8_detection_pipeline → 'interactive' (existing servers upgrade from
 *     Phase 40's stored 'dark_launch' to the live approval UX)
 *
 * If the sock is unavailable or the sendMessage fails, neither flag is
 * flipped — the next init call will retry.
 */
async function runFirstBootDigest(): Promise<void> {
  const pending = getPendingActionables();
  const sock = getState().sock;
  if (!sock) {
    logger.warn('Cannot run approval digest — no sock');
    return;
  }

  if (pending.length > 0) {
    // `getPendingActionables` orders by detectedAt desc, so pending[0] is the
    // most recent item — its language drives the digest copy.
    const lang = (pending[0].detectedLanguage as 'he' | 'en') ?? 'en';
    const text =
      lang === 'he'
        ? `\u23F3 ${pending.length} פריטים ממתינים לאישור. תראה אותם כפי שזוהו, החל מעכשיו.`
        : `\u23F3 ${pending.length} items are waiting for approval. You'll see them as they were detected, starting now.`;

    try {
      await sock.sendMessage(config.USER_JID, { text });
    } catch (err) {
      logger.error({ err }, 'Failed to send approval digest');
      return; // don't flip flags — retry on next boot
    }

    // Flush the backlog: enqueue every pending actionable into its
    // source-chat bucket. The 2-minute debounce window applies normally —
    // one batched preview per source chat.
    for (const a of pending) {
      enqueueForPreview(a.id, a.sourceContactJid);
    }
    logger.info(
      { backlog: pending.length },
      'Approval digest sent; backlog enqueued',
    );
  } else {
    logger.info('Approval digest skipped — no pending actionables');
  }

  // Atomically flip both flags: digest posted + pipeline to interactive.
  setSetting('v1_8_approval_digest_posted', 'true');
  setSetting('v1_8_detection_pipeline', 'interactive');
}

// ─── Test-only helpers ────────────────────────────────────────────────────────

/** Test-only: reset the in-module `initialized` latch so unit tests can
 *  re-exercise the first-call digest path cleanly. */
export function __resetInitializedForTest(): void {
  initialized = false;
}

import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import {
  scheduleMessage,
  startPeriodicScan,
  scheduleAllUpcoming,
} from './scheduledMessageScheduler.js';
import {
  getScheduledMessageById,
  getPendingScheduledMessages,
  updateScheduledMessageStatus,
  incrementScheduledMessageFailCount,
} from '../db/queries/scheduledMessages.js';
import {
  getRecipientsForMessage,
  updateRecipientStatus,
  incrementRecipientFailCount,
} from '../db/queries/scheduledMessageRecipients.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKOFF_DELAYS_MS = [60_000, 300_000, 1_800_000, 1_800_000, 1_800_000]; // 1m, 5m, 30m, 30m, 30m
const MAX_ATTEMPTS = 5;
const SEND_TIMEOUT_MS = 15_000;
const RECOVERY_MAX_AGE_MS = 3_600_000; // 1 hour
const RECOVERY_STAGGER_MS = 5_000;

// ─── Module-level state ───────────────────────────────────────────────────────

let initialized = false;

// ─── Send with timeout ────────────────────────────────────────────────────────

/**
 * Wraps sock.sendMessage in a Promise.race with a 15-second timeout.
 * This is the ONLY way to call sendMessage in this module.
 */
async function sendWithTimeout(
  sock: NonNullable<ReturnType<typeof getState>['sock']>,
  jid: string,
  content: { text: string },
  timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('sendMessage timeout')), timeoutMs),
  );
  await Promise.race([sock.sendMessage(jid, content), timeout]);
}

// ─── Retry logic ──────────────────────────────────────────────────────────────

/**
 * Handle a failed message: increment fail count, decide retry vs. permanent failure.
 * On permanent failure: notify owner via self-chat.
 * On retry: revert status to 'pending' and schedule a backoff setTimeout.
 */
async function handleFailedMessage(
  id: string,
  msg: NonNullable<ReturnType<typeof getScheduledMessageById>>,
): Promise<void> {
  const currentFailCount = msg.failCount ?? 0;
  incrementScheduledMessageFailCount(id);

  if (currentFailCount + 1 >= MAX_ATTEMPTS) {
    updateScheduledMessageStatus(id, 'failed');
    logger.error(
      { id, failCount: currentFailCount + 1 },
      'Scheduled message permanently failed after max attempts',
    );

    // Best-effort owner notification
    const sock = getState().sock;
    if (sock) {
      try {
        const recipients = getRecipientsForMessage(id);
        const recipientJids = recipients.map((r) => r.recipientJid).join(', ');
        const contentPreview = msg.content.slice(0, 100);
        await sock.sendMessage(config.USER_JID, {
          text: `Scheduled message permanently failed after ${MAX_ATTEMPTS} attempts.\nID: ${id}\nRecipients: ${recipientJids}\nContent: ${contentPreview}`,
        });
      } catch (notifyErr) {
        logger.warn({ notifyErr, id }, 'Failed to send permanent failure notification');
      }
    }
  } else {
    // Revert to pending so periodic scan or retry timer can pick it up
    updateScheduledMessageStatus(id, 'pending');

    const delay = BACKOFF_DELAYS_MS[currentFailCount] ?? 1_800_000;
    const attemptNumber = currentFailCount + 2; // next attempt number
    logger.info(
      { id, attemptNumber, delayMs: delay },
      'Scheduling retry for failed scheduled message',
    );
    setTimeout(() => {
      fireMessage(id).catch((err) =>
        logger.error({ err, id }, 'Unhandled error in retry fireMessage'),
      );
    }, delay);
  }
}

// ─── Fire handler ─────────────────────────────────────────────────────────────

/**
 * Fire a scheduled message: send to all recipients, update statuses.
 * Idempotent — returns early if message is not in 'pending' status.
 * Updates status to 'sending' before send to prevent periodic scan race.
 */
async function fireMessage(id: string): Promise<void> {
  try {
    const msg = getScheduledMessageById(id);
    if (!msg) {
      logger.warn({ id }, 'Scheduled message not found at fire time');
      return;
    }
    if (msg.status !== 'pending') {
      logger.debug({ id, status: msg.status }, 'Scheduled message already handled — skipping fire');
      return;
    }

    // Mark as 'sending' immediately to prevent periodic scan from re-firing
    updateScheduledMessageStatus(id, 'sending');

    const sock = getState().sock;
    if (!sock) {
      logger.warn({ id }, 'No WhatsApp connection at scheduled message fire time — reverting to pending');
      updateScheduledMessageStatus(id, 'pending');
      // Schedule retry after first backoff delay
      const delay = BACKOFF_DELAYS_MS[msg.failCount ?? 0] ?? 1_800_000;
      setTimeout(() => {
        fireMessage(id).catch((err) =>
          logger.error({ err, id }, 'Unhandled error in no-sock retry fireMessage'),
        );
      }, delay);
      return;
    }

    const recipients = getRecipientsForMessage(id);
    if (recipients.length === 0) {
      logger.warn({ id }, 'Scheduled message has no recipients — marking as sent');
      updateScheduledMessageStatus(id, 'sent');
      return;
    }

    let anyFailed = false;

    for (const recipient of recipients) {
      try {
        await sendWithTimeout(sock, recipient.recipientJid, { text: msg.content });
        updateRecipientStatus(recipient.id, 'sent');
        logger.info({ id, recipientJid: recipient.recipientJid }, 'Scheduled message sent to recipient');
      } catch (sendErr) {
        logger.error({ sendErr, id, recipientJid: recipient.recipientJid }, 'Failed to send scheduled message to recipient');
        incrementRecipientFailCount(recipient.id);
        updateRecipientStatus(recipient.id, 'failed');
        anyFailed = true;
      }
    }

    if (anyFailed) {
      await handleFailedMessage(id, msg);
    } else {
      updateScheduledMessageStatus(id, 'sent');
      logger.info({ id }, 'Scheduled message fully sent');
    }
  } catch (err) {
    logger.error({ err, id }, 'Unexpected error in fireMessage — marking as failed');
    try {
      updateScheduledMessageStatus(id, 'failed');
    } catch (dbErr) {
      logger.error({ dbErr, id }, 'Failed to update status after unexpected fireMessage error');
    }
  }
}

// ─── Recovery ─────────────────────────────────────────────────────────────────

/**
 * Recover messages missed during bot downtime.
 * - Missed by < 1 hour: fire (staggered 5s apart, non-blocking)
 * - Missed by >= 1 hour: mark as 'expired'
 * Sends self-chat summary for expired messages if sock is available.
 */
async function recoverMessages(): Promise<void> {
  const now = Date.now();
  const overdue = getPendingScheduledMessages(now);

  if (overdue.length === 0) {
    logger.info('No overdue scheduled messages to recover');
    return;
  }

  const cutoffMs = now - RECOVERY_MAX_AGE_MS;
  const toFire = overdue.filter((m) => m.scheduledAt >= cutoffMs);
  const toExpire = overdue.filter((m) => m.scheduledAt < cutoffMs);

  // Expire old messages
  for (const m of toExpire) {
    updateScheduledMessageStatus(m.id, 'expired');
  }

  if (toExpire.length > 0) {
    logger.info({ expiredCount: toExpire.length }, 'Expired old scheduled messages during recovery');
    const sock = getState().sock;
    if (sock) {
      try {
        const lines = toExpire.map(
          (m) => `- ID: ${m.id} (was due ${new Date(m.scheduledAt).toISOString()})`,
        );
        await sock.sendMessage(config.USER_JID, {
          text: `Expired ${toExpire.length} scheduled message(s) missed while offline (older than 1 hour):\n${lines.join('\n')}`,
        });
      } catch (notifyErr) {
        logger.warn({ notifyErr }, 'Failed to send expired messages notification');
      }
    }
  }

  // Stagger fire recent messages — non-blocking
  for (let i = 0; i < toFire.length; i++) {
    const m = toFire[i];
    setTimeout(() => {
      fireMessage(m.id).catch((err) =>
        logger.error({ err, id: m.id }, 'Unhandled error in recovery fireMessage'),
      );
    }, i * RECOVERY_STAGGER_MS);
  }

  logger.info(
    { fired: toFire.length, expired: toExpire.length },
    'Scheduled message recovery complete',
  );
}

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the scheduled message scheduler: recover missed messages, start
 * the periodic scan, and schedule all upcoming messages.
 *
 * Safe to call on every WhatsApp reconnect — periodic scan clears previous
 * interval, activeTimers Map dedup prevents duplicate timers.
 */
export async function initScheduledMessageScheduler(): Promise<void> {
  // Recovery first — fast, just schedules timeouts
  await recoverMessages();

  // Periodic scan is safe to restart (clears previous interval internally)
  startPeriodicScan((id) => {
    fireMessage(id).catch((err) =>
      logger.error({ err, id }, 'Unhandled error in periodic scan fireMessage'),
    );
  });

  scheduleAllUpcoming((id) => {
    fireMessage(id).catch((err) =>
      logger.error({ err, id }, 'Unhandled error in scheduleAllUpcoming fireMessage'),
    );
  });

  if (!initialized) {
    logger.info('Scheduled message scheduler initialized');
    initialized = true;
  } else {
    logger.info('Scheduled message scheduler re-initialized after reconnect');
  }
}

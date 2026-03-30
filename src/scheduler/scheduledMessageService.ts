import pino from 'pino';
import PQueue from 'p-queue';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import {
  scheduleMessage,
  cancelScheduledMessage,
  startPeriodicScan,
  scheduleAllUpcoming,
} from './scheduledMessageScheduler.js';
import {
  getScheduledMessageById,
  getPendingScheduledMessages,
  getNotifiedScheduledMessages,
  updateScheduledMessageStatus,
  updateScheduledMessageNotificationMsgId,
  markScheduledMessageCancelled,
  incrementScheduledMessageFailCount,
  getScheduledMessageByNotificationMsgId,
} from '../db/queries/scheduledMessages.js';
import {
  getRecipientsForMessage,
  updateRecipientStatus,
  incrementRecipientFailCount,
} from '../db/queries/scheduledMessageRecipients.js';
import { getContact } from '../db/queries/contacts.js';
import { textToSpeech } from '../voice/tts.js';
import { buildSystemPrompt } from '../ai/gemini.js';
import { generateText } from '../ai/provider.js';
import { insertMessage } from '../db/queries/messages.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKOFF_DELAYS_MS = [60_000, 300_000, 1_800_000, 1_800_000, 1_800_000]; // 1m, 5m, 30m, 30m, 30m
const MAX_ATTEMPTS = 5;
const SEND_TIMEOUT_MS = 15_000;
const TTS_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 30_000;
const RECOVERY_MAX_AGE_MS = 3_600_000; // 1 hour
const RECOVERY_STAGGER_MS = 5_000;
const NOTIFICATION_LEAD_MS = 10 * 60 * 1000; // 10 minutes

// ─── Module-level state ───────────────────────────────────────────────────────

let initialized = false;
const ttsQueue = new PQueue({ concurrency: 1 });

// ─── Time formatter ───────────────────────────────────────────────────────────

const timeFormatter = new Intl.DateTimeFormat('en-IL', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jerusalem',
});

// ─── Send with timeout ────────────────────────────────────────────────────────

/**
 * Wraps sock.sendMessage in a Promise.race with a 15-second timeout.
 * This is the ONLY way to call sendMessage for outgoing contact messages.
 * Self-chat notifications use plain sock.sendMessage (best-effort).
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

// ─── Content resolution ───────────────────────────────────────────────────────

type ResolvedContent =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; buffer: Buffer; sourceText: string };

async function resolveContent(
  type: string,
  content: string,
  recipientJid: string,
): Promise<ResolvedContent> {
  if (type === 'voice') {
    const buffer = await ttsQueue.add(() => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TTS timeout')), TTS_TIMEOUT_MS),
      );
      return Promise.race([textToSpeech(content, logger), timeout]);
    });
    if (!buffer) throw new Error('TTS returned undefined');
    return { kind: 'audio', buffer, sourceText: content };
  }

  if (type === 'ai') {
    const contact = getContact(recipientJid);
    const systemPrompt = await buildSystemPrompt(
      recipientJid,
      contact ?? { name: null, relationship: null, customInstructions: null, styleSummary: null },
    );
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI generation timeout')), AI_TIMEOUT_MS),
    );
    const generated = await Promise.race([
      generateText({
        systemPrompt,
        messages: [{ role: 'user', content }],
      }),
      timeout,
    ]);
    if (!generated) throw new Error('AI generation returned empty');
    return { kind: 'text', text: generated };
  }

  return { kind: 'text', text: content };
}

async function sendVoiceWithTimeout(
  sock: NonNullable<ReturnType<typeof getState>['sock']>,
  jid: string,
  buffer: Buffer,
  sourceText: string,
  timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('sendMessage timeout')), timeoutMs),
  );
  const sent = await Promise.race([
    sock.sendMessage(jid, {
      audio: buffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    }),
    timeout,
  ]);
  if (sent?.key?.id) {
    insertMessage({
      id: sent.key.id,
      contactJid: jid,
      fromMe: true,
      body: sourceText,
      timestamp: Date.now(),
    }).run();
  }
}

// ─── Pre-send notification ────────────────────────────────────────────────────

/**
 * Send a self-chat notification 10 minutes before the scheduled send.
 * Stores the notification message ID in DB and transitions status to 'notified'.
 * Schedules the actual fire timer at max(scheduledAt, now + 10min).
 *
 * Falls back to scheduling the send without a cancel window if sock is unavailable
 * or notification send fails — message always sends, cancel window is best-effort.
 */
async function sendPreSendNotification(id: string): Promise<void> {
  const msg = getScheduledMessageById(id);
  if (!msg) {
    logger.warn({ id }, 'sendPreSendNotification: message not found');
    return;
  }
  if (msg.status !== 'pending') {
    logger.debug(
      { id, status: msg.status },
      'sendPreSendNotification: message not in pending status — skipping',
    );
    return;
  }

  const recipients = getRecipientsForMessage(id);

  // Build recipient display
  let recipientDisplay: string;
  if (recipients.length === 0) {
    recipientDisplay = 'Unknown';
  } else if (recipients.length === 1) {
    recipientDisplay = getContact(recipients[0].recipientJid)?.name ?? recipients[0].recipientJid;
  } else if (recipients.length <= 3) {
    recipientDisplay = recipients
      .map((r) => getContact(r.recipientJid)?.name ?? r.recipientJid)
      .join(', ');
  } else {
    recipientDisplay = `${recipients.length} recipients`;
  }

  // First 20 words, truncated
  const words = msg.content.split(/\s+/);
  const preview = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : msg.content;

  // Type label
  const typeLabel = msg.type === 'text' ? 'Text' : msg.type === 'voice' ? 'Voice' : 'AI';

  // Send time in Jerusalem timezone
  const sendTime = timeFormatter.format(new Date(msg.scheduledAt));

  const notification = [
    `📅 Scheduled message in 10 min`,
    `👤 ${recipientDisplay}`,
    `📝 ${typeLabel}`,
    `💬 "${preview}"`,
    `⏰ ${sendTime}`,
    `Reply to this message with "cancel" to stop it.`,
  ].join('\n');

  const sock = getState().sock;
  if (!sock) {
    logger.warn(
      { id },
      'No WhatsApp connection at notification time — skipping notification, scheduling send directly',
    );
    // No cancel window, but message still sends
    updateScheduledMessageStatus(id, 'notified');
    scheduleMessage(id, msg.scheduledAt, fireCallback);
    return;
  }

  try {
    const sent = await sock.sendMessage(config.USER_JID, { text: notification });
    const sentMsgId = sent?.key?.id;
    if (sentMsgId) {
      updateScheduledMessageNotificationMsgId(id, sentMsgId);
    }
    updateScheduledMessageStatus(id, 'notified');

    // Schedule actual send — always give a 10-minute cancel window
    const actualFireAt = Math.max(msg.scheduledAt, Date.now() + NOTIFICATION_LEAD_MS);
    scheduleMessage(id, actualFireAt, fireCallback);

    logger.info(
      { id, recipientDisplay, actualFireAt },
      'Pre-send notification sent, fire timer armed',
    );
  } catch (err) {
    logger.warn(
      { err, id },
      'Failed to send pre-send notification — proceeding with send without cancel window',
    );
    updateScheduledMessageStatus(id, 'notified');
    scheduleMessage(id, msg.scheduledAt, fireCallback);
  }
}

// ─── Dispatch callback ────────────────────────────────────────────────────────

/**
 * Dispatch callback used by periodic scan, scheduleAllUpcoming, and recovery.
 * Routes 'pending' messages through the notification pipeline.
 * Routes 'notified' messages directly to fire.
 */
function dispatchCallback(id: string): void {
  const msg = getScheduledMessageById(id);
  if (!msg) return;
  if (msg.status === 'pending') {
    sendPreSendNotification(id).catch((err) =>
      logger.error({ err, id }, 'Unhandled error in notification dispatch'),
    );
  } else if (msg.status === 'notified') {
    fireMessage(id).catch((err) =>
      logger.error({ err, id }, 'Unhandled error in fire dispatch'),
    );
  }
}

/**
 * Direct fire callback — used for re-arming recovered 'notified' messages.
 */
function fireCallback(id: string): void {
  fireMessage(id).catch((err) =>
    logger.error({ err, id }, 'Unhandled error in fire callback'),
  );
}

// ─── Retry logic ──────────────────────────────────────────────────────────────

/**
 * Handle a failed message: increment fail count, decide retry vs. permanent failure.
 * On permanent failure: notify owner via self-chat.
 * On retry: revert status to 'notified' (message already went through notification),
 * send a per-attempt retry notification, and schedule a backoff setTimeout.
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
    // Revert to 'notified' — message already went through the notification pipeline
    updateScheduledMessageStatus(id, 'notified');

    const delay = BACKOFF_DELAYS_MS[currentFailCount] ?? 1_800_000;
    const delayLabel = delay >= 1_800_000 ? '30 min' : delay >= 300_000 ? '5 min' : '1 min';
    const attemptNumber = currentFailCount + 2; // next attempt number

    logger.info(
      { id, attemptNumber, delayMs: delay },
      'Scheduling retry for failed scheduled message',
    );

    // Per-attempt retry notification (best-effort)
    const sock = getState().sock;
    if (sock) {
      try {
        const recipients = getRecipientsForMessage(id);
        const recipientJids = recipients.map((r) => r.recipientJid).join(', ');
        await sock.sendMessage(config.USER_JID, {
          text: `Failed to send to ${recipientJids}, retrying in ${delayLabel}...`,
        });
      } catch (notifyErr) {
        logger.warn({ notifyErr, id }, 'Failed to send retry notification');
      }
    }

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
 * Idempotent — returns early if message is not in 'notified' status.
 * A 'cancelled' message is silently skipped.
 * Updates status to 'sending' before send to prevent periodic scan race.
 */
async function fireMessage(id: string): Promise<void> {
  try {
    const msg = getScheduledMessageById(id);
    if (!msg) {
      logger.warn({ id }, 'Scheduled message not found at fire time');
      return;
    }
    if (msg.status !== 'notified') {
      logger.debug(
        { id, status: msg.status },
        'Scheduled message not in notified status — skipping fire',
      );
      return;
    }

    // Mark as 'sending' immediately to prevent periodic scan from re-firing
    updateScheduledMessageStatus(id, 'sending');

    const sock = getState().sock;
    if (!sock) {
      logger.warn(
        { id },
        'No WhatsApp connection at scheduled message fire time — reverting to notified',
      );
      updateScheduledMessageStatus(id, 'notified');
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
        logger.info(
          { id, recipientJid: recipient.recipientJid },
          'Scheduled message sent to recipient',
        );
      } catch (sendErr) {
        logger.error(
          { sendErr, id, recipientJid: recipient.recipientJid },
          'Failed to send scheduled message to recipient',
        );
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
 *
 * Pending messages (notification not yet sent):
 * - Missed by < 1 hour: run full notification-then-send pipeline (staggered 5s apart)
 * - Missed by >= 1 hour: mark as 'expired'
 *
 * Notified messages (notification sent, send timer lost on restart):
 * - Re-arm fire timer immediately at max(scheduledAt, now + 10min)
 * - Do NOT re-send notification (Pitfall 4)
 */
async function recoverMessages(): Promise<void> {
  const now = Date.now();

  // ── Handle pending overdue messages ──────────────────────────────────────────
  const overdue = getPendingScheduledMessages(now);

  if (overdue.length > 0) {
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

    // Stagger full pipeline (notification-then-send) for recent pending messages
    for (let i = 0; i < toFire.length; i++) {
      const m = toFire[i];
      setTimeout(() => {
        sendPreSendNotification(m.id).catch((err) =>
          logger.error({ err, id: m.id }, 'Unhandled error in recovery sendPreSendNotification'),
        );
      }, i * RECOVERY_STAGGER_MS);
    }

    logger.info(
      { fired: toFire.length, expired: toExpire.length },
      'Pending scheduled message recovery complete',
    );
  } else {
    logger.info('No overdue pending scheduled messages to recover');
  }

  // ── Handle notified messages (re-arm fire timer only) ─────────────────────
  const notifiedMessages = getNotifiedScheduledMessages();

  if (notifiedMessages.length > 0) {
    for (const m of notifiedMessages) {
      // Notification already sent — just re-arm fire timer at scheduledAt
      // If scheduledAt is past, fire immediately (message is overdue)
      scheduleMessage(m.id, m.scheduledAt, fireCallback);
    }
    logger.info(
      { count: notifiedMessages.length },
      'Re-armed notified scheduled messages after restart',
    );
  }
}

// ─── Cancel handler ───────────────────────────────────────────────────────────

/**
 * Handle a cancel command for a scheduled message.
 * Called from messageHandler when owner replies "cancel" to a notification.
 *
 * @param sock - Active WhatsApp socket (to send confirmation)
 * @param notificationMsgId - The stanzaId of the quoted notification message
 * @returns true if a message was found and cancelled; false if not found or already past
 */
export async function handleScheduledMessageCancel(
  sock: NonNullable<ReturnType<typeof getState>['sock']>,
  notificationMsgId: string,
): Promise<boolean> {
  const msg = getScheduledMessageByNotificationMsgId(notificationMsgId);
  if (!msg || msg.status !== 'notified') {
    // Silent: late cancel (already sent) or not found
    return false;
  }

  markScheduledMessageCancelled(msg.id);   // DB: status='cancelled', cancelRequestedAt=now
  cancelScheduledMessage(msg.id);          // in-memory: clears setTimeout (keyed by UUID, not notificationMsgId)

  await sock.sendMessage(config.USER_JID, { text: 'Scheduled message cancelled.' });

  logger.info({ id: msg.id, notificationMsgId }, 'Scheduled message cancelled by owner');
  return true;
}

// ─── Public timer API ─────────────────────────────────────────────────────────

/**
 * Public wrapper for arming an in-memory timer for a newly created or rescheduled
 * scheduled message. Calls scheduleMessage with the module-internal dispatchCallback,
 * avoiding the need to export dispatchCallback directly.
 */
export function scheduleNewMessage(id: string, scheduledAt: number): void {
  // Schedule notification 10 minutes before send time
  scheduleMessage(id, scheduledAt - NOTIFICATION_LEAD_MS, dispatchCallback);
}

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the scheduled message scheduler: recover missed messages, start
 * the periodic scan, and schedule all upcoming messages.
 *
 * Safe to call on every WhatsApp reconnect — periodic scan clears previous
 * interval, activeTimers Map dedup prevents duplicate timers.
 *
 * All callbacks use dispatchCallback which routes:
 * - 'pending' messages -> sendPreSendNotification (full pipeline)
 * - 'notified' messages -> fireMessage (re-arm fire only, no duplicate notification)
 */
export async function initScheduledMessageScheduler(): Promise<void> {
  // Recovery first — fast, just schedules timeouts
  await recoverMessages();

  // Periodic scan is safe to restart (clears previous interval internally)
  startPeriodicScan(dispatchCallback, NOTIFICATION_LEAD_MS);

  scheduleAllUpcoming(dispatchCallback, NOTIFICATION_LEAD_MS);

  if (!initialized) {
    logger.info('Scheduled message scheduler initialized');
    initialized = true;
  } else {
    logger.info('Scheduled message scheduler re-initialized after reconnect');
  }
}

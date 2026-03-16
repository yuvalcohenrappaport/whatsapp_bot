import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { getSetting } from '../db/queries/settings.js';
import { commitmentDetection } from './CommitmentDetectionService.js';
import { detectMessageLanguage } from '../calendar/calendarApproval.js';
import { insertReminder } from '../db/queries/reminders.js';
import { scheduleReminder } from '../reminders/reminderScheduler.js';
import { fireReminder } from '../reminders/reminderService.js';
import {
  createPersonalCalendarEvent,
  getSelectedCalendarId,
} from '../calendar/personalCalendarService.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Cooldown state ──────────────────────────────────────────────────────────

/** Per-chat JID -> last Gemini call timestamp (ms) */
const chatCooldowns = new Map<string, number>();

/** 5-minute cooldown per chat to avoid rapid-fire Gemini calls */
const COOLDOWN_MS = 5 * 60 * 1000;

// ─── Time formatting ─────────────────────────────────────────────────────────

const timeFormatterEn = new Intl.DateTimeFormat('en-IL', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const timeFormatterHe = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isOnCooldown(chatJid: string): boolean {
  const last = chatCooldowns.get(chatJid);
  if (last === undefined) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function isBlocklisted(contactJid: string): boolean {
  const raw = getSetting('commitment_blocklist');
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(contactJid);
  } catch {
    return false;
  }
}

function isIncomingAllowed(contactJid: string): boolean {
  const raw = getSetting('commitment_incoming_allowlist');
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(contactJid);
  } catch {
    return false;
  }
}

function buildCommitmentNotification(params: {
  task: string;
  contactName: string | null;
  originalText: string;
  fireAt: number;
  chatText: string;
}): string {
  const lang = detectMessageLanguage(params.chatText);
  const snippet =
    params.originalText.length > 100
      ? params.originalText.slice(0, 100) + '...'
      : params.originalText;
  const name = params.contactName ?? 'Unknown';
  const formatter = lang === 'he' ? timeFormatterHe : timeFormatterEn;
  const time = formatter.format(new Date(params.fireAt));

  if (lang === 'he') {
    return `\uD83D\uDD14 \u05D4\u05EA\u05D7\u05D9\u05D9\u05D1\u05D5\u05EA \u05D6\u05D5\u05D4\u05EA\u05D4: ${params.task}\n\uD83D\uDC64 ${name}\n\uD83D\uDCAC "${snippet}"\n\u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E0\u05E7\u05D1\u05E2\u05D4 \u05DC-${time}. \u05D4\u05E9\u05D1 cancel \u05DC\u05D4\u05E1\u05E8\u05D4.`;
  }

  return `\uD83D\uDD14 Commitment detected: ${params.task}\n\uD83D\uDC64 ${name}\n\uD83D\uDCAC "${snippet}"\nReminder set for ${time}. Reply cancel to remove.`;
}

// ─── Main pipeline function ──────────────────────────────────────────────────

export async function processCommitment(params: {
  messageId: string;
  contactJid: string;
  contactName: string | null;
  text: string;
  timestamp: number;
  fromMe: boolean;
}): Promise<void> {
  try {
    const { contactJid, contactName, text, timestamp, fromMe } = params;

    // a. Check master switch
    if (getSetting('commitment_detection_enabled') === 'false') return;

    // b. Skip self-chat
    if (contactJid === config.USER_JID) return;

    // c. Incoming messages: check allowlist
    if (!fromMe) {
      if (!isIncomingAllowed(contactJid)) return;
    }

    // d. Check blocklist
    if (isBlocklisted(contactJid)) return;

    // e. Pre-filter
    if (!commitmentDetection.passesPreFilter(text, fromMe)) return;

    // f. Check cooldown
    if (isOnCooldown(contactJid)) return;

    // g. Set cooldown BEFORE async Gemini call (avoid race condition)
    chatCooldowns.set(contactJid, Date.now());

    // h. Extract commitments via Gemini
    const commitments = await commitmentDetection.extractCommitments(text, {
      contactName,
      contactJid,
      fromMe,
    });

    if (commitments.length === 0) return;

    // i. Process each extracted commitment
    for (const commitment of commitments) {
      const fireAt = commitment.dateTime
        ? commitment.dateTime.getTime()
        : timestamp + 24 * 60 * 60 * 1000; // 24h default for timeless

      const id = randomUUID();

      // Insert reminder with commitment source tracking
      insertReminder({
        id,
        task: commitment.task,
        fireAt,
        source: 'commitment',
        sourceContactJid: contactJid,
      });

      // Smart routing (same pattern as reminderService)
      const hoursUntil = (fireAt - Date.now()) / 3_600_000;

      if (hoursUntil <= 24) {
        scheduleReminder(id, fireAt, (remId) => {
          fireReminder(remId);
        });
      }

      if (hoursUntil > 24) {
        const calendarId = getSelectedCalendarId();
        if (calendarId) {
          try {
            await createPersonalCalendarEvent({
              calendarId,
              title: `Reminder: ${commitment.task}`,
              date: new Date(fireAt),
              description: `Commitment from ${contactName ?? contactJid}: ${commitment.task}`,
            });
          } catch (err) {
            logger.warn(
              { err, id },
              'Failed to create calendar event for commitment — WhatsApp delivery will still work',
            );
          }
        }
      }

      // Build and send notification to self-chat
      const notification = buildCommitmentNotification({
        task: commitment.task,
        contactName,
        originalText: commitment.originalText,
        fireAt,
        chatText: text,
      });

      const sock = getState().sock;
      if (sock) {
        await sock.sendMessage(config.USER_JID, { text: notification });
      }

      logger.info(
        { id, task: commitment.task, contactJid, fireAt, source: 'commitment' },
        'Commitment reminder created',
      );
    }
  } catch (err) {
    logger.error(
      { err, messageId: params.messageId },
      'Error in commitment pipeline — skipping',
    );
  }
}

import { randomUUID } from 'crypto';
import pino from 'pino';
import { config } from '../config.js';
import { calendarDetection } from './CalendarDetectionService.js';
import { computeContentHash, isSimilarEvent } from './calendarDedup.js';
import {
  insertPersonalPendingEvent,
  findPendingEventByContentHash,
  findSimilarPendingEvents,
  updatePendingEventDetails,
  getPersonalPendingEvent,
} from '../db/queries/personalPendingEvents.js';
import { sendEventNotification, type PendingEvent } from './calendarApproval.js';
import { getState } from '../api/state.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Date keyword pre-filter ─────────────────────────────────────────────────

/**
 * Secondary keyword check to reduce false Gemini calls.
 * Text must contain at least one date-related word in English or Hebrew.
 */
const DATE_KEYWORDS_RE = new RegExp(
  [
    // English
    'tomorrow', 'today', 'tonight',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'next\\s+week', 'next\\s+month',
    '\\bam\\b', '\\bpm\\b',
    // Hebrew
    'מחר', 'היום', 'הערב',
    'יום\\s*ראשון', 'יום\\s*שני', 'יום\\s*שלישי', 'יום\\s*רביעי',
    'יום\\s*חמישי', 'יום\\s*שישי', 'שבת',
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
    'שבוע\\s+הבא', 'חודש\\s+הבא',
    'בבוקר', 'בערב', 'בלילה',
  ].join('|'),
  'i',
);

function hasDateKeyword(text: string): boolean {
  return DATE_KEYWORDS_RE.test(text);
}

// ─── Exported pipeline functions ─────────────────────────────────────────────

export async function processPrivateMessage(params: {
  messageId: string;
  contactJid: string;
  contactName: string | null;
  text: string;
  timestamp: number;
  fromMe: boolean;
  isForwarded: boolean;
}): Promise<void> {
  try {
    const { messageId, contactJid, contactName, text, timestamp, fromMe, isForwarded } = params;

    // Skip self-chat (commands, not content)
    if (contactJid === config.USER_JID) return;

    // Enhanced pre-filter: must have a digit AND a date keyword
    if (!calendarDetection.hasDateSignal(text) || !hasDateKeyword(text)) return;

    // Forwarded message dedup via content hash
    let contentHash: string | null = null;
    if (isForwarded) {
      contentHash = computeContentHash(text);
      const existing = findPendingEventByContentHash(contentHash);
      if (existing) {
        logger.debug({ messageId, contentHash }, 'Forwarded message already has pending event — skipping');
        return;
      }
    }

    // Extract dates via Gemini
    const extractedDates = await calendarDetection.extractDates(text, {
      senderName: contactName,
      chatName: contactName,
      chatType: 'private',
    });

    if (extractedDates.length === 0) return;

    // Process each extracted date
    for (const extracted of extractedDates) {
      const eventDate = extracted.date.getTime();

      // Check for similar existing pending events in same chat
      const similar = findSimilarPendingEvents(contactJid, eventDate);
      const match = similar.find((existing) =>
        isSimilarEvent(
          { sourceChatJid: existing.sourceChatJid, eventDate: existing.eventDate, title: existing.title },
          { sourceChatJid: contactJid, eventDate, title: extracted.title },
        ),
      );

      if (match) {
        // Update existing event with more details
        updatePendingEventDetails(match.id, {
          title: extracted.title,
          eventDate,
          location: extracted.location ?? match.location,
          description: extracted.description ?? match.description,
          isAllDay: extracted.isAllDay ?? false,
        });
        logger.info({ existingId: match.id, title: extracted.title }, 'Updated existing pending event with new details');

        // Re-send notification with updated details
        const sock = getState().sock;
        if (sock) {
          const updated = getPersonalPendingEvent(match.id);
          if (updated) {
            sendEventNotification(sock, match.id, updated as PendingEvent).catch(() => {});
          }
        }
      } else {
        // Insert new pending event
        const id = randomUUID();
        insertPersonalPendingEvent({
          id,
          sourceChatJid: contactJid,
          sourceChatName: contactName,
          senderJid: fromMe ? config.USER_JID : contactJid,
          senderName: fromMe ? null : contactName,
          sourceMessageId: messageId,
          sourceMessageText: text,
          title: extracted.title,
          eventDate,
          location: extracted.location,
          description: extracted.description,
          url: extracted.url,
          contentHash,
          isAllDay: extracted.isAllDay ?? false,
        });
        logger.info({ id, title: extracted.title, contactJid }, 'Created personal pending event from private message');

        // Send notification to self-chat
        const sock = getState().sock;
        if (sock) {
          const inserted = getPersonalPendingEvent(id);
          if (inserted) {
            sendEventNotification(sock, id, inserted as PendingEvent).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err, messageId: params.messageId }, 'Error in personal calendar private message processing');
  }
}

export async function processGroupMessage(params: {
  messageId: string;
  groupJid: string;
  groupName: string | null;
  senderJid: string;
  senderName: string | null;
  text: string;
  timestamp: number;
  isForwarded: boolean;
}): Promise<void> {
  try {
    const { messageId, groupJid, groupName, senderJid, senderName, text, timestamp, isForwarded } = params;

    // Enhanced pre-filter: must have a digit AND a date keyword
    if (!calendarDetection.hasDateSignal(text) || !hasDateKeyword(text)) return;

    // Forwarded message dedup via content hash
    let contentHash: string | null = null;
    if (isForwarded) {
      contentHash = computeContentHash(text);
      const existing = findPendingEventByContentHash(contentHash);
      if (existing) {
        logger.debug({ messageId, contentHash }, 'Forwarded message already has pending event — skipping');
        return;
      }
    }

    // Extract dates via Gemini
    const extractedDates = await calendarDetection.extractDates(text, {
      senderName,
      chatName: groupName,
      chatType: 'group',
    });

    if (extractedDates.length === 0) return;

    // Process each extracted date
    for (const extracted of extractedDates) {
      const eventDate = extracted.date.getTime();

      // Check for similar existing pending events in same chat
      const similar = findSimilarPendingEvents(groupJid, eventDate);
      const match = similar.find((existing) =>
        isSimilarEvent(
          { sourceChatJid: existing.sourceChatJid, eventDate: existing.eventDate, title: existing.title },
          { sourceChatJid: groupJid, eventDate, title: extracted.title },
        ),
      );

      if (match) {
        updatePendingEventDetails(match.id, {
          title: extracted.title,
          eventDate,
          location: extracted.location ?? match.location,
          description: extracted.description ?? match.description,
          isAllDay: extracted.isAllDay ?? false,
        });
        logger.info({ existingId: match.id, title: extracted.title }, 'Updated existing pending event with new details');

        // Re-send notification with updated details
        const sock = getState().sock;
        if (sock) {
          const updated = getPersonalPendingEvent(match.id);
          if (updated) {
            sendEventNotification(sock, match.id, updated as PendingEvent).catch(() => {});
          }
        }
      } else {
        const id = randomUUID();
        insertPersonalPendingEvent({
          id,
          sourceChatJid: groupJid,
          sourceChatName: groupName,
          senderJid,
          senderName,
          sourceMessageId: messageId,
          sourceMessageText: text,
          title: extracted.title,
          eventDate,
          location: extracted.location,
          description: extracted.description,
          url: extracted.url,
          contentHash,
          isAllDay: extracted.isAllDay ?? false,
        });
        logger.info({ id, title: extracted.title, groupJid }, 'Created personal pending event from group message');

        // Send notification to self-chat
        const sock = getState().sock;
        if (sock) {
          const inserted = getPersonalPendingEvent(id);
          if (inserted) {
            sendEventNotification(sock, id, inserted as PendingEvent).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err, messageId: params.messageId }, 'Error in personal calendar group message processing');
  }
}

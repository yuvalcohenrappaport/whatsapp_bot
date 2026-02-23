import crypto from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { getGroup, updateGroup } from '../db/queries/groups.js';
import { getGroupMessagesSince } from '../db/queries/groupMessages.js';
import {
  insertCalendarEvent,
  updateCalendarEventConfirmation,
  getCalendarEventByConfirmationMsgId,
  deleteCalendarEvent as deleteCalendarEventRecord,
} from '../db/queries/calendarEvents.js';
import { hasNumberPreFilter, extractDates } from './dateExtractor.js';
import {
  createCalendarEvent,
  createGroupCalendar,
  shareCalendar,
  deleteCalendarEvent as deleteCalendarEventApi,
} from '../calendar/calendarService.js';
import { getState } from '../api/state.js';
import { setGroupMessageCallback } from '../pipeline/messageHandler.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: string;
  senderJid: string;
  senderName: string | null;
  body: string;
  timestamp: number;
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** Debounce buffers: groupJid -> { messages, timer } */
const debounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();

/** In-memory cache of groupJid -> calendarId (to avoid re-reading from calendarLink) */
const calendarIdCache = new Map<string, string>();

/** Debounce window in ms */
const DEBOUNCE_MS = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract calendarId from a calendarLink URL.
 * Format: https://calendar.google.com/calendar/embed?src={encodedCalendarId}
 */
function getCalendarIdFromLink(calendarLink: string): string | null {
  try {
    const url = new URL(calendarLink);
    const src = url.searchParams.get('src');
    return src ? decodeURIComponent(src) : null;
  } catch {
    return null;
  }
}

/**
 * Format a Date for display in a confirmation message.
 * Returns e.g. "Tuesday, March 5 at 3:00 PM"
 */
function formatDateForDisplay(date: Date): string {
  return date.toLocaleString('en-IL', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
}

/**
 * Detect whether the group predominantly uses Hebrew based on recent messages.
 * Counts Hebrew chars (U+0590-U+05FF) vs Latin chars.
 */
async function detectGroupLanguage(groupJid: string): Promise<'he' | 'en'> {
  try {
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000; // Last 7 days
    const recentMsgs = getGroupMessagesSince(groupJid, sinceMs, 10);

    let hebrewChars = 0;
    let latinChars = 0;

    for (const msg of recentMsgs) {
      hebrewChars += (msg.body.match(/[\u0590-\u05FF]/g) ?? []).length;
      latinChars += (msg.body.match(/[a-zA-Z]/g) ?? []).length;
    }

    return hebrewChars >= latinChars ? 'he' : 'en';
  } catch {
    return 'en'; // Default to English on error
  }
}

/**
 * Build confirmation message text based on language.
 */
function buildConfirmationText(
  lang: 'he' | 'en',
  title: string,
  date: Date,
  calendarLink: string,
): string {
  const dateStr = formatDateForDisplay(date);
  if (lang === 'he') {
    return `קלטתי! הוספתי ${title} ב${dateStr} ללוח השנה\n${calendarLink}`;
  }
  return `Got it! Added ${title} on ${dateStr} to the calendar\n${calendarLink}`;
}

/**
 * Build delete confirmation message text based on language.
 */
function buildDeleteConfirmText(lang: 'he' | 'en', title: string): string {
  if (lang === 'he') {
    return `נמחק: ${title}`;
  }
  return `Deleted: ${title}`;
}

/**
 * Check if a message body is a delete trigger.
 * Matches: "delete", "מחק", or ❌ emoji (case-insensitive, trimmed).
 */
function isDeleteTrigger(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed === 'delete' || trimmed === 'מחק' || body.trim() === '❌';
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Process a batch of group messages for date extraction and calendar event creation.
 */
async function processGroupMessages(
  groupJid: string,
  messages: GroupMsg[],
): Promise<void> {
  const group = getGroup(groupJid);
  if (!group) {
    logger.warn({ groupJid }, 'Group not found during pipeline processing');
    return;
  }

  for (const msg of messages) {
    try {
      // Pre-filter: skip messages without any digits
      if (!hasNumberPreFilter(msg.body)) {
        logger.debug({ msgId: msg.id }, 'Pre-filter: no digits, skipping Gemini');
        continue;
      }

      // Extract dates using Gemini
      const extractedDates = await extractDates(
        msg.body,
        msg.senderName,
        group.name ?? null,
      );

      if (extractedDates.length === 0) {
        logger.debug({ msgId: msg.id }, 'No high-confidence dates extracted');
        continue;
      }

      // Ensure group has a calendar (lazy creation)
      let calendarId = calendarIdCache.get(groupJid);
      let calendarLink = group.calendarLink ?? null;

      if (!calendarId || !calendarLink) {
        // Try to get calendarId from existing calendarLink
        if (calendarLink) {
          const parsedId = getCalendarIdFromLink(calendarLink);
          if (parsedId) {
            calendarId = parsedId;
            calendarIdCache.set(groupJid, calendarId);
          }
        }

        // If still no calendarId, create a new calendar
        if (!calendarId) {
          logger.info({ groupJid }, 'Creating group calendar');
          const calendarResult = await createGroupCalendar(
            group.name ?? groupJid,
          );

          if (!calendarResult) {
            logger.warn(
              { groupJid },
              'Failed to create group calendar — skipping event creation',
            );
            continue;
          }

          calendarId = calendarResult.calendarId;
          calendarLink = calendarResult.calendarLink;
          calendarIdCache.set(groupJid, calendarId);

          // Persist calendarLink to DB
          updateGroup(groupJid, { calendarLink });

          // Share with member emails if any
          const memberEmailsRaw = group.memberEmails;
          if (memberEmailsRaw) {
            try {
              const emails: string[] = JSON.parse(memberEmailsRaw);
              if (emails.length > 0) {
                await shareCalendar(calendarId, emails);
              }
            } catch {
              logger.warn(
                { groupJid },
                'Failed to parse memberEmails for calendar sharing',
              );
            }
          }
        }
      }

      if (!calendarId || !calendarLink) {
        logger.warn({ groupJid }, 'No calendarId available — skipping event creation');
        continue;
      }

      // Create a calendar event for each extracted date
      for (const extracted of extractedDates) {
        try {
          const description = `${msg.body}\n\nSent by: ${msg.senderName ?? msg.senderJid}\nGroup: ${group.name ?? groupJid}`;

          const calendarEventId = await createCalendarEvent({
            calendarId,
            title: extracted.title,
            date: extracted.date,
            description,
          });

          if (!calendarEventId) {
            logger.warn(
              { title: extracted.title },
              'Failed to create calendar event — skipping',
            );
            continue;
          }

          // Save event record to DB
          const eventRecordId = crypto.randomUUID();
          insertCalendarEvent({
            id: eventRecordId,
            groupJid,
            messageId: msg.id,
            calendarId,
            calendarEventId,
            title: extracted.title,
            eventDate: extracted.date.getTime(),
          });

          logger.info(
            { eventRecordId, title: extracted.title, groupJid },
            'Calendar event created and saved',
          );

          // Send confirmation in group
          const { sock } = getState();
          if (!sock) {
            logger.warn({ groupJid }, 'sock is null — cannot send group confirmation');
            continue;
          }

          const lang = await detectGroupLanguage(groupJid);
          const confirmationText = buildConfirmationText(
            lang,
            extracted.title,
            extracted.date,
            calendarLink,
          );

          const sent = await sock.sendMessage(groupJid, { text: confirmationText });
          const sentMsgId = sent?.key?.id ?? null;

          if (sentMsgId) {
            updateCalendarEventConfirmation(eventRecordId, sentMsgId);
            logger.debug(
              { sentMsgId, eventRecordId },
              'Confirmation message sent and linked to event record',
            );
          }
        } catch (eventErr) {
          logger.error(
            { err: eventErr, title: extracted.title },
            'Error creating calendar event for extracted date',
          );
        }
      }
    } catch (msgErr) {
      logger.error(
        { err: msgErr, msgId: msg.id },
        'Error processing group message in pipeline',
      );
    }
  }
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

/**
 * Add a message to the debounce buffer for a group and reset the timer.
 * After 10 seconds of no new messages, processGroupMessages is called.
 */
function addToDebounce(groupJid: string, msg: GroupMsg): void {
  const existing = debounceBuffers.get(groupJid);

  if (existing) {
    // Reset timer
    clearTimeout(existing.timer);
    existing.messages.push(msg);

    existing.timer = setTimeout(() => {
      debounceBuffers.delete(groupJid);
      processGroupMessages(groupJid, existing.messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in debounced processGroupMessages');
      });
    }, DEBOUNCE_MS);
  } else {
    // New buffer
    const messages = [msg];
    const timer = setTimeout(() => {
      debounceBuffers.delete(groupJid);
      processGroupMessages(groupJid, messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in debounced processGroupMessages');
      });
    }, DEBOUNCE_MS);

    debounceBuffers.set(groupJid, { messages, timer });
  }
}

// ─── Reply-to-delete handler ──────────────────────────────────────────────────

/**
 * Handle a potential reply-to-delete action.
 * Returns true if the message was a delete action (caller should not process further).
 */
async function handleReplyToDelete(
  groupJid: string,
  msg: GroupMsg,
  quotedMessageId: string | null,
): Promise<boolean> {
  if (!quotedMessageId) return false;

  // Check if this is a reply to a bot confirmation message
  const calendarEventRecord = getCalendarEventByConfirmationMsgId(quotedMessageId);
  if (!calendarEventRecord) return false;

  // Check if the body is a delete trigger
  if (!isDeleteTrigger(msg.body)) return false;

  logger.info(
    { msgId: msg.id, eventTitle: calendarEventRecord.title },
    'Reply-to-delete triggered — deleting calendar event',
  );

  // Delete from Google Calendar
  await deleteCalendarEventApi(
    calendarEventRecord.calendarId,
    calendarEventRecord.calendarEventId,
  );

  // Delete from DB
  deleteCalendarEventRecord(calendarEventRecord.id);

  // Send delete confirmation
  const { sock } = getState();
  if (sock) {
    const lang = await detectGroupLanguage(groupJid);
    const confirmText = buildDeleteConfirmText(lang, calendarEventRecord.title);
    await sock.sendMessage(groupJid, { text: confirmText });
  }

  return true;
}

// ─── Pipeline init ────────────────────────────────────────────────────────────

/**
 * Register the group message callback and initialize the date extraction pipeline.
 * Call this during application startup, after initDb() and before startSocket().
 */
export function initGroupPipeline(): void {
  setGroupMessageCallback(
    async (
      groupJid: string,
      msg: { id: string; senderJid: string; senderName: string | null; body: string; timestamp: number },
      quotedMessageId: string | null,
    ) => {
      try {
        // Reply-to-delete check runs immediately (not debounced)
        const wasDelete = await handleReplyToDelete(groupJid, msg, quotedMessageId);
        if (wasDelete) return;

        // Add to debounce buffer for batch processing
        addToDebounce(groupJid, msg);
      } catch (err) {
        logger.error(
          { err, groupJid, msgId: msg.id },
          'Error in group message pipeline callback',
        );
      }
    },
  );

  logger.info('Group message pipeline initialized');
}

import type { WASocket } from '@whiskeysockets/baileys';
import { z } from 'zod';
import pino from 'pino';
import { config } from '../config.js';
import { generateJson } from '../ai/provider.js';
import {
  createPersonalCalendarEvent,
  getSelectedCalendarId,
} from './personalCalendarService.js';
import {
  updatePersonalPendingEventStatus,
  updatePersonalPendingEventNotificationMsgId,
} from '../db/queries/personalPendingEvents.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a row from the personalPendingEvents table. */
export interface PendingEvent {
  id: string;
  sourceChatJid: string;
  sourceChatName: string | null;
  senderJid: string;
  senderName: string | null;
  sourceMessageId: string;
  sourceMessageText: string;
  title: string;
  eventDate: number; // Unix ms
  location: string | null;
  description: string | null;
  url: string | null;
  status: string;
  notificationMsgId: string | null;
  contentHash: string | null;
  isAllDay: boolean;
  createdAt: number;
}

// ─── Language detection ───────────────────────────────────────────────────────

/**
 * Detect message language by counting Hebrew vs Latin characters.
 * Returns 'he' if Hebrew chars >= Latin chars, else 'en'.
 */
export function detectMessageLanguage(text: string): 'he' | 'en' {
  let hebrew = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0590 && code <= 0x05ff) hebrew++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
  }
  return hebrew >= latin ? 'he' : 'en';
}

// ─── Notification building ────────────────────────────────────────────────────

/**
 * Build a self-chat notification message for a detected calendar event.
 */
export function buildEventNotification(
  event: {
    title: string;
    eventDate: number;
    isAllDay: boolean;
    senderName: string | null;
    sourceChatName: string | null;
    sourceMessageText: string;
  },
  lang: 'he' | 'en',
): string {
  // Format date
  const date = new Date(event.eventDate);
  const locale = lang === 'he' ? 'he-IL' : 'en-IL';
  const tz = 'Asia/Jerusalem';

  const formattedDate = event.isAllDay
    ? date.toLocaleDateString(locale, { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : date.toLocaleString(locale, { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Source line
  const chatLabel = event.sourceChatName ?? (lang === 'he' ? 'צ\'אט פרטי' : 'private chat');
  const source = event.senderName
    ? `${event.senderName} (${chatLabel})`
    : chatLabel;

  // Text snippet (max 100 chars)
  const snippet = event.sourceMessageText.length > 100
    ? event.sourceMessageText.slice(0, 97) + '...'
    : event.sourceMessageText;

  if (lang === 'he') {
    return [
      `\u{1F4C5} אירוע חדש: ${event.title}`,
      `\u{1F4C6} ${formattedDate}`,
      `\u{1F464} ${source}`,
      `\u{1F4AC} "${snippet}"`,
      '',
      'השב *approve* לאישור | *reject* לדחייה',
    ].join('\n');
  }

  return [
    `\u{1F4C5} New event: ${event.title}`,
    `\u{1F4C6} ${formattedDate}`,
    `\u{1F464} ${source}`,
    `\u{1F4AC} "${snippet}"`,
    '',
    'Reply *approve* to confirm | *reject* to decline',
  ].join('\n');
}

// ─── Send notification ────────────────────────────────────────────────────────

/**
 * Send a self-chat notification for a pending event and store the notification message ID.
 */
export async function sendEventNotification(
  sock: WASocket,
  eventId: string,
  event: PendingEvent,
): Promise<void> {
  try {
    const lang = detectMessageLanguage(event.sourceMessageText);
    const text = buildEventNotification(event, lang);

    const sent = await sock.sendMessage(config.USER_JID, { text });
    const msgId = sent?.key?.id;

    if (msgId) {
      updatePersonalPendingEventNotificationMsgId(eventId, msgId);
      logger.info({ eventId, msgId }, 'Sent calendar event notification to self-chat');
    } else {
      logger.warn({ eventId }, 'Calendar notification sent but no message ID returned');
    }
  } catch (err) {
    logger.error({ err, eventId }, 'Failed to send calendar event notification');
  }
}

// ─── Edit parsing via Gemini ──────────────────────────────────────────────────

const EventEditSchema = z.object({
  changes: z.object({
    title: z.string().optional(),
    date: z.string().optional().describe('ISO 8601 date string if user changed the date'),
    time: z.string().optional().describe('Time in HH:mm format if user changed the time'),
    location: z.string().optional(),
  }),
});

const EVENT_EDIT_JSON_SCHEMA = z.toJSONSchema(EventEditSchema);

async function parseEventEdit(
  originalEvent: PendingEvent,
  editText: string,
): Promise<{ title?: string; eventDate?: number; location?: string } | null> {
  const originalDate = new Date(originalEvent.eventDate);

  try {
    const raw = await generateJson<{ changes: { title?: string; date?: string; time?: string; location?: string } }>({
      systemPrompt: `The user is approving a calendar event but wants to modify some details. Original event: title="${originalEvent.title}", date="${originalDate.toISOString()}", location="${originalEvent.location ?? 'none'}". User says: '${editText}'. Extract any field changes. If the user mentions a new time, put it in 'time'. If they mention a new date, put it in 'date' as ISO 8601. Timezone: Asia/Jerusalem.`,
      userContent: editText,
      jsonSchema: EVENT_EDIT_JSON_SCHEMA as Record<string, unknown>,
      schemaName: 'event_edit',
    });

    if (!raw?.changes) return null;

    const result: { title?: string; eventDate?: number; location?: string } = {};

    if (raw.changes.title) result.title = raw.changes.title;
    if (raw.changes.location) result.location = raw.changes.location;

    // Handle date/time changes
    if (raw.changes.date) {
      const newDate = new Date(raw.changes.date);
      if (!isNaN(newDate.getTime())) result.eventDate = newDate.getTime();
    } else if (raw.changes.time) {
      // Apply time change to the original date
      const match = raw.changes.time.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const updated = new Date(originalEvent.eventDate);
        updated.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
        result.eventDate = updated.getTime();
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    logger.error({ err, eventId: originalEvent.id }, 'Failed to parse event edit via Gemini');
    return null;
  }
}

// ─── Main approval handler ────────────────────────────────────────────────────

/**
 * Handle a self-chat reply to a calendar event notification.
 * Processes approve/reject/edit commands.
 * Returns true always (command was handled).
 */
export async function handleCalendarApproval(
  sock: WASocket,
  event: PendingEvent,
  replyText: string,
): Promise<boolean> {
  const trimmed = replyText.trim().toLowerCase();
  const lang = detectMessageLanguage(event.sourceMessageText);

  // Format date for confirmations
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const locale = lang === 'he' ? 'he-IL' : 'en-IL';
    return event.isAllDay
      ? d.toLocaleDateString(locale, { timeZone: 'Asia/Jerusalem' })
      : d.toLocaleString(locale, { timeZone: 'Asia/Jerusalem' });
  };

  // ─── Reject ───
  if (trimmed === 'reject' || trimmed === 'דחה') {
    updatePersonalPendingEventStatus(event.id, 'rejected');
    const msg = lang === 'he'
      ? `אירוע נדחה: ${event.title}`
      : `Event rejected: ${event.title}`;
    await sock.sendMessage(config.USER_JID, { text: msg });
    logger.info({ eventId: event.id, title: event.title }, 'Calendar event rejected');
    return true;
  }

  // ─── Approve (exact) ───
  if (trimmed === 'approve' || trimmed === 'אשר') {
    await approveEvent(sock, event, lang, formatDate);
    return true;
  }

  // ─── Approve with edits ───
  if (trimmed.startsWith('approve') && trimmed.length > 'approve'.length) {
    const editText = replyText.trim().slice('approve'.length).trim();
    const edits = await parseEventEdit(event, editText);

    if (edits) {
      // Apply edits to a copy for the approval
      const modified = { ...event };
      if (edits.title) modified.title = edits.title;
      if (edits.eventDate) {
        modified.eventDate = edits.eventDate;
        modified.isAllDay = false; // explicit time = not all-day
      }
      if (edits.location) modified.location = edits.location;
      await approveEvent(sock, modified, lang, formatDate);
    } else {
      // Gemini failed to parse edits — approve as-is and notify
      const notice = lang === 'he'
        ? 'לא הצלחתי לפענח את השינויים — מאשר את האירוע כמות שהוא.'
        : 'Could not parse your edits — approving the event as-is.';
      await sock.sendMessage(config.USER_JID, { text: notice });
      await approveEvent(sock, event, lang, formatDate);
    }
    return true;
  }

  // ─── Unrecognized reply to a calendar notification — treat as no-op ───
  const help = lang === 'he'
    ? 'השב *approve* לאישור, *reject* לדחייה, או "approve but change to..." לעריכה.'
    : 'Reply *approve* to confirm, *reject* to decline, or "approve but change to..." to edit.';
  await sock.sendMessage(config.USER_JID, { text: help });
  return true;
}

// ─── Approve helper ───────────────────────────────────────────────────────────

async function approveEvent(
  sock: WASocket,
  event: PendingEvent,
  lang: 'he' | 'en',
  formatDate: (ts: number) => string,
): Promise<void> {
  const calendarId = getSelectedCalendarId();
  if (!calendarId) {
    const msg = lang === 'he'
      ? 'לא נבחר לוח שנה. יש לחבר את Google Calendar דרך ההגדרות.'
      : 'No calendar selected. Please connect Google Calendar in Settings.';
    await sock.sendMessage(config.USER_JID, { text: msg });
    return;
  }

  const eventId = await createPersonalCalendarEvent({
    calendarId,
    title: event.title,
    date: new Date(event.eventDate),
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    isAllDay: event.isAllDay,
  });

  // Update status regardless of Google Calendar result
  updatePersonalPendingEventStatus(event.id, 'approved');

  if (eventId) {
    const msg = lang === 'he'
      ? `אירוע נוצר: ${event.title} ב-${formatDate(event.eventDate)}`
      : `Event created: ${event.title} on ${formatDate(event.eventDate)}`;
    await sock.sendMessage(config.USER_JID, { text: msg });
    logger.info({ eventId, pendingId: event.id, title: event.title }, 'Calendar event approved and created');
  } else {
    const msg = lang === 'he'
      ? `האירוע אושר אך לא נוצר ב-Google Calendar (בדוק חיבור). ${event.title}`
      : `Event approved but could not be created in Google Calendar (check connection). ${event.title}`;
    await sock.sendMessage(config.USER_JID, { text: msg });
    logger.warn({ pendingId: event.id, title: event.title }, 'Calendar event approved but Google Calendar creation failed');
  }
}

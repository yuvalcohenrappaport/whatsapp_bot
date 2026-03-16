import crypto from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { createCalendarEvent } from '../calendar/calendarService.js';
import {
  insertCalendarEvent,
  updateCalendarEventConfirmation,
} from '../db/queries/calendarEvents.js';
import {
  insertPendingSuggestion,
  getPendingSuggestionByMsgId,
  deletePendingSuggestion,
  getUnexpiredPendingSuggestions,
  deleteExpiredPendingSuggestions,
} from '../db/queries/pendingSuggestions.js';
import {
  buildConfirmationText,
  detectGroupLanguage,
} from './calendarHelpers.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PendingSuggestion {
  id: string;
  groupJid: string;
  suggestionMsgId: string;
  title: string;
  eventDate: number; // Unix ms
  location: string | null;
  description: string | null;
  url: string | null;
  calendarId: string;
  calendarLink: string;
  sourceMessageId: string;
  senderName: string | null;
  expiresAt: number; // Unix ms
  timer: NodeJS.Timeout;
}

// ─── Module-level state ────────────────────────────────────────────────────────

const pendingSuggestions = new Map<string, PendingSuggestion>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build suggestion text in Hebrew per locked decision.
 * Format: "📅 להוסיף 'title' ב-date? השב ✅ או ❌"
 */
function buildSuggestionText(
  title: string,
  date: Date,
  location?: string | null,
): string {
  const dateStr = date.toLocaleString('he-IL', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
  const locationPart = location ? `, ${location}` : '';
  return `📅 להוסיף '${title}' ב-${dateStr}${locationPart}? השב ✅ או ❌`;
}

/**
 * Check if a pending suggestion with the same groupJid + title + eventDate
 * (within a 1-hour window) already exists in the in-memory Map.
 */
function isDuplicate(groupJid: string, title: string, eventDate: number): boolean {
  for (const s of pendingSuggestions.values()) {
    if (
      s.groupJid === groupJid &&
      s.title === title &&
      Math.abs(s.eventDate - eventDate) < 3_600_000
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Start a TTL timer that silently removes the suggestion from Map and DB on expiry.
 */
function startTtlTimer(id: string, remainingMs: number): NodeJS.Timeout {
  return setTimeout(() => {
    pendingSuggestions.delete(id);
    deletePendingSuggestion(id);
    logger.debug({ id }, 'Suggestion TTL expired — silently discarded');
  }, remainingMs);
}

/**
 * Build the description string for a Google Calendar event.
 */
function buildEventDescription(s: {
  title: string;
  description: string | null;
  url: string | null;
  senderName: string | null;
  sourceMessageId: string;
}): string {
  const parts: string[] = [];
  if (s.description) parts.push(s.description);
  if (s.url) parts.push(`Link: ${s.url}`);
  if (s.senderName) parts.push(`Suggested by: ${s.senderName}`);
  return parts.length > 0 ? parts.join('\n') : s.title;
}

// ─── Private: confirmSuggestion ───────────────────────────────────────────────

/**
 * Create the Google Calendar event and send a confirmation message.
 * On API failure: leave suggestion alive for retry, send Hebrew error message.
 */
async function confirmSuggestion(
  groupJid: string,
  suggestion: PendingSuggestion,
): Promise<void> {
  const calendarEventId = await createCalendarEvent({
    calendarId: suggestion.calendarId,
    title: suggestion.title,
    date: new Date(suggestion.eventDate),
    description: buildEventDescription(suggestion),
    location: suggestion.location ?? undefined,
  });

  if (calendarEventId === null) {
    // API failure — leave suggestion alive so user can retry
    logger.warn(
      { id: suggestion.id, title: suggestion.title },
      'confirmSuggestion: createCalendarEvent failed — suggestion kept alive for retry',
    );
    const { sock } = getState();
    if (sock) {
      await sock.sendMessage(groupJid, {
        text: 'לא הצלחתי להוסיף ללוח השנה, נסה שוב',
      });
    }
    return;
  }

  // Success: clean up timer, Map, and DB
  clearTimeout(suggestion.timer);
  pendingSuggestions.delete(suggestion.id);
  deletePendingSuggestion(suggestion.id);

  // Insert calendar event record
  const eventRecordId = crypto.randomUUID();
  insertCalendarEvent({
    id: eventRecordId,
    groupJid,
    messageId: suggestion.sourceMessageId,
    calendarId: suggestion.calendarId,
    calendarEventId,
    title: suggestion.title,
    eventDate: suggestion.eventDate,
  });

  logger.info(
    { eventRecordId, title: suggestion.title, groupJid },
    'Suggestion confirmed — calendar event created',
  );

  // Send confirmation message
  const { sock } = getState();
  if (!sock) {
    logger.warn({ groupJid }, 'confirmSuggestion: sock is null — cannot send confirmation');
    return;
  }

  const lang = await detectGroupLanguage(groupJid);
  const confirmationText = buildConfirmationText(
    lang,
    suggestion.title,
    new Date(suggestion.eventDate),
    suggestion.calendarLink,
  );

  const sent = await sock.sendMessage(groupJid, { text: confirmationText });
  const sentMsgId = sent?.key?.id ?? null;

  if (sentMsgId) {
    updateCalendarEventConfirmation(eventRecordId, sentMsgId);
    logger.debug(
      { sentMsgId, eventRecordId },
      'Confirmation message sent and linked to calendar event record',
    );
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

/**
 * Create a pending suggestion: send a Hebrew suggestion message to the group
 * and store it in the in-memory Map and DB with a 30-minute TTL.
 *
 * Called from the pipeline for each extracted date.
 */
export async function createSuggestion(
  groupJid: string,
  extracted: {
    title: string;
    date: Date;
    location?: string;
    description?: string;
    url?: string;
  },
  calendarId: string,
  calendarLink: string,
  sourceMessageId: string,
  senderName: string | null,
): Promise<void> {
  // Deduplication check
  if (isDuplicate(groupJid, extracted.title, extracted.date.getTime())) {
    logger.debug(
      { title: extracted.title, groupJid },
      'createSuggestion: duplicate suggestion skipped',
    );
    return;
  }

  // Need sock to send the suggestion message
  const { sock } = getState();
  if (!sock) {
    logger.warn({ groupJid }, 'createSuggestion: sock is null — cannot send suggestion message');
    return;
  }

  // Build and send the suggestion message
  const suggestionText = buildSuggestionText(
    extracted.title,
    extracted.date,
    extracted.location,
  );

  const sent = await sock.sendMessage(groupJid, { text: suggestionText });
  const suggestionMsgId = sent?.key?.id;

  if (!suggestionMsgId) {
    logger.warn({ groupJid, title: extracted.title }, 'createSuggestion: no message ID returned from sendMessage');
    return;
  }

  // Generate suggestion ID and expiry
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SUGGESTION_TTL_MS;

  // Start TTL timer
  const timer = startTtlTimer(id, SUGGESTION_TTL_MS);

  // Build suggestion object
  const suggestion: PendingSuggestion = {
    id,
    groupJid,
    suggestionMsgId,
    title: extracted.title,
    eventDate: extracted.date.getTime(),
    location: extracted.location ?? null,
    description: extracted.description ?? null,
    url: extracted.url ?? null,
    calendarId,
    calendarLink,
    sourceMessageId,
    senderName,
    expiresAt,
    timer,
  };

  // Store in Map
  pendingSuggestions.set(id, suggestion);

  // Persist to DB
  insertPendingSuggestion({
    id,
    groupJid,
    suggestionMsgId,
    title: extracted.title,
    eventDate: extracted.date.getTime(),
    location: extracted.location ?? null,
    description: extracted.description ?? null,
    url: extracted.url ?? null,
    calendarId,
    calendarLink,
    sourceMessageId,
    senderName,
    expiresAt,
  });

  logger.info({ id, title: extracted.title, groupJid }, 'Pending suggestion created');
}

/**
 * Handle a potential ✅/❌ reply to a pending suggestion.
 * Returns true if the message was a confirm/reject action (caller should not process further).
 *
 * Called from the pipeline callback for every incoming group message with a quoted reply.
 */
export async function handleConfirmReject(
  groupJid: string,
  msg: {
    id: string;
    senderJid: string;
    senderName: string | null;
    body: string;
    timestamp: number;
    fromMe?: boolean;
  },
  quotedMessageId: string | null,
): Promise<boolean> {
  if (!quotedMessageId) return false;

  // Look up by suggestionMsgId — first check in-memory Map
  let suggestion: PendingSuggestion | undefined;
  for (const s of pendingSuggestions.values()) {
    if (s.suggestionMsgId === quotedMessageId) {
      suggestion = s;
      break;
    }
  }

  // If not found in Map, try DB
  if (!suggestion) {
    const dbRow = getPendingSuggestionByMsgId(quotedMessageId);
    if (!dbRow) return false;

    // DB row found but not in Map (e.g. server restart with no restorePendingSuggestions called)
    // Reconstruct a minimal suggestion from DB row for routing purposes.
    // Note: timer will be a no-op placeholder since we're handling it immediately.
    suggestion = {
      id: dbRow.id,
      groupJid: dbRow.groupJid,
      suggestionMsgId: dbRow.suggestionMsgId,
      title: dbRow.title,
      eventDate: dbRow.eventDate,
      location: dbRow.location ?? null,
      description: dbRow.description ?? null,
      url: dbRow.url ?? null,
      calendarId: dbRow.calendarId,
      calendarLink: dbRow.calendarLink,
      sourceMessageId: dbRow.sourceMessageId,
      senderName: dbRow.senderName ?? null,
      expiresAt: dbRow.expiresAt,
      timer: setTimeout(() => {}, 0), // placeholder, will be cleared immediately on confirm/reject
    };
  }

  // Check body is ✅ or ❌
  const trimmed = msg.body.trim();
  if (trimmed !== '✅' && trimmed !== '❌') return false;

  if (trimmed === '❌') {
    // Reject: silent discard — clear timer, delete from Map, delete from DB. No message sent.
    clearTimeout(suggestion.timer);
    pendingSuggestions.delete(suggestion.id);
    deletePendingSuggestion(suggestion.id);
    logger.debug(
      { id: suggestion.id, title: suggestion.title },
      'Suggestion rejected — silently discarded',
    );
    return true;
  }

  // trimmed === '✅': Confirm
  await confirmSuggestion(groupJid, suggestion);
  return true;
}

/**
 * Restore pending suggestions from DB at startup with adjusted remaining TTLs.
 * Call from initGroupPipeline() after DB is ready.
 *
 * Cleans up already-expired rows, then rehydrates the in-memory Map with
 * timer-adjusted entries for all rows that have not yet expired.
 */
export function restorePendingSuggestions(): void {
  const now = Date.now();

  // Clean up already-expired rows
  deleteExpiredPendingSuggestions(now);

  // Load all unexpired rows and restore to Map with adjusted TTLs
  const rows = getUnexpiredPendingSuggestions(now);

  for (const row of rows) {
    const remainingMs = row.expiresAt - now;
    const timer = startTtlTimer(row.id, remainingMs);

    pendingSuggestions.set(row.id, {
      id: row.id,
      groupJid: row.groupJid,
      suggestionMsgId: row.suggestionMsgId,
      title: row.title,
      eventDate: row.eventDate,
      location: row.location ?? null,
      description: row.description ?? null,
      url: row.url ?? null,
      calendarId: row.calendarId,
      calendarLink: row.calendarLink,
      sourceMessageId: row.sourceMessageId,
      senderName: row.senderName ?? null,
      expiresAt: row.expiresAt,
      timer,
    });
  }

  logger.info(
    { restored: rows.length },
    'Pending suggestions restored from DB on startup',
  );
}

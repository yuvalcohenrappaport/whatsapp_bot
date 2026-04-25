import pino from 'pino';
import { config } from '../config.js';
import { getGroup } from '../db/queries/groups.js';
import {
  getCalendarEventByConfirmationMsgId,
  deleteCalendarEvent as deleteCalendarEventRecord,
} from '../db/queries/calendarEvents.js';
import { calendarDetection } from '../calendar/CalendarDetectionService.js';
import { ensureGroupCalendar, detectGroupLanguage } from './calendarHelpers.js';
import { deleteCalendarEvent as deleteCalendarEventApi } from '../calendar/calendarService.js';
import { getState } from '../api/state.js';
import { setGroupMessageCallback } from '../pipeline/messageHandler.js';
import { handleTravelMention } from './travelHandler.js';
import { handleKeywordRules } from './keywordHandler.js';
import { addToTripContextDebounce } from './tripContextManager.js';
import { handleSelfReportCommand } from './tripPreferences.js';
import { createSuggestion, handleConfirmReject, restorePendingSuggestions } from './suggestionTracker.js';
import { processGroupMessage } from '../calendar/personalCalendarPipeline.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: string;
  senderJid: string;
  senderName: string | null;
  body: string;
  timestamp: number;
  fromMe?: boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** Debounce buffers: groupJid -> { messages, timer } */
const debounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();

// Re-export the shared calendarIdCache so any legacy importers of this module
// keep working during the Phase 52-02 migration. The actual Map lives in
// ./calendarIdCache.js (shared with calendarHelpers.ts).
export { calendarIdCache } from './calendarIdCache.js';

/** Debounce window in ms */
const DEBOUNCE_MS = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────


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
      if (!calendarDetection.hasDateSignal(msg.body)) {
        logger.debug({ msgId: msg.id }, 'Pre-filter: no digits, skipping Gemini');
        continue;
      }

      // Extract dates using Gemini
      const extractedDates = await calendarDetection.extractDates(
        msg.body,
        {
          senderName: msg.senderName,
          chatName: group.name ?? null,
          chatType: 'group',
        },
      );

      if (extractedDates.length === 0) {
        logger.debug({ msgId: msg.id }, 'No high-confidence dates extracted');
        continue;
      }

      // Ensure group has a calendar (lazy creation) — delegated to the
      // shared helper so multimodalIntake.ts (Phase 52) hits identical logic.
      const calResult = await ensureGroupCalendar(groupJid, group);
      if (!calResult) {
        logger.warn({ groupJid }, 'No calendarId available — skipping event creation');
        continue;
      }
      const { calendarId, calendarLink } = calResult;

      // Send a suggestion for each extracted date (suggest-then-confirm replaces silent-add)
      for (const extracted of extractedDates) {
        try {
          await createSuggestion(
            groupJid,
            extracted,
            calendarId,
            calendarLink,
            msg.id,
            msg.senderName,
          );
        } catch (suggestionErr) {
          logger.error(
            { err: suggestionErr, title: extracted.title },
            'Error creating suggestion for extracted date',
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
      msg: { id: string; senderJid: string; senderName: string | null; body: string; timestamp: number; fromMe?: boolean },
      quotedMessageId: string | null,
      mentionedJids: string[],
    ) => {
      try {
        const group = getGroup(groupJid);
        if (!group) return;

        // Personal calendar detection -- runs for ALL groups, not just travelBotActive
        // Skip own messages (bot confirmations) and messages without text
        if (!msg.fromMe) {
          processGroupMessage({
            messageId: msg.id,
            groupJid,
            groupName: group.name ?? null,
            senderJid: msg.senderJid,
            senderName: msg.senderName,
            text: msg.body,
            timestamp: msg.timestamp,
            isForwarded: false, // Group callback doesn't carry WAMessage forward metadata
          }).catch(() => {}); // fire-and-forget
        }

        if (group.travelBotActive) {
          // Travel @mention -- runs immediately, terminal
          const wasTravel = await handleTravelMention(groupJid, msg, quotedMessageId, mentionedJids);
          if (wasTravel) return;

          // Confirm/reject suggestion -- runs immediately, terminal (before fromMe guard so owner can confirm/reject)
          const wasConfirmReject = await handleConfirmReject(groupJid, msg, quotedMessageId);
          if (wasConfirmReject) return;

          // Reply-to-delete -- runs immediately, terminal (before fromMe guard so owner can delete events)
          const wasDelete = await handleReplyToDelete(groupJid, msg, quotedMessageId);
          if (wasDelete) return;

          // Self-report commands (!pref, !budget, !dates) -- terminal when matched.
          // Placed BEFORE the fromMe guard so the owner can self-report too,
          // and BEFORE addToTripContextDebounce so the literal command text
          // never enters the classifier buffer (would confuse it).
          const wasSelfReport = await handleSelfReportCommand(groupJid, msg);
          if (wasSelfReport) return;
        }

        // Keyword auto-response -- runs for all messages including own
        if (group.keywordRulesActive) {
          await handleKeywordRules(groupJid, msg);
        }

        // Skip date extraction for own messages (bot confirmations etc.)
        if (msg.fromMe) return;

        if (group.travelBotActive) {
          // Trip context accumulation -- non-terminal (pre-filter inside)
          addToTripContextDebounce(groupJid, msg);

          // Batch for calendar date extraction
          addToDebounce(groupJid, msg);
        }
      } catch (err) {
        logger.error(
          { err, groupJid, msgId: msg.id },
          'Error in group message pipeline callback',
        );
      }
    },
  );

  restorePendingSuggestions();

  logger.info('Group message pipeline initialized');
}

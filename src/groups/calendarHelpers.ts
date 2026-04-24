import pino from 'pino';
import { config } from '../config.js';
import { getGroupMessagesSince } from '../db/queries/groupMessages.js';
import { updateGroup } from '../db/queries/groups.js';
import {
  createGroupCalendar,
  shareCalendar,
} from '../calendar/calendarService.js';
import { calendarIdCache } from './calendarIdCache.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Helpers extracted from groupMessagePipeline.ts ──────────────────────────
// These are shared between groupMessagePipeline.ts and suggestionTracker.ts
// to break the circular dependency.

/**
 * Extract calendarId from a calendarLink URL.
 * Format: https://calendar.google.com/calendar/embed?src={encodedCalendarId}
 */
export function getCalendarIdFromLink(calendarLink: string): string | null {
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
export function formatDateForDisplay(date: Date): string {
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
export async function detectGroupLanguage(groupJid: string): Promise<'he' | 'en'> {
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
export function buildConfirmationText(
  lang: 'he' | 'en',
  title: string,
  date: Date,
  calendarLink: string,
): string {
  const dateStr = formatDateForDisplay(date);
  if (lang === 'he') {
    return `\u05e7\u05dc\u05d8\u05ea\u05d9! \u05d4\u05d5\u05e1\u05e4\u05ea\u05d9 ${title} \u05d1${dateStr} \u05dc\u05dc\u05d5\u05d7 \u05d4\u05e9\u05e0\u05d4\n${calendarLink}`;
  }
  return `Got it! Added ${title} on ${dateStr} to the calendar\n${calendarLink}`;
}

// \u2500\u2500\u2500 ensureGroupCalendar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Extracted from groupMessagePipeline.processGroupMessages (Phase 52-02).
// Single source of truth for calendarId resolution, consumed by both
// processGroupMessages (v1.4 text flow) and multimodalIntake (Phase 52).

/**
 * Row shape returned by `getGroup` that this helper actually consults.
 * Declared loosely so any caller holding a drizzle-inferred `Group` row can
 * pass it in without a cast.
 */
interface GroupLike {
  id: string;
  name: string | null;
  calendarLink: string | null;
  memberEmails: string | null;
}

/**
 * Resolve (or lazily create) the Google Calendar for a group.
 *
 * Returns `{ calendarId, calendarLink }` on success, or `null` if no calendar
 * could be produced (e.g. calendar API unavailable, auth missing).
 *
 * This is the single source of truth for calendarId resolution \u2014 called by
 * `processGroupMessages` (v1.4 text flow) AND `multimodalIntake` (Phase 52)
 * so parity between the two paths is guaranteed by construction.
 *
 * Behavior (byte-for-byte identical to the pre-extraction inline block):
 *   1. Check the in-memory `calendarIdCache` first.
 *   2. Fall back to parsing `group.calendarLink` via `getCalendarIdFromLink`.
 *   3. If still no id, call `createGroupCalendar(group.name ?? groupJid)`,
 *      persist the new link via `updateGroup`, and (best-effort) share with
 *      parsed `group.memberEmails`.
 *   4. Cache successes; return `null` on any creation failure.
 */
export async function ensureGroupCalendar(
  groupJid: string,
  group: GroupLike,
): Promise<{ calendarId: string; calendarLink: string } | null> {
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
          'Failed to create group calendar \u2014 skipping event creation',
        );
        return null;
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

  if (!calendarId || !calendarLink) return null;
  return { calendarId, calendarLink };
}

import { getGroupMessagesSince } from '../db/queries/groupMessages.js';

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

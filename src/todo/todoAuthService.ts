import pino from 'pino';
import { config } from '../config.js';
import { isPersonalCalendarConnected } from '../calendar/personalCalendarService.js';

const logger = pino({ level: config.LOG_LEVEL });

/**
 * Google Tasks reuses the existing Google OAuth from personalCalendarService.
 * No separate auth flow needed — if Google Calendar is connected, Tasks is too
 * (as long as the tasks scope was included in the OAuth consent).
 */

export function isTasksConfigured(): boolean {
  return !!(
    config.GOOGLE_OAUTH_CLIENT_ID &&
    config.GOOGLE_OAUTH_CLIENT_SECRET &&
    config.GOOGLE_OAUTH_REDIRECT_URI
  );
}

export function isTasksConnected(): boolean {
  return isPersonalCalendarConnected();
}

export function getTasksUserInfo(): { email: string } | null {
  // The Google OAuth doesn't fetch user profile by default — return the calendar ID
  // which is the user's email
  if (!isTasksConnected()) return null;
  return { email: 'Connected via Google Calendar' };
}

export async function disconnectTasks(): Promise<void> {
  // Tasks shares auth with Calendar — don't disconnect (would break Calendar too)
  logger.info('Google Tasks disconnect requested — skipping (shares auth with Calendar)');
}

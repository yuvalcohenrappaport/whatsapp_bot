import { google, type calendar_v3 } from 'googleapis';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { config } from '../config.js';
import pino from 'pino';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

let calendarClient: calendar_v3.Calendar | null = null;
let initAttempted = false;

/**
 * Initialize Google Calendar auth using service account JWT.
 * Returns the calendar client or null if not configured.
 */
export function initCalendarAuth(): calendar_v3.Calendar | null {
  if (initAttempted) return calendarClient;
  initAttempted = true;

  const keyPath = config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    logger.warn('GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set — calendar features disabled');
    return null;
  }

  if (!existsSync(keyPath)) {
    logger.warn({ keyPath }, 'Service account key file not found — calendar features disabled');
    return null;
  }

  try {
    const keyFileContents = JSON.parse(readFileSync(keyPath, 'utf-8'));

    if (!keyFileContents.client_email || !keyFileContents.private_key) {
      logger.error('Service account key file missing client_email or private_key');
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: keyFileContents,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    calendarClient = google.calendar({ version: 'v3', auth });
    logger.info({ client_email: keyFileContents.client_email }, 'Google Calendar auth initialized');
    return calendarClient;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Google Calendar auth');
    return null;
  }
}

/**
 * Lazily get or create the calendar client.
 */
function getCalendarClient(): calendar_v3.Calendar | null {
  if (!initAttempted) {
    return initCalendarAuth();
  }
  return calendarClient;
}

/**
 * Create a new Google Calendar for a WhatsApp group.
 */
export async function createGroupCalendar(
  groupName: string,
): Promise<{ calendarId: string; calendarLink: string } | null> {
  const client = getCalendarClient();
  if (!client) return null;

  try {
    const res = await client.calendars.insert({
      requestBody: {
        summary: groupName,
        timeZone: 'Asia/Jerusalem',
      },
    });

    const calendarId = res.data.id;
    if (!calendarId) {
      logger.error('Calendar created but no ID returned');
      return null;
    }

    const calendarLink = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`;
    logger.info({ calendarId, groupName }, 'Created group calendar');
    return { calendarId, calendarLink };
  } catch (err) {
    logger.error({ err, groupName }, 'Failed to create group calendar');
    return null;
  }
}

/**
 * Share a calendar with a list of email addresses (reader access).
 * Uses Promise.allSettled so one bad email doesn't block others.
 */
export async function shareCalendar(
  calendarId: string,
  emails: string[],
): Promise<void> {
  const client = getCalendarClient();
  if (!client) return;

  const results = await Promise.allSettled(
    emails.map((email) =>
      client.acl.insert({
        calendarId,
        requestBody: {
          role: 'reader',
          scope: { type: 'user', value: email },
        },
      }),
    ),
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      logger.info({ email: emails[i], calendarId }, 'Shared calendar with user');
    } else {
      logger.warn(
        { email: emails[i], calendarId, err: result.reason },
        'Failed to share calendar with user',
      );
    }
  });
}

/**
 * Create an event on a calendar.
 * Returns the event ID or null on failure.
 * Default duration: 1 hour.
 */
export async function createCalendarEvent(params: {
  calendarId: string;
  title: string;
  date: Date;
  description: string;
  location?: string;
  timeZone?: string;
}): Promise<string | null> {
  const client = getCalendarClient();
  if (!client) return null;

  const timeZone = params.timeZone ?? 'Asia/Jerusalem';
  const endDate = new Date(params.date.getTime() + 3600000); // +1 hour

  try {
    const res = await client.events.insert({
      calendarId: params.calendarId,
      requestBody: {
        summary: params.title,
        description: params.description,
        location: params.location,
        start: {
          dateTime: params.date.toISOString(),
          timeZone,
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone,
        },
        reminders: {
          useDefault: true,
        },
      },
    });

    const eventId = res.data.id;
    if (!eventId) {
      logger.error('Event created but no ID returned');
      return null;
    }

    logger.info(
      { eventId, calendarId: params.calendarId, title: params.title },
      'Created calendar event',
    );
    return eventId;
  } catch (err) {
    logger.error(
      { err, calendarId: params.calendarId, title: params.title },
      'Failed to create calendar event',
    );
    return null;
  }
}

/**
 * List upcoming calendar events within a time window.
 * Returns an array of event summaries or empty array if calendar not configured or on error.
 */
export async function listUpcomingEvents(
  calendarId: string,
  daysAhead = 14,
): Promise<{ title: string; date: string; description?: string }[]> {
  const client = getCalendarClient();
  if (!client) return [];

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString();

    const res = await client.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const items = res.data.items ?? [];
    return items.map((event) => ({
      title: event.summary ?? '(No title)',
      date: event.start?.dateTime ?? event.start?.date ?? '',
      description: event.description ?? undefined,
    }));
  } catch (err) {
    logger.error({ err, calendarId }, 'Failed to list upcoming calendar events');
    return [];
  }
}

/**
 * Delete an event from a calendar.
 * Returns true on success, false on failure.
 */
export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  const client = getCalendarClient();
  if (!client) return false;

  try {
    await client.events.delete({ calendarId, eventId });
    logger.info({ eventId, calendarId }, 'Deleted calendar event');
    return true;
  } catch (err) {
    logger.error({ err, eventId, calendarId }, 'Failed to delete calendar event');
    return false;
  }
}

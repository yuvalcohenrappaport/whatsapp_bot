import { OAuth2Client } from 'google-auth-library';
import { google, type calendar_v3 } from 'googleapis';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import pino from 'pino';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

let oauth2Client: OAuth2Client | null = null;
let calendarClient: calendar_v3.Calendar | null = null;

/** Expose the OAuth2 client for reuse by other Google APIs (e.g., Tasks). */
export function getOAuth2Client(): OAuth2Client | null {
  return oauth2Client;
}

// Settings keys
const REFRESH_TOKEN_KEY = 'google_oauth_refresh_token';
const SELECTED_CALENDAR_KEY = 'google_oauth_calendar_id';

/**
 * Initialize OAuth2 client from env vars and load stored refresh token.
 * Call at startup after initDb.
 */
export function initPersonalCalendarAuth(): void {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = config;

  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) {
    logger.info('Google OAuth env vars not set — personal calendar features disabled');
    return;
  }

  oauth2Client = new OAuth2Client(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI,
  );

  // Listen for refreshed tokens and persist them
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      setSetting(REFRESH_TOKEN_KEY, tokens.refresh_token);
      logger.info('Persisted refreshed OAuth refresh token');
    }
  });

  // Load existing refresh token from DB
  const storedToken = getSetting(REFRESH_TOKEN_KEY);
  if (storedToken) {
    oauth2Client.setCredentials({ refresh_token: storedToken });
    calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
    logger.info('Personal calendar OAuth initialized with stored refresh token');
  } else {
    logger.info('Personal calendar OAuth client ready — awaiting user authorization');
  }
}

/**
 * Whether the personal calendar is connected (refresh token exists and client configured).
 */
export function isPersonalCalendarConnected(): boolean {
  return oauth2Client !== null && getSetting(REFRESH_TOKEN_KEY) !== null;
}

/**
 * Generate the Google OAuth consent URL. Returns null if OAuth env vars not configured.
 */
export function getAuthUrl(): string | null {
  if (!oauth2Client) return null;

  // Phase 55 v2.1 — `documents` scope added; one-time owner re-auth required.
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.file', // needed to set the Doc's name + retrieve webViewLink via Drive API
    ],
  });
}

/**
 * Exchange the OAuth callback code for tokens and persist the refresh token.
 */
export async function handleAuthCallback(
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (!oauth2Client) {
    return { success: false, error: 'OAuth client not initialized' };
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return { success: false, error: 'No refresh token received — try revoking app access and re-authorizing' };
    }

    oauth2Client.setCredentials(tokens);
    setSetting(REFRESH_TOKEN_KEY, tokens.refresh_token);
    calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });

    logger.info('Personal calendar OAuth callback successful');
    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Failed to exchange OAuth code for tokens');
    return { success: false, error: String(err) };
  }
}

/**
 * Create an event on the user's personal Google Calendar.
 * Returns the event ID or null on failure.
 * On 401/invalid_grant: clears stored token (graceful degradation).
 */
export async function createPersonalCalendarEvent(params: {
  calendarId: string;
  title: string;
  date: Date;
  description?: string;
  location?: string;
  isAllDay?: boolean;
}): Promise<string | null> {
  if (!calendarClient) return null;

  const timeZone = 'Asia/Jerusalem';

  // Build start/end based on all-day vs timed event
  let start: { date?: string; dateTime?: string; timeZone?: string };
  let end: { date?: string; dateTime?: string; timeZone?: string };

  if (params.isAllDay) {
    // All-day events use date format (YYYY-MM-DD) in Asia/Jerusalem timezone
    const dateInTz = new Date(
      params.date.toLocaleString('en-US', { timeZone }),
    );
    const yyyy = dateInTz.getFullYear();
    const mm = String(dateInTz.getMonth() + 1).padStart(2, '0');
    const dd = String(dateInTz.getDate()).padStart(2, '0');
    const startDate = `${yyyy}-${mm}-${dd}`;

    // End date is next day for single all-day event
    const nextDay = new Date(dateInTz);
    nextDay.setDate(nextDay.getDate() + 1);
    const endYyyy = nextDay.getFullYear();
    const endMm = String(nextDay.getMonth() + 1).padStart(2, '0');
    const endDd = String(nextDay.getDate()).padStart(2, '0');
    const endDate = `${endYyyy}-${endMm}-${endDd}`;

    start = { date: startDate };
    end = { date: endDate };
  } else {
    const endDate = new Date(params.date.getTime() + 3600000); // +1 hour
    start = { dateTime: params.date.toISOString(), timeZone };
    end = { dateTime: endDate.toISOString(), timeZone };
  }

  try {
    const res = await calendarClient.events.insert({
      calendarId: params.calendarId,
      requestBody: {
        summary: params.title,
        description: params.description,
        location: params.location,
        start,
        end,
        reminders: {
          useDefault: true,
        },
      },
    });

    const eventId = res.data.id;
    if (!eventId) {
      logger.error('Personal calendar event created but no ID returned');
      return null;
    }

    logger.info(
      { eventId, calendarId: params.calendarId, title: params.title },
      'Created personal calendar event',
    );
    return eventId;
  } catch (err: unknown) {
    // Graceful degradation: clear token on auth errors
    const errMsg = String(err);
    if (errMsg.includes('invalid_grant') || errMsg.includes('401')) {
      logger.warn('Personal calendar auth expired — clearing stored token');
      setSetting(REFRESH_TOKEN_KEY, '');
      calendarClient = null;
    }

    logger.error(
      { err, calendarId: params.calendarId, title: params.title },
      'Failed to create personal calendar event',
    );
    return null;
  }
}

/**
 * List the user's calendars so they can pick which one to use.
 */
export async function listUserCalendars(): Promise<
  { id: string; summary: string; primary: boolean }[]
> {
  if (!calendarClient) return [];

  try {
    const res = await calendarClient.calendarList.list();
    const items = res.data.items ?? [];
    return items.map((cal) => ({
      id: cal.id ?? '',
      summary: cal.summary ?? '(Unnamed)',
      primary: cal.primary === true,
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to list user calendars');
    return [];
  }
}

/**
 * Get the selected calendar ID from settings, or null.
 */
export function getSelectedCalendarId(): string | null {
  return getSetting(SELECTED_CALENDAR_KEY);
}

/**
 * Delete a Google Calendar event. Returns true on success, false on failure.
 * Never throws — callers use this for best-effort cleanup before a local DELETE.
 * Tolerates 404 (already deleted) and 410 (gone).
 */
export async function deletePersonalCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  if (!calendarClient) {
    logger.warn('[personalCalendarService] no Google auth for delete');
    return false;
  }
  try {
    await calendarClient.events.delete({ calendarId, eventId });
    logger.info({ eventId, calendarId }, '[personalCalendarService] deleted calendar event');
    return true;
  } catch (err) {
    const status = (err as { code?: number })?.code;
    // 404 = already deleted, 410 = gone — both are acceptable
    if (status === 404 || status === 410) return true;
    logger.error({ err }, '[personalCalendarService] delete event failed');
    return false;
  }
}

/**
 * Patch an existing Google Calendar event. Returns true on success, false on
 * failure. Never throws — callers use this for best-effort mirroring after
 * a local DB write.
 */
export async function updatePersonalCalendarEvent(
  calendarId: string,
  eventId: string,
  patch: {
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
  },
): Promise<boolean> {
  if (!calendarClient) {
    logger.warn('[personalCalendarService] no Google auth for update');
    return false;
  }
  try {
    await calendarClient.events.patch({
      calendarId,
      eventId,
      requestBody: patch,
    });
    return true;
  } catch (err) {
    logger.error({ err }, '[personalCalendarService] update event failed');
    return false;
  }
}

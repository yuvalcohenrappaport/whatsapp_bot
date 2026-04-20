import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { config } from '../../config.js';
import {
  isPersonalCalendarConnected,
  getAuthUrl,
  handleAuthCallback,
  createPersonalCalendarEvent,
  updatePersonalCalendarEvent,
  deletePersonalCalendarEvent,
  listUserCalendars,
  getSelectedCalendarId,
} from '../../calendar/personalCalendarService.js';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import {
  getPendingPersonalEvents,
  getPersonalPendingEvent,
  getPersonalEventsByStatus,
  updatePersonalPendingEventStatus,
  updatePersonalPendingEventFields,
  linkCalendarEventId,
  insertApprovedPersonalEvent,
  deletePersonalPendingEvent,
} from '../../db/queries/personalPendingEvents.js';

const logger = pino({ level: config.LOG_LEVEL });

const SELECTED_CALENDAR_KEY = 'google_oauth_calendar_id';

export default async function personalCalendarRoutes(fastify: FastifyInstance) {
  // 1. GET /api/auth/google — generate OAuth consent URL and redirect
  fastify.get(
    '/api/auth/google',
    async (_request, reply) => {
      const url = getAuthUrl();
      if (!url) {
        return reply.status(503).send({ error: 'Google OAuth not configured' });
      }
      return reply.redirect(url);
    },
  );

  // 2. GET /api/auth/google/callback — handle Google OAuth redirect (no JWT auth)
  fastify.get(
    '/api/auth/google/callback',
    async (request, reply) => {
      const { code } = request.query as { code?: string };
      if (!code) {
        return reply.redirect('/?google=error');
      }

      const result = await handleAuthCallback(code);
      if (result.success) {
        return reply.redirect('/?google=connected');
      }
      logger.error({ error: result.error }, 'Google OAuth callback failed');
      return reply.redirect('/?google=error');
    },
  );

  // 3. GET /api/personal-calendar/status — connection status
  fastify.get(
    '/api/personal-calendar/status',
    { onRequest: [fastify.authenticate] },
    async () => {
      const configured = !!(
        config.GOOGLE_OAUTH_CLIENT_ID &&
        config.GOOGLE_OAUTH_CLIENT_SECRET &&
        config.GOOGLE_OAUTH_REDIRECT_URI
      );
      const connected = isPersonalCalendarConnected();
      const calendarId = getSelectedCalendarId();
      return { connected, calendarId, configured };
    },
  );

  // 4. GET /api/personal-calendar/calendars — list user's calendars
  fastify.get(
    '/api/personal-calendar/calendars',
    { onRequest: [fastify.authenticate] },
    async (_request, reply) => {
      if (!isPersonalCalendarConnected()) {
        return reply.status(503).send({ error: 'Personal calendar not connected' });
      }
      const calendars = await listUserCalendars();
      return { calendars };
    },
  );

  // 5. POST /api/personal-calendar/select — select which calendar to use
  fastify.post(
    '/api/personal-calendar/select',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { calendarId } = request.body as { calendarId: string };
      setSetting(SELECTED_CALENDAR_KEY, calendarId);
      return { ok: true };
    },
  );

  // 6. GET /api/personal-calendar/events — list events by status (for dashboard)
  fastify.get<{ Querystring: { status?: string } }>(
    '/api/personal-calendar/events',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const status = (request.query.status ?? 'pending') as 'pending' | 'approved' | 'rejected';
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return { events: [] };
      }
      const events = getPersonalEventsByStatus(status);
      return { events };
    },
  );

  // 7. GET /api/personal-calendar/pending — list pending events (backward compat)
  fastify.get(
    '/api/personal-calendar/pending',
    { onRequest: [fastify.authenticate] },
    async () => {
      const events = getPendingPersonalEvents();
      return { events };
    },
  );

  // 8. POST /api/personal-calendar/pending/:id/approve — approve and create calendar event
  fastify.post<{ Params: { id: string } }>(
    '/api/personal-calendar/pending/:id/approve',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const event = getPersonalPendingEvent(id);
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }

      const calendarId = getSelectedCalendarId();
      if (!calendarId) {
        return reply.status(400).send({ error: 'No calendar selected' });
      }

      const eventId = await createPersonalCalendarEvent({
        calendarId,
        title: event.title,
        date: new Date(event.eventDate),
        description: event.description ?? undefined,
        location: event.location ?? undefined,
      });

      if (!eventId) {
        return reply.status(500).send({ error: 'Failed to create calendar event' });
      }

      updatePersonalPendingEventStatus(id, 'approved');
      // Persist the Google Calendar event ID so PATCH can mirror edits upstream
      linkCalendarEventId(id, eventId);
      return { ok: true, calendarEventId: eventId };
    },
  );

  // 9. POST /api/personal-calendar/pending/:id/reject — reject pending event
  fastify.post<{ Params: { id: string } }>(
    '/api/personal-calendar/pending/:id/reject',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const event = getPersonalPendingEvent(id);
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }

      updatePersonalPendingEventStatus(id, 'rejected');
      return { ok: true };
    },
  );

  // 10. PATCH /api/personal-calendar/events/:id — edit fields of an existing event
  fastify.patch<{
    Params: { id: string };
    Body: { title?: string; eventDate?: number; location?: string | null; description?: string | null; isAllDay?: boolean };
  }>(
    '/api/personal-calendar/events/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};
      const { title, eventDate, location, description, isAllDay } = body as {
        title?: string;
        eventDate?: number;
        location?: string | null;
        description?: string | null;
        isAllDay?: boolean;
      };

      // Must have at least one field to patch
      if (
        title === undefined &&
        eventDate === undefined &&
        location === undefined &&
        description === undefined &&
        isAllDay === undefined
      ) {
        return reply.status(400).send({ error: 'empty patch' });
      }

      const event = getPersonalPendingEvent(id);
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }

      // Apply local DB update
      updatePersonalPendingEventFields(id, { title, eventDate, location, description, isAllDay });

      // Mirror to Google Calendar if event was approved and has a linked calendar event
      if (event.status === 'approved' && event.calendarEventId) {
        const calId = getSelectedCalendarId();
        if (calId) {
          const ONE_HOUR_MS = 3_600_000;
          const isAllDayEffective = isAllDay ?? event.isAllDay;
          const dateMs = eventDate ?? event.eventDate;

          const buildTimeSpec = (
            ms: number,
            allDay: boolean,
          ): { dateTime?: string; date?: string; timeZone?: string } => {
            if (allDay) {
              const d = new Date(ms);
              const yyyy = d.getUTCFullYear();
              const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
              const dd = String(d.getUTCDate()).padStart(2, '0');
              return { date: `${yyyy}-${mm}-${dd}` };
            }
            return { dateTime: new Date(ms).toISOString(), timeZone: 'Asia/Jerusalem' };
          };

          // Best-effort — failure is logged inside the service helper
          void updatePersonalCalendarEvent(calId, event.calendarEventId, {
            ...(title !== undefined && { summary: title }),
            ...(location !== undefined && { location: location ?? undefined }),
            ...(description !== undefined && { description: description ?? undefined }),
            ...(eventDate !== undefined && {
              start: buildTimeSpec(dateMs, isAllDayEffective),
              end: buildTimeSpec(dateMs + ONE_HOUR_MS, isAllDayEffective),
            }),
          });
        }
      }

      const fresh = getPersonalPendingEvent(id);
      return { event: fresh };
    },
  );

  // 11. POST /api/personal-calendar/events — create a new event directly at status='approved'
  fastify.post<{
    Body: { title: string; eventDate: number; location?: string | null; description?: string | null; isAllDay?: boolean };
  }>(
    '/api/personal-calendar/events',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = request.body as {
        title?: string;
        eventDate?: number;
        location?: string | null;
        description?: string | null;
        isAllDay?: boolean;
      };

      if (!body.title || String(body.title).trim() === '') {
        return reply.status(400).send({ error: 'title is required' });
      }
      if (body.eventDate === undefined || body.eventDate === null) {
        return reply.status(400).send({ error: 'eventDate is required' });
      }

      const calId = getSelectedCalendarId();

      // Insert local row first
      const row = insertApprovedPersonalEvent({
        title: body.title,
        eventDate: body.eventDate,
        location: body.location,
        description: body.description,
        isAllDay: body.isAllDay,
      });

      // Best-effort: create Google Calendar event
      if (calId && row) {
        try {
          const googleEventId = await createPersonalCalendarEvent({
            calendarId: calId,
            title: body.title,
            date: new Date(body.eventDate),
            description: body.description ?? undefined,
            location: body.location ?? undefined,
            isAllDay: body.isAllDay,
          });
          if (googleEventId && row) {
            linkCalendarEventId(row.id, googleEventId);
          }
        } catch {
          // Failure is swallowed — local row already written
          logger.warn('[personalCalendar] Google Calendar event creation failed for dashboard-created event');
        }
      }

      const fresh = row ? getPersonalPendingEvent(row.id) : row;
      return reply.status(201).send({ event: fresh });
    },
  );

  // 12. DELETE /api/personal-calendar/events/:id — delete an existing event
  fastify.delete<{ Params: { id: string } }>(
    '/api/personal-calendar/events/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const event = getPersonalPendingEvent(id);
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }

      // Best-effort Google Calendar delete before local hard delete
      if (event.calendarEventId) {
        const calId = getSelectedCalendarId();
        if (calId) {
          await deletePersonalCalendarEvent(calId, event.calendarEventId);
        }
      }

      deletePersonalPendingEvent(id);
      return reply.status(204).send();
    },
  );
}

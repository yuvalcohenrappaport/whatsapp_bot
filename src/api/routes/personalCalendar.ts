import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { config } from '../../config.js';
import {
  isPersonalCalendarConnected,
  getAuthUrl,
  handleAuthCallback,
  createPersonalCalendarEvent,
  listUserCalendars,
  getSelectedCalendarId,
} from '../../calendar/personalCalendarService.js';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import {
  getPendingPersonalEvents,
  getPersonalPendingEvent,
  updatePersonalPendingEventStatus,
} from '../../db/queries/personalPendingEvents.js';

const logger = pino({ level: config.LOG_LEVEL });

const SELECTED_CALENDAR_KEY = 'google_oauth_calendar_id';

export default async function personalCalendarRoutes(fastify: FastifyInstance) {
  // 1. GET /api/auth/google — generate OAuth consent URL
  fastify.get(
    '/api/auth/google',
    { onRequest: [fastify.authenticate] },
    async (_request, reply) => {
      const url = getAuthUrl();
      if (!url) {
        return reply.status(503).send({ error: 'Google OAuth not configured' });
      }
      return { url };
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

  // 6. GET /api/personal-calendar/pending — list pending events
  fastify.get(
    '/api/personal-calendar/pending',
    { onRequest: [fastify.authenticate] },
    async () => {
      const events = getPendingPersonalEvents();
      return { events };
    },
  );

  // 7. POST /api/personal-calendar/pending/:id/approve — approve and create calendar event
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
      return { ok: true, calendarEventId: eventId };
    },
  );

  // 8. POST /api/personal-calendar/pending/:id/reject — reject pending event
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
}

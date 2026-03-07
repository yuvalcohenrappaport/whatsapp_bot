import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { config } from '../../config.js';
import {
  getGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
} from '../../db/queries/groups.js';
import { createGroupCalendar, shareCalendar } from '../../calendar/calendarService.js';
import { getState } from '../state.js';

const logger = pino({ level: config.LOG_LEVEL });

export default async function groupRoutes(fastify: FastifyInstance) {
  // GET /api/groups - all groups
  fastify.get(
    '/api/groups',
    { onRequest: [fastify.authenticate] },
    async () => {
      return getGroups();
    },
  );

  // GET /api/groups/participating - all WhatsApp groups the account is in
  fastify.get(
    '/api/groups/participating',
    { onRequest: [fastify.authenticate] },
    async (_request, reply) => {
      const { sock } = getState();
      if (!sock) {
        return reply.status(503).send({ error: 'WhatsApp not connected' });
      }

      const participating = await sock.groupFetchAllParticipating();
      const trackedIds = new Set(getGroups().map((g) => g.id));

      return Object.values(participating).map((g) => ({
        jid: g.id,
        name: g.subject ?? null,
        alreadyTracked: trackedIds.has(g.id),
      }));
    },
  );

  // POST /api/groups - create a group and initialize its Google Calendar
  fastify.post(
    '/api/groups',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id, name } = request.body as { id: string; name?: string };
      createGroup(id, name);

      // Create a Google Calendar for the group immediately
      try {
        const calendarResult = await createGroupCalendar(name ?? id);
        if (calendarResult) {
          updateGroup(id, { calendarLink: calendarResult.calendarLink });
          logger.info({ groupId: id, calendarId: calendarResult.calendarId }, 'Calendar created for new group');
        }
      } catch (err) {
        logger.warn({ err, groupId: id }, 'Failed to create calendar for new group — can be created later');
      }

      return reply.status(201).send(getGroup(id) ?? { ok: true });
    },
  );

  // PATCH /api/groups/:id - update a group
  fastify.patch<{ Params: { id: string } }>(
    '/api/groups/:id',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { id } = request.params;
      const patch = request.body as Partial<{
        name: string;
        travelBotActive: boolean;
        keywordRulesActive: boolean;
        reminderDay: string;
        calendarLink: string;
        memberEmails: string;
      }>;

      updateGroup(id, patch);
      return getGroup(id) ?? { ok: true };
    },
  );

  // DELETE /api/groups/:id - delete a group
  fastify.delete<{ Params: { id: string } }>(
    '/api/groups/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      deleteGroup(id);
      return reply.status(204).send();
    },
  );

  // POST /api/groups/:id/send - send a text message to the group
  fastify.post<{ Params: { id: string } }>(
    '/api/groups/:id/send',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const { text } = request.body as { text: string };

      if (!text || typeof text !== 'string') {
        return reply.status(400).send({ error: 'text is required' });
      }

      const { sock } = getState();
      if (!sock) {
        return reply.status(503).send({ error: 'WhatsApp not connected' });
      }

      await sock.sendMessage(id, { text });
      return { ok: true };
    },
  );
}

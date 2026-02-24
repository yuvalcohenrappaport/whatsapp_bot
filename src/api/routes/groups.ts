import type { FastifyInstance } from 'fastify';
import {
  getGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
} from '../../db/queries/groups.js';
import { getState } from '../state.js';

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

  // POST /api/groups - create a group
  fastify.post(
    '/api/groups',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id, name } = request.body as { id: string; name?: string };
      createGroup(id, name);
      return reply.status(201).send({ ok: true });
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
        active: boolean;
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
}

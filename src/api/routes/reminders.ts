import type { FastifyInstance } from 'fastify';
import {
  getReminderById,
  getRemindersByStatus,
  updateReminderStatus,
} from '../../db/queries/reminders.js';
import { cancelScheduledReminder } from '../../reminders/reminderScheduler.js';

export default async function reminderRoutes(fastify: FastifyInstance) {
  // GET /api/reminders?status=pending — list reminders by status
  fastify.get<{ Querystring: { status?: string } }>(
    '/api/reminders',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const status = request.query.status ?? 'pending';
      if (!['pending', 'fired', 'cancelled', 'skipped'].includes(status)) {
        return { reminders: [] };
      }
      const reminders = getRemindersByStatus(status);
      return { reminders };
    },
  );

  // GET /api/reminders/stats — counts for overview card
  fastify.get(
    '/api/reminders/stats',
    { onRequest: [fastify.authenticate] },
    async () => {
      const pending = getRemindersByStatus('pending').length;
      const fired = getRemindersByStatus('fired').length;
      const cancelled = getRemindersByStatus('cancelled').length;
      return { pending, fired, cancelled };
    },
  );

  // POST /api/reminders/:id/cancel — cancel a pending reminder
  fastify.post<{ Params: { id: string } }>(
    '/api/reminders/:id/cancel',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const reminder = getReminderById(id);
      if (!reminder) {
        return reply.status(404).send({ error: 'Reminder not found' });
      }

      cancelScheduledReminder(id);
      updateReminderStatus(id, 'cancelled');
      return { ok: true };
    },
  );
}

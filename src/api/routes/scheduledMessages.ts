import type { FastifyInstance } from 'fastify';
import {
  getAllScheduledMessages,
  getScheduledMessageById,
  insertScheduledMessage,
  updateScheduledMessageContentAndTime,
  markScheduledMessageCancelled,
} from '../../db/queries/scheduledMessages.js';
import {
  insertScheduledMessageRecipient,
  getRecipientsForMessage,
} from '../../db/queries/scheduledMessageRecipients.js';
import { getContact } from '../../db/queries/contacts.js';
import { scheduleNewMessage } from '../../scheduler/scheduledMessageService.js';
import { cancelScheduledMessage } from '../../scheduler/scheduledMessageScheduler.js';
import { buildCronExpression } from '../../scheduler/cronUtils.js';

export default async function scheduledMessageRoutes(fastify: FastifyInstance) {
  // GET /api/scheduled-messages?tab=pending|sent|failed|all
  fastify.get<{ Querystring: { tab?: string } }>(
    '/api/scheduled-messages',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { tab } = request.query;
      const messages = getAllScheduledMessages(tab);

      const enriched = messages.map((msg) => {
        const recipients = getRecipientsForMessage(msg.id);
        const enrichedRecipients = recipients.map((r) => {
          const contact = getContact(r.recipientJid);
          return { ...r, name: contact?.name ?? r.recipientJid };
        });
        return { ...msg, recipients: enrichedRecipients };
      });

      return { messages: enriched };
    },
  );

  // POST /api/scheduled-messages — create a new scheduled message
  fastify.post<{
    Body: {
      recipientJid: string;
      recipientType?: string;
      content: string;
      scheduledAt: number;
      type?: string;
      cadence?: 'daily' | 'weekly' | 'monthly';
    };
  }>(
    '/api/scheduled-messages',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { recipientJid, recipientType, content, scheduledAt, type, cadence } = request.body;
      const id = crypto.randomUUID();

      const cronExpression = cadence
        ? buildCronExpression(cadence, scheduledAt)
        : null;

      insertScheduledMessage({
        id,
        type: type ?? 'text',
        content,
        scheduledAt,
        cronExpression,
      });

      insertScheduledMessageRecipient({
        id: crypto.randomUUID(),
        scheduledMessageId: id,
        recipientJid,
        recipientType: recipientType ?? 'individual',
      });

      scheduleNewMessage(id, scheduledAt);

      return reply.status(201).send({ id, message: 'Scheduled' });
    },
  );

  // PATCH /api/scheduled-messages/:id — edit content, scheduledAt, and/or cadence for pending messages
  fastify.patch<{
    Params: { id: string };
    Body: { content?: string; scheduledAt?: number; cadence?: 'daily' | 'weekly' | 'monthly' | null };
  }>(
    '/api/scheduled-messages/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const { content, scheduledAt, cadence } = request.body;

      const msg = getScheduledMessageById(id);
      if (!msg) {
        return reply.status(404).send({ error: 'Scheduled message not found' });
      }

      if (msg.status !== 'pending') {
        return reply.status(400).send({ error: 'Only pending messages can be edited' });
      }

      const newContent = content ?? msg.content;
      const newScheduledAt = scheduledAt ?? msg.scheduledAt;

      // Determine cronExpression update
      let newCronExpression: string | null | undefined;
      if (cadence !== undefined) {
        if (cadence === null) {
          // Explicitly clearing recurrence
          newCronExpression = null;
        } else {
          newCronExpression = buildCronExpression(cadence, newScheduledAt);
        }
      }
      // cadence not in body → leave cronExpression unchanged (undefined = no update)

      updateScheduledMessageContentAndTime(id, newContent, newScheduledAt, newCronExpression);

      if (scheduledAt !== undefined && scheduledAt !== msg.scheduledAt) {
        cancelScheduledMessage(id);
        scheduleNewMessage(id, newScheduledAt);
      }

      return { message: 'Updated' };
    },
  );

  // POST /api/scheduled-messages/:id/cancel — cancel a pending or notified message
  fastify.post<{ Params: { id: string } }>(
    '/api/scheduled-messages/:id/cancel',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const msg = getScheduledMessageById(id);
      if (!msg) {
        return reply.status(404).send({ error: 'Scheduled message not found' });
      }

      if (msg.status !== 'pending' && msg.status !== 'notified') {
        return reply
          .status(400)
          .send({ error: 'Only pending or notified messages can be cancelled' });
      }

      markScheduledMessageCancelled(id);
      cancelScheduledMessage(id);

      return { message: 'Cancelled' };
    },
  );
}

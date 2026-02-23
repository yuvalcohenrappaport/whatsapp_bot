import type { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { drafts, contacts, messages } from '../../db/schema.js';
import { markDraftSent, markDraftRejected } from '../../db/queries/drafts.js';
import { getState } from '../state.js';

export default async function draftRoutes(fastify: FastifyInstance) {
  // GET /api/drafts - all pending drafts with contact name and inbound message body
  fastify.get(
    '/api/drafts',
    { onRequest: [fastify.authenticate] },
    async () => {
      const pendingDrafts = db
        .select()
        .from(drafts)
        .where(eq(drafts.status, 'pending'))
        .orderBy(desc(drafts.createdAt))
        .all();

      const result = pendingDrafts.map((draft) => {
        // Get contact name
        const contact = db
          .select({ name: contacts.name })
          .from(contacts)
          .where(eq(contacts.jid, draft.contactJid))
          .get();

        // Get the inbound message this draft is replying to
        const inboundMessage = db
          .select({ body: messages.body, timestamp: messages.timestamp })
          .from(messages)
          .where(eq(messages.id, draft.inReplyToMessageId))
          .get();

        return {
          ...draft,
          contactName: contact?.name ?? null,
          inboundMessage: inboundMessage ?? null,
        };
      });

      return result;
    },
  );

  // PATCH /api/drafts/:id/approve - send the message and mark draft as sent
  fastify.patch<{ Params: { id: string } }>(
    '/api/drafts/:id/approve',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const { body } = request.body as { body: string };

      // Verify draft exists and is pending
      const draft = db
        .select()
        .from(drafts)
        .where(
          sql`${drafts.id} = ${id} AND ${drafts.status} = 'pending'`,
        )
        .get();

      if (!draft) {
        return reply.status(404).send({ error: 'Draft not found or not pending' });
      }

      const { sock } = getState();
      if (!sock) {
        return reply.status(503).send({ error: 'Bot not connected' });
      }

      await sock.sendMessage(draft.contactJid, { text: body });
      await markDraftSent(id);

      return { ok: true };
    },
  );

  // DELETE /api/drafts/:id - reject the draft
  fastify.delete<{ Params: { id: string } }>(
    '/api/drafts/:id',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { id } = request.params;
      await markDraftRejected(id);
      return { ok: true };
    },
  );
}

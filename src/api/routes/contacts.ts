import type { FastifyInstance } from 'fastify';
import { eq, desc, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { contacts, messages } from '../../db/schema.js';
import { upsertContact, updateContactMode } from '../../db/queries/contacts.js';

export default async function contactRoutes(fastify: FastifyInstance) {
  // GET /api/contacts - all contacts with their latest received message
  fastify.get(
    '/api/contacts',
    { onRequest: [fastify.authenticate] },
    async () => {
      const allContacts = db.select().from(contacts).all();

      // For each contact, get the latest inbound (fromMe=false) message
      const result = allContacts.map((contact) => {
        const latestMessage = db
          .select({
            body: messages.body,
            timestamp: messages.timestamp,
          })
          .from(messages)
          .where(
            sql`${messages.contactJid} = ${contact.jid} AND ${messages.fromMe} = 0`,
          )
          .orderBy(desc(messages.timestamp))
          .limit(1)
          .get();

        return {
          ...contact,
          lastMessage: latestMessage ?? null,
        };
      });

      return result;
    },
  );

  // GET /api/contacts/recent - JIDs from messages NOT already in contacts table
  fastify.get(
    '/api/contacts/recent',
    { onRequest: [fastify.authenticate] },
    async () => {
      const existingJids = db
        .select({ jid: contacts.jid })
        .from(contacts)
        .all()
        .map((c) => c.jid);

      const query = db
        .selectDistinct({
          jid: messages.contactJid,
        })
        .from(messages);

      const recentJids =
        existingJids.length > 0
          ? query
              .where(notInArray(messages.contactJid, existingJids))
              .all()
          : query.all();

      // Get the latest message for each JID to display a name/preview
      const result = recentJids.map((r) => {
        const latest = db
          .select({
            body: messages.body,
            timestamp: messages.timestamp,
          })
          .from(messages)
          .where(eq(messages.contactJid, r.jid))
          .orderBy(desc(messages.timestamp))
          .limit(1)
          .get();

        return {
          jid: r.jid,
          lastMessage: latest ?? null,
        };
      });

      return result;
    },
  );

  // POST /api/contacts - add a contact to the whitelist
  fastify.post(
    '/api/contacts',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { jid, name } = request.body as { jid: string; name?: string };
      await upsertContact(jid, name);
      await updateContactMode(jid, 'draft');
      return reply.status(201).send({ ok: true });
    },
  );

  // PATCH /api/contacts/:jid - update contact fields
  fastify.patch<{ Params: { jid: string } }>(
    '/api/contacts/:jid',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { jid } = request.params;
      const body = request.body as Partial<{
        mode: string;
        relationship: string;
        customInstructions: string;
        name: string;
      }>;

      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      if (body.mode !== undefined) updates.mode = body.mode;
      if (body.relationship !== undefined) updates.relationship = body.relationship;
      if (body.customInstructions !== undefined)
        updates.customInstructions = body.customInstructions;
      if (body.name !== undefined) updates.name = body.name;

      db.update(contacts).set(updates).where(eq(contacts.jid, jid)).run();

      const updated = db
        .select()
        .from(contacts)
        .where(eq(contacts.jid, jid))
        .get();
      return updated;
    },
  );

  // DELETE /api/contacts/:jid - soft delete (set mode to 'off')
  fastify.delete<{ Params: { jid: string } }>(
    '/api/contacts/:jid',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { jid } = request.params;
      db.update(contacts)
        .set({ mode: 'off', updatedAt: Date.now() })
        .where(eq(contacts.jid, jid))
        .run();
      return { ok: true };
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
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

  // GET /api/contacts/recent - last 10 distinct chats by most recent message
  fastify.get(
    '/api/contacts/recent',
    { onRequest: [fastify.authenticate] },
    async () => {
      const recentJids = db
        .select({
          jid: messages.contactJid,
          lastTimestamp: sql<number>`MAX(${messages.timestamp})`,
        })
        .from(messages)
        .groupBy(messages.contactJid)
        .orderBy(sql`MAX(${messages.timestamp}) DESC`)
        .limit(10)
        .all();

      const existingJids = new Set(
        db.select({ jid: contacts.jid }).from(contacts).where(sql`${contacts.mode} != 'off'`).all().map((c) => c.jid),
      );

      return recentJids.map((r) => {
        const latest = db
          .select({ body: messages.body, timestamp: messages.timestamp })
          .from(messages)
          .where(eq(messages.contactJid, r.jid))
          .orderBy(desc(messages.timestamp))
          .limit(1)
          .get();

        return {
          jid: r.jid,
          lastMessage: latest ?? null,
          alreadyContact: existingJids.has(r.jid),
        };
      });
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
        voiceReplyEnabled: boolean;
      }>;

      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      if (body.mode !== undefined) updates.mode = body.mode;
      if (body.relationship !== undefined) updates.relationship = body.relationship;
      if (body.customInstructions !== undefined)
        updates.customInstructions = body.customInstructions;
      if (body.name !== undefined) updates.name = body.name;
      if (body.voiceReplyEnabled !== undefined) updates.voiceReplyEnabled = body.voiceReplyEnabled;

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

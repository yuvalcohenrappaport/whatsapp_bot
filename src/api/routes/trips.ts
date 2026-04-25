/**
 * Trip dashboard API routes (Phase 55 Plan 02).
 *
 * Six endpoints for the trip detail view — JWT-gated reads, three write
 * endpoints that are soft-only, idempotent, and reject writes against
 * archived trips with 403, plus a JWT-gated SSE stream.
 *
 *   GET /api/trips
 *     Auth: Authorization: Bearer <jwt>
 *     Body: { trips: TripListEntry[] } — all trips sorted upcoming-first.
 *
 *   GET /api/trips/:groupJid
 *     Auth: Authorization: Bearer <jwt>
 *     Body: TripBundle | 404. readOnly: true for archived trips.
 *
 *   DELETE /api/trips/:groupJid/decisions/:id
 *     Auth: Authorization: Bearer <jwt>
 *     Soft-deletes (status='deleted'). 204 (idempotent). 403 if archived.
 *     404 if id unknown or belongs to a different group (anti-leak).
 *
 *   PATCH /api/trips/:groupJid/questions/:id/resolve
 *     Auth: Authorization: Bearer <jwt>
 *     Flips resolved=true on an open_question row. 204 (idempotent).
 *     403 if archived. 404 if id unknown/wrong group.
 *
 *   PATCH /api/trips/:groupJid/budget
 *     Auth: Authorization: Bearer <jwt>
 *     Body: Partial<Record<TripCategory, number>>
 *     Shallow-merges category targets. Returns { budget: BudgetRollup }.
 *     400 on invalid keys/values. 403 if archived. 404 if no context.
 *
 *   GET /api/trips/:groupJid/stream?token=<jwt>
 *     Auth: ?token= query string — EventSource can't send Authorization
 *           headers, so the JWT is verified manually via fastify.jwt.verify().
 *           Matches actionables.ts / calendar.ts SSE pattern exactly.
 *     Polls getTripBundle every 3s, emits `event: trip.updated` on hash
 *     change. Heartbeat ping every 15s to keep reverse proxies alive.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  getTripBundle,
  listTripsForDashboard,
  softDeleteDecision,
  resolveOpenItem,
  updateBudgetByCategory,
  TRIP_CATEGORIES,
  type TripBundle,
} from '../../db/queries/tripMemory.js';
import { db } from '../../db/client.js';
import { tripDecisions } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

// ─── Zod schema for PATCH /budget ────────────────────────────────────────────

// z.record(z.enum(...), ...) in Zod v3 requires ALL enum keys to be present —
// use z.record(z.string(), ...) + a custom refinement instead so callers can
// send a partial update (just the categories they want to change).
const PatchBudgetSchema = z
  .record(z.string(), z.number().finite().nonnegative())
  .refine(
    (obj) => Object.keys(obj).every((k) => (TRIP_CATEGORIES as readonly string[]).includes(k)),
    { message: 'Invalid category key — must be one of: ' + TRIP_CATEGORIES.join(', ') },
  );

// ─── Hash helper (exported so vitest can assert stability) ────────────────────

/**
 * Stable content hash of a TripBundle. Covers every UI-visible field:
 * decisions [id, status, resolved, costAmount, category, lat, lng],
 * openQuestions [id, resolved], budget targets+spent, calendarEvents
 * [id, eventDate, title], readOnly flag.
 */
export function hashTripBundle(bundle: TripBundle): string {
  const projection = {
    readOnly: bundle.readOnly,
    decisions: bundle.decisions.map((d) => [
      d.id,
      d.status,
      d.resolved,
      d.costAmount,
      d.category,
      d.lat,
      d.lng,
    ]),
    openQuestions: bundle.openQuestions.map((q) => [q.id, q.resolved]),
    budget: {
      targets: bundle.budget.targets,
      spent: bundle.budget.spent,
    },
    calendarEvents: bundle.calendarEvents.map((e) => [
      e.id,
      e.eventDate,
      e.title,
    ]),
  };
  return createHash('sha1').update(JSON.stringify(projection)).digest('hex');
}

// ─── Fastify plugin ───────────────────────────────────────────────────────────

export default async function tripsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ─── GET /api/trips ───────────────────────────────────────────────────
  fastify.get(
    '/api/trips',
    { onRequest: [fastify.authenticate] },
    async () => {
      return { trips: listTripsForDashboard() };
    },
  );

  // ─── GET /api/trips/:groupJid ─────────────────────────────────────────
  fastify.get<{ Params: { groupJid: string } }>(
    '/api/trips/:groupJid',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid } = request.params;
      const bundle = getTripBundle(groupJid);
      if (!bundle) {
        return reply.status(404).send({ error: 'Trip not found' });
      }
      return bundle;
    },
  );

  // ─── DELETE /api/trips/:groupJid/decisions/:id ────────────────────────
  fastify.delete<{ Params: { groupJid: string; id: string } }>(
    '/api/trips/:groupJid/decisions/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid, id } = request.params;

      // 403 guard — archived trips are read-only
      const bundle = getTripBundle(groupJid);
      if (bundle?.readOnly) {
        return reply
          .status(403)
          .send({ error: 'Archived trip is read-only' });
      }
      // 404 if trip itself not found
      if (!bundle) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // Existence check: must belong to this group (anti-leak: don't reveal
      // whether a decision ID exists in a different group)
      const row = db
        .select()
        .from(tripDecisions)
        .where(
          and(
            eq(tripDecisions.id, id),
            eq(tripDecisions.groupJid, groupJid),
          ),
        )
        .get();

      if (!row) {
        return reply.status(404).send({ error: 'Decision not found' });
      }

      // Soft-delete is idempotent — already-deleted rows still get 204
      softDeleteDecision(id);
      return reply.status(204).send();
    },
  );

  // ─── PATCH /api/trips/:groupJid/questions/:id/resolve ─────────────────
  fastify.patch<{ Params: { groupJid: string; id: string } }>(
    '/api/trips/:groupJid/questions/:id/resolve',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid, id } = request.params;

      // 403 guard
      const bundle = getTripBundle(groupJid);
      if (bundle?.readOnly) {
        return reply
          .status(403)
          .send({ error: 'Archived trip is read-only' });
      }
      if (!bundle) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // Existence check: must belong to this group AND be an open_question
      const row = db
        .select()
        .from(tripDecisions)
        .where(
          and(
            eq(tripDecisions.id, id),
            eq(tripDecisions.groupJid, groupJid),
            eq(tripDecisions.type, 'open_question'),
          ),
        )
        .get();

      if (!row) {
        return reply.status(404).send({ error: 'Question not found' });
      }

      // Resolve is idempotent — already-resolved rows still get 204
      resolveOpenItem(id);
      return reply.status(204).send();
    },
  );

  // ─── PATCH /api/trips/:groupJid/budget ────────────────────────────────
  fastify.patch<{ Params: { groupJid: string }; Body: unknown }>(
    '/api/trips/:groupJid/budget',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid } = request.params;

      // 403 guard
      const bundle = getTripBundle(groupJid);
      if (bundle?.readOnly) {
        return reply
          .status(403)
          .send({ error: 'Archived trip is read-only' });
      }
      if (!bundle) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // Validate body
      const parsed = PatchBudgetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid budget patch',
          details: parsed.error.issues,
        });
      }

      // updateBudgetByCategory throws if no trip_context row exists
      try {
        updateBudgetByCategory(groupJid, parsed.data as Record<string, number>);
      } catch {
        return reply.status(404).send({ error: 'Trip context not found' });
      }

      // Return the canonical BudgetRollup so FE can revert optimistic updates
      const fresh = getTripBundle(groupJid);
      return { budget: fresh!.budget };
    },
  );

  // ─── GET /api/trips/:groupJid/stream (SSE) ────────────────────────────
  fastify.get<{ Params: { groupJid: string } }>(
    '/api/trips/:groupJid/stream',
    async (request, reply) => {
      // JWT gate — EventSource can't send headers, so we verify the
      // ?token=<jwt> query string manually (same pattern as
      // actionables.ts and calendar.ts).
      const { token } = request.query as { token?: string };
      try {
        fastify.jwt.verify(token ?? '');
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { groupJid } = request.params;

      // SSE framing — all four headers match the actionables / calendar
      // stream for behaviour parity behind nginx / cloudflare / ngrok.
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      // Per-connection state
      let lastHash: string | null = null;
      let closed = false;

      const writeFrame = (frame: string): void => {
        if (closed) return;
        try {
          reply.raw.write(frame);
        } catch {
          closed = true;
        }
      };

      // DB poll + emit. Errors log-and-swallow so the client's last-known-
      // good state stays on screen until the next tick succeeds.
      const pollOnce = (): void => {
        if (closed) return;
        try {
          const bundle = getTripBundle(groupJid);
          if (!bundle) return; // Trip deleted between subscribe and tick
          const hash = hashTripBundle(bundle);
          if (hash !== lastHash) {
            lastHash = hash;
            writeFrame(
              `event: trip.updated\ndata: ${JSON.stringify(bundle)}\n\n`,
            );
          }
        } catch (err) {
          fastify.log.warn(
            { err },
            '[trips-stream] poll failed; will retry',
          );
        }
      };

      // Seed client state immediately
      pollOnce();

      const pollInterval = setInterval(pollOnce, POLL_INTERVAL_MS);

      const heartbeatInterval = setInterval(() => {
        writeFrame(': ping\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      request.raw.on('close', () => {
        closed = true;
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
      });
    },
  );
}

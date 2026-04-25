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
  restoreDecision,
  resolveOpenItem,
  updateBudgetByCategory,
  updateDecisionGeocode,
  getDecisionsForBackfill,
  pinDecision,
  TRIP_CATEGORIES,
  type TripBundle,
} from '../../db/queries/tripMemory.js';
import { db } from '../../db/client.js';
import { tripDecisions } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import {
  exportTripToGoogleDoc,
  MissingDocsScopeError,
  type TripExportInput,
} from '../../integrations/googleDocsExport.js';
import { geocodeDecision } from '../../integrations/placesGeocode.js';
import {
  autocompletePlaces,
  fetchPlaceDetails,
  PlacesAutocompleteError,
} from '../../integrations/placesAutocomplete.js';
import { config } from '../../config.js';

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

// ─── Zod schema for PATCH /pin (Phase 57 D14) ────────────────────────────────

const PinDecisionBodySchema = z.object({
  placeId: z.string().min(1),
  sessionToken: z.string().min(1),
  languageCode: z.enum(['iw', 'en']).optional(),
});

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

  // ─── POST /api/trips/:groupJid/decisions/:id/restore ─────────────────
  fastify.post<{ Params: { groupJid: string; id: string } }>(
    '/api/trips/:groupJid/decisions/:id/restore',
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

      // Restore is idempotent — already-active rows return changes:0 but
      // the route still returns 204 (caller can treat it as a no-op success).
      restoreDecision(id, groupJid);
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

  // ─── POST /api/trips/:groupJid/export ─────────────────────────────────
  fastify.post<{ Params: { groupJid: string } }>(
    '/api/trips/:groupJid/export',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid } = request.params;
      const bundle = getTripBundle(groupJid);
      if (!bundle) return reply.status(404).send({ error: 'Trip not found' });

      const input: TripExportInput = {
        destination: bundle.context?.destination ?? null,
        startDate: bundle.context?.startDate ?? null,
        endDate: bundle.context?.endDate ?? null,
        decisions: bundle.decisions.map((d) => ({
          id: d.id,
          type: d.type,
          value: d.value,
          category: d.category,
          costAmount: d.costAmount,
          costCurrency: d.costCurrency,
          origin: d.origin,
          status: d.status,
          metadata: d.metadata,
        })),
        openQuestions: bundle.openQuestions.map((q) => ({
          id: q.id,
          value: q.value,
          resolved: q.resolved,
        })),
        calendarEvents: bundle.calendarEvents.map((e) => ({
          id: e.id,
          title: e.title,
          eventDate: e.eventDate,
        })),
        budget: bundle.budget,
      };

      try {
        const { url } = await exportTripToGoogleDoc(input);
        return { url };
      } catch (err) {
        if (err instanceof MissingDocsScopeError) {
          return reply.status(412).send({
            error: 'Google Docs scope missing',
            action: 'Visit /integrations and re-authorize Google to grant the documents scope',
          });
        }
        fastify.log.error({ err, groupJid }, '[trips/export] failed');
        return reply.status(500).send({ error: 'Export failed', detail: String(err) });
      }
    },
  );

  // ─── POST /api/trips/:groupJid/backfill-geocode ────────────────────────
  fastify.post<{ Params: { groupJid: string } }>(
    '/api/trips/:groupJid/backfill-geocode',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid } = request.params;
      const bundle = getTripBundle(groupJid);
      if (!bundle) return reply.status(404).send({ error: 'Trip not found' });
      if (bundle.readOnly) return reply.status(403).send({ error: 'Archived trip is read-only' });

      // Fail fast if no API key is configured
      if (!config.GOOGLE_PLACES_API_KEY) {
        return reply.status(412).send({ error: 'GOOGLE_PLACES_API_KEY not configured' });
      }

      const eligible = getDecisionsForBackfill(groupJid);
      const destination = bundle.context?.destination ?? null;

      const summary = { geocoded: 0, no_match: 0, error: 0, skipped: 0, total: eligible.length };

      for (const row of eligible) {
        try {
          const result = await geocodeDecision(row.value, destination);
          if (result) {
            updateDecisionGeocode(row.id, 'geocoded', result);
            summary.geocoded++;
          } else {
            updateDecisionGeocode(row.id, 'no_match', null);
            summary.no_match++;
          }
        } catch (err) {
          fastify.log.warn({ err, decisionId: row.id, groupJid }, 'backfill-geocode row failed');
          updateDecisionGeocode(row.id, 'error', null);
          summary.error++;
        }
        await new Promise((r) => setTimeout(r, 200)); // 200ms pace per CONTEXT.md
      }

      return summary;
    },
  );

  // ─── GET /api/trips/:groupJid/autocomplete-places (Phase 57 Plan 02) ──────
  // JWT-gated proxy to Places API (New) Autocomplete. Read-only — archived
  // trips CAN search; only the pin write itself is gated (CONTEXT D14).
  fastify.get<{
    Params: { groupJid: string };
    Querystring: { q?: string; sessionToken?: string; languageCode?: string };
  }>(
    '/api/trips/:groupJid/autocomplete-places',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid } = request.params;
      const { q, sessionToken, languageCode } = request.query;

      // 404 if trip doesn't exist (anti-leak: don't reveal arbitrary group state)
      const bundle = getTripBundle(groupJid);
      if (!bundle) return reply.status(404).send({ error: 'Trip not found' });

      // NOTE: archived trips CAN search — the picker only suppresses Save, not
      // the search-while-typing UX. The pin write itself is gated below.

      if (!q || q.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing required query param `q`' });
      }
      if (!sessionToken || sessionToken.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing required query param `sessionToken`' });
      }
      const lang = languageCode === 'iw' || languageCode === 'en' ? languageCode : undefined;

      try {
        const suggestions = await autocompletePlaces(q, sessionToken, lang);
        return { suggestions };
      } catch (err) {
        if (err instanceof PlacesAutocompleteError) {
          if (err.status === 412) {
            return reply.status(412).send({ error: 'GOOGLE_PLACES_API_KEY not configured' });
          }
          fastify.log.warn({ err, groupJid, q }, 'autocomplete-places upstream error');
          return reply.status(502).send({ error: 'Places API error', upstream: err.status });
        }
        fastify.log.error({ err, groupJid, q }, 'autocomplete-places unexpected error');
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  // ─── GET /api/trips/:groupJid/place/:placeId (Phase 57 D9 preview) ───────
  // Read-only proxy to Places Details. The picker calls this on Pick (before
  // Save) so the optimistic state at Save time carries real lat/lng — letting
  // the off-map badge decrement in the same React tick (CONTEXT D9 lock).
  fastify.get<{
    Params: { groupJid: string; placeId: string };
    Querystring: { sessionToken?: string; languageCode?: string };
  }>(
    '/api/trips/:groupJid/place/:placeId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid, placeId } = request.params;
      const { sessionToken, languageCode } = request.query;

      // 404 if trip doesn't exist (group-membership gate via JWT + bundle lookup)
      const bundle = getTripBundle(groupJid);
      if (!bundle) return reply.status(404).send({ error: 'Trip not found' });

      // NOTE: archived trips CAN preview — same as autocomplete-places. No write here.

      if (!placeId || placeId.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing placeId path param' });
      }
      if (!sessionToken || sessionToken.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing required query param `sessionToken`' });
      }
      const lang = languageCode === 'iw' || languageCode === 'en' ? languageCode : undefined;

      try {
        const result = await fetchPlaceDetails(placeId, sessionToken, lang);
        // Return the same shape PATCH /pin would write — Plan 03's
        // fetchPlacePreview parses this directly into a PlacePreview object.
        return {
          placeId: result.placeId,
          lat: result.lat,
          lng: result.lng,
          canonicalAddress: result.canonicalAddress,
          metadata: result.metadata,
        };
      } catch (err) {
        if (err instanceof PlacesAutocompleteError) {
          if (err.status === 412) {
            return reply.status(412).send({ error: 'GOOGLE_PLACES_API_KEY not configured' });
          }
          fastify.log.warn({ err, groupJid, placeId }, 'place preview upstream error');
          return reply.status(502).send({ error: 'Places API error', upstream: err.status });
        }
        fastify.log.error({ err, groupJid, placeId }, 'place preview unexpected error');
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  // ─── PATCH /api/trips/:groupJid/decisions/:id/pin (Phase 57 D14) ─────────
  // Maps PinDecisionResult discriminated union → distinct HTTP status codes:
  //   200 ok / 400 invalid body / 401 unauth / 403 archived (trip OR row)
  //   404 missing OR cross-group decision (anti-leak; same message)
  //   412 missing API key / 500 internal / 502 upstream Places failure
  fastify.patch<{
    Params: { groupJid: string; id: string };
    Body: unknown;
  }>(
    '/api/trips/:groupJid/decisions/:id/pin',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupJid, id } = request.params;

      // 404 if trip doesn't exist
      const bundle = getTripBundle(groupJid);
      if (!bundle) return reply.status(404).send({ error: 'Trip not found' });

      // 403 — archived trips are read-only at the trip level (CONTEXT D14)
      if (bundle.readOnly) {
        return reply.status(403).send({ error: 'Trip is archived' });
      }

      // Validate body
      const parsed = PinDecisionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid pin body',
          details: parsed.error.issues,
        });
      }

      // Fetch place details from Google
      let result;
      try {
        result = await fetchPlaceDetails(
          parsed.data.placeId,
          parsed.data.sessionToken,
          parsed.data.languageCode,
        );
      } catch (err) {
        if (err instanceof PlacesAutocompleteError) {
          if (err.status === 412) {
            return reply.status(412).send({ error: 'GOOGLE_PLACES_API_KEY not configured' });
          }
          fastify.log.warn({ err, groupJid, id }, 'pin: fetchPlaceDetails failed');
          return reply.status(502).send({ error: 'Places API error', upstream: err.status });
        }
        fastify.log.error({ err, groupJid, id }, 'pin: unexpected error');
        return reply.status(500).send({ error: 'Internal error' });
      }

      // Persist with archived/group guards in pinDecision.
      // pinDecision returns a discriminated union — map each case to the
      // correct HTTP status per CONTEXT D14:
      //   - missing → 404 ("Decision not found")
      //   - wrong-group → 404 ("Decision not found") — anti-leak; never reveal
      //     that the id exists in a different group
      //   - archived → 403 ("Decision is archived") — D14 mandates 403 for
      //     ANY archived case, including a row archived by Phase 51's daily
      //     auto-archive cron INSIDE an active trip (the bundle.readOnly
      //     check above only catches whole-trip archive)
      const persistResult = pinDecision(id, groupJid, result);
      if (!persistResult.ok) {
        if (persistResult.reason === 'archived') {
          return reply.status(403).send({ error: 'Decision is archived' });
        }
        // missing OR wrong-group → 404 with the SAME message (anti-leak)
        return reply.status(404).send({ error: 'Decision not found' });
      }

      // Re-read canonical state and return ONLY the freshly-pinned decision row.
      // (The full bundle is overkill — useTrip's optimistic mutation already
      // has a snapshot; it just needs to drop in the canonical row to confirm
      // the write succeeded. The SSE 3s tick will broadcast the same row to
      // all OTHER sessions.)
      const fresh = getTripBundle(groupJid);
      const decision = fresh?.decisions.find((d) => d.id === id);
      if (!decision) {
        // Should be unreachable — we just wrote this row.
        fastify.log.error({ groupJid, id }, 'pin: post-write bundle re-read missed the row');
        return reply.status(500).send({ error: 'Post-write read missed' });
      }
      return { decision };
    },
  );
}

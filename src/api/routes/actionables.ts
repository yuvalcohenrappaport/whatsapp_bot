/**
 * Dashboard read-plus-SSE routes for Phase 43 (plan 43-01).
 *
 * Three endpoints — all JWT-gated, all read-only, all backed by the existing
 * `src/db/queries/actionables.ts` query layer shipped in Phase 39. Contract
 * mirrors `/api/linkedin/*` so the dashboard keeps ONE mental model for
 * JWT + SSE across both surfaces.
 *
 *   GET /api/actionables/pending
 *     Auth: Authorization: Bearer <jwt> (via fastify.authenticate decorator)
 *     Body: { actionables: Actionable[] } — every row with
 *           status='pending_approval', ordered detectedAt desc by the
 *           query layer.
 *
 *   GET /api/actionables/recent?limit=50
 *     Auth: Authorization: Bearer <jwt>
 *     Query: limit — optional, defaults 50, clamps [1, 200], NaN falls
 *            back to 50.
 *     Body: { actionables: Actionable[] } — terminal-status rows
 *           (approved, rejected, expired, fired) ordered updatedAt desc.
 *
 *   GET /api/actionables/stream?token=<jwt>
 *     Auth: EventSource can't set headers, so the JWT comes via query
 *           string and we call fastify.jwt.verify(token) manually —
 *           exactly the /api/linkedin/queue/stream pattern.
 *     Headers: Content-Type text/event-stream + Cache-Control no-cache +
 *              Connection keep-alive + X-Accel-Buffering no.
 *     Poll: every POLL_INTERVAL_MS (3s) read both lists, sha1 a stable
 *           subset per row, emit `event: actionables.updated\ndata: {...}`
 *           iff the hash changed. FIRST poll ALWAYS emits (seeds client).
 *     Heartbeat: `: ping\n\n` every HEARTBEAT_INTERVAL_MS (15s) — keeps
 *                reverse proxies from dropping an idle connection.
 *     Errors: DB read failures log.warn-and-keep-polling — no event is
 *             emitted so the client's last-known-good state stays on
 *             screen.
 *
 * Why polling instead of threading emits through approvalHandler /
 * detectionService / expiryScan: the hash-polling loop catches every
 * status change automatically. ~5ms per DB read × 3s tick = 0.17% CPU
 * for a single worker — same tradeoff LinkedIn stream made per its
 * docstring.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  getPendingActionables,
  getRecentTerminalActionables,
  getActionableById,
  updateActionableTask,
  updateActionableFireAt,
  updateActionableTodoIds,
  createApprovedActionable,
  type Actionable,
} from '../../db/queries/actionables.js';
import { getSetting } from '../../db/queries/settings.js';
import { config } from '../../config.js';
import { createTodoTask, updateTodoTask } from '../../todo/todoService.js';

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_RECENT_LIMIT = 50;
const MAX_RECENT_LIMIT = 200;
const MIN_RECENT_LIMIT = 1;

/**
 * Stable content hash across BOTH pending and recent lists. Catches every
 * UI-visible change (id set, status transition, task edit, enrichment,
 * Google Tasks linkage) and ignores fields that drift without semantic
 * impact (e.g. createdAt — which never changes after INSERT anyway).
 *
 * Exported so the vitest suite can assert stability + change-detection
 * without spinning up a real SSE connection.
 */
export function hashActionables(
  pending: Actionable[],
  recent: Actionable[],
): string {
  const row = (a: Actionable): Array<string | number | null> => [
    a.id,
    a.status,
    a.updatedAt,
    a.enrichedTitle ? a.enrichedTitle.slice(0, 50) : null,
    a.todoTaskId,
  ];
  const combined = {
    pending: pending.map(row),
    recent: recent.map(row),
  };
  return createHash('sha1').update(JSON.stringify(combined)).digest('hex');
}

/** Marshal both lists into a single `actionables.updated` SSE frame. */
function buildUpdatedFrame(
  pending: Actionable[],
  recent: Actionable[],
): string {
  const payload = JSON.stringify({ pending, recent });
  return `event: actionables.updated\ndata: ${payload}\n\n`;
}

export default async function actionablesRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ─── GET /api/actionables/pending ────────────────────────────────────
  fastify.get(
    '/api/actionables/pending',
    { onRequest: [fastify.authenticate] },
    async () => {
      const actionables = getPendingActionables();
      return { actionables };
    },
  );

  // ─── GET /api/actionables/recent?limit=50 ────────────────────────────
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/actionables/recent',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const rawLimit = request.query.limit;
      let limit = DEFAULT_RECENT_LIMIT;
      if (rawLimit !== undefined) {
        const parsed = parseInt(rawLimit, 10);
        if (!Number.isNaN(parsed)) {
          limit = Math.min(
            MAX_RECENT_LIMIT,
            Math.max(MIN_RECENT_LIMIT, parsed),
          );
        }
      }
      const actionables = getRecentTerminalActionables(limit);
      return { actionables };
    },
  );

  // ─── GET /api/actionables/stream (SSE) ───────────────────────────────
  fastify.get('/api/actionables/stream', async (request, reply) => {
    // JWT gate — EventSource can't send headers, so we verify the
    // ?token=<jwt> query string manually (same pattern as
    // /api/linkedin/queue/stream and /api/status/stream).
    const { token } = request.query as { token?: string };
    try {
      fastify.jwt.verify(token ?? '');
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // SSE framing — all four headers match the LinkedIn stream for
    // behavior parity behind nginx/cloudflare/ngrok.
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    // Per-connection state.
    let lastHash: string | null = null;
    let closed = false;

    const writeFrame = (frame: string): void => {
      if (closed) return;
      try {
        reply.raw.write(frame);
      } catch {
        // Socket dead — mark closed and let the cleanup interval fire.
        closed = true;
      }
    };

    // DB poll + emit. Errors log-and-swallow; the next tick may succeed.
    const pollOnce = (): void => {
      if (closed) return;
      try {
        const pending = getPendingActionables();
        const recent = getRecentTerminalActionables(DEFAULT_RECENT_LIMIT);
        const hash = hashActionables(pending, recent);
        if (hash !== lastHash) {
          lastHash = hash;
          writeFrame(buildUpdatedFrame(pending, recent));
        }
      } catch (err) {
        // Stale data is better than a crashed stream — the client's
        // last-known-good state stays on screen until the next tick
        // succeeds.
        fastify.log.warn(
          { err },
          '[actionables-stream] poll failed; will retry',
        );
      }
    };

    // Kick off the first poll immediately — seeds the client state.
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
  });

  // ─── PATCH /api/actionables/:id ──────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Body: { task?: string; fireAt?: number | null };
  }>(
    '/api/actionables/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const body = (request.body ?? {}) as { task?: string; fireAt?: number | null };
      const { task, fireAt } = body;

      if (task === undefined && fireAt === undefined) {
        return reply.status(400).send({ error: 'empty patch' });
      }

      const row = getActionableById(id);
      if (!row) {
        return reply.status(404).send({ error: 'Actionable not found' });
      }

      if (task !== undefined) updateActionableTask(id, task);
      if (fireAt !== undefined) updateActionableFireAt(id, fireAt);

      // Best-effort mirror to Google Tasks
      if (row.todoTaskId && row.todoListId) {
        void updateTodoTask(row.todoListId, row.todoTaskId, {
          ...(task !== undefined && { title: task }),
          ...(fireAt !== undefined && {
            due: fireAt === null ? null : new Date(fireAt).toISOString(),
          }),
        });
      }

      const fresh = getActionableById(id);
      return { actionable: fresh };
    },
  );

  // ─── POST /api/actionables ───────────────────────────────────────────
  fastify.post<{
    Body: { task?: string; fireAt?: number | null; detectedLanguage?: 'he' | 'en'; sourceContactName?: string | null };
  }>(
    '/api/actionables',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        task?: string;
        fireAt?: number | null;
        detectedLanguage?: 'he' | 'en';
        sourceContactName?: string | null;
      };

      if (!body.task || String(body.task).trim() === '') {
        return reply.status(400).send({ error: 'task is required' });
      }

      const newRow = createApprovedActionable({
        task: body.task,
        fireAt: body.fireAt ?? null,
        detectedLanguage: body.detectedLanguage,
        sourceContactJid: config.USER_JID,
        sourceContactName: body.sourceContactName ?? 'Self',
      });

      // Best-effort Google Tasks sync
      const todoListId = getSetting('google_tasks_list_id');
      if (todoListId) {
        try {
          const result = await createTodoTask({
            title: body.task,
            note: `Created from dashboard`,
          });
          updateActionableTodoIds(newRow.id, {
            todoTaskId: result.taskId,
            todoListId: result.listId,
          });
        } catch {
          // Swallow — local row already written
        }
      }

      const fresh = getActionableById(newRow.id);
      return reply.status(201).send({ actionable: fresh });
    },
  );
}

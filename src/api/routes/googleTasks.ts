/**
 * Phase 46 Plan 01 — Google Tasks full-list sync read layer.
 *
 * Two JWT-gated routes exposing every Google Tasks list the owner maintains
 * (not just the bot-configured 'WhatsApp Tasks' list) to the dashboard:
 *
 *   GET /api/google-tasks/lists
 *     Returns every list, mapped to { id, name, etag, updated } shape.
 *     `title` → `name` at the projection boundary so clients don't need to
 *     learn both names.
 *
 *   GET /api/google-tasks/items?from=<ms>&to=<ms>
 *     Returns CalendarItem[] with source='gtasks' across all lists within
 *     the window. Completed tasks are dropped by todoService; undated tasks
 *     are dropped by todoService. Items whose id matches a live (approved)
 *     actionable's todoTaskId are deduped server-side so the client never
 *     sees both the actionable row and the gtasks row for the same task.
 *
 * Per-list color is assigned via djb2 hash over listId — list IDs are stable
 * per Google (renames don't change the id), so colors persist across renames.
 * Palette is shared with Phase 47's hashCalendarColor for visual consistency
 * across gtasks + gcal.
 */
import type { FastifyInstance } from 'fastify';
import type { CalendarItem } from './calendar.js';
import {
  getAllTaskLists,
  getTaskItemsInWindow,
  rescheduleTodoTask,
  editTodoTaskTitle,
  completeTodoTask,
  deleteTodoTask,
  updateTodoTask,
  type GtasksCalendarItem,
} from '../../todo/todoService.js';
import {
  getApprovedActionableTodoTaskIds,
  getActionableByTodoTaskId,
  updateActionableTask,
  updateActionableFireAt,
} from '../../db/queries/actionables.js';

// ─── Color hash helper (shared palette with gcalService.hashCalendarColor) ──

const PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-fuchsia-500',
];

/**
 * djb2 hash over listId → palette slot. listId is stable per Google Tasks
 * (renaming a list does NOT change its id), so color is stable across renames
 * per the locked CONTEXT decision.
 */
export function hashListColor(listId: string): string {
  let h = 5381;
  for (let i = 0; i < listId.length; i++) {
    h = ((h << 5) + h) ^ listId.charCodeAt(i);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ─── Window parser (copied inline from calendar.ts — same shape) ───────────

const DEFAULT_FROM_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TO_OFFSET_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

function parseWindow(q: {
  from?: string;
  to?: string;
}): { fromMs: number; toMs: number } {
  const now = Date.now();
  let fromMs = parseInt(q.from ?? '', 10);
  let toMs = parseInt(q.to ?? '', 10);
  if (!Number.isFinite(fromMs)) fromMs = now - DEFAULT_FROM_OFFSET_MS;
  if (!Number.isFinite(toMs)) toMs = now + DEFAULT_TO_OFFSET_MS;
  if (toMs - fromMs > MAX_WINDOW_MS) toMs = fromMs + MAX_WINDOW_MS;
  return { fromMs, toMs };
}

// ─── Projection helper (gtasks → CalendarItem shape) ───────────────────────

function projectGtasksItem(item: GtasksCalendarItem): CalendarItem {
  return {
    source: 'gtasks',
    id: item.id,
    title: item.title,
    start: item.dueMs,
    end: null,
    isAllDay: false,
    language: /[\u0590-\u05FF]/.test(item.title) ? 'he' : 'en',
    sourceFields: {
      listId: item.listId,
      listName: item.listName,
      color: hashListColor(item.listId),
      sourceColor: hashListColor(item.listId),
      etag: item.etag,
      updated: item.updated,
    },
  };
}

/**
 * Internal helper for the unified aggregator (Plan 46-02). Same logic as
 * GET /api/google-tasks/items but returns the CalendarItem[] directly —
 * no HTTP, no auth, no error-envelope. The aggregator wraps this in
 * Promise.allSettled for partial-failure isolation across sources.
 */
export async function fetchGtasksCalendarItems(
  fromMs: number,
  toMs: number,
): Promise<CalendarItem[]> {
  const [items, approvedIds] = await Promise.all([
    getTaskItemsInWindow(fromMs, toMs),
    Promise.resolve().then(() =>
      getApprovedActionableTodoTaskIds(fromMs, toMs),
    ),
  ]);
  // Dedup — GTASKS-05: actionable row wins, drop matching gtasks item entirely.
  const kept = items.filter((t) => !approvedIds.has(t.id));
  return kept.map(projectGtasksItem);
}

export default async function googleTasksRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/google-tasks/lists — enumerate every list
  fastify.get(
    '/api/google-tasks/lists',
    { onRequest: [fastify.authenticate] },
    async (_req, reply) => {
      try {
        const rows = await getAllTaskLists();
        return {
          lists: rows.map((l) => ({
            id: l.id,
            name: l.title,
            etag: l.etag,
            updated: l.updated,
          })),
        };
      } catch (err) {
        fastify.log.warn({ err }, 'gtasks getAllTaskLists failed');
        return reply.status(503).send({ error: 'gtasks_unavailable' });
      }
    },
  );

  // GET /api/google-tasks/items?from=<ms>&to=<ms>
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/google-tasks/items',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { fromMs, toMs } = parseWindow(request.query);
      try {
        const items = await fetchGtasksCalendarItems(fromMs, toMs);
        return { items };
      } catch (err) {
        fastify.log.warn({ err }, 'gtasks fetchGtasksCalendarItems failed');
        // Match the gcal pattern: graceful 200 with empty items + error code
        // so the Plan 46-02 aggregator's partial-failure logic stays uniform.
        return { items: [], error: 'gtasks_unavailable' };
      }
    },
  );

  // ─── Phase 46 Plan 04 — gtasks mutation routes ──────────────────────────
  //
  // All four routes are JWT-gated and require ?listId=<listId> because the
  // Google Tasks API is list-scoped (task ids are list-local). The mutation
  // helpers in todoService.ts return boolean (never throw) — `false`
  // surfaces as 502 gtasks_upstream_error.

  const EDIT_TITLE_MAX_LEN = 1024;

  // PATCH /api/google-tasks/items/:taskId/reschedule?listId=...
  //   body: { dueMs: number } (unix ms)
  fastify.patch<{
    Params: { taskId: string };
    Querystring: { listId?: string };
    Body: { dueMs?: unknown };
  }>(
    '/api/google-tasks/items/:taskId/reschedule',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const listId = request.query.listId;
      if (!listId) {
        return reply.status(400).send({ error: 'listId is required' });
      }
      const dueMs = (request.body ?? {}).dueMs;
      if (typeof dueMs !== 'number' || !Number.isFinite(dueMs)) {
        return reply.status(400).send({ error: 'dueMs must be a finite number' });
      }

      // If the gtasks item is mirrored by a live actionable, also update the
      // actionable's fireAt so the calendar surfaces stay consistent after
      // Plan 45-02's "one echo" discipline. Best-effort — the DB flip is a
      // local write, not a network call.
      const mirror = getActionableByTodoTaskId(taskId);
      if (mirror && mirror.status === 'approved') {
        updateActionableFireAt(mirror.id, dueMs);
      }

      const ok = await rescheduleTodoTask(listId, taskId, dueMs);
      if (!ok) {
        return reply.status(502).send({ error: 'gtasks_upstream_error' });
      }
      return { ok: true };
    },
  );

  // PATCH /api/google-tasks/items/:taskId/edit?listId=...
  //   body: { title: string }
  //
  // Mirrored-item edit ownership (CONTEXT §Mirrored-item edit ownership):
  // if the gtasks item is mirrored by a live actionable (status='approved'),
  // rewrite the actionable's task text + push the same title to Google Tasks.
  // We do NOT route through approveActionable here — that primitive requires
  // status='pending_approval' (ALLOWED_TRANSITIONS only permits
  // pending_approval → approved), and a mirrored item is by definition
  // already approved. Instead we mirror the PATCH /api/actionables/:id
  // pattern: updateActionableTask + updateTodoTask in one go. This preserves
  // the actionable ↔ gtasks sync without an invalid-transition throw.
  fastify.patch<{
    Params: { taskId: string };
    Querystring: { listId?: string };
    Body: { title?: unknown };
  }>(
    '/api/google-tasks/items/:taskId/edit',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const listId = request.query.listId;
      if (!listId) {
        return reply.status(400).send({ error: 'listId is required' });
      }
      const rawTitle = (request.body ?? {}).title;
      if (typeof rawTitle !== 'string') {
        return reply.status(400).send({ error: 'title must be a string' });
      }
      const title = rawTitle.trim();
      if (!title) {
        return reply.status(400).send({ error: 'title is required' });
      }
      if (title.length > EDIT_TITLE_MAX_LEN) {
        return reply.status(400).send({
          error: 'title too long',
          maxLength: EDIT_TITLE_MAX_LEN,
        });
      }

      const mirror = getActionableByTodoTaskId(taskId);
      if (mirror && mirror.status === 'approved') {
        // Rewrite the actionable row FIRST, then mirror to Google Tasks via
        // updateTodoTask (same best-effort pattern the /api/actionables/:id
        // PATCH uses — Google push is fire-and-forget but awaited here so
        // we can surface the upstream error code on failure).
        updateActionableTask(mirror.id, title);
        const ok = await updateTodoTask(listId, taskId, { title });
        if (!ok) {
          return reply.status(502).send({ error: 'gtasks_upstream_error' });
        }
        return { ok: true };
      }

      // Non-mirrored item — write directly to Google Tasks.
      const ok = await editTodoTaskTitle(listId, taskId, title);
      if (!ok) {
        return reply.status(502).send({ error: 'gtasks_upstream_error' });
      }
      return { ok: true };
    },
  );

  // DELETE /api/google-tasks/items/:taskId?listId=...
  // Reuses deleteTodoTask — which swallows 404s (already deleted) but throws
  // on other upstream errors. Wrap in try/catch so we can return 502 cleanly.
  fastify.delete<{
    Params: { taskId: string };
    Querystring: { listId?: string };
  }>(
    '/api/google-tasks/items/:taskId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const listId = request.query.listId;
      if (!listId) {
        return reply.status(400).send({ error: 'listId is required' });
      }
      try {
        await deleteTodoTask(taskId, listId);
      } catch (err) {
        fastify.log.warn({ err, taskId, listId }, 'gtasks deleteTodoTask failed');
        return reply.status(502).send({ error: 'gtasks_upstream_error' });
      }
      return reply.status(204).send();
    },
  );

  // PATCH /api/google-tasks/items/:taskId/complete?listId=...
  fastify.patch<{
    Params: { taskId: string };
    Querystring: { listId?: string };
  }>(
    '/api/google-tasks/items/:taskId/complete',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const listId = request.query.listId;
      if (!listId) {
        return reply.status(400).send({ error: 'listId is required' });
      }
      const ok = await completeTodoTask(listId, taskId);
      if (!ok) {
        return reply.status(502).send({ error: 'gtasks_upstream_error' });
      }
      return { ok: true };
    },
  );
}

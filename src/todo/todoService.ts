import { google, type tasks_v1 } from 'googleapis';
import pino from 'pino';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { getOAuth2Client } from '../calendar/personalCalendarService.js';

const logger = pino({ level: config.LOG_LEVEL });

const LIST_NAME = 'WhatsApp Tasks';
const TASKS_LIST_ID_KEY = 'google_tasks_list_id';

function getTasksClient(): tasks_v1.Tasks | null {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return google.tasks({ version: 'v1', auth });
}

async function findOrCreateTaskList(): Promise<string> {
  const client = getTasksClient();
  if (!client) throw new Error('Google Tasks client not available');

  // Check cached list ID
  const cachedId = getSetting(TASKS_LIST_ID_KEY);
  if (cachedId) {
    try {
      const res = await client.tasklists.get({ tasklist: cachedId });
      if (res.data.id) return cachedId;
    } catch {
      logger.info('Google Tasks: cached list ID is stale, re-fetching');
      setSetting(TASKS_LIST_ID_KEY, '');
    }
  }

  // Search existing lists
  const listRes = await client.tasklists.list();
  const existing = listRes.data.items?.find((l) => l.title === LIST_NAME);
  if (existing?.id) {
    setSetting(TASKS_LIST_ID_KEY, existing.id);
    return existing.id;
  }

  // Create new list
  const createRes = await client.tasklists.insert({
    requestBody: { title: LIST_NAME },
  });
  const newId = createRes.data.id;
  if (!newId) throw new Error('Created task list but no ID returned');

  setSetting(TASKS_LIST_ID_KEY, newId);
  logger.info({ listId: newId }, 'Google Tasks: created "WhatsApp Tasks" list');
  return newId;
}

export async function createTodoTask(params: {
  title: string;
  note: string;
}): Promise<{ taskId: string; listId: string }> {
  const client = getTasksClient();
  if (!client) throw new Error('Google Tasks client not available');

  const listId = await findOrCreateTaskList();

  const res = await client.tasks.insert({
    tasklist: listId,
    requestBody: {
      title: params.title,
      notes: params.note,
      status: 'needsAction',
    },
  });

  const taskId = res.data.id;
  if (!taskId) throw new Error('Created task but no ID returned');

  logger.info({ taskId, listId }, 'Google Tasks: task created');
  return { taskId, listId };
}

export async function deleteTodoTask(
  todoTaskId: string,
  todoListId: string,
): Promise<void> {
  const client = getTasksClient();
  if (!client) throw new Error('Google Tasks client not available');

  try {
    await client.tasks.delete({
      tasklist: todoListId,
      task: todoTaskId,
    });
    logger.info({ todoTaskId, todoListId }, 'Google Tasks: task deleted');
  } catch (err: unknown) {
    // Ignore 404 (already deleted)
    const status = (err as { code?: number })?.code;
    if (status === 404) return;
    throw err;
  }
}

/**
 * Patch an existing Google Tasks task. Returns true on success, false on
 * failure (auth missing, 404, 401). Never throws — callers use this for
 * best-effort mirroring after a local DB write.
 */
export async function updateTodoTask(
  listId: string,
  taskId: string,
  patch: { title?: string; due?: string | null; notes?: string },
): Promise<boolean> {
  const client = getTasksClient();
  if (!client) {
    logger.warn('[todoService] no Google auth available for updateTodoTask');
    return false;
  }
  try {
    const requestBody: Record<string, unknown> = {};
    if (patch.title !== undefined) requestBody.title = patch.title;
    if (patch.due !== undefined) requestBody.due = patch.due;
    if (patch.notes !== undefined) requestBody.notes = patch.notes;
    await client.tasks.patch({
      tasklist: listId,
      task: taskId,
      requestBody,
    });
    return true;
  } catch (err) {
    logger.error({ err }, '[todoService] updateTodoTask failed');
    return false;
  }
}

// ─── Phase 46 — full-list sync helpers ─────────────────────────────────────

/**
 * Phase 46 Plan 01 — CalendarItem shape for a Google Tasks task scoped to a
 * specific list. Returned by getTaskItemsInWindow(). Emitted by the gtasks
 * proxy route after projection into the shared CalendarItem discriminated
 * union.
 */
export type GtasksCalendarItem = {
  id: string; // task id
  listId: string;
  listName: string;
  title: string;
  dueMs: number; // parsed from task.due (RFC 3339) as unix ms
  etag: string | null;
  updated: string | null;
};

/**
 * List every Google Tasks task list the owner has access to. Google Tasks
 * API caps at 100 lists per call — hard cap here since the owner realistically
 * has fewer than ~10 lists. Throws if the OAuth client is unavailable
 * (same shape as createTodoTask).
 */
export async function getAllTaskLists(): Promise<
  Array<{ id: string; title: string; etag: string | null; updated: string | null }>
> {
  const client = getTasksClient();
  if (!client) throw new Error('Google Tasks client not available');

  const res = await client.tasklists.list({ maxResults: 100 });
  const items = res.data.items ?? [];
  return items
    .filter((l) => !!l.id)
    .map((l) => ({
      id: l.id!,
      title: l.title ?? '',
      etag: l.etag ?? null,
      updated: l.updated ?? null,
    }));
}

/**
 * Fetch every non-completed, dated task across all of the owner's lists whose
 * `due` falls within [fromMs, toMs]. Undated tasks and completed tasks are
 * dropped — the calendar is a time-based surface.
 *
 * Individual list-fetch failures are logged + swallowed; the remaining lists
 * still contribute. If the outer list-enumeration fails, the caller sees the
 * throw (the route layer converts that into `gtasks_unavailable`).
 */
export async function getTaskItemsInWindow(
  fromMs: number,
  toMs: number,
): Promise<GtasksCalendarItem[]> {
  const client = getTasksClient();
  if (!client) throw new Error('Google Tasks client not available');

  const lists = await getAllTaskLists();
  if (lists.length === 0) return [];

  const perList = await Promise.allSettled(
    lists.map(async (list) => {
      const res = await client.tasks.list({
        tasklist: list.id,
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
      });
      const out: GtasksCalendarItem[] = [];
      for (const t of res.data.items ?? []) {
        if (!t.id || !t.due || t.status === 'completed') continue;
        const dueMs = new Date(t.due).getTime();
        if (!Number.isFinite(dueMs)) continue;
        if (dueMs < fromMs || dueMs > toMs) continue;
        out.push({
          id: t.id,
          listId: list.id,
          listName: list.title,
          title: t.title ?? '',
          dueMs,
          etag: t.etag ?? null,
          updated: t.updated ?? null,
        });
      }
      return out;
    }),
  );

  const items: GtasksCalendarItem[] = [];
  perList.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      logger.warn(
        { err: r.reason, listId: lists[idx]?.id },
        'gtasks per-list fetch failed; continuing with other lists',
      );
    }
  });
  return items;
}

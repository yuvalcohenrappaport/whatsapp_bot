import pino from 'pino';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { getAccessToken } from './todoAuthService.js';

const logger = pino({ level: config.LOG_LEVEL });

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LIST_NAME = 'WhatsApp Tasks';
const MS_TODO_LIST_ID_KEY = 'ms_todo_list_id';

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function findOrCreateTaskList(accessToken: string): Promise<string> {
  // Check cached list ID first
  const cachedId = getSetting(MS_TODO_LIST_ID_KEY);
  if (cachedId) {
    // Validate it still exists
    const checkRes = await fetch(`${GRAPH_BASE}/me/todo/lists/${cachedId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (checkRes.ok) return cachedId;
    // Cached ID is stale, clear it
    logger.info('Microsoft To Do: cached list ID is stale, re-fetching');
    setSetting(MS_TODO_LIST_ID_KEY, '');
  }

  // List existing lists
  const listRes = await fetch(`${GRAPH_BASE}/me/todo/lists`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list To Do lists: ${listRes.status} ${await listRes.text()}`);
  }
  const lists = (await listRes.json()) as { value: Array<{ id: string; displayName: string }> };
  const existing = lists.value?.find((l) => l.displayName === LIST_NAME);
  if (existing) {
    setSetting(MS_TODO_LIST_ID_KEY, existing.id);
    return existing.id;
  }

  // Create new list
  const createRes = await fetch(`${GRAPH_BASE}/me/todo/lists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: LIST_NAME }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create To Do list: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  setSetting(MS_TODO_LIST_ID_KEY, created.id);
  logger.info({ listId: created.id }, 'Microsoft To Do: created "WhatsApp Tasks" list');
  return created.id;
}

export async function createTodoTask(params: {
  title: string;
  note: string;
}): Promise<{ taskId: string; listId: string }> {
  return withRetry(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('No Microsoft access token available');

    const listId = await findOrCreateTaskList(accessToken);

    const res = await fetch(`${GRAPH_BASE}/me/todo/lists/${listId}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: params.title,
        body: { content: params.note, contentType: 'text' },
        importance: 'normal',
        status: 'notStarted',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Create task failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { id: string };
    logger.info({ taskId: data.id, listId }, 'Microsoft To Do: task created');
    return { taskId: data.id, listId };
  });
}

export async function deleteTodoTask(
  todoTaskId: string,
  todoListId: string,
): Promise<void> {
  return withRetry(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('No Microsoft access token available');

    const res = await fetch(
      `${GRAPH_BASE}/me/todo/lists/${todoListId}/tasks/${todoTaskId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    // Ignore 404 (already deleted)
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`Delete task failed: ${res.status} ${errText}`);
    }

    logger.info({ todoTaskId, todoListId }, 'Microsoft To Do: task deleted');
  });
}

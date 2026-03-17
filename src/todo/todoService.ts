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

import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { detectMessageLanguage } from '../calendar/calendarApproval.js';
import {
  insertTodoTask,
  updateTodoTaskStatus,
  updateTodoTaskNotificationMsgId,
  getTodoTaskByNotificationMsgId,
} from '../db/queries/todoTasks.js';
import { createTodoTask, deleteTodoTask } from './todoService.js';
import { isMicrosoftConnected } from './todoAuthService.js';

const logger = pino({ level: config.LOG_LEVEL });

/** Module-level flag to prevent spamming auth failure notifications */
let authFailureNotified = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTaskNote(params: {
  contactName: string | null;
  originalText: string;
}): string {
  const name = params.contactName ?? 'Unknown';
  return `From: ${name}\nOriginal message: "${params.originalText}"`;
}

function isAuthError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes('401') ||
    msg.includes('InteractionRequired') ||
    msg.includes('invalid_grant') ||
    msg.includes('InteractionRequiredAuthError')
  );
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

export async function processDetectedTask(params: {
  task: string;
  confidence: 'high' | 'medium';
  originalText: string;
  contactJid: string;
  contactName: string | null;
  chatText: string;
}): Promise<void> {
  const id = randomUUID();

  // a. Insert into todoTasks with status 'pending'
  insertTodoTask({
    id,
    task: params.task,
    contactJid: params.contactJid,
    contactName: params.contactName ?? undefined,
    originalText: params.originalText,
    confidence: params.confidence,
  });

  // b. Attempt To Do sync
  let synced = false;
  const connected = await isMicrosoftConnected();

  if (connected) {
    try {
      const result = await createTodoTask({
        title: params.task,
        note: buildTaskNote(params),
      });
      updateTodoTaskStatus(id, 'synced', result.taskId, result.listId);
      synced = true;
      // Reset auth failure flag on successful sync
      authFailureNotified = false;
    } catch (err) {
      if (isAuthError(err)) {
        updateTodoTaskStatus(id, 'failed');
        // One-time auth failure notification
        if (!authFailureNotified) {
          authFailureNotified = true;
          const sock = getState().sock;
          if (sock) {
            await sock.sendMessage(config.USER_JID, {
              text: 'Microsoft To Do disconnected \u2014 re-authorize in dashboard.',
            }).catch((e: unknown) =>
              logger.warn({ err: e }, 'Failed to send auth failure notification'),
            );
          }
        }
      } else {
        // Transient failure -- log, don't notify
        logger.warn({ err, id }, 'Transient error syncing task to Microsoft To Do');
        updateTodoTaskStatus(id, 'failed');
      }
    }
  }
  // If not connected: leave status as 'pending' (silent skip)

  // c. Send self-chat notification (always)
  const lang = detectMessageLanguage(params.chatText);
  const snippet =
    params.originalText.length > 80
      ? params.originalText.slice(0, 80) + '...'
      : params.originalText;
  const name = params.contactName ?? 'Unknown';
  const checkmark = synced ? ' \u2705' : '';

  let notification: string;
  if (lang === 'he') {
    notification = `\u2705 \u05DE\u05E9\u05D9\u05DE\u05D4 \u05E0\u05D5\u05E6\u05E8\u05D4: ${params.task}${checkmark}\n\uD83D\uDC64 ${name}\n\uD83D\uDCAC "${snippet}"\n\u05D4\u05E9\u05D1 cancel \u05DC\u05D4\u05E1\u05E8\u05D4.`;
  } else {
    notification = `\u2705 Task created: ${params.task}${checkmark}\n\uD83D\uDC64 ${name}\n\uD83D\uDCAC "${snippet}"\nReply cancel to remove.`;
  }

  const sock = getState().sock;
  if (sock) {
    try {
      const sent = await sock.sendMessage(config.USER_JID, { text: notification });
      // Store notification message ID for cancel matching
      const sentMsgId = sent?.key?.id;
      if (sentMsgId) {
        updateTodoTaskNotificationMsgId(id, sentMsgId);
      }
    } catch (err) {
      logger.warn({ err, id }, 'Failed to send task notification to self-chat');
    }
  }

  logger.info(
    { id, task: params.task, contactJid: params.contactJid, synced },
    'Task processed',
  );
}

// ─── Cancel handler ─────────────────────────────────────────────────────────

export async function handleTaskCancel(
  notificationMsgId: string,
): Promise<boolean> {
  const task = getTodoTaskByNotificationMsgId(notificationMsgId);
  if (!task) return false;

  // If synced to To Do, delete from there too
  if (task.status === 'synced' && task.todoTaskId && task.todoListId) {
    try {
      await deleteTodoTask(task.todoTaskId, task.todoListId);
    } catch (err) {
      logger.warn({ err, taskId: task.id }, 'Failed to delete task from Microsoft To Do');
    }
  }

  updateTodoTaskStatus(task.id, 'cancelled');
  return true;
}

import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { todoTasks } from '../schema.js';

export function insertTodoTask(params: {
  id: string;
  task: string;
  contactJid: string;
  contactName?: string;
  originalText?: string;
  confidence: string;
  notificationMsgId?: string;
}): void {
  db.insert(todoTasks)
    .values({
      id: params.id,
      task: params.task,
      contactJid: params.contactJid,
      contactName: params.contactName ?? null,
      originalText: params.originalText ?? null,
      confidence: params.confidence,
      notificationMsgId: params.notificationMsgId ?? null,
    })
    .run();
}

export function getTodoTaskByNotificationMsgId(msgId: string) {
  return db
    .select()
    .from(todoTasks)
    .where(eq(todoTasks.notificationMsgId, msgId))
    .get();
}

export function updateTodoTaskStatus(
  id: string,
  status: string,
  todoTaskId?: string,
  todoListId?: string,
): void {
  const updates: Record<string, unknown> = { status };
  if (todoTaskId !== undefined) updates.todoTaskId = todoTaskId;
  if (todoListId !== undefined) updates.todoListId = todoListId;
  if (status === 'synced') updates.syncedAt = Date.now();

  db.update(todoTasks).set(updates).where(eq(todoTasks.id, id)).run();
}

export function updateTodoTaskNotificationMsgId(
  id: string,
  notificationMsgId: string,
): void {
  db.update(todoTasks)
    .set({ notificationMsgId })
    .where(eq(todoTasks.id, id))
    .run();
}

export function getTodoTasksByStatus(status: string, limit?: number) {
  const query = db
    .select()
    .from(todoTasks)
    .where(eq(todoTasks.status, status))
    .orderBy(desc(todoTasks.createdAt));

  if (limit) {
    return query.limit(limit).all();
  }
  return query.all();
}

export function getTodoTasks(limit: number, offset: number) {
  return db
    .select()
    .from(todoTasks)
    .orderBy(desc(todoTasks.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export function countTodoTasksByStatus(status: string): number {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(todoTasks)
    .where(eq(todoTasks.status, status))
    .get();
  return result?.count ?? 0;
}

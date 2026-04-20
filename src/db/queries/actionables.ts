import { eq, and, lt, asc, desc, inArray, isNotNull, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../client.js';
import { actionables } from '../schema.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionableStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'fired'
  | 'expired';

export type ActionableSourceType = 'commitment' | 'task' | 'user_command';

export type Actionable = typeof actionables.$inferSelect;
export type NewActionable = typeof actionables.$inferInsert;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<ActionableStatus, ActionableStatus[]> = {
  pending_approval: ['approved', 'rejected', 'expired'],
  approved: ['fired'],
  rejected: [],
  fired: [],
  expired: [],
};

export function isValidTransition(
  from: ActionableStatus,
  to: ActionableStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createActionable(params: {
  id: string;
  sourceType: ActionableSourceType;
  sourceContactJid: string;
  sourceContactName?: string | null;
  sourceMessageId?: string | null;
  sourceMessageText?: string;
  detectedLanguage?: 'he' | 'en';
  originalDetectedTask: string;
  task?: string;
  status?: ActionableStatus;
  detectedAt?: number;
  fireAt?: number | null;
  todoTaskId?: string | null;
  todoListId?: string | null;
  approvalPreviewMessageId?: string | null;
}): void {
  const now = Date.now();
  db.insert(actionables)
    .values({
      id: params.id,
      sourceType: params.sourceType,
      sourceContactJid: params.sourceContactJid,
      sourceContactName: params.sourceContactName ?? null,
      sourceMessageId: params.sourceMessageId ?? null,
      sourceMessageText: params.sourceMessageText ?? '',
      detectedLanguage: params.detectedLanguage ?? 'en',
      originalDetectedTask: params.originalDetectedTask,
      task: params.task ?? params.originalDetectedTask,
      status: params.status ?? 'pending_approval',
      detectedAt: params.detectedAt ?? now,
      fireAt: params.fireAt ?? null,
      todoTaskId: params.todoTaskId ?? null,
      todoListId: params.todoListId ?? null,
      approvalPreviewMessageId: params.approvalPreviewMessageId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function getActionableById(id: string): Actionable | undefined {
  return db
    .select()
    .from(actionables)
    .where(eq(actionables.id, id))
    .get();
}

export function getActionableByPreviewMsgId(
  previewMsgId: string,
): Actionable | undefined {
  return db
    .select()
    .from(actionables)
    .where(eq(actionables.approvalPreviewMessageId, previewMsgId))
    .get();
}

/**
 * Return every actionable whose approval_preview_message_id matches
 * `previewMsgId`, ordered by createdAt ascending so item indices stay stable
 * with the batched preview's 1..N numbering. Returns `[]` when no row
 * matches — Plan 41-03's reply handler uses that to fall through to the
 * reminder/cancel pipelines.
 */
export function getActionablesByPreviewMsgId(
  previewMsgId: string,
): Actionable[] {
  return db
    .select()
    .from(actionables)
    .where(eq(actionables.approvalPreviewMessageId, previewMsgId))
    .orderBy(asc(actionables.createdAt))
    .all();
}

export function getPendingActionables(): Actionable[] {
  return db
    .select()
    .from(actionables)
    .where(eq(actionables.status, 'pending_approval'))
    .orderBy(desc(actionables.detectedAt))
    .all();
}

/**
 * Pending actionables whose `detected_at` is older than `olderThanMs`.
 * Used by the 7-day expiry scan shipping in Phase 41.
 */
export function getExpiredActionables(olderThanMs: number): Actionable[] {
  return db
    .select()
    .from(actionables)
    .where(
      and(
        eq(actionables.status, 'pending_approval'),
        lt(actionables.detectedAt, olderThanMs),
      ),
    )
    .all();
}

/**
 * Transition an actionable's status. Throws on invalid transitions (per
 * ALLOWED_TRANSITIONS above). Caller is responsible for any side-effects
 * like pushing to Google Tasks, scheduling fires, etc.
 */
export function updateActionableStatus(
  id: string,
  toStatus: ActionableStatus,
): void {
  const row = getActionableById(id);
  if (!row) throw new Error(`actionable ${id} not found`);
  const from = row.status as ActionableStatus;
  if (from === toStatus) return; // idempotent no-op
  if (!isValidTransition(from, toStatus)) {
    throw new Error(
      `invalid actionable transition: ${from} → ${toStatus} (id=${id})`,
    );
  }
  db.update(actionables)
    .set({ status: toStatus, updatedAt: Date.now() })
    .where(eq(actionables.id, id))
    .run();
}

export function updateActionableTask(id: string, newTask: string): void {
  db.update(actionables)
    .set({ task: newTask, updatedAt: Date.now() })
    .where(eq(actionables.id, id))
    .run();
}

export function updateActionableEnrichment(
  id: string,
  enriched: { title: string; note: string },
): void {
  db.update(actionables)
    .set({
      enrichedTitle: enriched.title,
      enrichedNote: enriched.note,
      updatedAt: Date.now(),
    })
    .where(eq(actionables.id, id))
    .run();
}

export function updateActionableTodoIds(
  id: string,
  ids: { todoTaskId: string; todoListId: string },
): void {
  db.update(actionables)
    .set({
      todoTaskId: ids.todoTaskId,
      todoListId: ids.todoListId,
      updatedAt: Date.now(),
    })
    .where(eq(actionables.id, id))
    .run();
}

export function updateActionablePreviewMsgId(
  id: string,
  previewMsgId: string,
): void {
  db.update(actionables)
    .set({
      approvalPreviewMessageId: previewMsgId,
      updatedAt: Date.now(),
    })
    .where(eq(actionables.id, id))
    .run();
}

export function updateActionableFireAt(id: string, fireAt: number | null): void {
  db.update(actionables)
    .set({ fireAt, updatedAt: Date.now() })
    .where(eq(actionables.id, id))
    .run();
}

/**
 * Create a new actionable in status='approved' directly — used by the
 * dashboard calendar's "create task" flow (SC4). source_type is hardcoded
 * to 'user_command' to match the /remind me dual-write convention from
 * Phase 41 plan 41-04 (those rows are also inserted at status='approved').
 * Returns the new row.
 */
export function createApprovedActionable(params: {
  task: string;
  fireAt: number | null;
  detectedLanguage?: 'he' | 'en';
  sourceContactJid: string;
  sourceContactName?: string | null;
}): Actionable {
  const id = `user_cmd_${randomUUID()}`;
  const now = Date.now();
  const row: Actionable = {
    id,
    sourceType: 'user_command' as const,
    sourceContactJid: params.sourceContactJid,
    sourceContactName: params.sourceContactName ?? null,
    sourceMessageId: null,
    sourceMessageText: '',
    detectedLanguage: params.detectedLanguage ?? 'en',
    originalDetectedTask: params.task,
    task: params.task,
    status: 'approved' as const,
    detectedAt: now,
    fireAt: params.fireAt,
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(actionables).values(row).run();
  return row;
}

/**
 * Calendar view: approved + fired actionables with a non-null fireAt
 * inside the window. Untimed approved actionables are excluded from
 * the calendar (they have nowhere to be placed). Phase 44 SC1.
 */
export function getCalendarActionables(
  fromMs: number,
  toMs: number,
): Actionable[] {
  return db
    .select()
    .from(actionables)
    .where(
      and(
        inArray(actionables.status, ['approved', 'fired']),
        // fireAt IS NOT NULL AND BETWEEN fromMs AND toMs
        isNotNull(actionables.fireAt),
        gte(actionables.fireAt, fromMs),
        lte(actionables.fireAt, toMs),
      ),
    )
    .all();
}

/**
 * Recent terminal-state actionables for the dashboard audit view (Phase 43).
 */
export function getRecentTerminalActionables(limit = 50): Actionable[] {
  return db
    .select()
    .from(actionables)
    .where(
      inArray(actionables.status, ['approved', 'rejected', 'expired', 'fired']),
    )
    .orderBy(desc(actionables.updatedAt))
    .limit(limit)
    .all();
}

/**
 * Phase 46 Plan 04 vitest coverage for the new Google Tasks mutation routes:
 *   PATCH  /api/google-tasks/items/:taskId/reschedule?listId=...
 *   PATCH  /api/google-tasks/items/:taskId/edit?listId=...
 *   DELETE /api/google-tasks/items/:taskId?listId=...
 *   PATCH  /api/google-tasks/items/:taskId/complete?listId=...
 *
 * Same fastify.inject() + stubbed-authenticate/jwt harness as
 * googleTasks.test.ts (Plan 46-01) so vitest's NODE_ENV='test' Zod enum
 * pipeline in config.ts never trips.
 *
 * 8 cases:
 *   1. /reschedule — 401 without JWT
 *   2. /reschedule — 400 missing listId
 *   3. /reschedule — 200 ok: true on rescheduleTodoTask success
 *   4. /reschedule — 502 gtasks_upstream_error when helper returns false
 *   5. /edit — 200, no matching actionable → editTodoTaskTitle called
 *   6. /edit — 200, live (approved) actionable → updateActionableTask +
 *              updateTodoTask called, editTodoTaskTitle NOT called
 *   7. DELETE — 204 happy path (deleteTodoTask called with taskId + listId)
 *   8. /complete — 200 ok: true on completeTodoTask success
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Actionable } from '../../db/queries/actionables.js';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockGetAllTaskLists = vi.fn();
const mockGetTaskItemsInWindow = vi.fn();
const mockRescheduleTodoTask = vi.fn<
  (listId: string, taskId: string, dueMs: number) => Promise<boolean>
>();
const mockEditTodoTaskTitle = vi.fn<
  (listId: string, taskId: string, title: string) => Promise<boolean>
>();
const mockCompleteTodoTask = vi.fn<
  (listId: string, taskId: string) => Promise<boolean>
>();
const mockDeleteTodoTask = vi.fn<
  (taskId: string, listId: string) => Promise<void>
>();
const mockUpdateTodoTask = vi.fn<
  (
    listId: string,
    taskId: string,
    patch: { title?: string; due?: string | null; notes?: string },
  ) => Promise<boolean>
>();

vi.mock('../../todo/todoService.js', () => ({
  getAllTaskLists: () => mockGetAllTaskLists(),
  getTaskItemsInWindow: (fromMs: number, toMs: number) =>
    mockGetTaskItemsInWindow(fromMs, toMs),
  rescheduleTodoTask: (listId: string, taskId: string, dueMs: number) =>
    mockRescheduleTodoTask(listId, taskId, dueMs),
  editTodoTaskTitle: (listId: string, taskId: string, title: string) =>
    mockEditTodoTaskTitle(listId, taskId, title),
  completeTodoTask: (listId: string, taskId: string) =>
    mockCompleteTodoTask(listId, taskId),
  deleteTodoTask: (taskId: string, listId: string) =>
    mockDeleteTodoTask(taskId, listId),
  updateTodoTask: (
    listId: string,
    taskId: string,
    patch: { title?: string; due?: string | null; notes?: string },
  ) => mockUpdateTodoTask(listId, taskId, patch),
}));

const mockGetApprovedActionableTodoTaskIds = vi.fn<
  (fromMs: number, toMs: number) => Set<string>
>(() => new Set<string>());
const mockGetActionableByTodoTaskId = vi.fn<
  (taskId: string) => Actionable | undefined
>(() => undefined);
const mockUpdateActionableTask = vi.fn();
const mockUpdateActionableFireAt = vi.fn();

vi.mock('../../db/queries/actionables.js', () => ({
  getApprovedActionableTodoTaskIds: (fromMs: number, toMs: number) =>
    mockGetApprovedActionableTodoTaskIds(fromMs, toMs),
  getActionableByTodoTaskId: (taskId: string) =>
    mockGetActionableByTodoTaskId(taskId),
  updateActionableTask: (...args: unknown[]) =>
    mockUpdateActionableTask(...args),
  updateActionableFireAt: (...args: unknown[]) =>
    mockUpdateActionableFireAt(...args),
}));

vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    USER_JID: '972500000001@s.whatsapp.net',
  },
}));

// Routes must be imported AFTER all vi.mock calls.
const { default: googleTasksRoutes } = await import('../routes/googleTasks.js');

// ─── Test server builder ───────────────────────────────────────────────

async function buildTestServer(authPasses = true): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorate(
    'authenticate',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: any, reply: any) => {
      if (!authPasses) {
        await reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );
  fastify.decorate('jwt', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verify: (_token: string): any => ({ sub: 'test' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await fastify.register(googleTasksRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Shared reset ──────────────────────────────────────────────────────

beforeEach(() => {
  mockGetAllTaskLists.mockReset();
  mockGetTaskItemsInWindow.mockReset();
  mockRescheduleTodoTask.mockReset();
  mockEditTodoTaskTitle.mockReset();
  mockCompleteTodoTask.mockReset();
  mockDeleteTodoTask.mockReset();
  mockUpdateTodoTask.mockReset();
  mockGetApprovedActionableTodoTaskIds.mockReset();
  mockGetApprovedActionableTodoTaskIds.mockReturnValue(new Set<string>());
  mockGetActionableByTodoTaskId.mockReset();
  mockGetActionableByTodoTaskId.mockReturnValue(undefined);
  mockUpdateActionableTask.mockReset();
  mockUpdateActionableFireAt.mockReset();
});

// Helper — minimal approved Actionable row for mirrored-item cases.
function mirroredActionable(overrides: Partial<Actionable> = {}): Actionable {
  const now = Date.now();
  return {
    id: 'act-1',
    sourceType: 'task',
    sourceContactJid: 'user@s.whatsapp.net',
    sourceContactName: null,
    sourceMessageId: null,
    sourceMessageText: '',
    detectedLanguage: 'en',
    originalDetectedTask: 'Buy milk',
    task: 'Buy milk',
    status: 'approved',
    detectedAt: now,
    fireAt: now + 3_600_000,
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: 'task-1',
    todoListId: 'list-A',
    approvalPreviewMessageId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Actionable;
}

// ══════════════════════════════════════════════════════════════════════
// /reschedule
// ══════════════════════════════════════════════════════════════════════

describe('PATCH /api/google-tasks/items/:taskId/reschedule', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 1. 401 without JWT
  it('401 without Authorization', async () => {
    server = await buildTestServer(false);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/reschedule?listId=list-A',
      payload: { dueMs: 1_745_000_000_000 },
    });
    expect(res.statusCode).toBe(401);
    expect(mockRescheduleTodoTask).not.toHaveBeenCalled();
  });

  // 2. 400 missing listId
  it('400 when listId query param is missing', async () => {
    server = await buildTestServer(true);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/reschedule',
      payload: { dueMs: 1_745_000_000_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'listId is required' });
    expect(mockRescheduleTodoTask).not.toHaveBeenCalled();
  });

  // 3. 200 on success
  it('200 { ok: true } when rescheduleTodoTask succeeds', async () => {
    server = await buildTestServer(true);
    mockRescheduleTodoTask.mockResolvedValueOnce(true);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/reschedule?listId=list-A',
      payload: { dueMs: 1_745_000_000_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockRescheduleTodoTask).toHaveBeenCalledWith(
      'list-A',
      'task-1',
      1_745_000_000_000,
    );
  });

  // 4. 502 when helper returns false
  it('502 gtasks_upstream_error when rescheduleTodoTask returns false', async () => {
    server = await buildTestServer(true);
    mockRescheduleTodoTask.mockResolvedValueOnce(false);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/reschedule?listId=list-A',
      payload: { dueMs: 1_745_000_000_000 },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'gtasks_upstream_error' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// /edit
// ══════════════════════════════════════════════════════════════════════

describe('PATCH /api/google-tasks/items/:taskId/edit', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 5. No matching actionable → editTodoTaskTitle called directly
  it('200 when no live actionable mirrors the task — writes directly via editTodoTaskTitle', async () => {
    server = await buildTestServer(true);
    mockGetActionableByTodoTaskId.mockReturnValueOnce(undefined);
    mockEditTodoTaskTitle.mockResolvedValueOnce(true);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/edit?listId=list-A',
      payload: { title: 'New title' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockEditTodoTaskTitle).toHaveBeenCalledWith(
      'list-A',
      'task-1',
      'New title',
    );
    expect(mockUpdateActionableTask).not.toHaveBeenCalled();
    expect(mockUpdateTodoTask).not.toHaveBeenCalled();
  });

  // 6. Live actionable → routes through actionable edit path
  it('200 when a live actionable mirrors the task — updates actionable + mirrors via updateTodoTask', async () => {
    server = await buildTestServer(true);
    mockGetActionableByTodoTaskId.mockReturnValueOnce(mirroredActionable());
    mockUpdateTodoTask.mockResolvedValueOnce(true);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/edit?listId=list-A',
      payload: { title: 'Edited mirrored title' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // actionable layer got rewritten
    expect(mockUpdateActionableTask).toHaveBeenCalledWith(
      'act-1',
      'Edited mirrored title',
    );
    // Google push went through updateTodoTask, NOT editTodoTaskTitle
    expect(mockUpdateTodoTask).toHaveBeenCalledWith('list-A', 'task-1', {
      title: 'Edited mirrored title',
    });
    expect(mockEditTodoTaskTitle).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════════════════

describe('DELETE /api/google-tasks/items/:taskId', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 7. 204 happy path
  it('204 when deleteTodoTask resolves', async () => {
    server = await buildTestServer(true);
    mockDeleteTodoTask.mockResolvedValueOnce(undefined);
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/google-tasks/items/task-1?listId=list-A',
    });
    expect(res.statusCode).toBe(204);
    expect(mockDeleteTodoTask).toHaveBeenCalledWith('task-1', 'list-A');
  });
});

// ══════════════════════════════════════════════════════════════════════
// /complete
// ══════════════════════════════════════════════════════════════════════

describe('PATCH /api/google-tasks/items/:taskId/complete', () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server.close();
  });

  // 8. 200 happy path
  it('200 { ok: true } when completeTodoTask succeeds', async () => {
    server = await buildTestServer(true);
    mockCompleteTodoTask.mockResolvedValueOnce(true);
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/google-tasks/items/task-1/complete?listId=list-A',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockCompleteTodoTask).toHaveBeenCalledWith('list-A', 'task-1');
  });
});

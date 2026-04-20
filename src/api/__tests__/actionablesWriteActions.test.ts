/**
 * Plan 45-02 vitest coverage for the new actionables write-action routes:
 *   POST /api/actionables/:id/approve
 *   POST /api/actionables/:id/reject
 *   POST /api/actionables/:id/edit
 *   POST /api/actionables/:id/unreject
 *
 * Uses the same fastify.inject() + stubbed-authenticate/jwt pattern as
 * actionables.test.ts (plan 43-01) and calendarMutations.test.ts (plan
 * 44-02) so NODE_ENV=test's Zod enum pipeline doesn't get pulled in.
 *
 * Groups (15 cases):
 *  A. Auth / 404 / 400      — 401 missing auth, 404 missing id, 400 empty/too-long edit body
 *  B. 503 bot disconnected  — getState().sock === null
 *  C. Happy path            — 200 + primitive called with (sock, row)
 *  D. Race / already_handled — 409 status mismatch + 409 grace_expired
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Actionable } from '../../db/queries/actionables.js';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockGetActionableById = vi.fn<(id: string) => Actionable | undefined>();
const mockUpdateActionableTask = vi.fn();
const mockGetPendingActionables = vi.fn<() => Actionable[]>(() => []);
const mockGetRecentTerminalActionables = vi.fn<() => Actionable[]>(() => []);
const mockUpdateActionableFireAt = vi.fn();
const mockUpdateActionableTodoIds = vi.fn();
const mockCreateApprovedActionable = vi.fn<() => Actionable>();
const mockDeleteActionable = vi.fn();

vi.mock('../../db/queries/actionables.js', () => ({
  getPendingActionables: () => mockGetPendingActionables(),
  getRecentTerminalActionables: () => mockGetRecentTerminalActionables(),
  getActionableById: (id: string) => mockGetActionableById(id),
  updateActionableTask: (...args: unknown[]) => mockUpdateActionableTask(...args),
  updateActionableFireAt: (...args: unknown[]) => mockUpdateActionableFireAt(...args),
  updateActionableTodoIds: (...args: unknown[]) => mockUpdateActionableTodoIds(...args),
  createApprovedActionable: (...args: unknown[]) => mockCreateApprovedActionable(...args),
  deleteActionable: (...args: unknown[]) => mockDeleteActionable(...args),
}));

vi.mock('../../db/queries/settings.js', () => ({
  getSetting: () => null,
  setSetting: vi.fn(),
}));

vi.mock('../../todo/todoService.js', () => ({
  createTodoTask: vi.fn(),
  updateTodoTask: vi.fn(() => Promise.resolve(true)),
  deleteTodoTask: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    USER_JID: '972500000001@s.whatsapp.net',
  },
}));

// Approval primitives — re-export a locally-declared GraceExpiredError so
// `err instanceof GraceExpiredError` in the route handler resolves against
// the SAME class symbol the mock throws.
class GraceExpiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GraceExpiredError';
  }
}

const mockApproveActionable = vi.fn<(sock: unknown, row: Actionable) => Promise<void>>(
  () => Promise.resolve(),
);
const mockRejectActionable = vi.fn<(sock: unknown, row: Actionable) => Promise<void>>(
  () => Promise.resolve(),
);
const mockUnrejectActionable = vi.fn<
  (sock: unknown, row: Actionable, graceMs: number) => Promise<void>
>(() => Promise.resolve());

vi.mock('../../approval/approvalHandler.js', () => ({
  approveActionable: (sock: unknown, row: Actionable) => mockApproveActionable(sock, row),
  rejectActionable: (sock: unknown, row: Actionable) => mockRejectActionable(sock, row),
  unrejectActionable: (sock: unknown, row: Actionable, graceMs: number) =>
    mockUnrejectActionable(sock, row, graceMs),
  GraceExpiredError,
}));

// getState — dashboard routes read the baileys sock off this.
const mockSock = { __stub: 'baileys-sock' };
const mockGetState = vi.fn<() => { sock: unknown | null }>(() => ({ sock: mockSock }));
vi.mock('../state.js', () => ({
  getState: () => mockGetState(),
}));

// Routes must be imported AFTER all vi.mock calls so the module graph
// binds against the mocked symbols.
const { default: actionablesRoutes } = await import('../routes/actionables.js');

// ─── Fixture builder ───────────────────────────────────────────────────
function fixtureActionable(overrides: Partial<Actionable> = {}): Actionable {
  return {
    id: 'act-1',
    sourceType: 'commitment',
    sourceContactJid: '972500000001@s.whatsapp.net',
    sourceContactName: 'Alice',
    sourceMessageId: 'msg-1',
    sourceMessageText: 'hello world',
    detectedLanguage: 'en',
    originalDetectedTask: 'buy milk',
    task: 'buy milk',
    status: 'pending_approval',
    detectedAt: 1_700_000_000_000,
    fireAt: null,
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as Actionable;
}

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
  await fastify.register(actionablesRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Shared reset ──────────────────────────────────────────────────────
beforeEach(() => {
  mockGetActionableById.mockReset();
  mockUpdateActionableTask.mockReset();
  mockApproveActionable.mockReset();
  mockApproveActionable.mockResolvedValue(undefined);
  mockRejectActionable.mockReset();
  mockRejectActionable.mockResolvedValue(undefined);
  mockUnrejectActionable.mockReset();
  mockUnrejectActionable.mockResolvedValue(undefined);
  mockGetState.mockReset();
  mockGetState.mockReturnValue({ sock: mockSock });
});

// ══════════════════════════════════════════════════════════════════════
// Group A — Auth / 404 / 400
// ══════════════════════════════════════════════════════════════════════
describe('write actions — auth / 404 / 400', () => {
  let server: FastifyInstance;
  afterEach(async () => { await server.close(); });

  // 1. POST /approve without Authorization → 401
  it('POST /approve without Authorization → 401', async () => {
    server = await buildTestServer(false);
    const res = await server.inject({
      method: 'POST',
      url: '/api/actionables/xxx/approve',
    });
    expect(res.statusCode).toBe(401);
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 2. POST /approve with JWT, missing id → 404
  it('POST /approve with JWT, missing id → 404', async () => {
    server = await buildTestServer(true);
    mockGetActionableById.mockReturnValueOnce(undefined);
    const res = await server.inject({
      method: 'POST',
      url: '/api/actionables/missing-id/approve',
    });
    expect(res.statusCode).toBe(404);
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 3. POST /edit with blank task → 400 "task is required"
  it('POST /edit with blank task → 400 task is required', async () => {
    server = await buildTestServer(true);
    const res = await server.inject({
      method: 'POST',
      url: '/api/actionables/xxx/edit',
      payload: { task: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'task is required' });
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 4. POST /edit with > 500 chars → 400 "task too long"
  it('POST /edit with > 500 chars → 400 task too long', async () => {
    server = await buildTestServer(true);
    const longTask = 'a'.repeat(501);
    const res = await server.inject({
      method: 'POST',
      url: '/api/actionables/xxx/edit',
      payload: { task: longTask },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'task too long', maxLength: 500 });
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 5. POST /edit with empty body → 400 "task is required"
  it('POST /edit with empty body → 400 task is required', async () => {
    server = await buildTestServer(true);
    const res = await server.inject({
      method: 'POST',
      url: '/api/actionables/xxx/edit',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'task is required' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group B — 503 bot disconnected
// ══════════════════════════════════════════════════════════════════════
describe('write actions — 503 bot_disconnected', () => {
  let server: FastifyInstance;
  beforeEach(async () => { server = await buildTestServer(true); });
  afterEach(async () => { await server.close(); });

  // 6. POST /approve on pending row with sock === null → 503
  it('POST /approve on pending row with null sock → 503', async () => {
    const row = fixtureActionable({ status: 'pending_approval' });
    mockGetActionableById.mockReturnValueOnce(row);
    mockGetState.mockReturnValueOnce({ sock: null });

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/approve`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'bot_disconnected' });
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 7. POST /unreject on rejected row with sock === null → 503
  it('POST /unreject on rejected row with null sock → 503', async () => {
    const row = fixtureActionable({
      status: 'rejected',
      updatedAt: Date.now() - 2_000,
    });
    mockGetActionableById.mockReturnValueOnce(row);
    mockGetState.mockReturnValueOnce({ sock: null });

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/unreject`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'bot_disconnected' });
    expect(mockUnrejectActionable).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group C — Happy path
// ══════════════════════════════════════════════════════════════════════
describe('write actions — happy path', () => {
  let server: FastifyInstance;
  beforeEach(async () => { server = await buildTestServer(true); });
  afterEach(async () => { await server.close(); });

  // 8. POST /approve on pending row → 200, approveActionable(sock, row)
  it('POST /approve on pending row → 200 + approveActionable(sock, row)', async () => {
    const row = fixtureActionable({ status: 'pending_approval' });
    const freshRow = { ...row, status: 'approved' as const, updatedAt: row.updatedAt + 1 };
    // 1st get: route pre-check. 2nd get: post-approve re-read.
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(freshRow);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { actionable: Actionable };
    expect(body.actionable.status).toBe('approved');
    expect(mockApproveActionable).toHaveBeenCalledTimes(1);
    expect(mockApproveActionable).toHaveBeenCalledWith(mockSock, row);
  });

  // 9. POST /reject on pending row → 200, rejectActionable(sock, row)
  it('POST /reject on pending row → 200 + rejectActionable(sock, row)', async () => {
    const row = fixtureActionable({ status: 'pending_approval' });
    const freshRow = { ...row, status: 'rejected' as const };
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(freshRow);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/reject`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { actionable: Actionable }).actionable.status).toBe('rejected');
    expect(mockRejectActionable).toHaveBeenCalledWith(mockSock, row);
  });

  // 10. POST /edit rewrites task then falls through to approveActionable
  it('POST /edit rewrites task → approveActionable called with refreshed row', async () => {
    const row = fixtureActionable({ status: 'pending_approval', task: 'old task' });
    const refreshed = { ...row, task: 'revised task' };
    const afterApprove = { ...refreshed, status: 'approved' as const };
    // 1st: pre-check. 2nd: after updateActionableTask. 3rd: post-approve.
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(refreshed)
      .mockReturnValueOnce(afterApprove);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/edit`,
      payload: { task: 'revised task' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateActionableTask).toHaveBeenCalledWith(row.id, 'revised task');
    expect(mockApproveActionable).toHaveBeenCalledTimes(1);
    expect(mockApproveActionable).toHaveBeenCalledWith(mockSock, refreshed);
    expect((res.json() as { actionable: Actionable }).actionable.task).toBe('revised task');
  });

  // 11. POST /unreject on rejected row within grace → 200
  it('POST /unreject on rejected row within grace → 200 + (sock, row, 10000)', async () => {
    const row = fixtureActionable({
      status: 'rejected',
      updatedAt: Date.now() - 2_000,
    });
    const afterUnreject = { ...row, status: 'pending_approval' as const };
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(afterUnreject);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/unreject`,
    });
    expect(res.statusCode).toBe(200);
    expect(mockUnrejectActionable).toHaveBeenCalledWith(mockSock, row, 10_000);
    expect((res.json() as { actionable: Actionable }).actionable.status).toBe('pending_approval');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group D — Race / already_handled
// ══════════════════════════════════════════════════════════════════════
describe('write actions — race / already_handled', () => {
  let server: FastifyInstance;
  beforeEach(async () => { server = await buildTestServer(true); });
  afterEach(async () => { await server.close(); });

  // 12. POST /approve on already-approved row → 409 already_handled
  it('POST /approve on already-approved row → 409 already_handled', async () => {
    const row = fixtureActionable({ status: 'approved' });
    mockGetActionableById.mockReturnValueOnce(row);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/approve`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'already_handled',
      currentStatus: 'approved',
    });
    expect(mockApproveActionable).not.toHaveBeenCalled();
  });

  // 13. POST /reject on expired row → 409 already_handled
  it('POST /reject on expired row → 409 already_handled', async () => {
    const row = fixtureActionable({ status: 'expired' });
    mockGetActionableById.mockReturnValueOnce(row);

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/reject`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'already_handled',
      currentStatus: 'expired',
    });
    expect(mockRejectActionable).not.toHaveBeenCalled();
  });

  // 14. POST /approve on pending row where approveActionable throws AND
  //     the fresh re-read shows 'approved' → 409 already_handled
  //     (concurrent-WhatsApp race during our call).
  it('POST /approve race: primitive throws, re-read shows drifted status → 409', async () => {
    const row = fixtureActionable({ status: 'pending_approval' });
    const driftedRow = { ...row, status: 'approved' as const };
    // 1st get: pre-check (pending). 2nd get: post-throw re-read (drifted).
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(driftedRow);
    mockApproveActionable.mockRejectedValueOnce(
      new Error('Invalid transition: approved → approved'),
    );

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/approve`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'already_handled',
      currentStatus: 'approved',
    });
    expect(mockApproveActionable).toHaveBeenCalledTimes(1);
  });

  // 15. POST /unreject where unrejectActionable throws GraceExpiredError → 409 grace_expired
  it('POST /unreject → GraceExpiredError → 409 grace_expired', async () => {
    const row = fixtureActionable({
      status: 'rejected',
      updatedAt: Date.now() - 30_000,
    });
    mockGetActionableById.mockReturnValueOnce(row);
    mockUnrejectActionable.mockRejectedValueOnce(
      new GraceExpiredError('unreject grace window expired (age 30000ms > 10000ms)'),
    );

    const res = await server.inject({
      method: 'POST',
      url: `/api/actionables/${row.id}/unreject`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'grace_expired',
      graceMs: 10_000,
    });
  });
});

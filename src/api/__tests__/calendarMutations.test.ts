/**
 * Plan 44-02 vitest coverage for the new calendar mutation routes.
 *
 * Covers:
 *  1. PATCH /api/actionables/:id without JWT → 401
 *  2. PATCH /api/actionables/:id with JWT, empty body → 400
 *  3. PATCH /api/actionables/:id with JWT, non-existent id → 404
 *  4. PATCH /api/actionables/:id with JWT, {task:"new text"} → 200, row updated, updateTodoTask NOT called (no todoTaskId)
 *  5. PATCH /api/actionables/:id with JWT, {fireAt:...}, row has todoTaskId → 200, updateTodoTask CALLED
 *  6. POST /api/actionables without JWT → 401
 *  7. POST /api/actionables with JWT, empty task → 400
 *  8. POST /api/actionables with JWT, {task:"buy milk", fireAt:...} → 201, createApprovedActionable+createTodoTask called
 *  9. PATCH /api/personal-calendar/events/:id without JWT → 401
 * 10. POST /api/personal-calendar/events with JWT, {title:"Lunch", eventDate:...} → 201, createPersonalCalendarEvent called
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Actionable } from '../../db/queries/actionables.js';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockGetActionableById = vi.fn<(id: string) => Actionable | undefined>();
const mockUpdateActionableTask = vi.fn();
const mockUpdateActionableFireAt = vi.fn();
const mockUpdateActionableTodoIds = vi.fn();
const mockCreateApprovedActionable = vi.fn<() => Actionable>();
const mockGetPendingActionables = vi.fn<() => Actionable[]>(() => []);
const mockGetRecentTerminalActionables = vi.fn<() => Actionable[]>(() => []);

vi.mock('../../db/queries/actionables.js', () => ({
  getPendingActionables: () => mockGetPendingActionables(),
  getRecentTerminalActionables: () => mockGetRecentTerminalActionables(),
  getActionableById: (id: string) => mockGetActionableById(id),
  updateActionableTask: (...args: unknown[]) => mockUpdateActionableTask(...args),
  updateActionableFireAt: (...args: unknown[]) => mockUpdateActionableFireAt(...args),
  updateActionableTodoIds: (...args: unknown[]) => mockUpdateActionableTodoIds(...args),
  createApprovedActionable: (...args: unknown[]) => mockCreateApprovedActionable(...args),
}));

const mockGetSetting = vi.fn<(key: string) => string | null>(() => null);
vi.mock('../../db/queries/settings.js', () => ({
  getSetting: (key: string) => mockGetSetting(key),
  setSetting: vi.fn(),
}));

const mockCreateTodoTask = vi.fn<() => Promise<{ taskId: string; listId: string }>>();
const mockUpdateTodoTask = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
vi.mock('../../todo/todoService.js', () => ({
  createTodoTask: (...args: unknown[]) => mockCreateTodoTask(...args),
  updateTodoTask: (...args: unknown[]) => mockUpdateTodoTask(...args),
}));

vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    USER_JID: '972500000001@s.whatsapp.net',
  },
}));

// Personal calendar service mocks
const mockCreatePersonalCalendarEvent = vi.fn<() => Promise<string | null>>(() => Promise.resolve('google-event-id-123'));
const mockUpdatePersonalCalendarEvent = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
const mockGetSelectedCalendarId = vi.fn<() => string | null>(() => 'primary');
vi.mock('../../calendar/personalCalendarService.js', () => ({
  isPersonalCalendarConnected: vi.fn(() => true),
  getAuthUrl: vi.fn(() => null),
  handleAuthCallback: vi.fn(),
  createPersonalCalendarEvent: (...args: unknown[]) => mockCreatePersonalCalendarEvent(...args),
  updatePersonalCalendarEvent: (...args: unknown[]) => mockUpdatePersonalCalendarEvent(...args),
  listUserCalendars: vi.fn(() => Promise.resolve([])),
  getSelectedCalendarId: () => mockGetSelectedCalendarId(),
}));

const mockGetPersonalPendingEvent = vi.fn<(id: string) => ReturnType<() => typeof personalEventFixture | undefined>>();
const mockUpdatePersonalPendingEventFields = vi.fn();
const mockLinkCalendarEventId = vi.fn();
const mockInsertApprovedPersonalEvent = vi.fn<() => ReturnType<() => typeof personalEventFixture | undefined>>();
const mockGetPendingPersonalEvents = vi.fn(() => []);
const mockGetPersonalEventsByStatus = vi.fn(() => []);
const mockUpdatePersonalPendingEventStatus = vi.fn();

const personalEventFixture = {
  id: 'evt-1',
  sourceChatJid: 'dashboard',
  sourceChatName: null,
  senderJid: 'dashboard',
  senderName: 'Self',
  sourceMessageId: 'dashboard_evt-1',
  sourceMessageText: '',
  title: 'Lunch',
  eventDate: 1_750_000_000_000,
  location: null,
  description: null,
  url: null,
  status: 'approved',
  notificationMsgId: null,
  contentHash: null,
  isAllDay: false,
  calendarEventId: null,
  createdAt: 1_750_000_000_000,
};

vi.mock('../../db/queries/personalPendingEvents.js', () => ({
  getPendingPersonalEvents: () => mockGetPendingPersonalEvents(),
  getPersonalPendingEvent: (id: string) => mockGetPersonalPendingEvent(id),
  getPersonalEventsByStatus: () => mockGetPersonalEventsByStatus(),
  updatePersonalPendingEventStatus: (...args: unknown[]) => mockUpdatePersonalPendingEventStatus(...args),
  updatePersonalPendingEventFields: (...args: unknown[]) => mockUpdatePersonalPendingEventFields(...args),
  linkCalendarEventId: (...args: unknown[]) => mockLinkCalendarEventId(...args),
  insertApprovedPersonalEvent: (...args: unknown[]) => mockInsertApprovedPersonalEvent(...args),
}));

// ─── Import routes AFTER mocks ──────────────────────────────────────────

const { default: actionablesRoutes } = await import('../routes/actionables.js');
const { default: personalCalendarRoutes } = await import('../routes/personalCalendar.js');

// ─── Fixtures ───────────────────────────────────────────────────────────

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

// ─── Test server builder ─────────────────────────────────────────────────

async function buildTestServer(authPasses = true): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorate(
    'authenticate',
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
      if (!authPasses) {
        await reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );
  fastify.decorate('jwt', {
    verify: (_token: string) => {
      if (!authPasses) throw new Error('unauthorized');
      return { sub: 'test' };
    },
  });
  await fastify.register(actionablesRoutes);
  await fastify.register(personalCalendarRoutes);
  await fastify.ready();
  return fastify;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('calendarMutations routes (plan 44-02)', () => {
  let serverAuth: FastifyInstance;
  let serverNoAuth: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetPendingActionables.mockReturnValue([]);
    mockGetRecentTerminalActionables.mockReturnValue([]);
    serverAuth = await buildTestServer(true);
    serverNoAuth = await buildTestServer(false);
  });

  afterEach(async () => {
    await serverAuth.close();
    await serverNoAuth.close();
  });

  // 1. PATCH /api/actionables/:id without JWT → 401
  it('PATCH /api/actionables/:id without JWT → 401', async () => {
    const res = await serverNoAuth.inject({
      method: 'PATCH',
      url: '/api/actionables/act-1',
      payload: { task: 'new task' },
    });
    expect(res.statusCode).toBe(401);
  });

  // 2. PATCH /api/actionables/:id with JWT, empty body → 400
  it('PATCH /api/actionables/:id with empty body → 400', async () => {
    const res = await serverAuth.inject({
      method: 'PATCH',
      url: '/api/actionables/act-1',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'empty patch' });
  });

  // 3. PATCH /api/actionables/:id with JWT, non-existent id → 404
  it('PATCH /api/actionables/:id with non-existent id → 404', async () => {
    mockGetActionableById.mockReturnValue(undefined);
    const res = await serverAuth.inject({
      method: 'PATCH',
      url: '/api/actionables/non-existent',
      payload: { task: 'something' },
    });
    expect(res.statusCode).toBe(404);
  });

  // 4. PATCH /api/actionables/:id, {task:"new text"} → 200, no todoTaskId so updateTodoTask NOT called
  it('PATCH /api/actionables/:id with {task} → 200, updateTodoTask not called when no todoTaskId', async () => {
    const row = fixtureActionable({ id: 'act-1', todoTaskId: null, todoListId: null });
    const updatedRow = { ...row, task: 'new text' };
    mockGetActionableById
      .mockReturnValueOnce(row)       // first call for lookup
      .mockReturnValueOnce(updatedRow); // second call for fresh response

    const res = await serverAuth.inject({
      method: 'PATCH',
      url: '/api/actionables/act-1',
      payload: { task: 'new text' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateActionableTask).toHaveBeenCalledWith('act-1', 'new text');
    expect(mockUpdateTodoTask).not.toHaveBeenCalled();
    const body = res.json() as { actionable: Actionable };
    expect(body.actionable.task).toBe('new text');
  });

  // 5. PATCH /api/actionables/:id, {fireAt:...}, row has todoTaskId → 200, updateTodoTask CALLED
  it('PATCH /api/actionables/:id with {fireAt} and todoTaskId → updateTodoTask called with ISO date', async () => {
    const ts = 1_750_000_000_000;
    const row = fixtureActionable({ id: 'act-1', todoTaskId: 'gtask-1', todoListId: 'glist-1' });
    const updatedRow = { ...row, fireAt: ts };
    mockGetActionableById
      .mockReturnValueOnce(row)
      .mockReturnValueOnce(updatedRow);

    const res = await serverAuth.inject({
      method: 'PATCH',
      url: '/api/actionables/act-1',
      payload: { fireAt: ts },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateActionableFireAt).toHaveBeenCalledWith('act-1', ts);
    expect(mockUpdateTodoTask).toHaveBeenCalledWith(
      'glist-1',
      'gtask-1',
      expect.objectContaining({ due: new Date(ts).toISOString() }),
    );
  });

  // 6. POST /api/actionables without JWT → 401
  it('POST /api/actionables without JWT → 401', async () => {
    const res = await serverNoAuth.inject({
      method: 'POST',
      url: '/api/actionables',
      payload: { task: 'do something' },
    });
    expect(res.statusCode).toBe(401);
  });

  // 7. POST /api/actionables with empty task → 400
  it('POST /api/actionables with empty task → 400', async () => {
    const res = await serverAuth.inject({
      method: 'POST',
      url: '/api/actionables',
      payload: { task: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'task is required' });
  });

  // 8. POST /api/actionables with valid body → 201, createApprovedActionable + createTodoTask called
  it('POST /api/actionables with {task, fireAt} → 201, syncs to Google Tasks when list configured', async () => {
    const ts = 1_750_000_000_000;
    const newRow = fixtureActionable({ id: 'user_cmd_abc', status: 'approved', task: 'buy milk', fireAt: ts });

    mockCreateApprovedActionable.mockReturnValue(newRow);
    mockGetSetting.mockReturnValue('glist-id-1');
    mockCreateTodoTask.mockResolvedValue({ taskId: 'gtask-new', listId: 'glist-id-1' });
    mockGetActionableById.mockReturnValue(newRow);

    const res = await serverAuth.inject({
      method: 'POST',
      url: '/api/actionables',
      payload: { task: 'buy milk', fireAt: ts },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateApprovedActionable).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'buy milk', fireAt: ts }),
    );
    expect(mockCreateTodoTask).toHaveBeenCalled();
    const body = res.json() as { actionable: Actionable };
    expect(body.actionable.id).toBe('user_cmd_abc');
  });

  // 9. PATCH /api/personal-calendar/events/:id without JWT → 401
  it('PATCH /api/personal-calendar/events/:id without JWT → 401', async () => {
    const res = await serverNoAuth.inject({
      method: 'PATCH',
      url: '/api/personal-calendar/events/evt-1',
      payload: { title: 'New Title' },
    });
    expect(res.statusCode).toBe(401);
  });

  // 10. POST /api/personal-calendar/events with {title, eventDate} → 201, createPersonalCalendarEvent called
  it('POST /api/personal-calendar/events with {title, eventDate} → 201, Google Calendar event created', async () => {
    const ts = 1_750_000_000_000;
    mockInsertApprovedPersonalEvent.mockReturnValue(personalEventFixture);
    mockGetPersonalPendingEvent.mockReturnValue(personalEventFixture);

    const res = await serverAuth.inject({
      method: 'POST',
      url: '/api/personal-calendar/events',
      payload: { title: 'Lunch', eventDate: ts },
    });
    expect(res.statusCode).toBe(201);
    expect(mockInsertApprovedPersonalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Lunch', eventDate: ts }),
    );
    expect(mockCreatePersonalCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Lunch' }),
    );
    const body = res.json() as { event: typeof personalEventFixture };
    expect(body.event.title).toBe('Lunch');
  });
});

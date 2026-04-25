/**
 * Plan 55-02 vitest coverage for the /api/trips routes.
 *
 * Uses the mock-based pattern from src/api/__tests__/actionables.test.ts:
 *   - vi.mock for all DB query imports
 *   - Minimal Fastify instance with stubbed fastify.authenticate + fastify.jwt
 *   - fastify.inject() for every HTTP assertion
 *
 * SSE / hashTripBundle is tested as a unit (no socket needed) — same
 * reasoning as actionables.test.ts §Manual review note: inject() buffers
 * the full body and an SSE handler never ends on its own, so we assert
 * hash stability + sensitivity instead of a live SSE round-trip.
 *
 * Soft-delete propagation is verified via mock call assertions (not a
 * round-trip DB test — that lives in tripMemory.test.ts which already covers
 * the query layer).
 *
 * Test groups:
 *   1. Auth gate (3 tests)
 *   2. GET /api/trips happy path (1 test)
 *   3. GET /api/trips/:groupJid (3 tests)
 *   4. DELETE /api/trips/:groupJid/decisions/:id (4 tests)
 *   5. PATCH /api/trips/:groupJid/questions/:id/resolve (2 tests)
 *   6. PATCH /api/trips/:groupJid/budget (3 tests)
 *   7. Archived-trip 403 enforcement (1 test)
 *   8. Soft-delete propagation (1 test — mock-based round-trip)
 *   9. hashTripBundle unit (2 tests — stability + sensitivity)
 *   Total: 20 tests
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { TripBundle, TripListEntry, BudgetRollup } from '../../../db/queries/tripMemory.js';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockListTrips = vi.fn<() => TripListEntry[]>(() => []);
const mockGetTripBundle = vi.fn<(groupJid: string) => TripBundle | null>(() => null);
const mockSoftDeleteDecision = vi.fn<(id: string) => void>(() => undefined);
const mockRestoreDecision = vi.fn<(id: string, groupJid: string) => { changes: number }>(() => ({ changes: 1 }));
const mockResolveOpenItem = vi.fn<(id: string) => void>(() => undefined);
const mockUpdateBudgetByCategory = vi.fn<
  (groupJid: string, patch: Record<string, number>) => Record<string, number>
>(() => ({
  flights: 0, lodging: 0, food: 0, activities: 0,
  transit: 0, shopping: 0, other: 0,
}));

// NOTE: Mock paths are relative to THIS test file (src/api/routes/__tests__/).
// The route at src/api/routes/trips.ts imports from ../../db/... which resolves
// to src/db/... — so the mock paths here must also resolve to src/db/...
// i.e., use ../../../db/... from this test file location.

vi.mock('../../../db/queries/tripMemory.js', () => ({
  listTripsForDashboard: () => mockListTrips(),
  getTripBundle: (jid: string) => mockGetTripBundle(jid),
  softDeleteDecision: (id: string) => mockSoftDeleteDecision(id),
  restoreDecision: (id: string, groupJid: string) => mockRestoreDecision(id, groupJid),
  resolveOpenItem: (id: string) => mockResolveOpenItem(id),
  updateBudgetByCategory: (
    jid: string,
    patch: Record<string, number>,
  ) => mockUpdateBudgetByCategory(jid, patch),
  TRIP_CATEGORIES: [
    'flights', 'lodging', 'food', 'activities', 'transit', 'shopping', 'other',
  ],
}));

// Mock db + schema so the route's inline SELECT (existence check) is intercepted
const mockDbGet = vi.fn<() => Record<string, unknown> | undefined>(() => undefined);

vi.mock('../../../db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => mockDbGet(),
        }),
      }),
    }),
  },
}));

vi.mock('../../../db/schema.js', () => ({
  tripDecisions: {},
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Mock googleDocsExport so route tests don't call the real Google API
const mockExportTripToGoogleDoc = vi.fn<
  () => Promise<{ url: string; documentId: string }>
>(async () => ({ url: 'https://docs.google.com/d/doc-x/edit', documentId: 'doc-x' }));

vi.mock('../../../integrations/googleDocsExport.js', () => ({
  exportTripToGoogleDoc: (...args: unknown[]) => mockExportTripToGoogleDoc(...args),
  MissingDocsScopeError: class MissingDocsScopeError extends Error {
    constructor() {
      super('Google OAuth client missing documents scope — owner must re-authorize');
      this.name = 'MissingDocsScopeError';
    }
  },
}));

// Import routes AFTER mocks
const { default: tripsRoutes, hashTripBundle } = await import(
  '../trips.js'
);

// Import MissingDocsScopeError AFTER the mock so we get the mocked class
const { MissingDocsScopeError } = await import('../../../integrations/googleDocsExport.js');

// ─── Fixtures ───────────────────────────────────────────────────────────────

function emptyBudget(): BudgetRollup {
  const zero = () => ({
    flights: 0, lodging: 0, food: 0, activities: 0,
    transit: 0, shopping: 0, other: 0,
  });
  return { targets: zero(), spent: zero(), remaining: zero() };
}

function fixtureBundle(overrides: Partial<TripBundle> = {}): TripBundle {
  return {
    context: {
      groupJid: 'grp-1@g.us',
      destination: 'Rome',
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      budgetByCategory: '{}',
      status: 'active',
      dates: null,
      contextSummary: null,
      lastClassifiedAt: null,
      updatedAt: Date.now(),
      calendarId: null,
      briefingTime: null,
      metadata: null,
    },
    readOnly: false,
    decisions: [],
    openQuestions: [],
    calendarEvents: [],
    budget: emptyBudget(),
    ...overrides,
  };
}

function fixtureTrip(overrides: Partial<TripListEntry> = {}): TripListEntry {
  return {
    groupJid: 'grp-1@g.us',
    destination: 'Rome',
    startDate: '2026-06-01',
    endDate: '2026-06-08',
    status: 'active',
    archivedAt: null,
    ...overrides,
  };
}

// Minimal decision row shape used in existence check stubs
function fixtureDecisionRow(id = 'dec-1', groupJid = 'grp-1@g.us') {
  return {
    id,
    group_jid: groupJid,
    type: 'accommodation',
    status: 'active',
    resolved: 0,
  };
}

function fixtureQuestionRow(id = 'q-1', groupJid = 'grp-1@g.us') {
  return {
    id,
    group_jid: groupJid,
    type: 'open_question',
    status: 'active',
    resolved: 0,
  };
}

// ─── Server builder ──────────────────────────────────────────────────────────

async function buildServer(
  authPasses = true,
  jwtVerifyPasses = true,
): Promise<FastifyInstance> {
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
    verify: (_token: string): any => {
      if (!jwtVerifyPasses) throw new Error('unauthorized');
      return { sub: 'test' };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await fastify.register(tripsRoutes);
  await fastify.ready();
  return fastify;
}

// ─── 1. Auth gate ─────────────────────────────────────────────────────────────

describe('1. Auth gate', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(false, false);
    mockGetTripBundle.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/trips without Authorization returns 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/trips' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/trips/:groupJid without Authorization returns 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/trips/grp-1@g.us',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/trips/:groupJid/stream without ?token= returns 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/trips/grp-1@g.us/stream',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── 2. GET /api/trips happy path ────────────────────────────────────────────

describe('2. GET /api/trips happy path', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockListTrips.mockReset();
    mockGetTripBundle.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns { trips: [...] } with 3 entries (2 active + 1 archived)', async () => {
    const active1 = fixtureTrip({ groupJid: 'g1@g.us', destination: 'Rome' });
    const active2 = fixtureTrip({
      groupJid: 'g2@g.us',
      destination: 'Paris',
      startDate: '2026-07-01',
    });
    const archived = fixtureTrip({
      groupJid: 'g3@g.us',
      destination: 'Berlin',
      status: 'archived',
      archivedAt: Date.now(),
    });
    mockListTrips.mockReturnValueOnce([active1, active2, archived]);

    const res = await server.inject({ method: 'GET', url: '/api/trips' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ trips: TripListEntry[] }>();
    expect(body.trips).toHaveLength(3);
    expect(body.trips[0].destination).toBe('Rome');
    expect(body.trips[2].status).toBe('archived');
  });
});

// ─── 3. GET /api/trips/:groupJid ─────────────────────────────────────────────

describe('3. GET /api/trips/:groupJid', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('404 for unknown groupJid', async () => {
    mockGetTripBundle.mockReturnValueOnce(null);
    const res = await server.inject({
      method: 'GET',
      url: '/api/trips/unknown@g.us',
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 with bundle for active trip — has all required fields + readOnly:false', async () => {
    const bundle = fixtureBundle({
      decisions: [
        {
          id: 'dec-1',
          groupJid: 'grp-1@g.us',
          type: 'accommodation',
          value: 'Hotel Roma',
          confidence: 'high',
          sourceMessageId: null,
          resolved: false,
          createdAt: Date.now(),
          proposedBy: null,
          category: 'lodging',
          costAmount: 820,
          costCurrency: 'EUR',
          conflictsWith: '[]',
          origin: 'self_reported',
          metadata: null,
          archived: false,
          status: 'active',
          lat: null,
          lng: null,
        },
      ],
    });
    mockGetTripBundle.mockReturnValueOnce(bundle);

    const res = await server.inject({
      method: 'GET',
      url: '/api/trips/grp-1@g.us',
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<TripBundle>();
    expect(body.readOnly).toBe(false);
    expect(body.context).toBeDefined();
    expect(body.decisions).toHaveLength(1);
    expect(body.openQuestions).toBeDefined();
    expect(body.calendarEvents).toBeDefined();
    expect(body.budget).toBeDefined();
  });

  it('200 with readOnly:true for archived trip', async () => {
    const bundle = fixtureBundle({ readOnly: true });
    mockGetTripBundle.mockReturnValueOnce(bundle);

    const res = await server.inject({
      method: 'GET',
      url: '/api/trips/archived-grp@g.us',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<TripBundle>();
    expect(body.readOnly).toBe(true);
  });
});

// ─── 4. DELETE /api/trips/:groupJid/decisions/:id ────────────────────────────

describe('4. DELETE /api/trips/:groupJid/decisions/:id', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockDbGet.mockReset();
    mockSoftDeleteDecision.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('204 on first delete and softDeleteDecision is called', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(fixtureDecisionRow('dec-1', 'grp-1@g.us'));

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/trips/grp-1@g.us/decisions/dec-1',
    });
    expect(res.statusCode).toBe(204);
    expect(mockSoftDeleteDecision).toHaveBeenCalledWith('dec-1');
  });

  it('204 idempotent on already-deleted row (existence check still finds row)', async () => {
    // The row exists (status='deleted') but softDeleteDecision is still called
    // — soft-delete is a no-op for already-deleted rows, returns 204 either way
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce({
      ...fixtureDecisionRow('dec-1', 'grp-1@g.us'),
      status: 'deleted',
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/trips/grp-1@g.us/decisions/dec-1',
    });
    expect(res.statusCode).toBe(204);
    expect(mockSoftDeleteDecision).toHaveBeenCalledWith('dec-1');
  });

  it('404 if decision id unknown (db returns undefined)', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(undefined);

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/trips/grp-1@g.us/decisions/ghost-id',
    });
    expect(res.statusCode).toBe(404);
    expect(mockSoftDeleteDecision).not.toHaveBeenCalled();
  });

  it('404 if decision belongs to a different group (anti-leak)', async () => {
    // Route builds WHERE clause with both id AND groupJid — db returns no row
    // because the mock returns undefined when groupJid doesn't match
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(undefined); // WHERE id=dec-1 AND groupJid=wrong-grp returns no row

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/trips/wrong-grp@g.us/decisions/dec-1',
    });
    expect(res.statusCode).toBe(404);
    expect(mockSoftDeleteDecision).not.toHaveBeenCalled();
  });
});

// ─── 5. PATCH /api/trips/:groupJid/questions/:id/resolve ──────────────────────

describe('5. PATCH /api/trips/:groupJid/questions/:id/resolve', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockDbGet.mockReset();
    mockResolveOpenItem.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('204 + resolveOpenItem called', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(fixtureQuestionRow('q-1', 'grp-1@g.us'));

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/trips/grp-1@g.us/questions/q-1/resolve',
    });
    expect(res.statusCode).toBe(204);
    expect(mockResolveOpenItem).toHaveBeenCalledWith('q-1');
  });

  it('204 idempotent on already-resolved question', async () => {
    // already-resolved question row is still found by the existence check
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce({
      ...fixtureQuestionRow('q-1', 'grp-1@g.us'),
      resolved: 1,
    });

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/trips/grp-1@g.us/questions/q-1/resolve',
    });
    expect(res.statusCode).toBe(204);
    expect(mockResolveOpenItem).toHaveBeenCalledWith('q-1');
  });
});

// ─── 6. PATCH /api/trips/:groupJid/budget ─────────────────────────────────────

describe('6. PATCH /api/trips/:groupJid/budget', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockUpdateBudgetByCategory.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('200 with new BudgetRollup after valid patch', async () => {
    const bundle = fixtureBundle({ readOnly: false });
    const patchedBudget: BudgetRollup = {
      ...emptyBudget(),
      targets: { ...emptyBudget().targets, food: 300 },
    };
    mockGetTripBundle
      .mockReturnValueOnce(bundle)  // first call: read-only check
      .mockReturnValueOnce({ ...bundle, budget: patchedBudget }); // second call: return fresh bundle
    mockUpdateBudgetByCategory.mockReturnValueOnce({ food: 300 } as Record<string, number>);

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/trips/grp-1@g.us/budget',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food: 300 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ budget: BudgetRollup }>();
    expect(body.budget).toBeDefined();
    expect(body.budget.targets.food).toBe(300);
    expect(mockUpdateBudgetByCategory).toHaveBeenCalledWith(
      'grp-1@g.us',
      { food: 300 },
    );
  });

  it('400 on invalid category key', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/trips/grp-1@g.us/budget',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plane: 100 }), // 'plane' is not a valid TripCategory
    });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateBudgetByCategory).not.toHaveBeenCalled();
  });

  it('400 on non-finite amount', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));

    const res = await server.inject({
      method: 'PATCH',
      url: '/api/trips/grp-1@g.us/budget',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food: 'abc' }), // string, not number
    });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateBudgetByCategory).not.toHaveBeenCalled();
  });
});

// ─── 7. Archived-trip 403 enforcement ────────────────────────────────────────

describe('7. Archived-trip 403 enforcement', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockDbGet.mockReset();
    mockSoftDeleteDecision.mockReset();
    mockResolveOpenItem.mockReset();
    mockUpdateBudgetByCategory.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('all write routes return 403 for archived trip', async () => {
    // All three writes check readOnly upfront
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: true }));

    const deleteRes = await server.inject({
      method: 'DELETE',
      url: '/api/trips/archived-grp@g.us/decisions/dec-1',
    });
    expect(deleteRes.statusCode).toBe(403);
    expect(mockSoftDeleteDecision).not.toHaveBeenCalled();

    const resolveRes = await server.inject({
      method: 'PATCH',
      url: '/api/trips/archived-grp@g.us/questions/q-1/resolve',
    });
    expect(resolveRes.statusCode).toBe(403);
    expect(mockResolveOpenItem).not.toHaveBeenCalled();

    const budgetRes = await server.inject({
      method: 'PATCH',
      url: '/api/trips/archived-grp@g.us/budget',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food: 200 }),
    });
    expect(budgetRes.statusCode).toBe(403);
    expect(mockUpdateBudgetByCategory).not.toHaveBeenCalled();
  });
});

// ─── 8. Soft-delete propagation (mock-based round-trip) ──────────────────────

describe('8. Soft-delete propagation round-trip', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockDbGet.mockReset();
    mockSoftDeleteDecision.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it('DELETE decision → bundle shows status=deleted + spent adjusted', async () => {
    // Step 1: initial bundle — 2 food decisions, spent.food=100
    const decision1 = {
      id: 'dec-1',
      groupJid: 'grp-1@g.us',
      type: 'food',
      value: 'Pizza',
      confidence: 'high',
      sourceMessageId: null,
      resolved: false,
      createdAt: Date.now(),
      proposedBy: null,
      category: 'food' as const,
      costAmount: 50,
      costCurrency: 'EUR',
      conflictsWith: '[]',
      origin: 'self_reported' as const,
      metadata: null,
      archived: false,
      status: 'active' as const,
      lat: null,
      lng: null,
    };
    const decision2 = { ...decision1, id: 'dec-2', value: 'Gelato' };

    const initialBundle = fixtureBundle({
      decisions: [decision1, decision2],
      budget: {
        ...emptyBudget(),
        spent: { ...emptyBudget().spent, food: 100 },
      },
    });
    mockGetTripBundle.mockReturnValueOnce(initialBundle);

    // GET bundle — shows spent.food=100
    const getRes = await server.inject({
      method: 'GET',
      url: '/api/trips/grp-1@g.us',
    });
    expect(getRes.statusCode).toBe(200);
    const before = getRes.json<TripBundle>();
    expect(before.budget.spent.food).toBe(100);
    expect(before.decisions).toHaveLength(2);

    // Step 2: DELETE dec-1
    mockGetTripBundle.mockReturnValueOnce(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(fixtureDecisionRow('dec-1', 'grp-1@g.us'));

    const delRes = await server.inject({
      method: 'DELETE',
      url: '/api/trips/grp-1@g.us/decisions/dec-1',
    });
    expect(delRes.statusCode).toBe(204);
    expect(mockSoftDeleteDecision).toHaveBeenCalledWith('dec-1');

    // Step 3: re-GET bundle — spent.food=50 (soft-delete query layer handles exclusion)
    // The mock simulates what the DB query layer would return after soft-delete
    const bundleAfterDelete = fixtureBundle({
      decisions: [
        { ...decision1, status: 'deleted' as const },
        decision2,
      ],
      budget: {
        ...emptyBudget(),
        spent: { ...emptyBudget().spent, food: 50 },
      },
    });
    mockGetTripBundle.mockReturnValueOnce(bundleAfterDelete);

    const getRes2 = await server.inject({
      method: 'GET',
      url: '/api/trips/grp-1@g.us',
    });
    expect(getRes2.statusCode).toBe(200);
    const after = getRes2.json<TripBundle>();
    expect(after.budget.spent.food).toBe(50);
    // deleted decision is still in the array (for "Show deleted" toggle) but flagged
    expect(after.decisions.find((d) => d.id === 'dec-1')?.status).toBe('deleted');
    expect(after.decisions).toHaveLength(2);
  });
});

// ─── 10. POST /api/trips/:groupJid/decisions/:id/restore ─────────────────────

describe('10. POST /api/trips/:groupJid/decisions/:id/restore', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockDbGet.mockReset();
    mockRestoreDecision.mockReset();
    mockRestoreDecision.mockReturnValue({ changes: 1 });
  });

  afterEach(async () => {
    await server.close();
  });

  it('401 without auth', async () => {
    const noAuthServer = await buildServer(false, false);
    const res = await noAuthServer.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/decisions/dec-1/restore',
    });
    expect(res.statusCode).toBe(401);
    await noAuthServer.close();
  });

  it('204 on happy path — restoreDecision called', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce({
      ...fixtureDecisionRow('dec-1', 'grp-1@g.us'),
      status: 'deleted',
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/decisions/dec-1/restore',
    });
    expect(res.statusCode).toBe(204);
    expect(mockRestoreDecision).toHaveBeenCalledWith('dec-1', 'grp-1@g.us');
  });

  it('204 idempotent on already-active row (row exists, restore returns changes:0)', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    // Row is active — existence check still finds it, restore is idempotent
    mockDbGet.mockReturnValueOnce(fixtureDecisionRow('dec-1', 'grp-1@g.us'));
    mockRestoreDecision.mockReturnValueOnce({ changes: 0 });

    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/decisions/dec-1/restore',
    });
    expect(res.statusCode).toBe(204);
    // restoreDecision is called — it's a no-op at the DB layer but route is 204
    expect(mockRestoreDecision).toHaveBeenCalledWith('dec-1', 'grp-1@g.us');
  });

  it('403 on archived trip', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: true }));

    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/archived-grp@g.us/decisions/dec-1/restore',
    });
    expect(res.statusCode).toBe(403);
    expect(mockRestoreDecision).not.toHaveBeenCalled();
  });

  it('404 on unknown decision id (db returns undefined)', async () => {
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(undefined);

    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/decisions/ghost-id/restore',
    });
    expect(res.statusCode).toBe(404);
    expect(mockRestoreDecision).not.toHaveBeenCalled();
  });

  it('404 on decision belonging to wrong group (anti-leak)', async () => {
    // WHERE clause uses id AND groupJid — different group means db returns no row
    mockGetTripBundle.mockReturnValue(fixtureBundle({ readOnly: false }));
    mockDbGet.mockReturnValueOnce(undefined); // row not found for wrong group

    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/wrong-grp@g.us/decisions/dec-1/restore',
    });
    expect(res.statusCode).toBe(404);
    expect(mockRestoreDecision).not.toHaveBeenCalled();
  });
});

// ─── 11. POST /api/trips/:groupJid/export ────────────────────────────────────

describe('11. POST /api/trips/:groupJid/export', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer(true, true);
    mockGetTripBundle.mockReset();
    mockExportTripToGoogleDoc.mockReset();
    mockExportTripToGoogleDoc.mockResolvedValue({
      url: 'https://docs.google.com/d/doc-x/edit',
      documentId: 'doc-x',
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('401 without Authorization header', async () => {
    const noAuthServer = await buildServer(false, false);
    const res = await noAuthServer.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/export',
    });
    expect(res.statusCode).toBe(401);
    await noAuthServer.close();
  });

  it('404 for unknown groupJid', async () => {
    mockGetTripBundle.mockReturnValueOnce(null);
    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/unknown@g.us/export',
    });
    expect(res.statusCode).toBe(404);
    expect(mockExportTripToGoogleDoc).not.toHaveBeenCalled();
  });

  it('200 with { url } on success', async () => {
    mockGetTripBundle.mockReturnValueOnce(fixtureBundle());
    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/export',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(body.url).toBe('https://docs.google.com/d/doc-x/edit');
  });

  it('412 when MissingDocsScopeError is thrown', async () => {
    mockGetTripBundle.mockReturnValueOnce(fixtureBundle());
    mockExportTripToGoogleDoc.mockRejectedValueOnce(new MissingDocsScopeError());
    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/export',
    });
    expect(res.statusCode).toBe(412);
    const body = res.json<{ error: string; action: string }>();
    expect(body.action).toContain('/integrations');
  });

  it('500 on unexpected error', async () => {
    mockGetTripBundle.mockReturnValueOnce(fixtureBundle());
    mockExportTripToGoogleDoc.mockRejectedValueOnce(new Error('boom'));
    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/grp-1@g.us/export',
    });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('Export failed');
  });

  it('200 on archived trip — exports are read-only, not blocked by readOnly flag', async () => {
    // Archived trips CAN export (spec: archived trips can still export, read-only doesn't block exports)
    mockGetTripBundle.mockReturnValueOnce(fixtureBundle({ readOnly: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/api/trips/archived-grp@g.us/export',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(body.url).toBe('https://docs.google.com/d/doc-x/edit');
  });
});

// ─── 9. hashTripBundle unit tests ────────────────────────────────────────────

describe('9. hashTripBundle', () => {
  it('stable across two identical bundles', () => {
    const b = fixtureBundle();
    expect(hashTripBundle(b)).toBe(hashTripBundle(b));
  });

  it('differs when a decision status changes (active → deleted)', () => {
    const base = fixtureBundle({
      decisions: [
        {
          id: 'dec-1',
          groupJid: 'grp-1@g.us',
          type: 'food',
          value: 'Pizza',
          confidence: 'high',
          sourceMessageId: null,
          resolved: false,
          createdAt: Date.now(),
          proposedBy: null,
          category: 'food' as const,
          costAmount: 50,
          costCurrency: 'EUR',
          conflictsWith: '[]',
          origin: 'inferred' as const,
          metadata: null,
          archived: false,
          status: 'active' as const,
          lat: null,
          lng: null,
        },
      ],
    });
    const after = fixtureBundle({
      decisions: [
        { ...base.decisions[0], status: 'deleted' as const },
      ],
    });
    expect(hashTripBundle(base)).not.toBe(hashTripBundle(after));
  });

  it('differs when budget spent changes', () => {
    const b1 = fixtureBundle();
    const b2 = fixtureBundle({
      budget: {
        ...emptyBudget(),
        spent: { ...emptyBudget().spent, food: 100 },
      },
    });
    expect(hashTripBundle(b1)).not.toBe(hashTripBundle(b2));
  });

  it('differs when readOnly flips', () => {
    const b1 = fixtureBundle({ readOnly: false });
    const b2 = fixtureBundle({ readOnly: true });
    expect(hashTripBundle(b1)).not.toBe(hashTripBundle(b2));
  });
});

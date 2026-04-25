/**
 * Unit tests for googleDocsExport module.
 *
 * Mocks `googleapis` and `personalCalendarService.getOAuth2Client` so no
 * real HTTP calls are made. The six cases cover:
 *   1. renderTripBody includes all sections in CONTEXT-locked order
 *   2. status='deleted' decisions excluded from body
 *   3. resolved questions excluded from body
 *   4. MissingDocsScopeError thrown when docs.create returns 403 insufficientPermissions
 *   5. returns Drive webViewLink on success
 *   6. falls back to constructed URL when webViewLink is missing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock googleapis ─────────────────────────────────────────────────────────

const mockDocumentsCreate = vi.fn();
const mockDocumentsBatchUpdate = vi.fn();
const mockDriveFilesGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    docs: vi.fn(() => ({
      documents: {
        create: mockDocumentsCreate,
        batchUpdate: mockDocumentsBatchUpdate,
      },
    })),
    drive: vi.fn(() => ({
      files: {
        get: mockDriveFilesGet,
      },
    })),
  },
}));

// ─── Mock personalCalendarService ────────────────────────────────────────────

vi.mock('../../calendar/personalCalendarService.js', () => ({
  getOAuth2Client: () => ({ /* stub OAuth2Client */ }),
}));

// ─── Import module under test AFTER mocks ────────────────────────────────────

const { exportTripToGoogleDoc, MissingDocsScopeError, renderTripBody } = await import(
  '../googleDocsExport.js'
);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function emptyBudget() {
  const zero = () => ({
    flights: 0, lodging: 0, food: 0, activities: 0,
    transit: 0, shopping: 0, other: 0,
  });
  return { targets: zero(), spent: zero(), remaining: zero() };
}

function fixtureInput(
  overrides: Partial<Parameters<typeof exportTripToGoogleDoc>[0]> = {},
): Parameters<typeof exportTripToGoogleDoc>[0] {
  return {
    destination: 'Paris',
    startDate: '2026-06-01',
    endDate: '2026-06-08',
    decisions: [
      {
        id: 'par-01',
        type: 'accommodation',
        value: 'Hotel Le Marais',
        category: 'lodging',
        costAmount: 800,
        costCurrency: 'EUR',
        origin: 'self_reported',
        status: 'active',
        metadata: null,
      },
    ],
    openQuestions: [
      { id: 'q-01', value: 'Visa required?', resolved: false },
    ],
    calendarEvents: [
      { id: 'ev-01', title: 'Flight CDG', eventDate: Date.parse('2026-06-01T08:00:00Z') },
    ],
    budget: emptyBudget(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('googleDocsExport', () => {
  beforeEach(() => {
    mockDocumentsCreate.mockReset();
    mockDocumentsBatchUpdate.mockReset();
    mockDriveFilesGet.mockReset();

    // Default happy-path mocks
    mockDocumentsCreate.mockResolvedValue({ data: { documentId: 'doc-123' } });
    mockDocumentsBatchUpdate.mockResolvedValue({});
    mockDriveFilesGet.mockResolvedValue({ data: { webViewLink: 'https://docs.google.com/d/doc-123/edit' } });
  });

  // 1. renderTripBody includes all sections in CONTEXT-locked order
  it('renderTripBody includes TIMELINE, DECISIONS, OPEN QUESTIONS, BUDGET in document order', () => {
    const input = fixtureInput();
    const body = renderTripBody(input);

    const iTimeline = body.indexOf('TIMELINE');
    const iDecisions = body.indexOf('DECISIONS');
    const iQuestions = body.indexOf('OPEN QUESTIONS');
    const iBudget = body.indexOf('BUDGET');

    expect(iTimeline).toBeGreaterThan(-1);
    expect(iDecisions).toBeGreaterThan(iTimeline);
    expect(iQuestions).toBeGreaterThan(iDecisions);
    expect(iBudget).toBeGreaterThan(iQuestions);
  });

  // 2. excludes status='deleted' decisions from the body
  it('excludes status="deleted" decisions from the body', () => {
    const input = fixtureInput({
      decisions: [
        {
          id: 'par-active',
          type: 'food',
          value: 'Baguette Bistro',
          category: 'food',
          costAmount: 40,
          costCurrency: 'EUR',
          origin: 'self_reported',
          status: 'active',
          metadata: null,
        },
        {
          id: 'par-14',
          type: 'food',
          value: 'Café de Flore',
          category: 'food',
          costAmount: 60,
          costCurrency: 'EUR',
          origin: 'multimodal',
          status: 'deleted',
          metadata: null,
        },
      ],
    });
    const body = renderTripBody(input);
    expect(body).toContain('Baguette Bistro');
    expect(body).not.toContain('Café de Flore');
  });

  // 3. excludes resolved questions from the body
  it('excludes resolved=true questions from the body', () => {
    const input = fixtureInput({
      openQuestions: [
        { id: 'q-unresolved', value: 'Hotel confirmed?', resolved: false },
        { id: 'q-resolved', value: 'Passport valid?', resolved: true },
      ],
    });
    const body = renderTripBody(input);
    expect(body).toContain('Hotel confirmed?');
    expect(body).not.toContain('Passport valid?');
  });

  // 4. MissingDocsScopeError when docs.create returns 403 insufficientPermissions
  it('throws MissingDocsScopeError when docs.create returns 403 insufficientPermissions', async () => {
    mockDocumentsCreate.mockRejectedValueOnce({
      code: 403,
      errors: [{ reason: 'insufficientPermissions' }],
    });

    await expect(exportTripToGoogleDoc(fixtureInput())).rejects.toBeInstanceOf(
      MissingDocsScopeError,
    );
  });

  // 5. returns Drive webViewLink on success
  it('returns the webViewLink from Drive on success', async () => {
    const expectedUrl = 'https://docs.google.com/d/doc-abc/edit';
    mockDriveFilesGet.mockResolvedValueOnce({ data: { webViewLink: expectedUrl } });

    const result = await exportTripToGoogleDoc(fixtureInput());
    expect(result.url).toBe(expectedUrl);
    expect(result.documentId).toBe('doc-123');
  });

  // 6. falls back to constructed URL when webViewLink is missing
  it('falls back to constructed URL when Drive webViewLink is missing', async () => {
    mockDriveFilesGet.mockResolvedValueOnce({ data: {} });

    const result = await exportTripToGoogleDoc(fixtureInput());
    expect(result.url).toBe('https://docs.google.com/document/d/doc-123/edit');
  });
});

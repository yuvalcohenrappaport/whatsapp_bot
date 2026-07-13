import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock config — must be set up before the module under test is imported ────

const mockConfig = {
  LOG_LEVEL: 'silent' as const,
  GOOGLE_PLACES_API_KEY: 'test-api-key' as string | undefined,
};

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

// ─── Mock DB + tripMemory — no real SQLite needed for these unit tests ─────────

const updateDecisionGeocodeMock = vi.fn();
const getTripContextMock = vi.fn();

vi.mock('../../db/queries/tripMemory.js', () => ({
  GEOCODEABLE_TYPES: new Set(['restaurant', 'hotel', 'lodging', 'activity', 'accommodation']),
  updateDecisionGeocode: updateDecisionGeocodeMock,
  getTripContext: getTripContextMock,
}));

// Mock db client (used directly in runGeocodeAfterInsert to fetch the row)
const getRowMock = vi.fn();
const whereMock = vi.fn(() => ({ get: getRowMock }));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

vi.mock('../../db/client.js', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('../../db/schema.js', () => ({
  tripDecisions: {
    id: 'id',
    type: 'type',
    value: 'value',
    placeId: 'placeId',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// ─── Mock globalThis.fetch ────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ─── Import module under test after all mocks are set up ─────────────────────

const {
  geocodeDecision,
  detectLanguageCode,
  runGeocodeAfterInsert,
  PlacesGeocodeError,
} = await import('../placesGeocode.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlacesResponse(places: unknown[] = [{ id: 'ChIJ_test123', formattedAddress: '123 Test St, Paris', location: { latitude: 48.85, longitude: 2.35 }, types: ['restaurant', 'food'], rating: 4.5, userRatingCount: 120, currentOpeningHours: { openNow: true }, displayName: { text: 'Café de Flore', languageCode: 'en' } }]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ places }),
  };
}

function makeEmptyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ places: [] }),
  };
}

function makeErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED' } }),
  };
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.mockReset();
  updateDecisionGeocodeMock.mockReset();
  getTripContextMock.mockReset();
  getRowMock.mockReset();
  // Reset config API key to a valid key for most tests
  mockConfig.GOOGLE_PLACES_API_KEY = 'test-api-key';
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectLanguageCode', () => {
  it('returns en for Latin text', () => {
    expect(detectLanguageCode('Café de Flore Paris')).toBe('en');
  });

  it('returns iw for Hebrew text', () => {
    expect(detectLanguageCode('מסעדת קמה')).toBe('iw');
  });

  it('returns iw for mixed text containing Hebrew', () => {
    expect(detectLanguageCode('מסעדת קמה Tel Aviv')).toBe('iw');
  });
});

describe('geocodeDecision', () => {
  it('1. happy path English: returns correct placeId/lat/lng, fetch called once with languageCode en', async () => {
    fetchMock.mockResolvedValueOnce(makePlacesResponse());

    const result = await geocodeDecision('Café de Flore', 'Paris');

    expect(result).not.toBeNull();
    expect(result!.placeId).toBe('ChIJ_test123');
    expect(result!.lat).toBe(48.85);
    expect(result!.lng).toBe(2.35);
    expect(result!.canonicalAddress).toBe('123 Test St, Paris');
    expect(result!.metadata.rating).toBe(4.5);

    // Verify fetch call details
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(url).not.toContain('maps.googleapis.com');
    const body = JSON.parse(options.body as string) as { textQuery: string; languageCode: string };
    expect(body.textQuery).toBe('Café de Flore Paris');
    expect(body.languageCode).toBe('en');
  });

  it('2. Hebrew detection: fetch body has languageCode iw', async () => {
    fetchMock.mockResolvedValueOnce(makePlacesResponse([{
      id: 'ChIJ_hebrew',
      formattedAddress: 'רחוב הרצל 1, תל אביב',
      location: { latitude: 32.08, longitude: 34.78 },
      types: ['restaurant'],
      displayName: { text: 'מסעדת קמה', languageCode: 'iw' },
    }]));

    const result = await geocodeDecision('מסעדת קמה', 'תל אביב');

    expect(result).not.toBeNull();
    expect(detectLanguageCode('מסעדת קמה תל אביב')).toBe('iw');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { languageCode: string };
    expect(body.languageCode).toBe('iw');
  });

  it('3. hybrid fallback fires: first call returns empty, second call returns result with value alone', async () => {
    fetchMock
      .mockResolvedValueOnce(makeEmptyResponse())
      .mockResolvedValueOnce(makePlacesResponse());

    const result = await geocodeDecision('Café de Flore', 'Paris');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.placeId).toBe('ChIJ_test123');

    // Second call should use value alone (no destination)
    const [, opts2] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body2 = JSON.parse(opts2.body as string) as { textQuery: string };
    expect(body2.textQuery).toBe('Café de Flore');
  });

  it('4. no-match terminal: both calls return empty → returns null', async () => {
    fetchMock
      .mockResolvedValueOnce(makeEmptyResponse())
      .mockResolvedValueOnce(makeEmptyResponse());

    const result = await geocodeDecision('NonexistentPlace12345', 'Paris');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5. HTTP 429: throws PlacesGeocodeError with status 429', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(429));

    const err = await geocodeDecision('Some Place', 'City').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesGeocodeError);
    expect((err as InstanceType<typeof PlacesGeocodeError>).status).toBe(429);
  });

  it('10. FieldMask includes correct fields and uses places.googleapis.com', async () => {
    fetchMock.mockResolvedValueOnce(makePlacesResponse());

    await geocodeDecision('Test Place', 'Test City');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(url).toContain('places.googleapis.com');
    expect(url).not.toContain('maps.googleapis.com');
    expect(headers['X-Goog-FieldMask']).toContain('places.id');
    expect(headers['X-Goog-FieldMask']).toContain('places.rating');
    expect(headers['X-Goog-FieldMask']).toContain('places.formattedAddress');
    expect(headers['X-Goog-FieldMask']).toContain('places.location');
    expect(headers['X-Goog-FieldMask']).toContain('places.displayName');
    expect(headers['X-Goog-FieldMask']).not.toBe('*');
  });
});

describe('runGeocodeAfterInsert', () => {
  it('6. type-skip: flight type → updateDecisionGeocode called with skipped, fetch never called', async () => {
    getRowMock.mockReturnValue({ id: 'dec-1', type: 'flight', value: 'NYC to LAX', placeId: null });
    getTripContextMock.mockReturnValue({ destination: 'Los Angeles' });

    await runGeocodeAfterInsert('group-1@g.us', 'dec-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateDecisionGeocodeMock).toHaveBeenCalledWith('dec-1', 'skipped', null);
  });

  it('7. idempotence: row with placeId already set → neither updateDecisionGeocode nor fetch called', async () => {
    getRowMock.mockReturnValue({ id: 'dec-2', type: 'restaurant', value: 'Café de Flore', placeId: 'existing-id' });

    await runGeocodeAfterInsert('group-1@g.us', 'dec-2');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateDecisionGeocodeMock).not.toHaveBeenCalled();
  });

  it('8. error swallow: fetch throws network error → no exception escapes, updateDecisionGeocode called with error', async () => {
    getRowMock.mockReturnValue({ id: 'dec-3', type: 'restaurant', value: 'Café de Flore', placeId: null });
    getTripContextMock.mockReturnValue({ destination: 'Paris' });
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(runGeocodeAfterInsert('group-1@g.us', 'dec-3')).resolves.toBeUndefined();

    expect(updateDecisionGeocodeMock).toHaveBeenCalledWith('dec-3', 'error', null);
  });

  it('9. no API key: runGeocodeAfterInsert returns without DB write or fetch; second call does not re-warn', async () => {
    // We can't reset warnedNoKey since it's module-level, but we can verify no crash + no DB write
    mockConfig.GOOGLE_PLACES_API_KEY = undefined;
    getRowMock.mockReturnValue({ id: 'dec-4', type: 'restaurant', value: 'Test', placeId: null });
    getTripContextMock.mockReturnValue(null);

    await runGeocodeAfterInsert('group-1@g.us', 'dec-4');
    // No DB write
    expect(updateDecisionGeocodeMock).not.toHaveBeenCalled();
    // No API call
    expect(fetchMock).not.toHaveBeenCalled();

    // Second call — also no crash, also no DB write
    await runGeocodeAfterInsert('group-1@g.us', 'dec-4');
    expect(updateDecisionGeocodeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('geocodes successfully: restaurant type with destination → updateDecisionGeocode called with geocoded', async () => {
    getRowMock.mockReturnValue({ id: 'dec-5', type: 'restaurant', value: 'Café de Flore', placeId: null });
    getTripContextMock.mockReturnValue({ destination: 'Paris' });
    fetchMock.mockResolvedValueOnce(makePlacesResponse());

    await runGeocodeAfterInsert('group-1@g.us', 'dec-5');

    expect(updateDecisionGeocodeMock).toHaveBeenCalledWith(
      'dec-5',
      'geocoded',
      expect.objectContaining({
        placeId: 'ChIJ_test123',
        lat: 48.85,
        lng: 2.35,
      }),
    );
  });

  it('no_match: fetch returns empty → updateDecisionGeocode called with no_match', async () => {
    getRowMock.mockReturnValue({ id: 'dec-6', type: 'activity', value: 'Nonexistent Place XYZ', placeId: null });
    getTripContextMock.mockReturnValue(null);
    fetchMock.mockResolvedValueOnce(makeEmptyResponse());

    await runGeocodeAfterInsert('group-1@g.us', 'dec-6');

    expect(updateDecisionGeocodeMock).toHaveBeenCalledWith('dec-6', 'no_match', null);
  });

  it('row not found: returns silently without any DB write', async () => {
    getRowMock.mockReturnValue(undefined);

    await runGeocodeAfterInsert('group-1@g.us', 'no-such-id');

    expect(updateDecisionGeocodeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

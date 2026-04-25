import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock config — must be set up before the module under test is imported ────

const mockConfig = {
  LOG_LEVEL: 'silent' as const,
  GOOGLE_PLACES_API_KEY: 'test-api-key' as string | undefined,
};

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

// PlaceMetadata type is imported as `import type` in the SUT, so we don't need
// to mock the tripMemory module — TypeScript-only imports are erased at runtime.

// ─── Mock globalThis.fetch ────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ─── Import module under test after all mocks are set up ─────────────────────

const {
  autocompletePlaces,
  fetchPlaceDetails,
  detectLanguageCode,
  PlacesAutocompleteError,
} = await import('../placesAutocomplete.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAutocompleteResponse(
  suggestions: Array<{
    placeId: string;
    main?: string;
    secondary?: string;
  }>,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      suggestions: suggestions.map((s) => ({
        placePrediction: {
          placeId: s.placeId,
          structuredFormat: {
            mainText: s.main !== undefined ? { text: s.main } : undefined,
            secondaryText:
              s.secondary !== undefined ? { text: s.secondary } : undefined,
          },
        },
      })),
    }),
  };
}

function makeDetailsResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
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
  mockConfig.GOOGLE_PLACES_API_KEY = 'test-api-key';
});

// ─── detectLanguageCode ───────────────────────────────────────────────────────

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

// ─── autocompletePlaces ───────────────────────────────────────────────────────

describe('autocompletePlaces', () => {
  it('1. happy path: returns 3 mapped suggestions', async () => {
    fetchMock.mockResolvedValueOnce(
      makeAutocompleteResponse([
        { placeId: 'A', main: 'Café de Flore', secondary: 'Paris, France' },
        { placeId: 'B', main: 'Café Flore', secondary: 'Lyon, France' },
        { placeId: 'C', main: 'Le Flore', secondary: 'Nice, France' },
      ]),
    );

    const out = await autocompletePlaces('Cafe Flore', 'sess-1');

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      placeId: 'A',
      primaryText: 'Café de Flore',
      secondaryText: 'Paris, France',
    });
    expect(out[2].placeId).toBe('C');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    const body = JSON.parse(options.body as string) as {
      input: string;
      sessionToken: string;
      languageCode: string;
    };
    expect(body.input).toBe('Cafe Flore');
    expect(body.sessionToken).toBe('sess-1');
    expect(body.languageCode).toBe('en');
  });

  it('2a. zero results: empty body returns []', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const out = await autocompletePlaces('xyzzy', 'sess-1');
    expect(out).toEqual([]);
  });

  it('2b. zero results: empty suggestions array returns []', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ suggestions: [] }),
    });

    const out = await autocompletePlaces('xyzzy', 'sess-1');
    expect(out).toEqual([]);
  });

  it('3. caps at 5 even when API returns 7', async () => {
    fetchMock.mockResolvedValueOnce(
      makeAutocompleteResponse([
        { placeId: 'A', main: 'A', secondary: 'a' },
        { placeId: 'B', main: 'B', secondary: 'b' },
        { placeId: 'C', main: 'C', secondary: 'c' },
        { placeId: 'D', main: 'D', secondary: 'd' },
        { placeId: 'E', main: 'E', secondary: 'e' },
        { placeId: 'F', main: 'F', secondary: 'f' },
        { placeId: 'G', main: 'G', secondary: 'g' },
      ]),
    );

    const out = await autocompletePlaces('any', 'sess-1');
    expect(out).toHaveLength(5);
    expect(out[4].placeId).toBe('E');
  });

  it('4. HTTP 429 throws PlacesAutocompleteError with status 429', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(429));

    const err = await autocompletePlaces('Café', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(429);
  });

  it('5. schema drift throws PlacesAutocompleteError with status 0', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      // suggestions should be an array; passing a string forces Zod to fail.
      json: async () => ({ suggestions: 'not-an-array' }),
    });

    const err = await autocompletePlaces('Café', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(0);
  });

  it('6. missing GOOGLE_PLACES_API_KEY throws with status 412', async () => {
    mockConfig.GOOGLE_PLACES_API_KEY = undefined;

    const err = await autocompletePlaces('Café', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(412);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('7. Hebrew query auto-selects languageCode=iw in body', async () => {
    fetchMock.mockResolvedValueOnce(
      makeAutocompleteResponse([
        { placeId: 'IL', main: 'מסעדת קמה', secondary: 'תל אביב' },
      ]),
    );

    await autocompletePlaces('מסעדת קמה', 'sess-1');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { languageCode: string };
    expect(body.languageCode).toBe('iw');
  });

  it('handles missing structuredFormat fields without crashing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          { placePrediction: { placeId: 'X' } },
          { placePrediction: { placeId: 'Y', structuredFormat: {} } },
        ],
      }),
    });

    const out = await autocompletePlaces('q', 'sess-1');
    expect(out).toEqual([
      { placeId: 'X', primaryText: '', secondaryText: '' },
      { placeId: 'Y', primaryText: '', secondaryText: '' },
    ]);
  });

  it('forwards explicit languageCode override', async () => {
    fetchMock.mockResolvedValueOnce(makeAutocompleteResponse([]));

    await autocompletePlaces('any latin query', 'sess-1', 'iw');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { languageCode: string };
    expect(body.languageCode).toBe('iw');
  });

  it('sends X-Goog-Api-Key + narrow X-Goog-FieldMask headers', async () => {
    fetchMock.mockResolvedValueOnce(makeAutocompleteResponse([]));

    await autocompletePlaces('Café', 'sess-1');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-api-key');
    expect(headers['X-Goog-FieldMask']).toContain(
      'suggestions.placePrediction.placeId',
    );
    expect(headers['X-Goog-FieldMask']).toContain('mainText.text');
    expect(headers['X-Goog-FieldMask']).toContain('secondaryText.text');
    expect(headers['X-Goog-FieldMask']).not.toBe('*');
  });
});

// ─── fetchPlaceDetails ────────────────────────────────────────────────────────

describe('fetchPlaceDetails', () => {
  it('8. happy path: returns full PlaceDetailsResult with metadata fields populated', async () => {
    fetchMock.mockResolvedValueOnce(
      makeDetailsResponse({
        id: 'ChIJ_test123',
        formattedAddress: '123 Test St, Paris',
        location: { latitude: 48.85, longitude: 2.35 },
        types: ['restaurant', 'food'],
        rating: 4.5,
        userRatingCount: 120,
        currentOpeningHours: { openNow: true },
        displayName: { text: 'Café de Flore' },
      }),
    );

    const out = await fetchPlaceDetails('ChIJ_test123', 'sess-1');

    expect(out.placeId).toBe('ChIJ_test123');
    expect(out.canonicalAddress).toBe('123 Test St, Paris');
    expect(out.lat).toBe(48.85);
    expect(out.lng).toBe(2.35);
    expect(out.metadata.rating).toBe(4.5);
    expect(out.metadata.userRatingCount).toBe(120);
    expect(out.metadata.openNow).toBe(true);
    expect(out.metadata.types).toEqual(['restaurant', 'food']);
    expect(out.metadata.primaryType).toBe('restaurant');
    expect(out.metadata.displayName).toBe('Café de Flore');
  });

  it('9. missing fields → all metadata fields are null + types is []', async () => {
    fetchMock.mockResolvedValueOnce(makeDetailsResponse({}));

    const out = await fetchPlaceDetails('ChIJ_unknown', 'sess-1');

    // id falls back to the requested placeId when the API omits it.
    expect(out.placeId).toBe('ChIJ_unknown');
    expect(out.canonicalAddress).toBeNull();
    expect(out.lat).toBeNull();
    expect(out.lng).toBeNull();
    expect(out.metadata.rating).toBeNull();
    expect(out.metadata.userRatingCount).toBeNull();
    expect(out.metadata.openNow).toBeNull();
    expect(out.metadata.types).toEqual([]);
    expect(out.metadata.primaryType).toBeNull();
    expect(out.metadata.displayName).toBeNull();
  });

  it('10. missing API key → 412', async () => {
    mockConfig.GOOGLE_PLACES_API_KEY = undefined;

    const err = await fetchPlaceDetails('ChIJ_x', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(412);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('11. appends sessionToken and languageCode to URL query string', async () => {
    fetchMock.mockResolvedValueOnce(makeDetailsResponse({ id: 'ChIJ_z' }));

    await fetchPlaceDetails('ChIJ_z', 'sess-abc', 'iw');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://places.googleapis.com/v1/places/ChIJ_z');
    expect(url).toContain('sessionToken=sess-abc');
    expect(url).toContain('languageCode=iw');
    expect(options.method).toBe('GET');
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-api-key');
    expect(headers['X-Goog-FieldMask']).toContain('formattedAddress');
    expect(headers['X-Goog-FieldMask']).toContain('location');
    expect(headers['X-Goog-FieldMask']).toContain('rating');
  });

  it('omits languageCode from URL when caller does not pass one', async () => {
    fetchMock.mockResolvedValueOnce(makeDetailsResponse({ id: 'ChIJ_q' }));

    await fetchPlaceDetails('ChIJ_q', 'sess-1');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('languageCode=');
    expect(url).toContain('sessionToken=sess-1');
  });

  it('HTTP 404 throws PlacesAutocompleteError with status 404', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(404));

    const err = await fetchPlaceDetails('ChIJ_missing', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(404);
  });

  it('schema drift on details throws PlacesAutocompleteError with status 0', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      // location must be an object — passing a number forces Zod to fail.
      json: async () => ({ id: 'ChIJ_z', location: 123 }),
    });

    const err = await fetchPlaceDetails('ChIJ_z', 'sess-1').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PlacesAutocompleteError);
    expect((err as PlacesAutocompleteError).status).toBe(0);
  });

  it('URL-encodes the placeId path segment', async () => {
    fetchMock.mockResolvedValueOnce(makeDetailsResponse({ id: 'foo/bar' }));

    await fetchPlaceDetails('foo/bar', 'sess-1');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('places/foo%2Fbar');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCoords, getDestinationForecast } from '../openWeather.js';

// ─── Global fetch mock ───────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// Small helper to build a Response-like object.
function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Pick<Response, 'ok' | 'status' | 'json'> {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe('resolveCoords', () => {
  it('returns lat/lon from first geo result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'Rome', lat: 41.9028, lon: 12.4964, country: 'IT' },
      ]),
    );

    const coords = await resolveCoords('Rome', 'fake-key');

    expect(coords).toEqual({ lat: 41.9028, lon: 12.4964 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('geo/1.0/direct');
    expect(calledUrl).toContain('q=Rome');
    expect(calledUrl).toContain('appid=fake-key');
  });

  it('returns null on empty array response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const coords = await resolveCoords('Atlantis', 'fake-key');
    expect(coords).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const coords = await resolveCoords('Rome', 'fake-key');
    expect(coords).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }));
    const coords = await resolveCoords('Rome', 'bad-key');
    expect(coords).toBeNull();
  });
});

describe('getDestinationForecast', () => {
  const COORDS = { lat: 41.9028, lon: 12.4964 };
  const TARGET = '2026-05-01';

  function forecastFixture() {
    // 3 slots: two on 2026-05-01 (matching target), one on 2026-05-02.
    const on501_09 = Date.UTC(2026, 4, 1, 9, 0, 0) / 1000; // 09:00 UTC
    const on501_12 = Date.UTC(2026, 4, 1, 12, 0, 0) / 1000; // 12:00 UTC
    const on502_09 = Date.UTC(2026, 4, 2, 9, 0, 0) / 1000;
    return {
      list: [
        {
          dt: on501_09,
          main: { temp: 18.5 },
          weather: [{ description: 'clear sky', icon: '01d' }],
        },
        {
          dt: on501_12,
          main: { temp: 22.1 },
          weather: [{ description: 'few clouds', icon: '02d' }],
        },
        {
          dt: on502_09,
          main: { temp: 17.0 },
          weather: [{ description: 'light rain', icon: '10d' }],
        },
      ],
    };
  }

  it('happy path: returns slots filtered to target date only', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(forecastFixture()));

    const slots = await getDestinationForecast(COORDS, 'fake-key', TARGET);

    expect(slots).toHaveLength(2);
    expect(slots[0].temp).toBe(18.5);
    expect(slots[0].description).toBe('clear sky');
    expect(slots[0].icon).toBe('01d');
    expect(slots[1].temp).toBe(22.1);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('data/2.5/forecast');
    expect(calledUrl).toContain('lat=41.9028');
    expect(calledUrl).toContain('lon=12.4964');
    expect(calledUrl).toContain('units=metric');
    expect(calledUrl).toContain('cnt=40');
  });

  it('returns an empty array when no slots match the target date', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ list: [] }));
    const slots = await getDestinationForecast(COORDS, 'fake-key', TARGET);
    expect(slots).toEqual([]);
  });

  it('retries exactly once on 429 then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse(forecastFixture()));

    const promise = getDestinationForecast(COORDS, 'fake-key', TARGET);
    await vi.advanceTimersByTimeAsync(5000);
    const slots = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(slots).toHaveLength(2);
  });

  it('throws on second consecutive 429 (retry exhausted)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 429 }));

    const promise = getDestinationForecast(COORDS, 'fake-key', TARGET);
    // Attach rejection handler BEFORE advancing timers so the rejected promise
    // is never unhandled.
    const assertion = expect(promise).rejects.toThrow(/OpenWeather 429/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on non-429 non-200 response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({}, { ok: false, status: 500 }),
    );
    await expect(
      getDestinationForecast(COORDS, 'fake-key', TARGET),
    ).rejects.toThrow(/OpenWeather 500/);
  });
});

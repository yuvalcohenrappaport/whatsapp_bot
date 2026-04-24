import pino from 'pino';

// NOTE: Do NOT import `config` here — the API key is passed as a function
// parameter so tests can inject a fake key without mocking the config
// module. Log level defaults to LOG_LEVEL env var if set, else 'info'.
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export interface Coords {
  lat: number;
  lon: number;
}

export interface ForecastSlot {
  /** Unix seconds — matches OpenWeather `list[].dt` semantics. */
  dt: number;
  /** Celsius (we request units=metric). */
  temp: number;
  /** Short English description from `list[].weather[0].description`. */
  description: string;
  /** Icon code from `list[].weather[0].icon` (e.g. "04d"). */
  icon: string;
}

// ─── Internal types for the raw OpenWeather responses ──────────────────────────

interface GeoResult {
  lat: number;
  lon: number;
  name?: string;
  country?: string;
}

interface ForecastResponseSlot {
  dt: number;
  main: { temp: number };
  weather: Array<{ description: string; icon: string }>;
}

interface ForecastResponse {
  list: ForecastResponseSlot[];
}

/**
 * Sleep for `ms` milliseconds. Extracted so tests can mock it via fake timers.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a destination name (e.g. "Rome" or "Tel Aviv, Israel") to lat/lon
 * via OpenWeather's `/geo/1.0/direct` endpoint.
 *
 * Returns `null` on empty responses, non-200s, or network errors. Does NOT
 * cache — the caller (`dayOfBriefing`) stores coords in `metadata.coords` so
 * there is exactly one cache layer in the system.
 */
export async function resolveCoords(
  destination: string,
  apiKey: string,
): Promise<Coords | null> {
  const url = new URL('https://api.openweathermap.org/geo/1.0/direct');
  url.searchParams.set('q', destination);
  url.searchParams.set('limit', '1');
  url.searchParams.set('appid', apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    logger.warn({ err, destination }, 'OpenWeather geo lookup network error');
    return null;
  }

  if (!response.ok) {
    logger.warn(
      { status: response.status, destination },
      'OpenWeather geo lookup non-200',
    );
    return null;
  }

  let data: GeoResult[];
  try {
    data = (await response.json()) as GeoResult[];
  } catch (err) {
    logger.warn({ err, destination }, 'OpenWeather geo lookup invalid JSON');
    return null;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const first = data[0];
  if (typeof first.lat !== 'number' || typeof first.lon !== 'number') {
    return null;
  }

  return { lat: first.lat, lon: first.lon };
}

/**
 * Fetch the 5-day / 3-hour forecast for `coords` and filter slots down to a
 * single target date (in UTC — callers that need destination-local filtering
 * should pass the destination-tz date they computed externally).
 *
 * Retries exactly once on HTTP 429 after waiting 5 seconds. Any other
 * non-200 (or a second consecutive 429) throws.
 */
export async function getDestinationForecast(
  coords: Coords,
  apiKey: string,
  targetDateIso: string,
): Promise<ForecastSlot[]> {
  const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
  url.searchParams.set('lat', String(coords.lat));
  url.searchParams.set('lon', String(coords.lon));
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('cnt', '40');

  const performRequest = async (): Promise<Response> => fetch(url.toString());

  let response = await performRequest();

  if (response.status === 429) {
    logger.warn(
      { coords, targetDateIso },
      'OpenWeather forecast 429 — retrying once after 5s',
    );
    await sleep(5000);
    response = await performRequest();
    if (response.status === 429) {
      throw new Error('OpenWeather 429 (retry exhausted)');
    }
  }

  if (!response.ok) {
    throw new Error(`OpenWeather ${response.status}`);
  }

  const data = (await response.json()) as ForecastResponse;
  const list = Array.isArray(data.list) ? data.list : [];

  return list
    .filter((slot) => {
      const iso = new Date(slot.dt * 1000).toISOString();
      return iso.startsWith(targetDateIso);
    })
    .map((slot) => ({
      dt: slot.dt,
      temp: slot.main.temp,
      description: slot.weather[0]?.description ?? '',
      icon: slot.weather[0]?.icon ?? '',
    }));
}

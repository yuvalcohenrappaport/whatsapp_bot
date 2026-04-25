/**
 * Phase 53-01 Task 2: Unit tests for travelSearch restaurant branch.
 *
 * Suites:
 *   1. Restaurant branch: prompt composition (2 tests)
 *   2. Restaurant branch: field extraction (3 tests)
 *   3. Result cap (1 test)
 *   4. Warn log on grounding regression (1 test)
 *   5. Non-restaurant regression guard (1 test)
 *
 * No real Gemini calls — @google/genai is fully mocked at module level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so spies are available inside vi.mock factories (which are hoisted above const declarations)
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

const { warnSpy, infoSpy, debugSpy, errorSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  infoSpy: vi.fn(),
  debugSpy: vi.fn(),
  errorSpy: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock('pino', () => ({
  default: () => ({ info: infoSpy, warn: warnSpy, debug: debugSpy, error: errorSpy }),
}));

// Also mock the AI provider (knowledgeFallback uses it; confirm it is NOT called on happy Maps path)
vi.mock('../../ai/provider.js', () => ({
  generateText: vi.fn(),
  generateJson: vi.fn(),
}));

import { searchTravel, type SearchResult } from '../travelSearch.js';

// Helper: build a minimal mock Gemini Maps response that returns the given items as JSON text
function mockMapsResponse(items: Record<string, unknown>[]) {
  mockGenerateContent.mockResolvedValueOnce({
    text: JSON.stringify(items),
    candidates: [],
  });
}

beforeEach(() => {
  mockGenerateContent.mockReset();
  warnSpy.mockReset();
  infoSpy.mockReset();
  debugSpy.mockReset();
  errorSpy.mockReset();
});

// ---------------------------------------------------------------------------
// Suite 1 — Restaurant branch: prompt composition
// ---------------------------------------------------------------------------

describe('Suite 1 — Restaurant branch: prompt composition', () => {
  it('restaurant query prompt contains all five enriched field names', async () => {
    const items = [
      { title: 'Ristorante Roma', url: 'https://maps.google.com/x', rating: 4.5, reviewCount: 200, address: 'Via Roma 1', photo_url: 'https://example.com/p.jpg', open_now: true, price_level: '$$', cuisine: 'Italian', reservation_url: null },
    ];
    mockMapsResponse(items);

    await searchTravel('restaurants in Rome', 'en', 'restaurants');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    const promptText: string = callArg.contents[0].parts[0].text;

    expect(promptText).toContain('photo_url');
    expect(promptText).toContain('open_now');
    expect(promptText).toContain('price_level');
    expect(promptText).toContain('cuisine');
    expect(promptText).toContain('reservation_url');
    // Must NOT contain the non-restaurant sentinel phrase
    expect(promptText).not.toContain('For each result provide: name, rating (number or null), reviewCount (number or null), address (string or null), and a direct URL.');
  });

  it('hotels query uses the non-restaurant prompt (no enriched fields)', async () => {
    const items = [
      { title: 'Hotel Grand', url: 'https://example.com', rating: 4.0, reviewCount: 500, address: 'Main St 1' },
    ];
    mockMapsResponse(items);

    await searchTravel('hotels in Paris', 'en', 'hotels');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    const promptText: string = callArg.contents[0].parts[0].text;

    expect(promptText).not.toContain('photo_url');
    expect(promptText).not.toContain('reservation_url');
    expect(promptText).not.toContain('price_level');
    expect(promptText).not.toContain('open_now');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Restaurant branch: field extraction
// ---------------------------------------------------------------------------

describe('Suite 2 — Restaurant branch: field extraction', () => {
  it('all-fields-present fixture: correctly maps all five restaurant fields', async () => {
    const items = [
      {
        title: 'Osteria Francescana',
        url: 'https://maps.google.com/xyz',
        rating: 4.9,
        reviewCount: 1234,
        address: 'Via Stella 22, Modena',
        photo_url: 'https://example.com/photo.jpg',
        open_now: true,
        price_level: '$$$$',
        cuisine: 'Italian',
        reservation_url: 'https://opentable.com/osteria',
      },
    ];
    mockMapsResponse(items);

    const { results, isFallback } = await searchTravel('best restaurants in Modena', 'en', 'restaurants');

    expect(isFallback).toBe(false);
    expect(results).toHaveLength(1);

    const r = results[0];
    expect(r.photoUrl).toBe('https://example.com/photo.jpg');
    expect(r.openNow).toBe(true);
    expect(r.priceLevel).toBe('$$$$');
    expect(r.cuisine).toBe('Italian');
    expect(r.reservationUrl).toBe('https://opentable.com/osteria');
    // Existing base fields also correct
    expect(r.rating).toBe(4.9);
    expect(r.address).toBe('Via Stella 22, Modena');
  });

  it('some-fields-null fixture: photo_url and open_now null, others present', async () => {
    const items = [
      {
        title: 'Trattoria Emilia',
        url: 'https://maps.google.com/abc',
        rating: 4.3,
        reviewCount: 300,
        address: 'Corso Italia 5',
        photo_url: null,
        open_now: null,
        price_level: '$$',
        cuisine: 'Emilian',
        reservation_url: 'https://thefork.com/trattoria',
      },
    ];
    mockMapsResponse(items);

    const { results } = await searchTravel('restaurants in Bologna', 'en', 'restaurants');

    const r = results[0];
    expect(r.photoUrl).toBe(null);
    expect(r.openNow).toBe(null);
    expect(r.priceLevel).toBe('$$');
    expect(r.cuisine).toBe('Emilian');
    expect(r.reservationUrl).toBe('https://thefork.com/trattoria');
  });

  it('wrong-type coercion: open_now string and price_level number are dropped to null', async () => {
    const items = [
      {
        title: 'Bistro Suspect',
        url: 'https://maps.google.com/suspect',
        rating: 3.8,
        reviewCount: 50,
        address: 'Fake St 99',
        photo_url: 'https://example.com/p.jpg',
        open_now: 'true',    // string, not boolean — should coerce to null
        price_level: 3,      // number, not string — should coerce to null
        cuisine: 'French',
        reservation_url: null,
      },
    ];
    mockMapsResponse(items);

    const { results } = await searchTravel('bistros in Lyon', 'en', 'restaurants');

    const r = results[0];
    expect(r.openNow).toBe(null);      // typeof 'true' !== 'boolean'
    expect(r.priceLevel).toBe(null);   // typeof 3 !== 'string'
    // correctly typed fields still work
    expect(r.cuisine).toBe('French');
    expect(r.photoUrl).toBe('https://example.com/p.jpg');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Result cap
// ---------------------------------------------------------------------------

describe('Suite 3 — Result cap', () => {
  it('restaurants request caps at 5 results (not 3, not 10)', async () => {
    const tenItems = Array.from({ length: 10 }, (_, i) => ({
      title: `Restaurant ${i + 1}`,
      url: `https://maps.google.com/r${i + 1}`,
      rating: 4.0,
      reviewCount: 100,
      address: `Street ${i + 1}`,
      photo_url: `https://example.com/r${i + 1}.jpg`,
      open_now: true,
      price_level: '$$',
      cuisine: 'Generic',
      reservation_url: null,
    }));
    mockMapsResponse(tenItems);

    const { results } = await searchTravel('restaurants anywhere', 'en', 'restaurants');

    expect(results).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Warn log on grounding regression
// ---------------------------------------------------------------------------

describe('Suite 4 — Warn log on grounding regression', () => {
  it('fires warn log when all 5 enriched fields are null; results still surface', async () => {
    const items = [
      {
        title: 'Starved Restaurant A',
        url: 'https://maps.google.com/sa',
        rating: 4.0,
        reviewCount: 100,
        address: 'Street A',
        photo_url: null,
        open_now: null,
        price_level: null,
        cuisine: null,
        reservation_url: null,
      },
      {
        title: 'Starved Restaurant B',
        url: 'https://maps.google.com/sb',
        rating: 3.5,
        reviewCount: 80,
        address: 'Street B',
        photo_url: null,
        open_now: null,
        price_level: null,
        cuisine: null,
        reservation_url: null,
      },
    ];
    mockMapsResponse(items);

    const { results } = await searchTravel('restaurants in nowhere', 'en', 'restaurants');

    // Results still surface (warn is observability-only, not a gate)
    expect(results).toHaveLength(2);

    // warnSpy should have been called with a message about missing enriched fields
    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find(
      (call) => typeof call[1] === 'string' && call[1].includes('missing all enriched fields'),
    );
    expect(warnCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Non-restaurant regression guard
// ---------------------------------------------------------------------------

describe('Suite 5 — Non-restaurant regression guard', () => {
  it('hotels query does not populate restaurant fields on results', async () => {
    const items = [
      {
        title: 'Hotel Le Fancy',
        url: 'https://maps.google.com/hotel',
        rating: 4.7,
        reviewCount: 2000,
        address: 'Boulevard Haussmann, Paris',
      },
    ];
    mockMapsResponse(items);

    const { results } = await searchTravel('luxury hotels in Paris', 'en', 'hotels');

    expect(results.length).toBeGreaterThan(0);
    const r = results[0] as SearchResult;
    expect(r.photoUrl).toBeUndefined();
    expect(r.openNow).toBeUndefined();
    expect(r.priceLevel).toBeUndefined();
    expect(r.cuisine).toBeUndefined();
    expect(r.reservationUrl).toBeUndefined();
  });
});

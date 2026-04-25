/**
 * Phase 52-01 Task 2: Unit tests for geminiVision.
 *
 * Three suites:
 *   1. TripFactExtractionSchema shape (Zod validation)
 *   2. extractTripFact happy path (mocked generateContent)
 *   3. extractTripFact failure paths (non-JSON, schema violation, API throw)
 *
 * No real Gemini calls — `@google/genai` is fully mocked at module level.
 * Accuracy testing against real fixtures lives in Plan 52-03, not here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @google/genai BEFORE any import that transitively pulls it in.
// `vi.mock` is hoisted above `const` declarations, so we declare the mock spy
// inside `vi.hoisted(...)` — same hoist tier as `vi.mock`, so the factory can
// reference it safely when the module constructs `new GoogleGenAI(...)` at
// import time.
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

// Import AFTER the mock declaration. The `extractTripFact` module constructs
// a GoogleGenAI instance at import time, which will use the mocked class.
import {
  TripFactExtractionSchema,
  extractTripFact,
  type GroupContext,
} from '../geminiVision.js';

const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const FAKE_JPEG_B64 = FAKE_JPEG.toString('base64');

const SAMPLE_GROUP_CONTEXT: GroupContext = {
  destination: 'Italy',
  startDate: '2026-05-10',
  endDate: '2026-05-17',
  activePersons: ['Yossi', 'Dana'],
};

describe('TripFactExtractionSchema', () => {
  it('accepts a fully populated flight payload with high confidence', () => {
    const ok = TripFactExtractionSchema.safeParse({
      type: 'flight',
      title: 'LH401 TLV→FRA',
      date: '2026-05-10',
      time: '14:20',
      location: 'TLV',
      address: 'Ben Gurion Airport',
      reservation_number: 'ABC123',
      cost_amount: 450,
      cost_currency: 'EUR',
      confidence: 0.95,
      notes: 'Seat 14A',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a payload with every nullable field set to null', () => {
    const ok = TripFactExtractionSchema.safeParse({
      type: 'other',
      title: 'Unknown media',
      date: null,
      time: null,
      location: null,
      address: null,
      reservation_number: null,
      cost_amount: null,
      cost_currency: null,
      confidence: 0.2,
      notes: null,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an invalid `type` enum value', () => {
    const bad = TripFactExtractionSchema.safeParse({
      type: 'car', // not in enum
      title: 'Rental',
      date: null,
      time: null,
      location: null,
      address: null,
      reservation_number: null,
      cost_amount: null,
      cost_currency: null,
      confidence: 0.5,
      notes: null,
    });
    expect(bad.success).toBe(false);
  });

  it('rejects `confidence` out of [0, 1] range', () => {
    const bad = TripFactExtractionSchema.safeParse({
      type: 'flight',
      title: 'x',
      date: null,
      time: null,
      location: null,
      address: null,
      reservation_number: null,
      cost_amount: null,
      cost_currency: null,
      confidence: 1.5,
      notes: null,
    });
    expect(bad.success).toBe(false);
  });
});

describe('extractTripFact — happy path (mocked Gemini)', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('parses a well-formed flight response and asserts inlineData wiring', async () => {
    const geminiJson = {
      type: 'flight',
      title: 'LH401 TLV→FRA',
      date: '2026-05-10',
      time: '14:20',
      location: 'TLV',
      address: null,
      reservation_number: 'ABC123',
      cost_amount: 450,
      cost_currency: 'EUR',
      confidence: 0.95,
      notes: null,
    };
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(geminiJson),
    });

    const result = await extractTripFact(
      FAKE_JPEG,
      'image/jpeg',
      SAMPLE_GROUP_CONTEXT,
    );

    // Full parsed object comes back (not just a subset)
    expect(result).toEqual(geminiJson);

    // Assert inlineData wiring — mimeType + base64 data must match inputs
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    const parts = callArg.contents[0].parts;
    const inlineEntry = parts.find(
      (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData,
    );
    expect(inlineEntry).toBeDefined();
    expect(inlineEntry.inlineData.mimeType).toBe('image/jpeg');
    expect(inlineEntry.inlineData.data).toBe(FAKE_JPEG_B64);
  });
});

describe('extractTripFact — failure paths (mocked Gemini)', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('returns null (no throw) when Gemini returns non-JSON text', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'not-json' });

    const result = await extractTripFact(FAKE_JPEG, 'image/jpeg', {});

    expect(result).toBeNull();
  });

  it('returns null (no throw) when Gemini output violates the Zod schema', async () => {
    // bad enum + missing required fields
    mockGenerateContent.mockResolvedValueOnce({
      text: '{"type":"rocket","title":"x","confidence":0.9}',
    });

    const result = await extractTripFact(FAKE_JPEG, 'image/jpeg', {});

    expect(result).toBeNull();
  });

  it('returns null (no throw) when the Gemini API call rejects', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API 429'));

    const result = await extractTripFact(FAKE_JPEG, 'image/jpeg', {});

    expect(result).toBeNull();
  });

  it('returns null when Gemini returns empty text', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: '' });

    const result = await extractTripFact(FAKE_JPEG, 'image/jpeg', {});

    expect(result).toBeNull();
  });
});

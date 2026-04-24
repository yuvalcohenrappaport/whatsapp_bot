/**
 * Phase 53-02: travelParser unit tests (mocked AI provider).
 *
 * Suite 1 — Mocked classifier unit (always runs, 4 tests):
 *   1. Happy path: queryType='restaurants' intent returned unchanged
 *   2. Schema-violation: isTravelRelated as non-bool → safeParse returns null
 *   3. Null passthrough: generateJson returns null → parseTravelIntent returns null
 *   4. Contract test: all 6 locked restaurant keywords reach the generateJson call
 *
 * Real-API accuracy tests live in travelParser.fixtures.test.ts (key-gated).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mockGenerateJson is available inside the vi.mock factory
// (vi.mock is hoisted to the top of the file before variable initializers).
const { mockGenerateJson } = vi.hoisted(() => ({
  mockGenerateJson: vi.fn(),
}));

vi.mock('../../ai/provider.js', () => ({
  generateJson: mockGenerateJson,
  generateText: vi.fn(),
}));

import { parseTravelIntent, type TravelIntent } from '../travelParser.js';

beforeEach(() => {
  mockGenerateJson.mockReset();
});

describe('parseTravelIntent — mocked unit', () => {
  it('returns queryType="restaurants" intent when AI resolves a valid object', async () => {
    const mockIntent = {
      isTravelRelated: true,
      isVague: false,
      clarificationQuestion: null,
      queryType: 'restaurants',
      searchQuery: 'best restaurants in Rome',
      destination: 'Rome',
      dates: null,
      budget: null,
      preferences: null,
    } satisfies TravelIntent;

    mockGenerateJson.mockResolvedValueOnce(mockIntent);

    const result = await parseTravelIntent('מסעדות ברומא', '', 'he');
    expect(result).not.toBeNull();
    expect(result!.queryType).toBe('restaurants');
    expect(result!.isTravelRelated).toBe(true);
  });

  it('returns null when AI returns an object that fails Zod validation', async () => {
    mockGenerateJson.mockResolvedValueOnce({
      queryType: 'restaurants',
      isTravelRelated: 'not-a-bool', // invalid — schema expects boolean
      isVague: false,
      clarificationQuestion: null,
      searchQuery: null,
      destination: null,
      dates: null,
      budget: null,
      preferences: null,
    });

    const result = await parseTravelIntent('restaurants in Rome', '', 'en');
    expect(result).toBeNull();
  });

  it('returns null when AI returns null', async () => {
    mockGenerateJson.mockResolvedValueOnce(null);

    const result = await parseTravelIntent('מסעדות טובות', '', 'he');
    expect(result).toBeNull();
  });

  it('contract test: all 6 locked restaurant keywords reach the generateJson systemPrompt', async () => {
    // Return a valid response so parseTravelIntent doesn't short-circuit
    mockGenerateJson.mockResolvedValueOnce({
      isTravelRelated: true,
      isVague: false,
      clarificationQuestion: null,
      queryType: 'restaurants',
      searchQuery: 'restaurants in Rome',
      destination: 'Rome',
      dates: null,
      budget: null,
      preferences: null,
    });

    await parseTravelIntent('restaurants in Rome', '', 'en');

    expect(mockGenerateJson).toHaveBeenCalledOnce();
    const callArgs = mockGenerateJson.mock.calls[0][0] as { systemPrompt: string };
    const { systemPrompt } = callArgs;

    // All 6 locked keywords must appear verbatim in the system prompt sent to Gemini
    expect(systemPrompt).toContain('מסעדה');
    expect(systemPrompt).toContain('מסעדות');
    expect(systemPrompt).toContain('restaurant');
    expect(systemPrompt).toContain('restaurants');
    expect(systemPrompt).toContain('לאכול');
    expect(systemPrompt).toContain('ארוחה');
  });
});

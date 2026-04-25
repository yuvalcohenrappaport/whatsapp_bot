/**
 * Phase 53-02: travelParser real-Gemini accuracy fixtures.
 *
 * Gated on GEMINI_API_KEY — tests are skipped in CI (no key).
 * Run with: GEMINI_API_KEY=... npx vitest run src/groups/__tests__/travelParser.fixtures.test.ts
 *
 * Suite: Real Gemini accuracy (3 tests)
 *   - Hebrew "מסעדות" keyword → queryType='restaurants'
 *   - Hebrew "לאכול" verb → queryType='restaurants'
 *   - English "restaurants" → queryType='restaurants'
 */

import { describe, it, expect } from 'vitest';
import { parseTravelIntent } from '../travelParser.js';

const hasKey = !!process.env.GEMINI_API_KEY;
const maybe = hasKey ? it : it.skip;

describe('parseTravelIntent — real Gemini accuracy (key-gated)', () => {
  maybe(
    'Hebrew "מסעדות" classifies as restaurants',
    async () => {
      const result = await parseTravelIntent('מסעדות טובות בטוריסמו', '', 'he');
      expect(result).not.toBeNull();
      expect(result!.queryType).toBe('restaurants');
    },
    30_000,
  );

  maybe(
    'Hebrew "לאכול" verb classifies as restaurants',
    async () => {
      const result = await parseTravelIntent('איפה אפשר לאכול ברומא הערב?', '', 'he');
      expect(result).not.toBeNull();
      expect(result!.queryType).toBe('restaurants');
    },
    30_000,
  );

  maybe(
    'English "restaurants in Rome" classifies as restaurants',
    async () => {
      const result = await parseTravelIntent('restaurants in Rome', '', 'en');
      expect(result).not.toBeNull();
      expect(result!.queryType).toBe('restaurants');
    },
    30_000,
  );
});

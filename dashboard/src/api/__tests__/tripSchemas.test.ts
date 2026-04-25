import { describe, it, expect } from 'vitest';
import { parsePlaceMetadata } from '../tripSchemas';

describe('parsePlaceMetadata', () => {
  it('returns null for null input', () => {
    expect(parsePlaceMetadata(null)).toBeNull();
  });

  it('returns object with types=[] for empty JSON object', () => {
    const result = parsePlaceMetadata('{}');
    expect(result).not.toBeNull();
    expect(result?.types).toEqual([]);
  });

  it('returns null for invalid JSON', () => {
    expect(parsePlaceMetadata('not json')).toBeNull();
  });

  it('returns parsed object for valid metadata', () => {
    const raw = JSON.stringify({
      rating: 4.6,
      openNow: true,
      types: ['restaurant', 'food'],
      primaryType: 'restaurant',
    });
    const result = parsePlaceMetadata(raw);
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(4.6);
    expect(result?.openNow).toBe(true);
    expect(result?.types).toEqual(['restaurant', 'food']);
    expect(result?.primaryType).toBe('restaurant');
  });
});

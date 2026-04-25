import { describe, it, expect } from 'vitest';
import {
  parsePlaceMetadata,
  AutocompleteResponseSchema,
  PlacePreviewSchema,
  PinDecisionResponseSchema,
} from '../tripSchemas';

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

describe('AutocompleteResponseSchema (Phase 57)', () => {
  it('parses happy-path body with one suggestion', () => {
    const result = AutocompleteResponseSchema.safeParse({
      suggestions: [
        { placeId: 'p1', primaryText: 'Café', secondaryText: 'Paris' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestions).toHaveLength(1);
      expect(result.data.suggestions[0]?.placeId).toBe('p1');
    }
  });

  it('rejects schema drift when suggestions is not an array', () => {
    const result = AutocompleteResponseSchema.safeParse({
      suggestions: 'not an array',
    });
    expect(result.success).toBe(false);
  });
});

describe('PlacePreviewSchema (Phase 57)', () => {
  it('parses happy-path body with full metadata', () => {
    const result = PlacePreviewSchema.safeParse({
      placeId: 'p1',
      lat: 48.85,
      lng: 2.34,
      canonicalAddress: '6 Pl. St-Germain, Paris',
      metadata: {
        rating: 4.5,
        userRatingCount: 1234,
        openNow: true,
        types: ['cafe'],
        primaryType: 'cafe',
        displayName: 'Café Flore',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lat).toBe(48.85);
      expect(result.data.lng).toBe(2.34);
      expect(result.data.metadata.primaryType).toBe('cafe');
    }
  });
});

describe('PinDecisionResponseSchema (Phase 57)', () => {
  it('parses happy-path body wrapping a full TripDecision row', () => {
    const decisionFixture = {
      id: 'd1',
      groupJid: '120363000000000000@g.us',
      type: 'restaurant',
      value: 'Café Flore',
      confidence: 'high',
      sourceMessageId: 'msg1',
      proposedBy: 'user1',
      category: 'food' as const,
      costAmount: null,
      costCurrency: null,
      conflictsWith: '[]',
      origin: 'dashboard' as const,
      metadata: null,
      archived: false,
      status: 'active' as const,
      lat: 48.85,
      lng: 2.34,
      resolved: true,
      createdAt: 1714000000000,
      placeId: 'p1',
      canonicalAddress: '6 Pl. St-Germain, Paris',
      lookupStatus: 'geocoded' as const,
      placeMetadata: JSON.stringify({
        rating: 4.5,
        userRatingCount: 1234,
        openNow: true,
        types: ['cafe'],
        primaryType: 'cafe',
        displayName: 'Café Flore',
      }),
    };
    const result = PinDecisionResponseSchema.safeParse({
      decision: decisionFixture,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision.placeId).toBe('p1');
      expect(result.data.decision.lookupStatus).toBe('geocoded');
      expect(result.data.decision.lat).toBe(48.85);
    }
  });
});

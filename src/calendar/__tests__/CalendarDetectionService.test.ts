import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../ai/provider.js', () => ({
  generateJson: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue('gemini'),
}));

vi.mock('../../config.js', () => ({
  config: { LOG_LEVEL: 'silent', GEMINI_API_KEY: 'test' },
}));

vi.mock('../../db/queries/settings.js', () => ({
  getSetting: vi.fn().mockReturnValue('gemini'),
}));

import { CalendarDetectionService } from '../CalendarDetectionService.js';
import type { DetectionContext } from '../CalendarDetectionService.js';
import { generateJson } from '../../ai/provider.js';

const mockedGenerateJson = vi.mocked(generateJson);

const defaultContext: DetectionContext = {
  senderName: 'Test User',
  chatName: 'Test Group',
  chatType: 'group',
};

// ─── hasDateSignal ───────────────────────────────────────────────────────────

describe('CalendarDetectionService', () => {
  let service: CalendarDetectionService;

  beforeEach(() => {
    service = new CalendarDetectionService();
    vi.clearAllMocks();
  });

  describe('hasDateSignal', () => {
    it('returns true for text containing digits', () => {
      expect(service.hasDateSignal('Meeting on 15/03')).toBe(true);
      expect(service.hasDateSignal('call at 3pm')).toBe(true);
      expect(service.hasDateSignal('2026')).toBe(true);
    });

    it('returns false for text with no digits', () => {
      expect(service.hasDateSignal('hello world')).toBe(false);
      expect(service.hasDateSignal('no numbers here')).toBe(false);
      expect(service.hasDateSignal('')).toBe(false);
    });

    it('returns true for Hebrew text with digits', () => {
      expect(service.hasDateSignal('פגישה ב-15 למרץ')).toBe(true);
    });

    it('handles edge cases', () => {
      expect(service.hasDateSignal('5')).toBe(true);
      expect(service.hasDateSignal('abc1def')).toBe(true);
    });
  });

  // ─── extractDates ────────────────────────────────────────────────────────────

  describe('extractDates', () => {
    it('returns extracted dates when Gemini returns high-confidence results', async () => {
      mockedGenerateJson.mockResolvedValue({
        dates: [
          {
            title: 'Flight to Barcelona',
            date: '2026-03-20T10:00:00',
            confidence: 'high',
            isAllDay: false,
          },
        ],
      });

      const results = await service.extractDates('Flying to Barcelona on March 20', defaultContext);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Flight to Barcelona');
      expect(results[0].date).toBeInstanceOf(Date);
      expect(results[0].date.getFullYear()).toBe(2026);
      expect(results[0].confidence).toBe('high');
      expect(results[0].isAllDay).toBe(false);
    });

    it('filters out low/medium confidence results', async () => {
      mockedGenerateJson.mockResolvedValue({
        dates: [
          {
            title: 'Flight to Barcelona',
            date: '2026-03-20T10:00:00',
            confidence: 'high',
            isAllDay: false,
          },
          {
            title: 'Maybe lunch',
            date: '2026-03-21T12:00:00',
            confidence: 'medium',
            isAllDay: false,
          },
          {
            title: 'Vague reference',
            date: '2026-03-22T09:00:00',
            confidence: 'low',
            isAllDay: false,
          },
        ],
      });

      const results = await service.extractDates('Various mentions', defaultContext);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Flight to Barcelona');
    });

    it('returns empty array when Gemini returns null', async () => {
      mockedGenerateJson.mockResolvedValue(null);

      const results = await service.extractDates('Some text', defaultContext);

      expect(results).toEqual([]);
    });

    it('returns empty array when Gemini throws an error', async () => {
      mockedGenerateJson.mockRejectedValue(new Error('API error'));

      const results = await service.extractDates('Some text', defaultContext);

      expect(results).toEqual([]);
    });

    it('filters out invalid dates', async () => {
      mockedGenerateJson.mockResolvedValue({
        dates: [
          {
            title: 'Bad event',
            date: 'not-a-date',
            confidence: 'high',
            isAllDay: false,
          },
        ],
      });

      const results = await service.extractDates('Bad date text', defaultContext);

      expect(results).toEqual([]);
    });

    it('includes optional fields when present in Gemini response', async () => {
      mockedGenerateJson.mockResolvedValue({
        dates: [
          {
            title: 'Conference',
            date: '2026-04-15T09:00:00',
            confidence: 'high',
            location: 'Tel Aviv Convention Center',
            description: 'Annual tech conference',
            url: 'https://example.com/conference',
            isAllDay: false,
          },
        ],
      });

      const results = await service.extractDates('Conference on April 15', defaultContext);

      expect(results).toHaveLength(1);
      expect(results[0].location).toBe('Tel Aviv Convention Center');
      expect(results[0].description).toBe('Annual tech conference');
      expect(results[0].url).toBe('https://example.com/conference');
    });
  });
});

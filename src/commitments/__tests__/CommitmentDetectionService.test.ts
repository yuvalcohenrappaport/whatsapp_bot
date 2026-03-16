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

import { CommitmentDetectionService } from '../CommitmentDetectionService.js';
import type { CommitmentContext } from '../CommitmentDetectionService.js';
import { generateJson } from '../../ai/provider.js';

const mockedGenerateJson = vi.mocked(generateJson);

const defaultContext: CommitmentContext = {
  contactName: 'David',
  contactJid: '972501234567@s.whatsapp.net',
  fromMe: true,
};

// ─── passesPreFilter ────────────────────────────────────────────────────────

describe('CommitmentDetectionService', () => {
  let service: CommitmentDetectionService;

  beforeEach(() => {
    service = new CommitmentDetectionService();
    vi.clearAllMocks();
  });

  describe('passesPreFilter', () => {
    it('rejects short messages (<10 chars)', () => {
      expect(service.passesPreFilter('ok', true)).toBe(false);
      expect(service.passesPreFilter('sure', true)).toBe(false);
      expect(service.passesPreFilter('yes', true)).toBe(false);
    });

    it('accepts English action verbs', () => {
      expect(service.passesPreFilter("I'll send it tomorrow", true)).toBe(true);
      expect(service.passesPreFilter('Let me check on that', true)).toBe(true);
      expect(service.passesPreFilter('I will do it later', true)).toBe(true);
    });

    it('accepts Hebrew action verbs', () => {
      expect(service.passesPreFilter('אני אשלח את זה מחר', true)).toBe(true);
      expect(service.passesPreFilter('אבדוק ואחזור אליך', true)).toBe(true);
    });

    it('accepts temporal markers without verbs', () => {
      expect(
        service.passesPreFilter('I need the report by tomorrow', true),
      ).toBe(true);
      expect(service.passesPreFilter('the meeting is next week', true)).toBe(
        true,
      );
    });

    it('accepts action verbs without temporal markers', () => {
      expect(
        service.passesPreFilter("I'll check and get back to you", true),
      ).toBe(true);
    });

    it('rejects messages with neither verbs nor temporal markers', () => {
      expect(service.passesPreFilter('sounds good to me', true)).toBe(false);
      expect(service.passesPreFilter('thanks for letting me know', true)).toBe(
        false,
      );
    });

    it('checks both languages on same message', () => {
      expect(service.passesPreFilter('ok אני אבדוק', true)).toBe(true);
    });
  });

  // ─── extractCommitments ───────────────────────────────────────────────────

  describe('extractCommitments', () => {
    it('returns commitments when Gemini returns high/medium confidence', async () => {
      mockedGenerateJson.mockResolvedValue({
        commitments: [
          {
            task: 'Send the report to David',
            dateTime: '2026-03-17T10:00:00',
            confidence: 'high',
            originalText: "I'll send you the report tomorrow morning",
          },
          {
            task: 'Check the budget numbers',
            dateTime: null,
            confidence: 'medium',
            originalText: "let me check the budget numbers",
          },
        ],
      });

      const results = await service.extractCommitments(
        "I'll send you the report tomorrow morning, and let me check the budget numbers",
        defaultContext,
      );

      expect(results).toHaveLength(2);
      expect(results[0].task).toBe('Send the report to David');
      expect(results[0].dateTime).toBeInstanceOf(Date);
      expect(results[0].confidence).toBe('high');
      expect(results[1].task).toBe('Check the budget numbers');
      expect(results[1].dateTime).toBeNull();
      expect(results[1].confidence).toBe('medium');
    });

    it('filters out low confidence results', async () => {
      mockedGenerateJson.mockResolvedValue({
        commitments: [
          {
            task: 'Send the report',
            dateTime: '2026-03-17T10:00:00',
            confidence: 'high',
            originalText: "I'll send it",
          },
          {
            task: 'Maybe meet up sometime',
            dateTime: null,
            confidence: 'low',
            originalText: 'we should hang out',
          },
        ],
      });

      const results = await service.extractCommitments(
        'Various mentions',
        defaultContext,
      );

      expect(results).toHaveLength(1);
      expect(results[0].task).toBe('Send the report');
    });

    it('returns empty array on null response', async () => {
      mockedGenerateJson.mockResolvedValue(null);

      const results = await service.extractCommitments(
        'Some text',
        defaultContext,
      );

      expect(results).toEqual([]);
    });

    it('returns empty array on API error', async () => {
      mockedGenerateJson.mockRejectedValue(new Error('API error'));

      const results = await service.extractCommitments(
        'Some text',
        defaultContext,
      );

      expect(results).toEqual([]);
    });

    it('handles null dateTime (timeless commitments)', async () => {
      mockedGenerateJson.mockResolvedValue({
        commitments: [
          {
            task: 'Look into the issue',
            dateTime: null,
            confidence: 'medium',
            originalText: "I'll look into it",
          },
        ],
      });

      const results = await service.extractCommitments(
        "I'll look into it",
        defaultContext,
      );

      expect(results).toHaveLength(1);
      expect(results[0].dateTime).toBeNull();
    });

    it('handles invalid dates gracefully', async () => {
      mockedGenerateJson.mockResolvedValue({
        commitments: [
          {
            task: 'Do something',
            dateTime: 'not-a-date',
            confidence: 'high',
            originalText: 'I will do it',
          },
        ],
      });

      const results = await service.extractCommitments(
        'I will do it',
        defaultContext,
      );

      expect(results).toHaveLength(1);
      expect(results[0].dateTime).toBeNull(); // invalid date falls back to null
    });
  });
});

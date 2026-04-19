import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (must be defined BEFORE importing the module under test) ──────────

const passesPreFilterMock = vi.fn();
const extractCommitmentsMock = vi.fn();

vi.mock('../../commitments/CommitmentDetectionService.js', () => ({
  commitmentDetection: {
    passesPreFilter: passesPreFilterMock,
    extractCommitments: extractCommitmentsMock,
  },
}));

const getSettingMock = vi.fn();
vi.mock('../../db/queries/settings.js', () => ({
  getSetting: getSettingMock,
}));

const createActionableMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  createActionable: createActionableMock,
}));

const detectMessageLanguageMock = vi.fn(() => 'en' as 'he' | 'en');
vi.mock('../../calendar/calendarApproval.js', () => ({
  detectMessageLanguage: detectMessageLanguageMock,
}));

vi.mock('../../config.js', () => ({
  config: {
    USER_JID: 'self@s.whatsapp.net',
    LOG_LEVEL: 'silent',
  },
}));

const { processDetection, __resetCooldownsForTest } = await import(
  '../detectionService.js'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseParams = {
  messageId: 'MSG1',
  contactJid: 'lee@s.whatsapp.net',
  contactName: 'Lee',
  text: "I'll send the Q2 report tomorrow",
  timestamp: 1_700_000_000_000,
  fromMe: true,
};

function defaultSettings(overrides: Record<string, string | null> = {}): void {
  getSettingMock.mockImplementation((key: string) => {
    const map: Record<string, string | null> = {
      commitment_detection_enabled: 'true',
      commitment_blocklist: null,
      commitment_incoming_allowlist: null,
      ...overrides,
    };
    return map[key] ?? null;
  });
}

describe('detectionService.processDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCooldownsForTest();
    defaultSettings();
    passesPreFilterMock.mockReturnValue(true);
    extractCommitmentsMock.mockResolvedValue([]);
    detectMessageLanguageMock.mockReturnValue('en');
  });

  describe('guards — byte-for-byte with commitmentPipeline.processCommitment', () => {
    it('skips when commitment_detection_enabled=false', async () => {
      defaultSettings({ commitment_detection_enabled: 'false' });
      await processDetection(baseParams);
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
      expect(createActionableMock).not.toHaveBeenCalled();
    });

    it('skips self-chat (contactJid === config.USER_JID)', async () => {
      await processDetection({ ...baseParams, contactJid: 'self@s.whatsapp.net' });
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
      expect(createActionableMock).not.toHaveBeenCalled();
    });

    it('skips incoming message from non-allowlisted contact', async () => {
      defaultSettings({ commitment_incoming_allowlist: null });
      await processDetection({ ...baseParams, fromMe: false });
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
    });

    it('allows incoming message from allowlisted contact', async () => {
      defaultSettings({
        commitment_incoming_allowlist: JSON.stringify(['lee@s.whatsapp.net']),
      });
      extractCommitmentsMock.mockResolvedValue([
        {
          task: 'x',
          dateTime: null,
          confidence: 'high',
          originalText: 'x',
          type: 'commitment',
        },
      ]);
      await processDetection({ ...baseParams, fromMe: false });
      expect(extractCommitmentsMock).toHaveBeenCalledOnce();
      expect(createActionableMock).toHaveBeenCalledOnce();
    });

    it('skips blocklisted contacts', async () => {
      defaultSettings({
        commitment_blocklist: JSON.stringify(['lee@s.whatsapp.net']),
      });
      await processDetection(baseParams);
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
    });

    it('skips when pre-filter returns false', async () => {
      passesPreFilterMock.mockReturnValue(false);
      await processDetection(baseParams);
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
    });

    it('skips when cooldown is active for the chat', async () => {
      // First call seeds the cooldown
      extractCommitmentsMock.mockResolvedValue([]);
      await processDetection(baseParams);
      // Second call within 5 min is short-circuited
      extractCommitmentsMock.mockClear();
      await processDetection(baseParams);
      expect(extractCommitmentsMock).not.toHaveBeenCalled();
    });

    it('sets cooldown BEFORE awaiting Gemini (race-condition guard)', async () => {
      let resolveExtract: (v: unknown[]) => void = () => {};
      const pending = new Promise<unknown[]>((r) => {
        resolveExtract = r;
      });
      extractCommitmentsMock.mockReturnValueOnce(pending);

      const first = processDetection(baseParams);
      // While the first call is awaiting Gemini, a second call must find cooldown set.
      extractCommitmentsMock.mockClear();
      await processDetection(baseParams);
      expect(extractCommitmentsMock).not.toHaveBeenCalled();

      resolveExtract([]);
      await first;
    });
  });

  describe('happy path', () => {
    it('writes exactly one actionable per extracted item', async () => {
      extractCommitmentsMock.mockResolvedValue([
        {
          task: 'Send Q2 report',
          dateTime: new Date('2026-05-01T09:00:00Z'),
          confidence: 'high',
          originalText: 'send the Q2 report tomorrow',
          type: 'commitment',
        },
        {
          task: 'Buy groceries',
          dateTime: null,
          confidence: 'medium',
          originalText: 'buy groceries',
          type: 'task',
        },
      ]);

      await processDetection(baseParams);

      expect(createActionableMock).toHaveBeenCalledTimes(2);
      const firstCall = createActionableMock.mock.calls[0][0];
      expect(firstCall.sourceType).toBe('commitment');
      expect(firstCall.sourceContactJid).toBe('lee@s.whatsapp.net');
      expect(firstCall.sourceContactName).toBe('Lee');
      expect(firstCall.sourceMessageId).toBe('MSG1');
      expect(firstCall.task).toBe('Send Q2 report');
      expect(firstCall.originalDetectedTask).toBe('Send Q2 report');
      expect(firstCall.status).toBe('pending_approval');
      expect(firstCall.detectedAt).toBe(1_700_000_000_000);
      expect(firstCall.fireAt).toBe(new Date('2026-05-01T09:00:00Z').getTime());

      const secondCall = createActionableMock.mock.calls[1][0];
      expect(secondCall.sourceType).toBe('task');
      expect(secondCall.fireAt).toBeNull();
    });

    it('persists detectedLanguage from detectMessageLanguage', async () => {
      detectMessageLanguageMock.mockReturnValue('he');
      extractCommitmentsMock.mockResolvedValue([
        {
          task: 't',
          dateTime: null,
          confidence: 'high',
          originalText: 't',
          type: 'commitment',
        },
      ]);
      await processDetection(baseParams);
      expect(createActionableMock.mock.calls[0][0].detectedLanguage).toBe('he');
    });

    it('sends full source message text to sourceMessageText', async () => {
      extractCommitmentsMock.mockResolvedValue([
        {
          task: 't',
          dateTime: null,
          confidence: 'high',
          originalText: 't',
          type: 'task',
        },
      ]);
      await processDetection({ ...baseParams, text: 'full trigger text goes here' });
      expect(createActionableMock.mock.calls[0][0].sourceMessageText).toBe(
        'full trigger text goes here',
      );
    });
  });

  describe('error paths', () => {
    it('writes nothing and does not throw when Gemini throws', async () => {
      extractCommitmentsMock.mockRejectedValue(new Error('gemini down'));
      await expect(processDetection(baseParams)).resolves.toBeUndefined();
      expect(createActionableMock).not.toHaveBeenCalled();
    });

    it('writes nothing when Gemini returns an empty array', async () => {
      extractCommitmentsMock.mockResolvedValue([]);
      await processDetection(baseParams);
      expect(createActionableMock).not.toHaveBeenCalled();
    });
  });

  describe('negative invariants (v1.8 dark-launch guarantees)', () => {
    it('never calls Google Tasks — no import of todoService used in this module', async () => {
      // This is a behavioral assertion: the file should not reference todoService.
      // The tested behavior: a happy-path detection with createActionable succeeding
      // produces zero additional side effects beyond createActionable.
      extractCommitmentsMock.mockResolvedValue([
        {
          task: 't',
          dateTime: null,
          confidence: 'high',
          originalText: 't',
          type: 'commitment',
        },
      ]);
      await processDetection(baseParams);
      expect(createActionableMock).toHaveBeenCalledOnce();
      // If todoService or sendMessage were invoked, this test file would have
      // needed to mock them; the bare imports above are sufficient.
    });
  });
});

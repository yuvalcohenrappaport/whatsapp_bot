import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock collaborators BEFORE importing the router.
vi.mock('../../config.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

const getSettingMock = vi.fn();
vi.mock('../../db/queries/settings.js', () => ({
  getSetting: getSettingMock,
}));

const processCommitmentMock = vi.fn();
vi.mock('../../commitments/commitmentPipeline.js', () => ({
  processCommitment: processCommitmentMock,
}));

const processDetectionMock = vi.fn();
vi.mock('../detectionService.js', () => ({
  processDetection: processDetectionMock,
}));

const { routeDetection } = await import('../detectionRouter.js');

const baseParams = {
  messageId: 'MSG1',
  contactJid: 'lee@s.whatsapp.net',
  contactName: 'Lee',
  text: "I'll send the report tomorrow",
  timestamp: 1_700_000_000_000,
  fromMe: true,
};

describe('routeDetection (Phase 40 gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processCommitmentMock.mockResolvedValue(undefined);
    processDetectionMock.mockResolvedValue(undefined);
  });

  it('routes to processDetection when v1_8_detection_pipeline = dark_launch', () => {
    getSettingMock.mockReturnValue('dark_launch');
    routeDetection(baseParams);
    expect(processDetectionMock).toHaveBeenCalledOnce();
    expect(processDetectionMock).toHaveBeenCalledWith(baseParams);
    expect(processCommitmentMock).not.toHaveBeenCalled();
  });

  it('routes to processDetection when setting is null (default)', () => {
    getSettingMock.mockReturnValue(null);
    routeDetection(baseParams);
    expect(processDetectionMock).toHaveBeenCalledOnce();
    expect(processCommitmentMock).not.toHaveBeenCalled();
  });

  it('routes to processCommitment when setting = legacy', () => {
    getSettingMock.mockReturnValue('legacy');
    routeDetection(baseParams);
    expect(processCommitmentMock).toHaveBeenCalledOnce();
    expect(processCommitmentMock).toHaveBeenCalledWith(baseParams);
    expect(processDetectionMock).not.toHaveBeenCalled();
  });

  it('treats any unknown setting value as dark_launch (not legacy)', () => {
    getSettingMock.mockReturnValue('something_weird');
    routeDetection(baseParams);
    expect(processDetectionMock).toHaveBeenCalledOnce();
    expect(processCommitmentMock).not.toHaveBeenCalled();
  });

  it('swallows a processDetection rejection without crashing', async () => {
    getSettingMock.mockReturnValue('dark_launch');
    processDetectionMock.mockRejectedValueOnce(new Error('boom'));
    expect(() => routeDetection(baseParams)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  it('swallows a legacy processCommitment rejection without crashing', async () => {
    getSettingMock.mockReturnValue('legacy');
    processCommitmentMock.mockRejectedValueOnce(new Error('boom'));
    expect(() => routeDetection(baseParams)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before module-under-test import) ─────────────────────────

vi.mock('../../config.js', () => ({
  config: { USER_JID: 'self@s.whatsapp.net', LOG_LEVEL: 'silent' },
}));

const getSettingMock = vi.fn();
const setSettingMock = vi.fn();
vi.mock('../../db/queries/settings.js', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}));

const getPendingActionablesMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  getPendingActionables: getPendingActionablesMock,
}));

const sockMock = {
  sendMessage: vi.fn(),
};
const getStateMock = vi.fn(() => ({
  connection: 'connected',
  qr: null,
  sock: sockMock,
  botJid: null,
  botDisplayName: null,
  isShuttingDown: false,
}));
vi.mock('../../api/state.js', () => ({
  getState: getStateMock,
}));

const setFlushCallbackMock = vi.fn();
const enqueueForPreviewMock = vi.fn();
vi.mock('../debounceBuckets.js', () => ({
  setFlushCallback: setFlushCallbackMock,
  enqueueForPreview: enqueueForPreviewMock,
}));

const sendBucketPreviewMock = vi.fn();
vi.mock('../previewSender.js', () => ({
  sendBucketPreview: sendBucketPreviewMock,
}));

const startExpiryScanMock = vi.fn();
vi.mock('../expiryScan.js', () => ({
  startExpiryScan: startExpiryScanMock,
}));

const { initApprovalSystem, __resetInitializedForTest } = await import(
  '../approvalInit.js'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pending(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    sourceType: 'commitment',
    sourceContactJid: 'lee@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'MSG1',
    sourceMessageText: 'I will send the report',
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the report',
    task: 'Send the report',
    status: 'pending_approval',
    detectedAt: 1_700_000_000_000,
    fireAt: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    enrichedTitle: null,
    enrichedNote: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('initApprovalSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInitializedForTest();
    sockMock.sendMessage.mockResolvedValue({ key: { id: 'DIGEST-MSG-1' } });
    getStateMock.mockReturnValue({
      connection: 'connected',
      qr: null,
      sock: sockMock,
      botJid: null,
      botDisplayName: null,
      isShuttingDown: false,
    });
  });

  afterEach(() => {
    __resetInitializedForTest();
  });

  it('always wires the flush callback and starts the expiry scan', async () => {
    getSettingMock.mockReturnValue('true'); // digest already posted
    getPendingActionablesMock.mockReturnValue([]);

    await initApprovalSystem();

    expect(setFlushCallbackMock).toHaveBeenCalledOnce();
    expect(setFlushCallbackMock).toHaveBeenCalledWith(sendBucketPreviewMock);
    expect(startExpiryScanMock).toHaveBeenCalledOnce();
  });

  it('first call with pending rows + sock sends digest, flips both flags, enqueues backlog', async () => {
    getSettingMock.mockReturnValue('false'); // gate open

    const pendingRows = [
      pending('a-1', { detectedLanguage: 'en', sourceContactJid: 'lee@s.whatsapp.net' }),
      pending('a-2', { detectedLanguage: 'en', sourceContactJid: 'sam@s.whatsapp.net' }),
      pending('a-3', { detectedLanguage: 'en', sourceContactJid: 'lee@s.whatsapp.net' }),
    ];
    getPendingActionablesMock.mockReturnValue(pendingRows);

    await initApprovalSystem();

    // Digest sent to USER_JID in English (first pending row's language)
    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const [jid, payload] = sockMock.sendMessage.mock.calls[0];
    expect(jid).toBe('self@s.whatsapp.net');
    expect(payload.text).toContain('3');
    expect(payload.text).toContain('items are waiting for approval');

    // Backlog enqueued — one call per pending actionable with (id, sourceContactJid)
    expect(enqueueForPreviewMock).toHaveBeenCalledTimes(3);
    expect(enqueueForPreviewMock).toHaveBeenNthCalledWith(1, 'a-1', 'lee@s.whatsapp.net');
    expect(enqueueForPreviewMock).toHaveBeenNthCalledWith(2, 'a-2', 'sam@s.whatsapp.net');
    expect(enqueueForPreviewMock).toHaveBeenNthCalledWith(3, 'a-3', 'lee@s.whatsapp.net');

    // Both flags flipped atomically
    expect(setSettingMock).toHaveBeenCalledWith('v1_8_approval_digest_posted', 'true');
    expect(setSettingMock).toHaveBeenCalledWith('v1_8_detection_pipeline', 'interactive');
  });

  it('first call with Hebrew most-recent pending sends Hebrew digest', async () => {
    getSettingMock.mockReturnValue('false');
    getPendingActionablesMock.mockReturnValue([
      pending('a-1', { detectedLanguage: 'he' }),
    ]);

    await initApprovalSystem();

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const payload = sockMock.sendMessage.mock.calls[0][1];
    expect(payload.text).toContain('1');
    expect(payload.text).toContain('פריטים');
    expect(payload.text).toContain('ממתינים לאישור');
  });

  it('no pending actionables → does not send digest but still flips flags', async () => {
    getSettingMock.mockReturnValue('false');
    getPendingActionablesMock.mockReturnValue([]);

    await initApprovalSystem();

    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(enqueueForPreviewMock).not.toHaveBeenCalled();
    // Flags still flip — empty backlog is a terminal success.
    expect(setSettingMock).toHaveBeenCalledWith('v1_8_approval_digest_posted', 'true');
    expect(setSettingMock).toHaveBeenCalledWith('v1_8_detection_pipeline', 'interactive');
  });

  it('digest flag already true → skips digest entirely (no send, no flip, no enqueue)', async () => {
    getSettingMock.mockReturnValue('true'); // gate closed
    getPendingActionablesMock.mockReturnValue([pending('a-1')]);

    await initApprovalSystem();

    expect(getPendingActionablesMock).not.toHaveBeenCalled();
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(enqueueForPreviewMock).not.toHaveBeenCalled();
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('sock missing → returns without sending or flipping flags (retries next boot)', async () => {
    getSettingMock.mockReturnValue('false');
    getPendingActionablesMock.mockReturnValue([pending('a-1')]);
    getStateMock.mockReturnValue({
      connection: 'disconnected',
      qr: null,
      sock: null,
      botJid: null,
      botDisplayName: null,
      isShuttingDown: false,
    });

    await initApprovalSystem();

    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(enqueueForPreviewMock).not.toHaveBeenCalled();
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('sendMessage rejection → flags NOT flipped (so next boot retries)', async () => {
    getSettingMock.mockReturnValue('false');
    getPendingActionablesMock.mockReturnValue([pending('a-1')]);
    sockMock.sendMessage.mockRejectedValueOnce(new Error('network down'));

    await initApprovalSystem();

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    // backlog not enqueued because the digest failed
    expect(enqueueForPreviewMock).not.toHaveBeenCalled();
    // no flag flip — retry on next boot
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('second call (already initialized in-process) skips digest but re-registers callback + scan', async () => {
    getSettingMock.mockReturnValue('false');
    getPendingActionablesMock.mockReturnValue([]);

    // First call runs the digest path.
    await initApprovalSystem();
    vi.clearAllMocks();
    sockMock.sendMessage.mockResolvedValue({ key: { id: 'DIGEST-MSG-2' } });

    // Second call is the reconnect path.
    await initApprovalSystem();

    // Callback + scan always re-registered.
    expect(setFlushCallbackMock).toHaveBeenCalledOnce();
    expect(startExpiryScanMock).toHaveBeenCalledOnce();

    // Digest NOT re-fired.
    expect(getSettingMock).not.toHaveBeenCalled();
    expect(getPendingActionablesMock).not.toHaveBeenCalled();
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(setSettingMock).not.toHaveBeenCalled();
  });
});

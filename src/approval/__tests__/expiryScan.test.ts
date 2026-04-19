import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before module-under-test import) ─────────────────────────

vi.mock('../../config.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

const getExpiredActionablesMock = vi.fn();
const updateActionableStatusMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  getExpiredActionables: getExpiredActionablesMock,
  updateActionableStatus: updateActionableStatusMock,
}));

const { runOnce, startExpiryScan, stopExpiryScan } = await import(
  '../expiryScan.js'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pendingRow(id: string, detectedAt: number) {
  return {
    id,
    sourceType: 'commitment',
    sourceContactJid: 'lee@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'MSG1',
    sourceMessageText: 'I will send the report tomorrow',
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the report',
    task: 'Send the report',
    status: 'pending_approval',
    detectedAt,
    fireAt: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: null,
    enrichedTitle: null,
    enrichedNote: null,
    createdAt: detectedAt,
    updatedAt: detectedAt,
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─── runOnce ─────────────────────────────────────────────────────────────────

describe('runOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips every expired pending row to "expired" and returns the count', async () => {
    const now = Date.now();
    const old = now - SEVEN_DAYS_MS - 60_000; // comfortably past 7 days
    getExpiredActionablesMock.mockReturnValue([
      pendingRow('a-1', old),
      pendingRow('a-2', old),
      pendingRow('a-3', old),
    ]);

    const count = await runOnce();

    expect(count).toBe(3);
    expect(updateActionableStatusMock).toHaveBeenCalledTimes(3);
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(1, 'a-1', 'expired');
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(2, 'a-2', 'expired');
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(3, 'a-3', 'expired');
  });

  it('returns 0 and flips nothing when no expired rows exist', async () => {
    getExpiredActionablesMock.mockReturnValue([]);

    const count = await runOnce();

    expect(count).toBe(0);
    expect(updateActionableStatusMock).not.toHaveBeenCalled();
  });

  it('swallows a transition error mid-batch and continues with the rest', async () => {
    const now = Date.now();
    const old = now - SEVEN_DAYS_MS - 60_000;
    getExpiredActionablesMock.mockReturnValue([
      pendingRow('a-1', old),
      pendingRow('a-bad', old),
      pendingRow('a-3', old),
    ]);
    updateActionableStatusMock.mockImplementation((id: string) => {
      if (id === 'a-bad') throw new Error('invalid transition');
    });

    const count = await runOnce();

    // 2 succeeded, 1 threw — count reflects only successes, but the batch
    // keeps going so a-3 still lands.
    expect(count).toBe(2);
    expect(updateActionableStatusMock).toHaveBeenCalledTimes(3);
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(1, 'a-1', 'expired');
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(2, 'a-bad', 'expired');
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(3, 'a-3', 'expired');
  });

  it('passes now - 7 days as the cutoff to getExpiredActionables', async () => {
    getExpiredActionablesMock.mockReturnValue([]);
    const before = Date.now();
    await runOnce();
    const after = Date.now();

    expect(getExpiredActionablesMock).toHaveBeenCalledOnce();
    const cutoff = getExpiredActionablesMock.mock.calls[0][0];
    expect(cutoff).toBeGreaterThanOrEqual(before - SEVEN_DAYS_MS);
    expect(cutoff).toBeLessThanOrEqual(after - SEVEN_DAYS_MS);
  });
});

// ─── startExpiryScan ─────────────────────────────────────────────────────────

describe('startExpiryScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    getExpiredActionablesMock.mockReturnValue([]);
  });

  afterEach(() => {
    stopExpiryScan();
    vi.useRealTimers();
  });

  it('fires runOnce immediately on start so restart picks up stale expiries', () => {
    startExpiryScan(60_000);

    // Initial fire is synchronous — getExpiredActionables should have been
    // called at least once before any timer advances.
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(1);
  });

  it('runs repeatedly on the configured interval', async () => {
    startExpiryScan(60_000);
    // initial fire
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(3);
  });

  it('is idempotent — a second call clears the previous interval (no leak)', async () => {
    startExpiryScan(60_000);
    // initial fire #1
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(1);

    // Second startExpiryScan should clear the first interval AND fire an
    // immediate initial runOnce for the new one.
    startExpiryScan(60_000);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(2);

    // Advance one interval — only ONE timer should fire (the new one),
    // not both. So the count goes to 3, not 4.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(3);
  });

  it('stopExpiryScan halts further runs', async () => {
    startExpiryScan(60_000);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(1);

    stopExpiryScan();

    await vi.advanceTimersByTimeAsync(60_000 * 5);
    expect(getExpiredActionablesMock).toHaveBeenCalledTimes(1); // unchanged
  });
});

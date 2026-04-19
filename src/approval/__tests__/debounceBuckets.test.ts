import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Silence pino during tests — must be mocked before importing the module.
vi.mock('../../config.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

const {
  enqueueForPreview,
  setFlushCallback,
  __resetBucketsForTest,
  __getBucketForTest,
} = await import('../debounceBuckets.js');

const DEBOUNCE_MS = 2 * 60 * 1000;

describe('debounceBuckets — enqueueForPreview + flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetBucketsForTest();
  });

  afterEach(() => {
    __resetBucketsForTest();
    vi.useRealTimers();
  });

  it('flushes the bucket once after DEBOUNCE_MS with the enqueued ids', async () => {
    const flush = vi.fn();
    setFlushCallback(flush);

    enqueueForPreview('a-1', 'lee@s.whatsapp.net');
    enqueueForPreview('a-2', 'lee@s.whatsapp.net');

    // Not yet — timer hasn't fired.
    expect(flush).not.toHaveBeenCalled();
    expect(__getBucketForTest('lee@s.whatsapp.net')?.actionableIds).toEqual([
      'a-1',
      'a-2',
    ]);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['a-1', 'a-2']);
    // Bucket cleared after flush.
    expect(__getBucketForTest('lee@s.whatsapp.net')).toBeUndefined();
  });

  it('resets the debounce timer on every enqueue — flush fires 2 min after the LAST add', async () => {
    const flush = vi.fn();
    setFlushCallback(flush);

    enqueueForPreview('a-1', 'lee@s.whatsapp.net');
    // Advance almost to the edge of the first window.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 10_000);
    expect(flush).not.toHaveBeenCalled();

    // New enqueue resets the timer.
    enqueueForPreview('a-2', 'lee@s.whatsapp.net');
    // Advancing by the original remaining 10s should NOT trigger flush yet.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(flush).not.toHaveBeenCalled();

    // But advancing by another full window from the second enqueue should.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['a-1', 'a-2']);
  });

  it('flush fires exactly once per bucket even after many enqueues', async () => {
    const flush = vi.fn();
    setFlushCallback(flush);

    for (let i = 0; i < 5; i++) {
      enqueueForPreview(`a-${i}`, 'lee@s.whatsapp.net');
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['a-0', 'a-1', 'a-2', 'a-3', 'a-4']);
  });

  it('maintains independent buckets for different sourceContactJids', async () => {
    const flush = vi.fn();
    setFlushCallback(flush);

    enqueueForPreview('lee-1', 'lee@s.whatsapp.net');
    await vi.advanceTimersByTimeAsync(60_000);
    enqueueForPreview('jo-1', 'jo@s.whatsapp.net');

    // After another DEBOUNCE_MS from lee's only enqueue (so lee's window
    // closes first by exactly 60_000 ms).
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 60_000);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['lee-1']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith(['jo-1']);
  });

  it('accepts async flush callbacks without crashing', async () => {
    let settled = false;
    let receivedIds: string[] | null = null;
    setFlushCallback(async (ids) => {
      receivedIds = [...ids];
      settled = true;
    });

    enqueueForPreview('a-1', 'lee@s.whatsapp.net');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // Flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(receivedIds).toEqual(['a-1']);
  });

  it('callback errors are swallowed — subsequent buckets still fire', async () => {
    const good = vi.fn();
    let call = 0;
    setFlushCallback((ids) => {
      call += 1;
      if (call === 1) throw new Error('boom');
      good(ids);
    });

    enqueueForPreview('bad-1', 'chat-a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // No throw — the bot continues.
    enqueueForPreview('good-1', 'chat-b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(good).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledWith(['good-1']);
  });

  it('no-op when no flush callback is registered (ids dropped silently)', async () => {
    // __resetBucketsForTest already cleared the callback.
    enqueueForPreview('a-1', 'lee@s.whatsapp.net');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // Drain any lingering microtasks scheduled by flush().
    await Promise.resolve();
    await Promise.resolve();
    // Bucket has been deleted regardless of whether a callback ran.
    expect(__getBucketForTest('lee@s.whatsapp.net')).toBeUndefined();
  });
});

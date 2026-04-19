import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must be hoisted before module-under-test import) ─────────────────

vi.mock('../../config.js', () => ({
  config: { USER_JID: 'self@s.whatsapp.net', LOG_LEVEL: 'silent' },
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

const getActionableByIdMock = vi.fn();
const updateActionablePreviewMsgIdMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  getActionableById: getActionableByIdMock,
  updateActionablePreviewMsgId: updateActionablePreviewMsgIdMock,
}));

// Use the real composePreview so the exact wire format is asserted.
const { sendBucketPreview } = await import('../previewSender.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionable(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a-1',
    sourceType: 'commitment',
    sourceContactJid: 'lee@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'MSG1',
    sourceMessageText: "I'll send you the Q2 report tomorrow morning",
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the Q2 report to Lee',
    task: 'Send the Q2 report to Lee',
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

describe('sendBucketPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockMock.sendMessage.mockResolvedValue({ key: { id: 'PREVIEW-MSG-1' } });
    getStateMock.mockReturnValue({
      connection: 'connected',
      qr: null,
      sock: sockMock,
      botJid: null,
      botDisplayName: null,
      isShuttingDown: false,
    });
  });

  it('no-op when the id list is empty', async () => {
    await sendBucketPreview([]);
    expect(getActionableByIdMock).not.toHaveBeenCalled();
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });

  it('no-op when all ids resolve to missing actionables', async () => {
    getActionableByIdMock.mockReturnValue(undefined);
    await sendBucketPreview(['ghost-1', 'ghost-2']);
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });

  it('no-op when every actionable has already been acted on (non-pending)', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id, status: 'approved' }),
    );
    await sendBucketPreview(['a-1', 'a-2']);
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });

  it('drops non-pending stragglers but sends the rest', async () => {
    getActionableByIdMock.mockImplementation((id: string) => {
      if (id === 'a-2') return actionable({ id: 'a-2', status: 'approved', task: 'gone' });
      return actionable({ id, task: id === 'a-1' ? 'Task A' : 'Task B' });
    });

    await sendBucketPreview(['a-1', 'a-2', 'a-3']);

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const [jid, payload] = sockMock.sendMessage.mock.calls[0];
    expect(jid).toBe('self@s.whatsapp.net');
    // 2 items remain — batched layout
    expect(payload.text).toMatch(/📝 2 items from Lee:/);
    expect(payload.text).toContain('1. Task A');
    expect(payload.text).toContain('2. Task B');
    expect(payload.text).not.toContain('gone');

    // Preview-msg-id written only to the two pending items.
    expect(updateActionablePreviewMsgIdMock).toHaveBeenCalledTimes(2);
    expect(updateActionablePreviewMsgIdMock).toHaveBeenCalledWith(
      'a-1',
      'PREVIEW-MSG-1',
    );
    expect(updateActionablePreviewMsgIdMock).toHaveBeenCalledWith(
      'a-3',
      'PREVIEW-MSG-1',
    );
  });

  it('single-item: composes 4-line layout and annotates the actionable', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id }),
    );

    await sendBucketPreview(['a-1']);

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const [jid, payload] = sockMock.sendMessage.mock.calls[0];
    expect(jid).toBe('self@s.whatsapp.net');
    // Single-item layout carries the 4 canonical lines.
    expect(payload.text).toContain('📝 Send the Q2 report to Lee');
    expect(payload.text).toContain('👤 Lee');
    expect(payload.text).toContain('💬 "I\'ll send you the Q2 report tomorrow morning"');
    expect(payload.text).toContain('Reply ✅ / ❌ / edit: <text>');
    // Should NOT contain batched hint.
    expect(payload.text).not.toMatch(/items from/);

    expect(updateActionablePreviewMsgIdMock).toHaveBeenCalledOnce();
    expect(updateActionablePreviewMsgIdMock).toHaveBeenCalledWith(
      'a-1',
      'PREVIEW-MSG-1',
    );
  });

  it('batched: composes HE layout when detectedLanguage is he', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({
        id,
        detectedLanguage: 'he',
        sourceContactName: 'לי',
        task: id === 'a-1' ? 'לשלוח דוח' : 'להתקשר לרו"ח',
        sourceMessageText: 'טקסט מקור',
      }),
    );

    await sendBucketPreview(['a-1', 'a-2']);

    const [, payload] = sockMock.sendMessage.mock.calls[0];
    expect(payload.text).toMatch(/📝 2 פריטים מ-לי:/);
    expect(payload.text).toContain('1. לשלוח דוח');
    expect(payload.text).toContain('2. להתקשר לרו"ח');
    expect(payload.text).toContain('השב:');
  });

  it('truncates long source message text to 100 chars with an ellipsis', async () => {
    const longText = 'a'.repeat(150);
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id, sourceMessageText: longText }),
    );

    await sendBucketPreview(['a-1']);

    const [, payload] = sockMock.sendMessage.mock.calls[0];
    // The snippet line must contain 100 a's followed by the ellipsis.
    expect(payload.text).toContain('💬 "' + 'a'.repeat(100) + '…"');
  });

  it('uses null contactName for the batch header when source has no name', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({
        id,
        sourceContactName: null,
        task: `task-${id}`,
      }),
    );

    await sendBucketPreview(['a-1', 'a-2']);

    const [, payload] = sockMock.sendMessage.mock.calls[0];
    expect(payload.text).toMatch(/📝 2 items:/);
    expect(payload.text).not.toContain('from ');
  });

  it('warns and is a no-op when sock is null', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id }),
    );
    getStateMock.mockReturnValue({
      connection: 'disconnected',
      qr: null,
      sock: null,
      botJid: null,
      botDisplayName: null,
      isShuttingDown: false,
    });

    await sendBucketPreview(['a-1']);

    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });

  it('skips annotation when sendMessage returns no key.id', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id }),
    );
    sockMock.sendMessage.mockResolvedValue({ key: {} });

    await sendBucketPreview(['a-1']);

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });

  it('swallows sendMessage errors without throwing', async () => {
    getActionableByIdMock.mockImplementation((id: string) =>
      actionable({ id }),
    );
    sockMock.sendMessage.mockRejectedValue(new Error('net down'));

    await expect(sendBucketPreview(['a-1'])).resolves.toBeUndefined();
    expect(updateActionablePreviewMsgIdMock).not.toHaveBeenCalled();
  });
});

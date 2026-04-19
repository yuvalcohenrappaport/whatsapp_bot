import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must be hoisted before module-under-test import) ─────────────────

vi.mock('../../config.js', () => ({
  config: { USER_JID: 'self@s.whatsapp.net', LOG_LEVEL: 'silent' },
}));

const getActionablesByPreviewMsgIdMock = vi.fn();
const updateActionableStatusMock = vi.fn();
const updateActionableTaskMock = vi.fn();
const updateActionableEnrichmentMock = vi.fn();
const updateActionableTodoIdsMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  getActionablesByPreviewMsgId: getActionablesByPreviewMsgIdMock,
  updateActionableStatus: updateActionableStatusMock,
  updateActionableTask: updateActionableTaskMock,
  updateActionableEnrichment: updateActionableEnrichmentMock,
  updateActionableTodoIds: updateActionableTodoIdsMock,
}));

const createTodoTaskMock = vi.fn();
vi.mock('../../todo/todoService.js', () => ({
  createTodoTask: createTodoTaskMock,
}));

const isTasksConnectedMock = vi.fn(() => true);
vi.mock('../../todo/todoAuthService.js', () => ({
  isTasksConnected: isTasksConnectedMock,
}));

const enrichActionableMock = vi.fn();
vi.mock('../enrichmentService.js', () => ({
  enrichActionable: enrichActionableMock,
}));

// Use the REAL replyParser so the grammar is end-to-end asserted.
const { tryHandleApprovalReply } = await import('../approvalHandler.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ActionableOverrides {
  id?: string;
  task?: string;
  status?: string;
  detectedLanguage?: 'he' | 'en';
  sourceContactName?: string | null;
  sourceContactJid?: string;
  sourceMessageText?: string;
}

function actionable(overrides: ActionableOverrides = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    sourceType: 'commitment',
    sourceContactJid: 'lee@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'MSG1',
    sourceMessageText: "I'll send you the Q2 report tomorrow",
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the Q2 report to Lee',
    task: 'Send the Q2 report to Lee',
    status: 'pending_approval',
    detectedAt: 1_700_000_000_000,
    fireAt: null,
    enrichedTitle: null,
    enrichedNote: null,
    todoTaskId: null,
    todoListId: null,
    approvalPreviewMessageId: 'PREVIEW-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function sockMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'REPLY-OK' } }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('tryHandleApprovalReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTasksConnectedMock.mockReturnValue(true);
    createTodoTaskMock.mockResolvedValue({ taskId: 'T-NEW', listId: 'L-1' });
    // Default: enrichActionable returns fallback shape (title = task, basic note).
    // Per-test cases that need custom enrichment override this.
    enrichActionableMock.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({
        title: a['task'] as string,
        note: `From: ${(a['sourceContactName'] as string | null) ?? 'Self'}`,
      }),
    );
  });

  // ── Unknown quoted-msg-id falls through ──
  it('returns false when the quoted msg id matches no actionable', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '✅',
      'UNKNOWN-PREVIEW',
      'en',
    );

    expect(handled).toBe(false);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(updateActionableStatusMock).not.toHaveBeenCalled();
  });

  // ── Bulk approve on a 2-item batch ──
  it('bulk ✅ on a 2-item batch approves both + syncs both + 2 confirmations', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
      actionable({ id: 'a-2', task: 'Task B' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledTimes(2);
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(1, 'a-1', 'approved');
    expect(updateActionableStatusMock).toHaveBeenNthCalledWith(2, 'a-2', 'approved');
    expect(createTodoTaskMock).toHaveBeenCalledTimes(2);
    expect(createTodoTaskMock.mock.calls[0][0].title).toBe('Task A');
    expect(createTodoTaskMock.mock.calls[1][0].title).toBe('Task B');
    expect(updateActionableTodoIdsMock).toHaveBeenCalledTimes(2);
    // 2 confirmations back to the owner.
    const texts = sock.sendMessage.mock.calls.map(
      (c: [string, { text: string }]) => c[1].text,
    );
    expect(texts).toEqual(['✅ Added: Task A', '✅ Added: Task B']);
  });

  // ── Per-item mixed directives ──
  it('1 ✅ 2 ❌ approves item 1 and rejects item 2', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
      actionable({ id: 'a-2', task: 'Task B' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅ 2 ❌',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-2', 'rejected');
    expect(createTodoTaskMock).toHaveBeenCalledOnce();
    expect(createTodoTaskMock.mock.calls[0][0].title).toBe('Task A');
    const texts = sock.sendMessage.mock.calls.map(
      (c: [string, { text: string }]) => c[1].text,
    );
    expect(texts).toEqual(['✅ Added: Task A', '❌ Dismissed']);
  });

  // ── Edit falls through to approve with the edited title ──
  it('1 edit: <new> rewrites task then approves + syncs with the new title', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Old title' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 edit: Send finalized Q2 report',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableTaskMock).toHaveBeenCalledWith(
      'a-1',
      'Send finalized Q2 report',
    );
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    expect(createTodoTaskMock).toHaveBeenCalledOnce();
    expect(createTodoTaskMock.mock.calls[0][0].title).toBe(
      'Send finalized Q2 report',
    );
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      '✅ Added: Send finalized Q2 report',
    );
  });

  // ── Unparseable → grammar hint ──
  it('unparseable reply sends the EN grammar hint and returns true', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      'banana',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).not.toHaveBeenCalled();
    expect(updateActionableTaskMock).not.toHaveBeenCalled();
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      'Reply ✅ / ❌ / edit: <text> (or number + action for a specific item)',
    );
  });

  // ── Already-handled item warning ──
  it('approving an already-approved item emits a warning + no mutation', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', status: 'approved', task: 'Task A' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).not.toHaveBeenCalled();
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      '⚠️ Item 1 already handled (approved) — skipped.',
    );
  });

  // ── HE approve ──
  it('HE reply `1 אישור` on a HE actionable approves + sends the HE confirmation', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({
        id: 'a-1',
        detectedLanguage: 'he',
        task: 'לשלוח דוח Q2',
      }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 אישור',
      'PREVIEW-1',
      'he',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      '✅ נוסף: לשלוח דוח Q2',
    );
  });

  // ── HE unparseable → HE grammar hint ──
  it('unparseable HE reply on a HE actionable sends the HE grammar hint', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', detectedLanguage: 'he' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      'בננה',
      'PREVIEW-1',
      'he',
    );

    expect(handled).toBe(true);
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      'השב ✅ / ❌ / עריכה: <טקסט> (או מספר + פעולה עבור פריט ספציפי)',
    );
  });

  // ── Idempotency: same directive processed twice across 2 calls ──
  it('double-approve across two calls: second call sees approved status → warns, no re-sync', async () => {
    // First call: pending → approves.
    const first = actionable({ id: 'a-1', task: 'Task A' });
    getActionablesByPreviewMsgIdMock.mockReturnValueOnce([first]);
    const sock = sockMock();

    await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    expect(createTodoTaskMock).toHaveBeenCalledOnce();

    // Second call: DB now returns it already 'approved' (we mock that).
    getActionablesByPreviewMsgIdMock.mockReturnValueOnce([
      { ...first, status: 'approved' },
    ]);
    sock.sendMessage.mockClear();
    createTodoTaskMock.mockClear();
    updateActionableStatusMock.mockClear();

    await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );
    expect(updateActionableStatusMock).not.toHaveBeenCalled();
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe(
      '⚠️ Item 1 already handled (approved) — skipped.',
    );
  });

  // ── createTodoTask throws → status still flipped, enrichment persisted, no crash ──
  it('Google Tasks push failure still flips status to approved, persists enrichment, and sends confirmation', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
    ]);
    createTodoTaskMock.mockRejectedValue(new Error('quota exceeded'));
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    // Enrichment persisted BEFORE createTodoTask was attempted.
    expect(updateActionableEnrichmentMock).toHaveBeenCalledOnce();
    expect(createTodoTaskMock).toHaveBeenCalledOnce();
    expect(updateActionableTodoIdsMock).not.toHaveBeenCalled();
    // Confirmation still sent even when sync failed.
    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe('✅ Added: Task A');
  });

  // ── Tasks not connected → still flips + confirms, no sync attempt ──
  it('when Google Tasks is not connected, approve still flips status + confirms', async () => {
    isTasksConnectedMock.mockReturnValue(false);
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    expect(updateActionableTodoIdsMock).not.toHaveBeenCalled();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe('✅ Added: Task A');
  });

  // ── Last-wins dedupe: `1 ✅ 1 ❌` rejects item 1 ──
  it('duplicate item indices dedupe last-wins: `1 ✅ 1 ❌` rejects', async () => {
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅ 1 ❌',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableStatusMock).toHaveBeenCalledOnce();
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'rejected');
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    expect(sock.sendMessage.mock.calls[0][1].text).toBe('❌ Dismissed');
  });

  // ── Note body includes contact name + original text snippet ──
  it('Google Tasks note carries From + Original snippet from the source message', async () => {
    const enrichedNote = 'Contact: Lee\nOriginal: "Hey can you send the Q2 report tomorrow?"';
    enrichActionableMock.mockResolvedValue({ title: 'Task A', note: enrichedNote });
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({
        id: 'a-1',
        task: 'Task A',
        sourceContactName: 'Lee',
        sourceMessageText: 'Hey can you send the Q2 report tomorrow?',
      }),
    ]);
    const sock = sockMock();

    await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(createTodoTaskMock).toHaveBeenCalledOnce();
    const note = createTodoTaskMock.mock.calls[0][0].note;
    expect(note).toContain('Lee');
    expect(note).toContain('Hey can you send the Q2 report tomorrow?');
  });

  // ── Enrichment returns custom title → createTodoTask receives enriched values ──
  it('enrichment returns custom title → createTodoTask and updateActionableEnrichment receive enriched values', async () => {
    const enrichedTitle = 'Follow up with Lee on Q2 report by Monday';
    const enrichedNote = 'Contact: Lee\nOriginal: "Check it"\nContext: Lee asked about Q2';
    enrichActionableMock.mockResolvedValue({ title: enrichedTitle, note: enrichedNote });
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Check it', sourceContactName: 'Lee' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    expect(updateActionableEnrichmentMock).toHaveBeenCalledWith('a-1', {
      title: enrichedTitle,
      note: enrichedNote,
    });
    expect(createTodoTaskMock).toHaveBeenCalledWith({
      title: enrichedTitle,
      note: enrichedNote,
    });
    // Confirmation still uses actionable.task (not enriched title).
    expect(sock.sendMessage.mock.calls[0][1].text).toBe('✅ Added: Check it');
  });

  // ── Enrichment persists even when Google Tasks disconnected ──
  it('enrichment persists updateActionableEnrichment even when Google Tasks disconnected', async () => {
    isTasksConnectedMock.mockReturnValue(false);
    const enrichedTitle = 'Custom enriched title';
    const enrichedNote = 'Contact: Lee\nOriginal: "Task A"';
    enrichActionableMock.mockResolvedValue({ title: enrichedTitle, note: enrichedNote });
    getActionablesByPreviewMsgIdMock.mockReturnValue([
      actionable({ id: 'a-1', task: 'Task A' }),
    ]);
    const sock = sockMock();

    const handled = await tryHandleApprovalReply(
      sock as never,
      '1 ✅',
      'PREVIEW-1',
      'en',
    );

    expect(handled).toBe(true);
    // Status flipped.
    expect(updateActionableStatusMock).toHaveBeenCalledWith('a-1', 'approved');
    // Enrichment persisted even without Tasks.
    expect(updateActionableEnrichmentMock).toHaveBeenCalledWith('a-1', {
      title: enrichedTitle,
      note: enrichedNote,
    });
    // createTodoTask NOT called when Tasks disconnected.
    expect(createTodoTaskMock).not.toHaveBeenCalled();
    // Confirmation still sent.
    expect(sock.sendMessage.mock.calls[0][1].text).toBe('✅ Added: Task A');
  });
});

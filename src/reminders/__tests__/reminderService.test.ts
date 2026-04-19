import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before module-under-test import) ─────────────────────────

vi.mock('../../config.js', () => ({
  config: { USER_JID: 'self@s.whatsapp.net', LOG_LEVEL: 'silent' },
}));

const hasReminderIntentMock = vi.fn();
const parseReminderCommandMock = vi.fn();
const matchReminderForCancelEditMock = vi.fn();
vi.mock('../reminderParser.js', () => ({
  hasReminderIntent: hasReminderIntentMock,
  parseReminderCommand: parseReminderCommandMock,
  matchReminderForCancelEdit: matchReminderForCancelEditMock,
}));

const scheduleReminderMock = vi.fn();
const cancelScheduledReminderMock = vi.fn();
const startHourlyScanMock = vi.fn();
const scheduleAllUpcomingMock = vi.fn();
vi.mock('../reminderScheduler.js', () => ({
  scheduleReminder: scheduleReminderMock,
  cancelScheduledReminder: cancelScheduledReminderMock,
  startHourlyScan: startHourlyScanMock,
  scheduleAllUpcoming: scheduleAllUpcomingMock,
}));

const insertReminderMock = vi.fn();
vi.mock('../../db/queries/reminders.js', () => ({
  insertReminder: insertReminderMock,
  getReminderById: vi.fn(),
  getPendingReminders: vi.fn(),
  getPendingOverdue: vi.fn(),
  updateReminderStatus: vi.fn(),
  updateReminderCalendarEventId: vi.fn(),
  updateReminderFireAt: vi.fn(),
  updateReminderTask: vi.fn(),
  updateReminderTodoIds: vi.fn(),
}));

vi.mock('../../calendar/personalCalendarService.js', () => ({
  createPersonalCalendarEvent: vi.fn(),
  getSelectedCalendarId: vi.fn().mockReturnValue(null),
}));

vi.mock('../../todo/todoService.js', () => ({
  createTodoTask: vi.fn().mockResolvedValue({ taskId: 't-1', listId: 'l-1' }),
  deleteTodoTask: vi.fn(),
}));

vi.mock('../../todo/todoAuthService.js', () => ({
  isTasksConnected: vi.fn().mockReturnValue(false),
}));

vi.mock('../../api/state.js', () => ({
  getState: vi.fn(() => ({ sock: null })),
}));

const createActionableMock = vi.fn();
vi.mock('../../db/queries/actionables.js', () => ({
  createActionable: createActionableMock,
}));

const detectMessageLanguageMock = vi.fn(() => 'en' as 'he' | 'en');
vi.mock('../../calendar/calendarApproval.js', () => ({
  detectMessageLanguage: detectMessageLanguageMock,
}));

const { tryHandleReminder } = await import('../reminderService.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sockStub = {
  sendMessage: vi.fn().mockResolvedValue({ key: { id: 'OUT-1' } }),
} as unknown as Parameters<typeof tryHandleReminder>[0];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('tryHandleReminder — user_command dual-write (Phase 41 DETC-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sockStub as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage =
      vi.fn().mockResolvedValue({ key: { id: 'OUT-1' } });
  });

  it('set intent writes BOTH reminders row AND approved user_command actionable', async () => {
    hasReminderIntentMock.mockReturnValue(true);
    // 1 hour in the future so we take the in-day scheduleReminder path (no
    // calendar branch)
    const fireAt = Date.now() + 60 * 60 * 1000;
    parseReminderCommandMock.mockResolvedValue({
      intent: 'set',
      task: 'call the dentist',
      dateTime: new Date(fireAt).toISOString(),
    });

    const handled = await tryHandleReminder(
      sockStub,
      'remind me to call the dentist in 1 hour',
    );

    expect(handled).toBe(true);

    // Legacy reminders row written.
    expect(insertReminderMock).toHaveBeenCalledOnce();
    const insertedReminder = insertReminderMock.mock.calls[0][0];
    expect(insertedReminder.task).toBe('call the dentist');

    // Actionables dual-write happened.
    expect(createActionableMock).toHaveBeenCalledOnce();
    const actionable = createActionableMock.mock.calls[0][0];
    expect(actionable.id).toBe(`user_cmd_${insertedReminder.id}`);
    expect(actionable.sourceType).toBe('user_command');
    expect(actionable.sourceContactJid).toBe('self@s.whatsapp.net');
    expect(actionable.sourceContactName).toBe('Self');
    expect(actionable.sourceMessageId).toBeNull();
    expect(actionable.sourceMessageText).toBe(
      'remind me to call the dentist in 1 hour',
    );
    expect(actionable.detectedLanguage).toBe('en');
    expect(actionable.originalDetectedTask).toBe('call the dentist');
    expect(actionable.task).toBe('call the dentist');
    expect(actionable.status).toBe('approved');
    expect(actionable.fireAt).toBe(fireAt);
  });

  it('actionables write failure does NOT prevent the reminder from firing (graceful degradation)', async () => {
    hasReminderIntentMock.mockReturnValue(true);
    const fireAt = Date.now() + 60 * 60 * 1000;
    parseReminderCommandMock.mockResolvedValue({
      intent: 'set',
      task: 'buy milk',
      dateTime: new Date(fireAt).toISOString(),
    });
    createActionableMock.mockImplementation(() => {
      throw new Error('sqlite locked');
    });

    const handled = await tryHandleReminder(sockStub, 'remind me to buy milk in 1h');

    expect(handled).toBe(true);
    // The legacy reminder STILL got written — that's the whole point.
    expect(insertReminderMock).toHaveBeenCalledOnce();
    // The reminder was still scheduled via the in-24h path.
    expect(scheduleReminderMock).toHaveBeenCalledOnce();
    // And the confirmation message was still sent to the user.
    expect(
      (sockStub as unknown as { sendMessage: ReturnType<typeof vi.fn> })
        .sendMessage,
    ).toHaveBeenCalled();
  });

  it('Hebrew command detected as Hebrew on the actionable', async () => {
    hasReminderIntentMock.mockReturnValue(true);
    detectMessageLanguageMock.mockReturnValueOnce('he');
    const fireAt = Date.now() + 60 * 60 * 1000;
    parseReminderCommandMock.mockResolvedValue({
      intent: 'set',
      task: 'לקנות חלב',
      dateTime: new Date(fireAt).toISOString(),
    });

    await tryHandleReminder(sockStub, 'תזכיר לי לקנות חלב בעוד שעה');

    expect(createActionableMock).toHaveBeenCalledOnce();
    expect(createActionableMock.mock.calls[0][0].detectedLanguage).toBe('he');
  });
});

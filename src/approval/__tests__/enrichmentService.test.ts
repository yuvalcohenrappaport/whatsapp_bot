import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must be hoisted before module-under-test import) ─────────────────

vi.mock('../../config.js', () => ({
  config: { USER_JID: 'self@s.whatsapp.net', LOG_LEVEL: 'silent' },
}));

const generateJsonMock = vi.fn();
vi.mock('../../ai/provider.js', () => ({
  generateJson: generateJsonMock,
}));

const getRecentMessagesMock = vi.fn();
vi.mock('../../db/queries/messages.js', () => ({
  getRecentMessages: getRecentMessagesMock,
}));

// Break the circular enrichmentService → approvalHandler → enrichmentService by
// mocking approvalHandler.js. We provide a real buildBasicNote implementation so
// fallback assertions on note format are accurate.
vi.mock('../approvalHandler.js', () => ({
  buildBasicNote: (a: { sourceContactName?: string | null; sourceContactJid?: string | null; sourceMessageText?: string | null }) => {
    const who = a.sourceContactName ?? a.sourceContactJid ?? 'Self';
    const rawSnippet = a.sourceMessageText ?? '';
    const snippet = rawSnippet.length > 200
      ? rawSnippet.slice(0, 200).trimEnd() + '…'
      : rawSnippet;
    return snippet.length > 0
      ? `From: ${who}\nOriginal: "${snippet}"`
      : `From: ${who}`;
  },
  tryHandleApprovalReply: vi.fn(),
}));

// Import the real enrichActionable AFTER mocks are set up.
const { enrichActionable } = await import('../enrichmentService.js');

// ─── Fixture helper ───────────────────────────────────────────────────────────

import type { Actionable } from '../../db/queries/actionables.js';

function mkActionable(overrides: Partial<Actionable> = {}): Actionable {
  const now = Date.now();
  return {
    id: 'a1',
    sourceType: 'commitment',
    sourceContactJid: '972501234567@s.whatsapp.net',
    sourceContactName: 'Lee',
    sourceMessageId: 'msg1',
    sourceMessageText: "I'll send the report tomorrow",
    detectedLanguage: 'en',
    originalDetectedTask: 'Send the report tomorrow',
    task: 'Send the report tomorrow',
    status: 'approved',
    detectedAt: now,
    fireAt: null,
    todoTaskId: null,
    todoListId: null,
    enrichedTitle: null,
    enrichedNote: null,
    approvalPreviewMessageId: 'prev1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Actionable;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('enrichActionable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty history, valid Gemini response.
    getRecentMessagesMock.mockResolvedValue([]);
    generateJsonMock.mockResolvedValue({
      title: 'Follow up with Lee on Q2 report by Monday',
      note: 'Contact: Lee\nOriginal: "I\'ll send the report tomorrow"\nContext: Lee promised report',
    });
  });

  // ── Case 1: happy path — commitment with chat history ──
  it('happy path: enriches with contact name from Gemini response and passes through {title, note}', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      contactJid: '972501234567@s.whatsapp.net',
      fromMe: i % 2 === 0,
      body: i % 2 === 0 ? `me message ${i}` : `them message ${i}`,
      timestamp: 1_700_000_000 + i,
    }));
    getRecentMessagesMock.mockResolvedValue(history);
    generateJsonMock.mockResolvedValue({
      title: 'Follow up with Lee on Q2 report by Monday',
      note: 'Contact: Lee\nOriginal: "..."\nContext: Lee asked about the Q2 report',
    });

    const a = mkActionable({ sourceContactName: 'Lee' });
    const result = await enrichActionable(a);

    expect(result.title).toBe('Follow up with Lee on Q2 report by Monday');
    expect(result.note).toContain('Contact: Lee');

    // generateJson called once with correct shape.
    expect(generateJsonMock).toHaveBeenCalledOnce();
    const call = generateJsonMock.mock.calls[0][0];
    expect(call.systemPrompt).toContain('self-contained');
    expect(call.userContent).toContain('Contact name: Lee');
    expect(call.userContent).toContain('Detected task: Send the report tomorrow');
  });

  // ── Case 2: happy path — empty history ──
  it('empty history: still calls generateJson and userContent contains "(no prior messages available)"', async () => {
    getRecentMessagesMock.mockResolvedValue([]);
    generateJsonMock.mockResolvedValue({
      title: 'Send Q2 report',
      note: 'Contact: Lee\nOriginal: "task"',
    });

    const a = mkActionable({ sourceType: 'task' });
    await enrichActionable(a);

    expect(generateJsonMock).toHaveBeenCalledOnce();
    const call = generateJsonMock.mock.calls[0][0];
    expect(call.userContent).toContain('(no prior messages available)');
  });

  // ── Case 3: user_command — Gemini NOT called ──
  it('user_command: skips Gemini entirely and returns {title: task, note: buildBasicNote}', async () => {
    const a = mkActionable({
      sourceType: 'user_command',
      task: 'remind me to call the dentist',
      sourceContactName: null,
      sourceContactJid: 'self@s.whatsapp.net',
      sourceMessageText: '/remind me to call the dentist',
    });

    const result = await enrichActionable(a);

    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(getRecentMessagesMock).not.toHaveBeenCalled();
    expect(result.title).toBe('remind me to call the dentist');
    // buildBasicNote: contactName=null → falls back to contactJid → 'self@s.whatsapp.net'.
    expect(result.note).toContain('From: self@s.whatsapp.net');
  });

  // ── Case 4: fallback — generateJson returns null ──
  it('generateJson null: returns fallback {title: task, note: buildBasicNote} without warning', async () => {
    generateJsonMock.mockResolvedValue(null);

    const a = mkActionable();
    const result = await enrichActionable(a);

    expect(result.title).toBe(a.task);
    // buildBasicNote includes "From: <contactName>".
    expect(result.note).toContain('From: Lee');
  });

  // ── Case 5: fallback — safeParse fails (wrong types) ──
  it('safeParse fail: returns fallback and logs warn', async () => {
    generateJsonMock.mockResolvedValue({ title: 123, note: null });

    const a = mkActionable();
    const result = await enrichActionable(a);

    expect(result.title).toBe(a.task);
    expect(result.note).toContain('From: Lee');
  });

  // ── Case 6: fallback — generateJson throws ──
  it('generateJson throws: returns fallback and logs warn', async () => {
    generateJsonMock.mockRejectedValue(new Error('Gemini 503'));

    const a = mkActionable();
    const result = await enrichActionable(a);

    expect(result.title).toBe(a.task);
    expect(result.note).toContain('From: Lee');
  });

  // ── Case 7: fallback — empty title string (Zod min(1) or post-trim check) ──
  it('Gemini returns empty/whitespace title: returns fallback', async () => {
    // Zod min(1) will reject whitespace-only string after trim is applied.
    // The implementation also has an explicit post-parse trim+empty check as belt+suspenders.
    generateJsonMock.mockResolvedValue({ title: '   ', note: 'valid note content here' });

    const a = mkActionable();
    const result = await enrichActionable(a);

    expect(result.title).toBe(a.task);
  });

  // ── Case 8: fallback preserves contact metadata ──
  it('fallback note contains contact name and original trigger message', async () => {
    generateJsonMock.mockRejectedValue(new Error('Gemini 503'));

    const a = mkActionable({
      sourceContactName: 'Alice',
      sourceMessageText: 'Check it',
    });

    const result = await enrichActionable(a);

    expect(result.title).toBe(a.task);
    expect(result.note).toContain('Alice');
    expect(result.note).toContain('Check it');
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseApprovalReply,
  type ApprovalDirective,
} from '../replyParser.js';

describe('parseApprovalReply — bulk (un-numbered)', () => {
  it('✅ → approve all', () => {
    expect(parseApprovalReply('✅', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 'all' },
    ]);
  });

  it('❌ → reject all', () => {
    expect(parseApprovalReply('❌', 3)).toEqual<ApprovalDirective[]>([
      { action: 'reject', itemIndex: 'all' },
    ]);
  });

  it('bulk approve tolerates surrounding whitespace', () => {
    expect(parseApprovalReply('   ✅   ', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 'all' },
    ]);
  });

  it('bulk EN latin "ok" → approve all (case-insensitive)', () => {
    expect(parseApprovalReply('OK', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 'all' },
    ]);
  });

  it('bulk HE "אישור" → approve all (literal)', () => {
    expect(parseApprovalReply('אישור', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 'all' },
    ]);
  });

  it('bulk HE "ביטול" → reject all (literal)', () => {
    expect(parseApprovalReply('ביטול', 3)).toEqual<ApprovalDirective[]>([
      { action: 'reject', itemIndex: 'all' },
    ]);
  });
});

describe('parseApprovalReply — numbered per-item', () => {
  it('1 ✅ → approve item 1', () => {
    expect(parseApprovalReply('1 ✅', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
    ]);
  });

  it('1 yes → approve item 1 (EN synonym, case-insensitive)', () => {
    expect(parseApprovalReply('1 yes', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
    ]);
  });

  it('1 YES → approve item 1 (upper case)', () => {
    expect(parseApprovalReply('1 YES', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
    ]);
  });

  it('1 לא → reject item 1 (HE synonym, literal)', () => {
    expect(parseApprovalReply('1 לא', 3)).toEqual<ApprovalDirective[]>([
      { action: 'reject', itemIndex: 1 },
    ]);
  });

  it('2 ❌ → reject item 2', () => {
    expect(parseApprovalReply('2 ❌', 3)).toEqual<ApprovalDirective[]>([
      { action: 'reject', itemIndex: 2 },
    ]);
  });
});

describe('parseApprovalReply — multi-directive', () => {
  it('1 ✅ 2 ❌ 3 edit: Send report to Lee → 3 directives', () => {
    expect(
      parseApprovalReply('1 ✅ 2 ❌ 3 edit: Send report to Lee', 3),
    ).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
      { action: 'reject', itemIndex: 2 },
      { action: 'edit', itemIndex: 3, editText: 'Send report to Lee' },
    ]);
  });

  it('multi-directive with HE edit', () => {
    expect(
      parseApprovalReply('1 ✅ 2 עריכה: שלח את הדוח', 2),
    ).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
      { action: 'edit', itemIndex: 2, editText: 'שלח את הדוח' },
    ]);
  });

  it('multiple approves on the same index are preserved (last-wins is caller concern)', () => {
    expect(parseApprovalReply('1 ✅ 1 ❌', 3)).toEqual<ApprovalDirective[]>([
      { action: 'approve', itemIndex: 1 },
      { action: 'reject', itemIndex: 1 },
    ]);
  });
});

describe('parseApprovalReply — edit grammar', () => {
  it('EN edit: preserves internal whitespace', () => {
    expect(
      parseApprovalReply('1 edit: Hello,   world!', 3),
    ).toEqual<ApprovalDirective[]>([
      { action: 'edit', itemIndex: 1, editText: 'Hello,   world!' },
    ]);
  });

  it('EN edit: preserves internal colons', () => {
    expect(
      parseApprovalReply('1 edit: Reminder: call Lee at 3:00', 3),
    ).toEqual<ApprovalDirective[]>([
      {
        action: 'edit',
        itemIndex: 1,
        editText: 'Reminder: call Lee at 3:00',
      },
    ]);
  });

  it('HE edit grammar', () => {
    expect(
      parseApprovalReply('1 עריכה: שלח את הדוח', 3),
    ).toEqual<ApprovalDirective[]>([
      { action: 'edit', itemIndex: 1, editText: 'שלח את הדוח' },
    ]);
  });

  it('EN edit case-insensitive prefix: "EDIT:"', () => {
    expect(
      parseApprovalReply('1 EDIT: hello', 3),
    ).toEqual<ApprovalDirective[]>([
      { action: 'edit', itemIndex: 1, editText: 'hello' },
    ]);
  });
});

describe('parseApprovalReply — invalid / edge cases', () => {
  it('empty string → []', () => {
    expect(parseApprovalReply('', 3)).toEqual([]);
  });

  it('whitespace-only → []', () => {
    expect(parseApprovalReply('   \n\t ', 3)).toEqual([]);
  });

  it('trailing garbage after valid directive → [] (no partial parse)', () => {
    expect(parseApprovalReply('1 ✅ banana', 3)).toEqual([]);
  });

  it('out-of-range item index → []', () => {
    expect(parseApprovalReply('5 ✅', 3)).toEqual([]);
  });

  it('unknown synonym → []', () => {
    expect(parseApprovalReply('1 banana', 3)).toEqual([]);
  });

  it('un-numbered edit: → [] (edit requires item number)', () => {
    expect(parseApprovalReply('edit: no number', 3)).toEqual([]);
  });

  it('zero item-count is treated as invalid → []', () => {
    expect(parseApprovalReply('✅', 0)).toEqual([]);
  });

  it('empty edit body → []', () => {
    expect(parseApprovalReply('1 edit:', 3)).toEqual([]);
  });

  it('leading non-digit garbage → []', () => {
    expect(parseApprovalReply('banana 1 ✅', 3)).toEqual([]);
  });
});

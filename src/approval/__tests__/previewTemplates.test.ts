import { describe, expect, it } from 'vitest';
import { composePreview, type PreviewItem } from '../previewTemplates.js';

const ITEM_A: PreviewItem = {
  task: 'Send the Q2 report to Lee',
  contactName: 'Lee',
  snippet: "I'll send you the Q2 report tomorrow morning",
};

const ITEM_B: PreviewItem = {
  task: 'Call the accountant',
  contactName: 'Lee',
  snippet: "let's ping the accountant this week about the tax form",
};

const ITEM_C: PreviewItem = {
  task: 'Book flights for the offsite',
  contactName: 'Lee',
  snippet: 'I can book the flights for the offsite on Thursday',
};

const ITEM_HE: PreviewItem = {
  task: 'לשלוח דוח ללי',
  contactName: 'לי',
  snippet: 'אני אשלח את הדוח מחר בבוקר',
};

describe('composePreview — single item', () => {
  it('EN single-item: renders 4 lines (task / name / snippet / hint)', () => {
    const out = composePreview([ITEM_A], 'en', 'Lee');
    expect(out).toBe(
      '📝 Send the Q2 report to Lee\n' +
        '👤 Lee\n' +
        '💬 "I\'ll send you the Q2 report tomorrow morning"\n' +
        'Reply ✅ / ❌ / edit: <text>\n',
    );
  });

  it('HE single-item: renders 4 lines with Hebrew grammar hint', () => {
    const out = composePreview([ITEM_HE], 'he', 'לי');
    expect(out).toBe(
      '📝 לשלוח דוח ללי\n' +
        '👤 לי\n' +
        '💬 "אני אשלח את הדוח מחר בבוקר"\n' +
        'השב ✅ / ❌ / עריכה: <טקסט>\n',
    );
  });
});

describe('composePreview — batched', () => {
  it('EN batch with 3 items from Lee: numbered header + bulk-approve hint', () => {
    const out = composePreview([ITEM_A, ITEM_B, ITEM_C], 'en', 'Lee');
    expect(out).toBe(
      '📝 3 items from Lee:\n' +
        '1. Send the Q2 report to Lee\n' +
        '   💬 "I\'ll send you the Q2 report tomorrow morning"\n' +
        '2. Call the accountant\n' +
        '   💬 "let\'s ping the accountant this week about the tax form"\n' +
        '3. Book flights for the offsite\n' +
        '   💬 "I can book the flights for the offsite on Thursday"\n' +
        '\n' +
        'Reply: `1 ✅` / `2 ❌` / `3 edit: <text>` (or `✅` to approve all)\n',
    );
  });

  it('HE batch: renders with Hebrew header + Hebrew grammar hint', () => {
    const items: PreviewItem[] = [
      { task: 'לשלוח דוח ללי', contactName: 'לי', snippet: 'אשלח את הדוח מחר' },
      { task: 'להתקשר לרואה חשבון', contactName: 'לי', snippet: 'נתאם שיחה עם רואה החשבון' },
    ];
    const out = composePreview(items, 'he', 'לי');
    expect(out).toBe(
      '📝 2 פריטים מ-לי:\n' +
        '1. לשלוח דוח ללי\n' +
        '   💬 "אשלח את הדוח מחר"\n' +
        '2. להתקשר לרואה חשבון\n' +
        '   💬 "נתאם שיחה עם רואה החשבון"\n' +
        '\n' +
        'השב: `1 ✅` / `2 ❌` / `3 עריכה: <טקסט>` (או `✅` לאישור הכל)\n',
    );
  });

  it('EN batch with null contactName: header omits "from X"', () => {
    const out = composePreview([ITEM_A, ITEM_B], 'en', null);
    // Header must start with "📝 2 items:" (no "from")
    expect(out.startsWith('📝 2 items:\n')).toBe(true);
    // Make sure no "from" leaked into the header line
    expect(out.split('\n')[0]).toBe('📝 2 items:');
  });

  it('HE batch with null contactName: header omits "מ-<name>"', () => {
    const items: PreviewItem[] = [
      { task: 'לשלוח דוח', contactName: null, snippet: 'אשלח' },
      { task: 'להתקשר', contactName: null, snippet: 'אתקשר' },
    ];
    const out = composePreview(items, 'he', null);
    expect(out.split('\n')[0]).toBe('📝 2 פריטים:');
  });
});

describe('composePreview — edge cases', () => {
  it('empty array throws', () => {
    expect(() => composePreview([], 'en', 'Lee')).toThrow('empty preview items');
  });
});

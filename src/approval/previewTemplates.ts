/**
 * Preview message composer for the WhatsApp approval UX (Phase 41).
 *
 * Pure string-in / string-out: given a list of pending actionable items and a
 * language, emits the preview message body that is posted to the user's
 * self-chat. Two layouts:
 *
 *   - single-item (items.length === 1): 4 lines, no numbering, per-item
 *     grammar hint (✅ / ❌ / edit: <text>).
 *   - batched    (items.length  >  1): numbered list headered by
 *     "📝 <N> items from <name>:" (or "📝 <N> items:" when contactName is null),
 *     grammar hint supports per-item approve/reject/edit plus un-numbered bulk
 *     approve.
 *
 * Snippets are pre-truncated by the caller — this composer is dumb about
 * length limits, line wrapping, and Markdown. No DB, no I/O.
 */

export type Language = 'he' | 'en';

export interface PreviewItem {
  task: string;
  contactName: string | null;
  /** Pre-truncated by caller (max 100 chars). */
  snippet: string;
}

/**
 * Compose the self-chat preview for one or more pending actionables.
 *
 * @param items            Non-empty list of items awaiting approval.
 * @param language         'en' or 'he' — selects grammar hint + header copy.
 * @param contactName      Source-chat display name for the batch header. When
 *                         `null`, the batched header omits the "from X" clause.
 *                         Ignored for single-item layouts (the single-item
 *                         template carries its own per-item contact line).
 * @throws Error if `items` is empty.
 */
export function composePreview(
  items: PreviewItem[],
  language: Language,
  contactName: string | null,
): string {
  if (items.length === 0) throw new Error('empty preview items');
  if (items.length === 1) return composeSingle(items[0], language);
  return composeBatched(items, language, contactName);
}

// ─── Single-item ─────────────────────────────────────────────────────────────

function composeSingle(item: PreviewItem, language: Language): string {
  const nameLine = item.contactName ?? '';
  const hint =
    language === 'he'
      ? 'השב ✅ / ❌ / עריכה: <טקסט>'
      : 'Reply ✅ / ❌ / edit: <text>';

  return (
    `📝 ${item.task}\n` +
    `👤 ${nameLine}\n` +
    `💬 "${item.snippet}"\n` +
    `${hint}\n`
  );
}

// ─── Batched ─────────────────────────────────────────────────────────────────

function composeBatched(
  items: PreviewItem[],
  language: Language,
  contactName: string | null,
): string {
  const header = batchHeader(items.length, language, contactName);

  const body = items
    .map((item, idx) => {
      const n = idx + 1;
      return `${n}. ${item.task}\n   💬 "${item.snippet}"`;
    })
    .join('\n');

  const hint = batchHint(language);

  return `${header}\n${body}\n\n${hint}\n`;
}

function batchHeader(
  count: number,
  language: Language,
  contactName: string | null,
): string {
  if (language === 'he') {
    return contactName !== null
      ? `📝 ${count} פריטים מ-${contactName}:`
      : `📝 ${count} פריטים:`;
  }
  // en
  return contactName !== null
    ? `📝 ${count} items from ${contactName}:`
    : `📝 ${count} items:`;
}

function batchHint(language: Language): string {
  if (language === 'he') {
    return 'השב: `1 ✅` / `2 ❌` / `3 עריכה: <טקסט>` (או `✅` לאישור הכל)';
  }
  return 'Reply: `1 ✅` / `2 ❌` / `3 edit: <text>` (or `✅` to approve all)';
}

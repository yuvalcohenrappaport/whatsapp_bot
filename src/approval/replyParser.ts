/**
 * Quoted-reply grammar parser for the WhatsApp approval UX (Phase 41).
 *
 * Parses a free-form user reply into an ordered list of structured directives.
 * Bilingual (EN + HE) by construction: Latin tokens are case-insensitive;
 * Hebrew and emoji tokens match literally. No I/O, never throws — invalid
 * input returns `[]` and the caller decides whether to re-post the grammar
 * hint.
 *
 * Supported forms:
 *   ✅ / ❌                              → bulk approve / reject (itemIndex='all')
 *   N ✅ / N ❌                          → per-item approve/reject (1-based N)
 *   N edit: <text>                       → per-item edit, full-text replacement
 *   N עריכה: <text>                      → HE per-item edit
 *   Multi-directive, e.g. `1 ✅ 2 ❌ 3 edit: Send report`
 *
 * Locks:
 *   - ANY malformed or out-of-range directive invalidates the whole reply
 *     (no partial parse). This keeps the mental model simple for the user:
 *     either the full reply is understood, or they see the grammar hint again.
 *   - Un-numbered `edit:` is NOT supported — edit requires an item number
 *     because it needs to know which actionable to rewrite.
 *   - Single-digit item indices only (1–9). With the 2-minute debounce
 *     bucket, >9 pending items in one preview is a degenerate case the v1
 *     grammar doesn't need to handle.
 */

export type ApprovalAction = 'approve' | 'reject' | 'edit';

export interface ApprovalDirective {
  action: ApprovalAction;
  /** 1-based item index, or 'all' for un-numbered bulk approve/reject. */
  itemIndex: number | 'all';
  /** Only present when action === 'edit'. Trimmed; internal whitespace and colons preserved. */
  editText?: string;
}

// ─── Grammar tables ──────────────────────────────────────────────────────────

const APPROVE_SYNONYMS = new Set<string>([
  '✅',
  '✓',
  'approve',
  'ok',
  'yes',
  'y',
  'אישור',
  'כן',
]);

const REJECT_SYNONYMS = new Set<string>([
  '❌',
  '✗',
  'reject',
  'no',
  'n',
  'ביטול',
  'לא',
]);

/** Edit prefixes. Latin `edit:` is matched case-insensitively; HE matches literally. */
const EDIT_PREFIXES: readonly string[] = ['edit:', 'עריכה:'];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a quoted-reply into directives.
 *
 * @param replyText  Raw text the user typed.
 * @param itemCount  Number of items in the preview the user was replying to
 *                   (1-based index ceiling; directives with N > itemCount
 *                   invalidate the whole reply).
 * @returns Ordered array of directives, or `[]` if the reply is unparseable.
 */
export function parseApprovalReply(
  replyText: string,
  itemCount: number,
): ApprovalDirective[] {
  const text = replyText.trim();
  if (text.length === 0) return [];
  if (itemCount < 1) return [];

  // 1) Un-numbered bulk approve / reject (entire reply is a single synonym).
  const bulk = matchBulkSynonym(text);
  if (bulk !== null) return [bulk];

  // 2) Per-item directives: greedy scan for leading single-digit index.
  return parseNumberedDirectives(text, itemCount);
}

// ─── Bulk ────────────────────────────────────────────────────────────────────

function matchBulkSynonym(text: string): ApprovalDirective | null {
  const lower = text.toLowerCase();
  if (APPROVE_SYNONYMS.has(text) || APPROVE_SYNONYMS.has(lower)) {
    return { action: 'approve', itemIndex: 'all' };
  }
  if (REJECT_SYNONYMS.has(text) || REJECT_SYNONYMS.has(lower)) {
    return { action: 'reject', itemIndex: 'all' };
  }
  return null;
}

// ─── Per-item directives ─────────────────────────────────────────────────────

/**
 * Scan the reply left-to-right. Every directive starts with a single-digit
 * integer N (1..itemCount) followed by whitespace and then either:
 *   - an approve synonym token,
 *   - a reject synonym token, or
 *   - an edit prefix (`edit:` or `עריכה:`) plus the rest of the text up to
 *     the next directive boundary (`\s[1-9]\s`) or end-of-string.
 *
 * Any syntactic failure → `[]` (no partial parse).
 */
function parseNumberedDirectives(
  text: string,
  itemCount: number,
): ApprovalDirective[] {
  const directives: ApprovalDirective[] = [];
  // Leading single-digit + whitespace marker.
  const leadRe = /^([1-9])\s+/;

  let rest = text;
  while (rest.length > 0) {
    const lead = leadRe.exec(rest);
    if (lead === null) return []; // garbage before any valid directive
    const idx = Number.parseInt(lead[1], 10);
    if (idx < 1 || idx > itemCount) return []; // out of range

    rest = rest.slice(lead[0].length); // consume "N "

    // Edit prefix? (case-insensitive for Latin, literal for HE)
    const editPrefix = detectEditPrefix(rest);
    if (editPrefix !== null) {
      // Everything after the prefix until the next "\s[1-9]\s" boundary or EOS.
      const afterPrefix = rest.slice(editPrefix.length);
      const { editText, consumed } = sliceEditText(afterPrefix);
      if (editText.length === 0) return []; // empty edit body
      directives.push({ action: 'edit', itemIndex: idx, editText });
      rest = afterPrefix.slice(consumed).replace(/^\s+/, '');
      continue;
    }

    // Approve / reject token → read first whitespace-delimited token.
    const tokenMatch = /^(\S+)/.exec(rest);
    if (tokenMatch === null) return [];
    const token = tokenMatch[1];
    const lowerToken = token.toLowerCase();

    if (APPROVE_SYNONYMS.has(token) || APPROVE_SYNONYMS.has(lowerToken)) {
      directives.push({ action: 'approve', itemIndex: idx });
    } else if (REJECT_SYNONYMS.has(token) || REJECT_SYNONYMS.has(lowerToken)) {
      directives.push({ action: 'reject', itemIndex: idx });
    } else {
      return []; // unknown synonym
    }

    rest = rest.slice(token.length).replace(/^\s+/, '');
  }

  return directives;
}

/** If `rest` starts with an edit prefix (case-insensitive for Latin), return the literal prefix (original casing, whatever length it actually was). */
function detectEditPrefix(rest: string): string | null {
  for (const prefix of EDIT_PREFIXES) {
    const head = rest.slice(0, prefix.length);
    if (head.length < prefix.length) continue;
    if (head === prefix) return head;
    // Latin `edit:` — allow case-insensitive match but preserve original casing.
    if (/^[a-z:]+$/i.test(prefix) && head.toLowerCase() === prefix.toLowerCase()) {
      return head;
    }
  }
  return null;
}

/**
 * Given the text after an edit prefix, greedily consume until the next
 * directive boundary (`\s[1-9]\s`) or end-of-string. The leading whitespace
 * between the prefix and the edit text is consumed; internal whitespace and
 * colons are preserved. Returned `editText` is trimmed on both ends.
 */
function sliceEditText(after: string): { editText: string; consumed: number } {
  // Regex finds a whitespace + [1-9] + whitespace boundary that signals the
  // start of the next numbered directive. We search with .exec to get the
  // index of the whitespace so the digit + following content stay in `rest`
  // for the next iteration.
  const boundaryRe = /\s+[1-9]\s+/;
  const boundary = boundaryRe.exec(after);

  if (boundary === null) {
    return { editText: after.trim(), consumed: after.length };
  }

  const editSlice = after.slice(0, boundary.index);
  // `consumed` stops at the START of the whitespace that precedes the next
  // digit, so the digit itself is re-fed into the outer loop.
  return { editText: editSlice.trim(), consumed: boundary.index };
}

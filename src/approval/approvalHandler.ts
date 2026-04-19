/**
 * Quoted-reply approval handler for the WhatsApp approval UX (Phase 41).
 *
 * Given a quoted-reply the owner sent in their self-chat, this module:
 *
 *   1. Looks up every actionable whose `approval_preview_message_id` matches
 *      the quoted message's id (one preview per bucket → N items).
 *   2. Parses the reply text via `parseApprovalReply` using the batched item
 *      count. An empty parse nudges the user with a one-line grammar hint
 *      (never a re-preview) and returns `true` so messageHandler short-
 *      circuits further routing.
 *   3. Expands bulk `'all'` directives into one directive per item and
 *      de-dupes by item index (last-wins) so `1 ✅ 1 ❌` cleanly resolves
 *      to "reject item 1".
 *   4. Applies each directive in input order:
 *        - `approve` → flip to `approved`, enrich via Gemini (Phase 42),
 *          push enriched title+note to Google Tasks, confirm.
 *        - `edit`    → rewrite the task text, then fall through to approve
 *          so a single message is sent with the edited title.
 *        - `reject`  → flip to `rejected`, confirm dismissal.
 *      Already-terminal actionables produce a single `⚠️ Item N already
 *      handled` warning instead of mutating.
 *
 * Returns `true` when the caller should stop cascading (the reply was for
 * an actionable preview, handled or nudged), `false` when the quoted msg
 * id is unknown so messageHandler can fall through to the reminder path.
 */
import type { WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import {
  getActionablesByPreviewMsgId,
  updateActionableStatus,
  updateActionableTask,
  updateActionableEnrichment,
  updateActionableTodoIds,
  type Actionable,
} from '../db/queries/actionables.js';
import { createTodoTask } from '../todo/todoService.js';
import { isTasksConnected } from '../todo/todoAuthService.js';
import {
  parseApprovalReply,
  type ApprovalDirective,
} from './replyParser.js';
import { enrichActionable } from './enrichmentService.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Handle a quoted-reply that may refer to an actionables preview.
 *
 * @param sock         Live baileys socket.
 * @param text         Raw reply text from the user.
 * @param quotedMsgId  The `stanzaId` of the quoted preview message.
 * @param replyLang    Detected language of the reply (used only for the
 *                     grammar-hint fallback; per-item confirmations use the
 *                     actionable's own `detectedLanguage`).
 * @returns `true` when the reply was for an actionables preview (handled or
 *          nudged), `false` when the quoted msg id doesn't match any
 *          actionable — caller should fall through to the next handler.
 */
export async function tryHandleApprovalReply(
  sock: WASocket,
  text: string,
  quotedMsgId: string,
  replyLang: 'he' | 'en',
): Promise<boolean> {
  const items = getActionablesByPreviewMsgId(quotedMsgId);
  if (items.length === 0) return false;

  const directives = parseApprovalReply(text, items.length);

  // Unparseable → grammar hint (once) and claim the reply.
  if (directives.length === 0) {
    const hintLang = pickHintLanguage(items, replyLang);
    await sendGrammarHint(sock, hintLang);
    return true;
  }

  const expanded = expandAllDirectives(directives, items.length);
  const deduped = dedupeLastWins(expanded);

  for (const dir of deduped) {
    const actionable = items[dir.itemIndex - 1];
    if (!actionable) {
      // Defensive — parser already range-checks, but belt and suspenders.
      logger.warn(
        { quotedMsgId, dir, itemCount: items.length },
        'Directive itemIndex out of range after parse — skipping',
      );
      continue;
    }
    await applyDirective(sock, actionable, dir);
  }

  return true;
}

// ─── Directive expansion + dedupe ────────────────────────────────────────────

function expandAllDirectives(
  directives: ApprovalDirective[],
  itemCount: number,
): ApprovalDirective[] {
  const out: ApprovalDirective[] = [];
  for (const d of directives) {
    if (d.itemIndex === 'all') {
      for (let i = 1; i <= itemCount; i++) {
        out.push({ ...d, itemIndex: i });
      }
    } else {
      out.push(d);
    }
  }
  return out;
}

/** Last-wins dedupe by itemIndex — preserves the order of the last occurrence. */
function dedupeLastWins(
  directives: ApprovalDirective[],
): ApprovalDirective[] {
  const lastIndexFor = new Map<number, number>();
  directives.forEach((d, i) => {
    if (typeof d.itemIndex === 'number') lastIndexFor.set(d.itemIndex, i);
  });
  return directives.filter((d, i) => {
    if (typeof d.itemIndex !== 'number') return false; // all-directives already expanded
    return lastIndexFor.get(d.itemIndex) === i;
  });
}

// ─── Per-directive application ───────────────────────────────────────────────

async function applyDirective(
  sock: WASocket,
  actionable: Actionable,
  directive: ApprovalDirective,
): Promise<void> {
  // Already-terminal (or approved/fired/expired) → skip + warn, no mutation.
  if (actionable.status !== 'pending_approval') {
    await sock.sendMessage(config.USER_JID, {
      text: alreadyHandledMessage(directive, actionable),
    });
    logger.info(
      { id: actionable.id, status: actionable.status, action: directive.action },
      'Actionable already handled — directive skipped',
    );
    return;
  }

  if (directive.action === 'edit') {
    const editText = directive.editText ?? '';
    updateActionableTask(actionable.id, editText);
    // Refresh the local snapshot so the downstream approve path + confirmation
    // see the new title without an extra DB round-trip.
    actionable = { ...actionable, task: editText };
  }

  if (directive.action === 'approve' || directive.action === 'edit') {
    await approveAndSync(sock, actionable);
    return;
  }

  if (directive.action === 'reject') {
    updateActionableStatus(actionable.id, 'rejected');
    await sock.sendMessage(config.USER_JID, {
      text: rejectedConfirmation(
        (actionable.detectedLanguage ?? 'en') as 'he' | 'en',
      ),
    });
    return;
  }
}

// ─── Approve + Google Tasks sync ─────────────────────────────────────────────

async function approveAndSync(
  sock: WASocket,
  actionable: Actionable,
): Promise<void> {
  // 1. Flip status FIRST — enrichment failure must NEVER block approval (APPR-02 behavior preserved).
  updateActionableStatus(actionable.id, 'approved');

  // 2. Enrich (Gemini + fallback — never throws).
  const enrichment = await enrichActionable(actionable);

  // 3. Persist enrichment on the actionable row.
  updateActionableEnrichment(actionable.id, { title: enrichment.title, note: enrichment.note });

  // 4. Push to Google Tasks with the ENRICHED payload (title + note).
  if (isTasksConnected()) {
    try {
      const result = await createTodoTask({ title: enrichment.title, note: enrichment.note });
      updateActionableTodoIds(actionable.id, {
        todoTaskId: result.taskId,
        todoListId: result.listId,
      });
    } catch (err) {
      logger.warn(
        { err, id: actionable.id },
        'Google Tasks push failed on approval — actionable stays approved+enriched in DB',
      );
    }
  } else {
    logger.info(
      { id: actionable.id },
      'Google Tasks not connected — approved actionable not synced',
    );
  }

  // 5. Confirm to owner (still shows actionable.task, not enriched title — matches
  //    what they saw in the preview; enriched title is what appears in Google Tasks).
  await sock.sendMessage(config.USER_JID, {
    text: approvedConfirmation(actionable),
  });
}

export function buildBasicNote(actionable: Actionable): string {
  const who =
    actionable.sourceContactName ??
    actionable.sourceContactJid ??
    'Self';
  const rawSnippet = actionable.sourceMessageText ?? '';
  const snippet = rawSnippet.length > 200
    ? rawSnippet.slice(0, 200).trimEnd() + '…'
    : rawSnippet;
  return snippet.length > 0
    ? `From: ${who}\nOriginal: "${snippet}"`
    : `From: ${who}`;
}

// ─── Confirmation + hint copy ────────────────────────────────────────────────

function approvedConfirmation(actionable: Actionable): string {
  const lang = (actionable.detectedLanguage ?? 'en') as 'he' | 'en';
  return lang === 'he'
    ? `✅ נוסף: ${actionable.task}`
    : `✅ Added: ${actionable.task}`;
}

function rejectedConfirmation(lang: 'he' | 'en'): string {
  return lang === 'he' ? '❌ בוטל' : '❌ Dismissed';
}

function alreadyHandledMessage(
  directive: ApprovalDirective,
  actionable: Actionable,
): string {
  const lang = (actionable.detectedLanguage ?? 'en') as 'he' | 'en';
  const index =
    typeof directive.itemIndex === 'number' ? directive.itemIndex : '?';
  if (lang === 'he') {
    return `⚠️ פריט ${index} כבר טופל (${actionable.status}) — דולג.`;
  }
  return `⚠️ Item ${index} already handled (${actionable.status}) — skipped.`;
}

async function sendGrammarHint(
  sock: WASocket,
  lang: 'he' | 'en',
): Promise<void> {
  const text = lang === 'he'
    ? 'השב ✅ / ❌ / עריכה: <טקסט> (או מספר + פעולה עבור פריט ספציפי)'
    : 'Reply ✅ / ❌ / edit: <text> (or number + action for a specific item)';
  await sock.sendMessage(config.USER_JID, { text });
}

/**
 * Choose the language for the grammar hint: prefer the actionables' own
 * detected language (consistent with the preview they saw). Falls back to
 * the reply's detected language when the actionables' own value is missing.
 */
function pickHintLanguage(
  items: Actionable[],
  replyLang: 'he' | 'en',
): 'he' | 'en' {
  const first = items[0]?.detectedLanguage;
  if (first === 'he' || first === 'en') return first;
  return replyLang;
}

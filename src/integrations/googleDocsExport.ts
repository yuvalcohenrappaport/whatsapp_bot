import { google } from 'googleapis';
import pino from 'pino';
import { config } from '../config.js';
import { getOAuth2Client } from '../calendar/personalCalendarService.js';
import type { BudgetRollup, TripCategory } from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

export interface TripExportInput {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  decisions: Array<{
    id: string;
    type: string;
    value: string;
    category: TripCategory | null;
    costAmount: number | null;
    costCurrency: string | null;
    origin: string;
    status: 'active' | 'deleted';
    metadata: string | null;
  }>;
  openQuestions: Array<{ id: string; value: string; resolved: boolean }>;
  calendarEvents: Array<{ id: string; title: string; eventDate: number }>;
  budget: BudgetRollup;
}

export class MissingDocsScopeError extends Error {
  constructor() {
    super('Google OAuth client missing documents scope — owner must re-authorize');
  }
}

export async function exportTripToGoogleDoc(
  input: TripExportInput,
): Promise<{ url: string; documentId: string }> {
  const auth = getOAuth2Client();
  if (!auth) throw new Error('Google OAuth not configured');

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const title = `${input.destination ?? 'Trip'} ${input.startDate ?? ''} — Trip Summary`.trim();

  // 1. Create the empty doc.
  let documentId: string;
  try {
    const created = await docs.documents.create({ requestBody: { title } });
    documentId = created.data.documentId!;
  } catch (err: unknown) {
    if (isInsufficientScopeError(err)) throw new MissingDocsScopeError();
    throw err;
  }

  // 2. Build the body via batchUpdate. Single-shot insertText calls in reverse
  //    document-position order so each previous insert doesn't shift the next
  //    target index. Simplest approach: build one giant string, insert at
  //    index 1, then issue style updates afterward.
  const body = renderTripBody(input);
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index: 1 }, text: body } }],
    },
  });

  // 3. Read webViewLink via Drive (the docs API doesn't return it).
  const fileMeta = await drive.files.get({
    fileId: documentId,
    fields: 'webViewLink',
  });
  const url =
    fileMeta.data.webViewLink ??
    `https://docs.google.com/document/d/${documentId}/edit`;

  logger.info({ documentId, title }, 'Trip exported to Google Doc');
  return { url, documentId };
}

export function renderTripBody(input: TripExportInput): string {
  const lines: string[] = [];
  lines.push(`${input.destination ?? 'Trip'}`);
  lines.push(`${input.startDate ?? ''} – ${input.endDate ?? ''}`);
  lines.push('');

  // Timeline
  lines.push('TIMELINE');
  if (input.calendarEvents.length === 0) lines.push('  (no events)');
  for (const ev of [...input.calendarEvents].sort((a, b) => a.eventDate - b.eventDate)) {
    const d = new Date(ev.eventDate);
    lines.push(`  ${d.toISOString().slice(0, 16).replace('T', ' ')}  ${ev.title}`);
  }
  lines.push('');

  // Decisions grouped by category (EXCLUDE deleted — CONTEXT lock)
  lines.push('DECISIONS');
  const active = input.decisions.filter((d) => d.status !== 'deleted');
  const grouped = new Map<string, typeof active>();
  for (const d of active) {
    const key = d.category ?? 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }
  for (const [cat, rows] of grouped) {
    lines.push(`  ${cat.toUpperCase()}`);
    for (const r of rows) {
      const cost = r.costAmount != null ? ` (${r.costAmount} ${r.costCurrency ?? ''})` : '';
      lines.push(`    - ${r.value}${cost} [${r.origin}]`);
    }
  }
  lines.push('');

  // Open questions
  lines.push('OPEN QUESTIONS');
  const open = input.openQuestions.filter((q) => !q.resolved);
  if (open.length === 0) lines.push('  (none)');
  for (const q of open) lines.push(`  - ${q.value}`);
  lines.push('');

  // Budget
  lines.push('BUDGET');
  for (const cat of Object.keys(input.budget.targets) as TripCategory[]) {
    const tgt = input.budget.targets[cat];
    const sp = input.budget.spent[cat];
    if (tgt === 0 && sp === 0) continue;
    lines.push(`  ${cat}: ${sp} / ${tgt}${sp > tgt && tgt > 0 ? '  [OVER]' : ''}`);
  }
  lines.push('');

  return lines.join('\n');
}

function isInsufficientScopeError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    code?: number;
    errors?: Array<{ reason?: string }>;
    message?: string;
  };
  if (
    e.code === 403 &&
    e.errors?.some(
      (x) => x.reason === 'insufficientPermissions' || x.reason === 'forbidden',
    )
  )
    return true;
  if (
    typeof e.message === 'string' &&
    /insufficient.*scope|insufficientScope/i.test(e.message)
  )
    return true;
  return false;
}

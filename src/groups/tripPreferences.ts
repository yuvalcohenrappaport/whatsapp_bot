import crypto from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import {
  insertTripDecision,
  upsertTripContext,
  getTripContext,
  TRIP_CATEGORIES,
  type TripCategory,
} from '../db/queries/tripMemory.js';
import { runAfterInsert } from './conflictDetector.js';

const logger = pino({ level: config.LOG_LEVEL });

// Strict ISO date (YYYY-MM-DD) and ISO-4217 currency regexes. Intentionally
// permissive on month/day numeric range (e.g. `2026-13-40` passes the regex)
// — the Date round-trip check below tightens the month/day to real calendar
// values without pulling in a date library.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

interface GroupMsg {
  id: string;
  senderJid: string;
  senderName: string | null;
  body: string;
  timestamp: number;
}

/**
 * Returns true if the message matched a known self-report verb (handled,
 * terminal — caller must NOT continue the pipeline). Returns false if the
 * message is not a `!`-prefixed command, OR uses a `!`-verb that this handler
 * doesn't recognize (caller should pass through to the classifier).
 *
 * Malformed-but-known-verb commands are silently swallowed (return true, no
 * DB write, no group reply) to preserve discreet chattiness.
 */
export async function handleSelfReportCommand(
  groupJid: string,
  msg: GroupMsg,
): Promise<boolean> {
  const trimmed = msg.body.trim();
  if (!trimmed.startsWith('!')) return false;

  const [verbRaw, ...rest] = trimmed.slice(1).split(/\s+/);
  const verb = verbRaw?.toLowerCase();

  if (verb === 'pref') {
    return handlePref(groupJid, msg, rest.join(' '));
  }
  if (verb === 'budget') {
    return handleBudget(groupJid, msg, rest);
  }
  if (verb === 'dates') {
    return handleDates(groupJid, msg, rest);
  }

  // Unknown `!`-verb — let it fall through to the classifier. User may just
  // be shouting (`!!!`) or using some other group convention.
  return false;
}

function handlePref(groupJid: string, msg: GroupMsg, text: string): true {
  const value = text.trim();
  if (value.length === 0) {
    // Malformed (empty body) — silent drop.
    return true;
  }

  const decisionId = crypto.randomUUID();
  insertTripDecision({
    id: decisionId,
    groupJid,
    // `tripDecisions.type` enum doesn't have a `preference` value; 'activity'
    // is the closest existing bucket. `origin='self_reported'` distinguishes
    // these from classifier-inferred activities. Dashboard (Phase 55) groups
    // by origin.
    type: 'activity',
    value,
    confidence: 'high',
    sourceMessageId: msg.id,
    proposedBy: msg.senderJid,
    origin: 'self_reported',
    category: null,
    costAmount: null,
    costCurrency: null,
  });

  // Fire-and-forget — self-reported preferences can conflict with
  // classifier-inferred decisions too. runAfterInsert never throws.
  runAfterInsert(groupJid, decisionId).catch(() => {});

  logger.info(
    { groupJid, senderJid: msg.senderJid },
    '!pref recorded',
  );
  return true;
}

function handleBudget(
  groupJid: string,
  _msg: GroupMsg,
  args: string[],
): true {
  if (args.length !== 3) return true; // malformed, silent

  const [categoryRaw, amountRaw, currencyRaw] = args;
  const category = categoryRaw?.toLowerCase();
  const amount = Number(amountRaw);
  const currency = currencyRaw?.toUpperCase();

  if (!category || !TRIP_CATEGORIES.includes(category as TripCategory)) {
    return true;
  }
  if (!Number.isFinite(amount) || amount <= 0) return true;
  if (!currency || !CURRENCY_RE.test(currency)) return true;

  // Read-merge-write so we don't clobber other category entries. The column
  // stores a JSON string per 51-01 schema; older writes (from the legacy
  // `getBudgetRollup` path) may have serialized as a flat `{cat: number}`
  // shape. Normalize both shapes into `{amount, currency}` objects so the
  // self-report surface always records the currency alongside the amount.
  const ctx = getTripContext(groupJid);
  const current: Record<string, { amount: number; currency: string }> = {};
  if (ctx?.budgetByCategory) {
    try {
      const parsed = JSON.parse(ctx.budgetByCategory) as Record<
        string,
        { amount?: number; currency?: string } | number
      >;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          // Legacy flat shape — preserve amount, currency unknown.
          current[k] = { amount: v, currency: '' };
        } else if (
          v &&
          typeof v === 'object' &&
          typeof v.amount === 'number' &&
          typeof v.currency === 'string'
        ) {
          current[k] = { amount: v.amount, currency: v.currency };
        }
      }
    } catch {
      // Malformed JSON — treat as empty, caller overwrites with this entry.
    }
  }

  current[category] = { amount, currency };

  upsertTripContext(groupJid, {
    // Cast is safe: our map matches the `Partial<Record<TripCategory, ...>>`
    // slot loosely; upsertTripContext JSON-stringifies objects unchanged.
    budgetByCategory: current as unknown as Partial<
      Record<TripCategory, number>
    >,
  });

  logger.info(
    { groupJid, category, amount, currency },
    '!budget recorded',
  );
  return true;
}

function handleDates(
  groupJid: string,
  _msg: GroupMsg,
  args: string[],
): true {
  if (args.length !== 2) return true; // malformed, silent
  const [startDate, endDate] = args;

  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) return true;

  // Regex allows 2026-13-40; tighten to real calendar dates via Date
  // round-trip: a valid ISO date parses back to the same YYYY-MM-DD.
  if (!isRealIsoDate(startDate) || !isRealIsoDate(endDate)) return true;

  if (startDate > endDate) return true; // silent reject (end before start)

  upsertTripContext(groupJid, { startDate, endDate });

  logger.info({ groupJid, startDate, endDate }, '!dates recorded');
  return true;
}

function isRealIsoDate(s: string): boolean {
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

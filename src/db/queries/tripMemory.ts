import { and, eq, desc, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../client.js';
import { tripArchive, tripContexts, tripDecisions } from '../schema.js';

// Phase 51 v2.1 — category enum shared across the classifier, budget rollup,
// and self-report commands. Enforced in the app layer (no CHECK constraint in
// the DB, matching the `type` column convention).
export type TripCategory =
  | 'flights'
  | 'lodging'
  | 'food'
  | 'activities'
  | 'transit'
  | 'shopping'
  | 'other';

export const TRIP_CATEGORIES: readonly TripCategory[] = [
  'flights',
  'lodging',
  'food',
  'activities',
  'transit',
  'shopping',
  'other',
] as const;

export type DecisionOrigin =
  | 'inferred'
  | 'self_reported'
  | 'multimodal'
  | 'dashboard';

export function getTripContext(groupJid: string) {
  return db
    .select()
    .from(tripContexts)
    .where(eq(tripContexts.groupJid, groupJid))
    .get();
}

export function upsertTripContext(
  groupJid: string,
  data: {
    destination?: string | null;
    dates?: string | null;
    contextSummary?: string | null;
    // v2.1 additions — all optional for backwards compat with existing callers
    startDate?: string | null;
    endDate?: string | null;
    budgetByCategory?: Partial<Record<TripCategory, number>> | string | null;
    calendarId?: string | null;
    status?: 'active' | 'archived';
    briefingTime?: string | null;
    // Phase 54 v2.1 — free-form JSON blob for per-trip soft state used by the
    // briefing cron (last_briefing_date, cached tz, resolved coords, etc.).
    // Callers pre-serialize the JSON string themselves so this helper stays
    // schema-agnostic about what goes inside.
    metadata?: string | null;
  },
) {
  // Normalize budgetByCategory → JSON string for storage. Callers may pass
  // either an object (typical) or a pre-serialized string (edge case).
  const {
    destination,
    dates,
    contextSummary,
    startDate,
    endDate,
    calendarId,
    status,
    briefingTime,
    metadata,
  } = data;
  const budgetJson =
    data.budgetByCategory === undefined
      ? undefined
      : data.budgetByCategory === null
        ? null
        : typeof data.budgetByCategory === 'string'
          ? data.budgetByCategory
          : JSON.stringify(data.budgetByCategory);

  // Build the set/values shape — omit undefined so we don't overwrite columns
  // the caller didn't mention.
  const patch: Record<string, unknown> = {
    lastClassifiedAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (destination !== undefined) patch.destination = destination;
  if (dates !== undefined) patch.dates = dates;
  if (contextSummary !== undefined) patch.contextSummary = contextSummary;
  if (startDate !== undefined) patch.startDate = startDate;
  if (endDate !== undefined) patch.endDate = endDate;
  if (budgetJson !== undefined) patch.budgetByCategory = budgetJson ?? '{}';
  if (calendarId !== undefined) patch.calendarId = calendarId;
  if (status !== undefined) patch.status = status;
  if (briefingTime !== undefined) patch.briefingTime = briefingTime;
  if (metadata !== undefined) patch.metadata = metadata;

  return db
    .insert(tripContexts)
    .values({ groupJid, ...patch })
    .onConflictDoUpdate({
      target: tripContexts.groupJid,
      set: patch,
    })
    .run();
}

export function getDecisionsByGroup(
  groupJid: string,
  typeOrOpts?: string | { type?: string; includeArchived?: boolean },
) {
  // Backwards compat: old callers pass `type` as second positional arg.
  const opts =
    typeof typeOrOpts === 'string'
      ? { type: typeOrOpts, includeArchived: false }
      : { type: typeOrOpts?.type, includeArchived: typeOrOpts?.includeArchived ?? false };

  const conditions = [eq(tripDecisions.groupJid, groupJid)];
  if (opts.type !== undefined) {
    conditions.push(eq(tripDecisions.type, opts.type));
  }
  if (!opts.includeArchived) {
    conditions.push(eq(tripDecisions.archived, false));
  }

  return db
    .select()
    .from(tripDecisions)
    .where(and(...conditions))
    .orderBy(desc(tripDecisions.createdAt))
    .all();
}

export function insertTripDecision(decision: {
  id: string;
  groupJid: string;
  type: string;
  value: string;
  confidence: string;
  sourceMessageId: string | null;
  // v2.1 additions — all optional for backwards compat
  proposedBy?: string | null;
  category?: TripCategory | null;
  costAmount?: number | null;
  costCurrency?: string | null;
  conflictsWith?: string[];
  origin?: DecisionOrigin;
  metadata?: Record<string, unknown> | null;
}) {
  return db
    .insert(tripDecisions)
    .values({
      id: decision.id,
      groupJid: decision.groupJid,
      type: decision.type,
      value: decision.value,
      confidence: decision.confidence,
      sourceMessageId: decision.sourceMessageId,
      proposedBy: decision.proposedBy ?? null,
      category: decision.category ?? null,
      costAmount: decision.costAmount ?? null,
      costCurrency: decision.costCurrency ?? null,
      // `conflicts_with` is NOT NULL DEFAULT '[]' — serialize explicitly so
      // the value we read back is always well-formed JSON.
      conflictsWith: JSON.stringify(decision.conflictsWith ?? []),
      origin: decision.origin ?? 'inferred',
      metadata:
        decision.metadata === undefined || decision.metadata === null
          ? null
          : JSON.stringify(decision.metadata),
    })
    .run();
}

export function getUnresolvedOpenItems(groupJid: string) {
  return db
    .select()
    .from(tripDecisions)
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        eq(tripDecisions.type, 'open_question'),
        eq(tripDecisions.resolved, false),
        eq(tripDecisions.archived, false),
      ),
    )
    .orderBy(desc(tripDecisions.createdAt))
    .all();
}

export function resolveOpenItem(decisionId: string) {
  return db
    .update(tripDecisions)
    .set({ resolved: true })
    .where(eq(tripDecisions.id, decisionId))
    .run();
}

// ─── Phase 51 v2.1 helpers ──────────────────────────────────────────────────

export interface BudgetRollup {
  targets: Record<TripCategory, number>;
  spent: Record<TripCategory, number>;
  remaining: Record<TripCategory, number>;
}

function emptyCategoryRecord(): Record<TripCategory, number> {
  return {
    flights: 0,
    lodging: 0,
    food: 0,
    activities: 0,
    transit: 0,
    shopping: 0,
    other: 0,
  };
}

/**
 * Sum cost_amount of non-archived trip_decisions per category, combined with
 * the per-category targets from trip_contexts.budget_by_category.
 *
 * Currency-agnostic for v2.1 — single trip = single currency assumption.
 * Cross-currency normalization is deferred to Phase 55.
 */
export function getBudgetRollup(groupJid: string): BudgetRollup {
  const targets = emptyCategoryRecord();
  const spent = emptyCategoryRecord();

  const ctx = getTripContext(groupJid);
  if (ctx?.budgetByCategory) {
    try {
      const parsed = JSON.parse(ctx.budgetByCategory) as Partial<
        Record<TripCategory, number>
      >;
      for (const cat of TRIP_CATEGORIES) {
        const v = parsed[cat];
        if (typeof v === 'number' && Number.isFinite(v)) targets[cat] = v;
      }
    } catch {
      // Malformed JSON — treat as no budget set.
    }
  }

  const rows = db
    .select({
      category: tripDecisions.category,
      total: sql<number>`COALESCE(SUM(${tripDecisions.costAmount}), 0)`.as(
        'total',
      ),
    })
    .from(tripDecisions)
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        eq(tripDecisions.archived, false),
      ),
    )
    .groupBy(tripDecisions.category)
    .all();

  for (const row of rows) {
    const cat = row.category as TripCategory | null;
    if (cat && cat in spent) {
      spent[cat] = Number(row.total) || 0;
    }
  }

  const remaining = emptyCategoryRecord();
  for (const cat of TRIP_CATEGORIES) {
    remaining[cat] = targets[cat] - spent[cat];
  }

  return { targets, spent, remaining };
}

/**
 * JSON-serialize + persist the `conflicts_with` column for a single decision.
 * Called by the conflict detector (Phase 51 Plan 03) after it finds overlaps.
 */
export function updateDecisionConflicts(
  decisionId: string,
  conflictsWith: string[],
): void {
  db.update(tripDecisions)
    .set({ conflictsWith: JSON.stringify(conflictsWith) })
    .where(eq(tripDecisions.id, decisionId))
    .run();
}

/**
 * Atomically move a trip_contexts row into trip_archive under a fresh UUID,
 * then delete it from trip_contexts. Returns the new archive id, or null if
 * no active row existed for the group.
 *
 * Called by the auto-archive cron (Phase 51 Plan 05). The caller should
 * invoke `markDecisionsArchivedForGroup` AFTER this succeeds so a concurrent
 * reader never sees a half-archived state.
 */
export function moveContextToArchive(
  groupJid: string,
): { archiveId: string } | null {
  const row = getTripContext(groupJid);
  if (!row) return null;

  const archiveId = randomUUID();
  const archivedAt = Date.now();

  // drizzle-orm better-sqlite3 `transaction` runs the callback synchronously
  // and rolls back on throw; unlike raw better-sqlite3 it is not a
  // re-callable wrapper.
  db.transaction((txDb) => {
    txDb
      .insert(tripArchive)
      .values({
        id: archiveId,
        groupJid: row.groupJid,
        destination: row.destination,
        dates: row.dates,
        contextSummary: row.contextSummary,
        lastClassifiedAt: row.lastClassifiedAt,
        updatedAt: row.updatedAt,
        startDate: row.startDate,
        endDate: row.endDate,
        budgetByCategory: row.budgetByCategory,
        calendarId: row.calendarId,
        // Snapshot as 'archived' on move — trip_archive is a terminal store.
        status: 'archived',
        briefingTime: row.briefingTime,
        archivedAt,
      })
      .run();

    txDb
      .delete(tripContexts)
      .where(eq(tripContexts.groupJid, groupJid))
      .run();
  });

  return { archiveId };
}

/**
 * Flip `archived = 1` on every non-archived trip_decisions row for a group.
 * Returns the number of rows updated. Called AFTER moveContextToArchive so
 * reads during the cron tick never see a partial state.
 */
export function markDecisionsArchivedForGroup(groupJid: string): number {
  const result = db
    .update(tripDecisions)
    .set({ archived: true })
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        eq(tripDecisions.archived, false),
      ),
    )
    .run();
  return result.changes;
}

/**
 * Find active trip_contexts rows whose end_date is more than 3 days in the
 * past (i.e. `now > end_date + 3 days`). The cron (Plan 05) calls this once
 * per tick and feeds results into moveContextToArchive +
 * markDecisionsArchivedForGroup.
 *
 * Rows with `end_date IS NULL` are skipped (we only archive trips that
 * actually finished).
 */
export function getExpiredActiveContexts(
  nowMs: number,
): Array<{ groupJid: string; endDate: string }> {
  // SQLite date math: date(:now / 1000, 'unixepoch') vs date(end_date, '+3 days')
  const rows = db
    .select({
      groupJid: tripContexts.groupJid,
      endDate: tripContexts.endDate,
    })
    .from(tripContexts)
    .where(
      sql`${tripContexts.status} = 'active'
          AND ${tripContexts.endDate} IS NOT NULL
          AND date(${tripContexts.endDate}, '+3 days') < date(${Math.floor(
            nowMs / 1000,
          )}, 'unixepoch')`,
    )
    .all();

  return rows
    .filter((r): r is { groupJid: string; endDate: string } => r.endDate !== null)
    .map((r) => ({ groupJid: r.groupJid, endDate: r.endDate }));
}

export function searchGroupMessages(
  groupJid: string,
  query: string,
  limit = 10,
): { id: string; senderName: string | null; body: string; timestamp: number }[] {
  // Sanitize: split on whitespace, filter words shorter than 2 chars,
  // wrap each word in double quotes to prevent FTS5 syntax injection
  const sanitized = query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w.replace(/"/g, '')}"`)
    .join(' ');

  if (!sanitized) return [];

  const results = db.all<{
    id: string;
    sender_name: string | null;
    body: string;
    timestamp: number;
  }>(sql`
    SELECT gm.id, gm.sender_name, gm.body, gm.timestamp
    FROM group_messages_fts fts
    JOIN group_messages gm ON gm.rowid = fts.rowid
    WHERE group_messages_fts MATCH ${sanitized}
      AND gm.group_jid = ${groupJid}
    ORDER BY fts.rank
    LIMIT ${limit}
  `);

  return results.map((r) => ({
    id: r.id,
    senderName: r.sender_name,
    body: r.body,
    timestamp: r.timestamp,
  }));
}

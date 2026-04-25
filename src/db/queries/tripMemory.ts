import { and, eq, desc, ne, sql, gte, lte, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../client.js';
import { calendarEvents, tripArchive, tripContexts, tripDecisions } from '../schema.js';

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
  typeOrOpts?: string | { type?: string; includeArchived?: boolean; includeDeleted?: boolean },
) {
  // Backwards compat: old callers pass `type` as second positional arg.
  const opts =
    typeof typeOrOpts === 'string'
      ? { type: typeOrOpts, includeArchived: false, includeDeleted: false }
      : {
          type: typeOrOpts?.type,
          includeArchived: typeOrOpts?.includeArchived ?? false,
          // Phase 55: soft-deleted rows are hidden by default everywhere —
          // getDecisionsByGroup, the map, and Google Docs export all use this
          // default. Pass includeDeleted: true only for the dashboard's "Show
          // deleted" toggle.
          includeDeleted: typeOrOpts?.includeDeleted ?? false,
        };

  const conditions = [eq(tripDecisions.groupJid, groupJid)];
  if (opts.type !== undefined) {
    conditions.push(eq(tripDecisions.type, opts.type));
  }
  if (!opts.includeArchived) {
    conditions.push(eq(tripDecisions.archived, false));
  }
  if (!opts.includeDeleted) {
    conditions.push(ne(tripDecisions.status, 'deleted'));
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
        // Phase 55: soft-deleted decisions are excluded from budget rollup —
        // a deleted item should not count toward the trip's spending.
        ne(tripDecisions.status, 'deleted'),
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

/**
 * Return every active (non-archived) trip context row. Called once per cron
 * tick by briefingCron to check all in-flight trips against their per-trip
 * briefing window.
 *
 * Only returns the columns the briefing cron actually needs — keeps the
 * shape narrow so callers can't accidentally rely on implementation detail.
 */
export function getActiveContextsForBriefing(): Array<{
  groupJid: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  briefingTime: string | null;
  calendarId: string | null;
  metadata: string | null;
}> {
  return db
    .select({
      groupJid: tripContexts.groupJid,
      destination: tripContexts.destination,
      startDate: tripContexts.startDate,
      endDate: tripContexts.endDate,
      briefingTime: tripContexts.briefingTime,
      calendarId: tripContexts.calendarId,
      metadata: tripContexts.metadata,
    })
    .from(tripContexts)
    .where(eq(tripContexts.status, 'active'))
    .all();
}

// ─── Phase 55 v2.1 dashboard helpers ────────────────────────────────────────

/**
 * Soft-delete a decision by setting status = 'deleted'.
 * Does NOT remove the row — deleted rows are hidden from the default board view,
 * the Leaflet map, and Google Docs export, but remain recoverable via the
 * "Show deleted" dashboard toggle.
 *
 * Returns better-sqlite3's RunResult. Callers check `.changes` to detect
 * a 404 case (changes === 0 means no row matched the id).
 */
export function softDeleteDecision(decisionId: string) {
  return db
    .update(tripDecisions)
    .set({ status: 'deleted' })
    .where(eq(tripDecisions.id, decisionId))
    .run();
}

/**
 * Shallow-merge a category→amount patch into the trip_context's
 * budget_by_category JSON column. Non-finite numbers in patch are stripped.
 *
 * Returns the new merged budget object.
 * Throws if no trip_context row exists for the group (route layer returns 404).
 */
export function updateBudgetByCategory(
  groupJid: string,
  patch: Partial<Record<TripCategory, number>>,
): Record<TripCategory, number> {
  const ctx = getTripContext(groupJid);
  if (!ctx) {
    throw new Error(`No trip_context found for group ${groupJid}`);
  }

  let existing: Partial<Record<TripCategory, number>> = {};
  if (ctx.budgetByCategory) {
    try {
      existing = JSON.parse(ctx.budgetByCategory) as Partial<Record<TripCategory, number>>;
    } catch {
      // Malformed JSON → treat as empty
    }
  }

  // Shallow-merge: caller-supplied keys win; non-finite values are stripped.
  const merged: Record<string, number> = { ...existing };
  for (const [key, val] of Object.entries(patch)) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      merged[key] = val;
    }
  }

  upsertTripContext(groupJid, { budgetByCategory: JSON.stringify(merged) });
  return merged as Record<TripCategory, number>;
}

/** Shape returned by listTripsForDashboard. */
export interface TripListEntry {
  groupJid: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  /** 'active' | 'archived' from trip_contexts.status, or 'archived' for trip_archive rows */
  status: string;
  archivedAt: number | null;
}

/**
 * Return all trips (active + archived) sorted upcoming-first then past then
 * archive: rows with endDate >= today ASC by startDate, rows with
 * endDate < today DESC by endDate, trip_archive rows DESC by archivedAt.
 *
 * Today is computed as YYYY-MM-DD in UTC (no luxon dependency).
 */
export function listTripsForDashboard(): TripListEntry[] {
  const today = new Date().toISOString().slice(0, 10);

  const activeRows: TripListEntry[] = db
    .select({
      groupJid: tripContexts.groupJid,
      destination: tripContexts.destination,
      startDate: tripContexts.startDate,
      endDate: tripContexts.endDate,
      status: tripContexts.status,
    })
    .from(tripContexts)
    .all()
    .map((r) => ({ ...r, archivedAt: null }));

  const archiveRows: TripListEntry[] = db
    .select({
      groupJid: tripArchive.groupJid,
      destination: tripArchive.destination,
      startDate: tripArchive.startDate,
      endDate: tripArchive.endDate,
      archivedAt: tripArchive.archivedAt,
    })
    .from(tripArchive)
    .all()
    .map((r) => ({ ...r, status: 'archived' as const }));

  // Split active rows into upcoming (endDate >= today or no endDate) and past
  const upcoming: TripListEntry[] = [];
  const past: TripListEntry[] = [];
  for (const row of activeRows) {
    if (!row.endDate || row.endDate >= today) {
      upcoming.push(row);
    } else {
      past.push(row);
    }
  }

  // Sort: upcoming ASC by startDate, past DESC by endDate, archive DESC by archivedAt
  upcoming.sort((a, b) => {
    const sa = a.startDate ?? '';
    const sb = b.startDate ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  past.sort((a, b) => {
    const ea = a.endDate ?? '';
    const eb = b.endDate ?? '';
    return ea > eb ? -1 : ea < eb ? 1 : 0;
  });
  archiveRows.sort((a, b) => {
    const aa = a.archivedAt ?? 0;
    const ab = b.archivedAt ?? 0;
    return ab - aa;
  });

  return [...upcoming, ...past, ...archiveRows];
}

/** Row type returned from calendarEvents table queries. */
type CalendarEventRow = typeof calendarEvents.$inferSelect;

/** Full payload returned by getTripBundle for the dashboard GET /api/trips/:groupJid. */
export interface TripBundle {
  /** Trip context row (from trip_contexts or mapped from trip_archive). Null only when group not found anywhere. */
  context: (typeof tripContexts.$inferSelect) | {
    groupJid: string;
    destination: string | null;
    startDate: string | null;
    endDate: string | null;
    budgetByCategory: string;
    status: string;
    // trip_archive doesn't have all trip_contexts columns — fill others as null
    dates: null;
    contextSummary: null;
    lastClassifiedAt: null;
    updatedAt: number;
    calendarId: string | null;
    briefingTime: string | null;
    metadata: null;
  } | null;
  /** True when context came from trip_archive (the trip is archived, no longer editable). */
  readOnly: boolean;
  /** All decisions for the group including deleted ones (use status field to distinguish). */
  decisions: (typeof tripDecisions.$inferSelect)[];
  /** Unresolved open_question decisions (non-deleted, non-archived). */
  openQuestions: (typeof tripDecisions.$inferSelect)[];
  /** Calendar events bounded by trip dates (or all events for the group if no dates). */
  calendarEvents: CalendarEventRow[];
  /** Per-category budget rollup. */
  budget: BudgetRollup;
}

/**
 * Return the full dashboard payload for a single trip group.
 *
 * Lookup order:
 *   1. trip_contexts (active or soft-archived trip)
 *   2. trip_archive (cron-archived trips → readOnly: true)
 *   3. Neither found → return null (route responds 404)
 *
 * decisions includes both active AND deleted rows so the dashboard can render
 * the "Show deleted" toggle. Use the `status` field to distinguish them.
 * openQuestions filters out deleted + resolved + archived items.
 * calendarEvents is windowed by trip's startDate/endDate when both are present.
 */
export function getTripBundle(groupJid: string): TripBundle | null {
  // 1. Try active trip_contexts row
  let ctx: TripBundle['context'] = getTripContext(groupJid) ?? null;
  let readOnly = false;

  // 2. Fall through to trip_archive if not in trip_contexts
  if (!ctx) {
    const archiveRow = db
      .select()
      .from(tripArchive)
      .where(eq(tripArchive.groupJid, groupJid))
      .get();

    if (!archiveRow) return null; // Unknown group — route returns 404

    // Map archive row to context-like shape (only fields the FE needs)
    ctx = {
      groupJid: archiveRow.groupJid,
      destination: archiveRow.destination,
      startDate: archiveRow.startDate,
      endDate: archiveRow.endDate,
      budgetByCategory: archiveRow.budgetByCategory,
      status: archiveRow.status, // 'archived'
      dates: null,
      contextSummary: null,
      lastClassifiedAt: null,
      updatedAt: archiveRow.updatedAt,
      calendarId: archiveRow.calendarId,
      briefingTime: archiveRow.briefingTime,
      metadata: null,
    };
    readOnly = true;
  }

  // Decisions: include all rows (active + deleted + archived for archive view)
  // The dashboard "Show deleted" toggle distinguishes by status field.
  const isArchived = readOnly;
  const decisions = db
    .select()
    .from(tripDecisions)
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        // For archived trips show all rows including archived:true ones
        // (they were moved to archived by the cron, still belong to this trip)
        isArchived ? undefined : eq(tripDecisions.archived, false),
      ),
    )
    .orderBy(desc(tripDecisions.createdAt))
    .all();

  // Open questions: non-deleted, non-resolved, non-archived
  const openQuestions = db
    .select()
    .from(tripDecisions)
    .where(
      and(
        eq(tripDecisions.groupJid, groupJid),
        eq(tripDecisions.type, 'open_question'),
        eq(tripDecisions.resolved, false),
        eq(tripDecisions.archived, false),
        ne(tripDecisions.status, 'deleted'),
      ),
    )
    .orderBy(desc(tripDecisions.createdAt))
    .all();

  // Calendar events: bounded by trip dates when both present, else all for group
  let events: CalendarEventRow[];
  const startDate = ctx?.startDate;
  const endDate = ctx?.endDate;
  if (startDate && endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime() + 86400000; // inclusive end day
    events = db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.groupJid, groupJid),
          gte(calendarEvents.eventDate, startMs),
          lte(calendarEvents.eventDate, endMs),
        ),
      )
      .orderBy(asc(calendarEvents.eventDate))
      .all();
  } else {
    events = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.groupJid, groupJid))
      .orderBy(asc(calendarEvents.eventDate))
      .all();
  }

  return {
    context: ctx,
    readOnly,
    decisions,
    openQuestions,
    calendarEvents: events,
    budget: getBudgetRollup(groupJid),
  };
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

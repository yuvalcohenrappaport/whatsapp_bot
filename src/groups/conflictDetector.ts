import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import {
  getDecisionsByGroup,
  updateDecisionConflicts,
} from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

export type ConflictKind = 'hard' | 'soft' | 'none';

export interface ParsedDecision {
  id: string;
  value: string;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
  createdAt: number;
  metadata: Record<string, unknown>;
  conflictsWith: string[];
  // Extracted from metadata if present. Phase 52 multimodal will populate
  // these; classifier may populate partially.
  startTimeMs: number | null;
  endTimeMs: number | null;
  lat: number | null;
  lng: number | null;
}

/** Row shape `getDecisionsByGroup` returns. */
interface DecisionRow {
  id: string;
  value: string;
  category: string | null;
  confidence: string;
  createdAt: number;
  metadata: string | null;
  conflictsWith: string | null;
}

/** Parse a trip_decision row into the shape the analyzer needs. Metadata JSON is best-effort. */
export function parseDecision(row: DecisionRow): ParsedDecision {
  let metadata: Record<string, unknown> = {};
  let conflictsWith: string[] = [];
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = {};
  }
  try {
    conflictsWith = row.conflictsWith ? JSON.parse(row.conflictsWith) : [];
  } catch {
    conflictsWith = [];
  }

  const confidence = (['high', 'medium', 'low'].includes(row.confidence)
    ? row.confidence
    : 'medium') as 'high' | 'medium' | 'low';

  return {
    id: row.id,
    value: row.value,
    category: row.category,
    confidence,
    createdAt: row.createdAt,
    metadata,
    conflictsWith,
    startTimeMs: (metadata.start_time_ms as number | undefined) ?? null,
    endTimeMs: (metadata.end_time_ms as number | undefined) ?? null,
    lat: (metadata.lat as number | undefined) ?? null,
    lng: (metadata.lng as number | undefined) ?? null,
  };
}

/** Pure geometry + time math. No DB, no I/O. */
export function analyzeConflict(
  a: ParsedDecision,
  b: ParsedDecision,
): {
  timeOverlapMinutes: number;
  gapMinutes: number;
  transitDistanceKm: number;
} {
  // Time overlap / gap
  let timeOverlapMinutes = 0;
  let gapMinutes = Infinity;
  if (
    a.startTimeMs != null &&
    a.endTimeMs != null &&
    b.startTimeMs != null &&
    b.endTimeMs != null
  ) {
    const overlapMs = Math.max(
      0,
      Math.min(a.endTimeMs, b.endTimeMs) - Math.max(a.startTimeMs, b.startTimeMs),
    );
    timeOverlapMinutes = Math.round(overlapMs / 60000);
    const gapMs =
      a.startTimeMs > b.endTimeMs
        ? a.startTimeMs - b.endTimeMs
        : b.startTimeMs > a.endTimeMs
          ? b.startTimeMs - a.endTimeMs
          : 0;
    gapMinutes = Math.round(gapMs / 60000);
  }

  // Transit distance (haversine) — only when both sides have coords
  let transitDistanceKm = 0;
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    transitDistanceKm = haversineKm(a.lat, a.lng, b.lat, b.lng);
  }

  return { timeOverlapMinutes, gapMinutes, transitDistanceKm };
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Hard: timeOverlap > 0 AND both confidences >= 0.9 AND both decisions dated
 * within 7 days of `nowMs`. Categorical confidence is mapped: high => 1.0,
 * medium => 0.7, low => 0.4. The "decision date within 7 days" check uses
 * metadata.event_date_ms if present, else createdAt.
 *
 * Soft: gapMinutes < 30 OR transitDistanceKm > 20 (and not Hard).
 *
 * Else: none.
 */
export function classifyConflict(
  newer: ParsedDecision,
  older: ParsedDecision,
  nowMs: number,
  analysis: ReturnType<typeof analyzeConflict>,
): ConflictKind {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const confToScore = (c: 'high' | 'medium' | 'low') =>
    c === 'high' ? 1.0 : c === 'medium' ? 0.7 : 0.4;

  const newerDate =
    (newer.metadata.event_date_ms as number | undefined) ?? newer.createdAt;
  const olderDate =
    (older.metadata.event_date_ms as number | undefined) ?? older.createdAt;
  const bothWithin7d =
    Math.abs(nowMs - newerDate) <= SEVEN_DAYS_MS &&
    Math.abs(nowMs - olderDate) <= SEVEN_DAYS_MS;

  const hardConfidence =
    confToScore(newer.confidence) >= 0.9 && confToScore(older.confidence) >= 0.9;

  if (analysis.timeOverlapMinutes > 0 && hardConfidence && bothWithin7d) {
    return 'hard';
  }
  if (analysis.gapMinutes < 30 || analysis.transitDistanceKm > 20) {
    return 'soft';
  }
  return 'none';
}

/**
 * Run after an insertTripDecision. Compares `newDecisionId` against all other
 * non-archived decisions in the same group; writes conflicts_with on both
 * sides; posts a single Hebrew alert on hard conflict (throttled by
 * conflicts_with idempotence).
 *
 * Fire-and-forget — never throws.
 */
export async function runAfterInsert(
  groupJid: string,
  newDecisionId: string,
): Promise<void> {
  try {
    const rows = getDecisionsByGroup(groupJid) as DecisionRow[];
    const all = rows.map(parseDecision);
    const newer = all.find((d) => d.id === newDecisionId);
    if (!newer) return;

    const nowMs = Date.now();

    for (const older of all) {
      if (older.id === newer.id) continue;
      // Idempotence guard — already linked, skip.
      if (newer.conflictsWith.includes(older.id)) continue;

      const analysis = analyzeConflict(newer, older);
      const kind = classifyConflict(newer, older, nowMs, analysis);
      if (kind === 'none') continue;

      const newerUpdated = [...newer.conflictsWith, older.id];
      const olderUpdated = [...older.conflictsWith, newer.id];
      updateDecisionConflicts(newer.id, newerUpdated);
      updateDecisionConflicts(older.id, olderUpdated);
      // In-memory mirror so later loop iterations see the update.
      newer.conflictsWith = newerUpdated;

      if (kind === 'hard') {
        await sendHardConflictAlert(groupJid, newer, older, analysis).catch(
          (err) => {
            logger.error(
              { err, groupJid, newer: newer.id, older: older.id },
              'Failed to send hard-conflict alert',
            );
          },
        );
      } else {
        logger.info(
          { groupJid, newer: newer.id, older: older.id, analysis },
          'Soft conflict recorded silently',
        );
      }
    }
  } catch (err) {
    logger.error(
      { err, groupJid, newDecisionId },
      'conflictDetector.runAfterInsert failed',
    );
  }
}

async function sendHardConflictAlert(
  groupJid: string,
  newer: ParsedDecision,
  older: ParsedDecision,
  analysis: { timeOverlapMinutes: number },
): Promise<void> {
  const { sock } = getState();
  if (!sock) return;
  // Discreet, single-line, 💬 prefix, Hebrew. Truncate long values so the
  // alert never spans multiple screens.
  const truncate = (s: string, n = 40) =>
    s.length > n ? s.slice(0, n - 1) + '…' : s;
  const text = `💬 שתי החלטות חופפות בזמן (${analysis.timeOverlapMinutes} דק'): "${truncate(newer.value)}" ↔ "${truncate(older.value)}"`;
  await sock.sendMessage(groupJid, { text });
  logger.info(
    { groupJid, newer: newer.id, older: older.id },
    'Hard-conflict alert sent',
  );
}

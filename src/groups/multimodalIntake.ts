/**
 * Phase 52-02: Multimodal intake orchestrator.
 *
 * Flow (mirrors design doc § Phase 52 "Flow" 1-7 and 52-CONTEXT.md):
 *   1. Detect media kind — sticker → skip; image < 50KB → skip; PDF → pass.
 *   2. Re-gate on travelBotActive (defence-in-depth — caller also gates).
 *   3. Download media via downloadMediaMessage → Buffer.
 *   4. Assemble GroupContext from trip_contexts (if any).
 *   5. Call geminiVision.extractTripFact → TripFactExtraction | null.
 *   6. Confidence < 0.8 → silent drop, no DB, no ack.
 *   7. Insert trip_decision with origin='multimodal' + metadata JSON.
 *      Fire-and-forget runAfterInsert (Phase 51-03 conflict detector hook).
 *   8. If date + time both present → createSuggestion via the shared
 *      ensureGroupCalendar helper (guarantees v1.4 parity).
 *   9. Post 1-line language-aware ack (📌 noted: / 📌 נרשם:).
 *
 * Never throws — all paths wrapped in top-level try/catch that logs + returns.
 * Discreet chattiness: no multi-line dumps; low-confidence + errors stay silent.
 */

import crypto from 'node:crypto';
import pino from 'pino';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { getGroup } from '../db/queries/groups.js';
import { insertTripDecision, getTripContext } from '../db/queries/tripMemory.js';
import { extractTripFact, type GroupContext } from '../ai/geminiVision.js';
import { createSuggestion } from './suggestionTracker.js';
import { detectGroupLanguage, ensureGroupCalendar } from './calendarHelpers.js';
import { runAfterInsert } from './conflictDetector.js';

const logger = pino({ level: config.LOG_LEVEL, name: 'multimodalIntake' });

// ─── Constants ───────────────────────────────────────────────────────────────

/** Pre-filter: images smaller than this are treated as emoji/screenshot noise. */
const MIN_IMAGE_BYTES = 50_000;

/** Confidence gate for inserting a trip_decision + posting an ack. */
const CONFIDENCE_THRESHOLD = 0.8;

/** Ack summary truncation guard (model verbosity belt-and-suspenders). */
const ACK_SUMMARY_MAX = 80;

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaKind = 'image' | 'pdf' | 'sticker' | 'other';

type ExtractionType = 'flight' | 'hotel' | 'restaurant' | 'activity' | 'transit' | 'other';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inspect a Baileys WAMessage and classify the media kind we care about.
 * Returns 'other' for video/audio/location/contact — the caller ignores those.
 */
function detectMediaKind(msg: WAMessage): { kind: MediaKind; mimeType: string | null; fileLength: number } {
  const m = msg.message;
  if (!m) return { kind: 'other', mimeType: null, fileLength: 0 };

  if (m.stickerMessage) {
    return { kind: 'sticker', mimeType: m.stickerMessage.mimetype ?? 'image/webp', fileLength: 0 };
  }

  if (m.imageMessage) {
    const raw = m.imageMessage.fileLength;
    // Baileys Long objects have a .toNumber(); Number(long) also works on v6+.
    const fileLength =
      typeof raw === 'number'
        ? raw
        : raw == null
          ? 0
          : Number(raw);
    return {
      kind: 'image',
      mimeType: m.imageMessage.mimetype ?? 'image/jpeg',
      fileLength: Number.isFinite(fileLength) ? fileLength : 0,
    };
  }

  if (m.documentMessage && m.documentMessage.mimetype === 'application/pdf') {
    const raw = m.documentMessage.fileLength;
    const fileLength =
      typeof raw === 'number'
        ? raw
        : raw == null
          ? 0
          : Number(raw);
    return {
      kind: 'pdf',
      mimeType: 'application/pdf',
      fileLength: Number.isFinite(fileLength) ? fileLength : 0,
    };
  }

  return { kind: 'other', mimeType: null, fileLength: 0 };
}

/**
 * Build a compact GroupContext from trip_contexts for the vision prompt.
 * Active persons are intentionally omitted here (keeps the prompt lean per
 * plan — trip_contexts has enough disambiguation signal on its own for now).
 */
function buildGroupContext(groupJid: string): GroupContext {
  try {
    const ctx = getTripContext(groupJid);
    if (!ctx) return {};
    return {
      destination: ctx.destination ?? null,
      startDate: ctx.startDate ?? null,
      endDate: ctx.endDate ?? null,
    };
  } catch (err) {
    logger.debug({ err, groupJid }, 'buildGroupContext: trip_context lookup failed, proceeding empty');
    return {};
  }
}

/**
 * Map an extraction type to its Hebrew label for the `he` ack.
 */
function typeToHebrew(type: ExtractionType): string {
  switch (type) {
    case 'flight':
      return 'טיסה';
    case 'hotel':
      return 'מלון';
    case 'restaurant':
      return 'מסעדה';
    case 'activity':
      return 'פעילות';
    case 'transit':
      return 'תחבורה';
    case 'other':
    default:
      return 'פריט';
  }
}

/**
 * Build the 1-line success ack in the group's detected language.
 * MUST NOT contain `\n` — strip any newlines as belt-and-suspenders.
 */
function buildAckText(lang: 'he' | 'en', type: ExtractionType, summary: string): string {
  const truncated =
    summary.length > ACK_SUMMARY_MAX ? summary.slice(0, ACK_SUMMARY_MAX - 1) + '…' : summary;
  const cleanSummary = truncated.replace(/\r?\n/g, ' ').trim();

  let line: string;
  if (lang === 'he') {
    line = `📌 נרשם: ${typeToHebrew(type)} — ${cleanSummary}`;
  } else {
    line = `📌 noted: ${type} — ${cleanSummary}`;
  }

  // Final guard: no newlines in the output.
  return line.replace(/\r?\n/g, ' ');
}

/**
 * Parse an ISO `YYYY-MM-DD` date + `HH:MM` time into a local-time Date.
 * Returns null if the combination is not a valid calendar instant.
 */
function parseEventDate(date: string, time: string): Date | null {
  const instant = new Date(`${date}T${time}:00`);
  if (Number.isNaN(instant.getTime())) return null;
  return instant;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Handle a single incoming image / PDF / sticker in a travelBotActive group.
 *
 * Never throws. All failure paths (auth error, download failure, vision null,
 * low confidence, sock unavailable) log + return — the caller can safely
 * fire-and-forget.
 */
export async function handleMultimodalIntake(
  groupJid: string,
  msg: WAMessage,
): Promise<void> {
  try {
    // Step 1 — Detect media kind.
    const { kind, mimeType, fileLength } = detectMediaKind(msg);

    if (kind === 'sticker') {
      logger.debug({ groupJid, msgId: msg.key.id }, 'multimodal: sticker skipped');
      return;
    }
    if (kind === 'other' || !mimeType) {
      // Not our concern (video, audio, location, contact, etc.).
      return;
    }
    if (kind === 'image' && fileLength < MIN_IMAGE_BYTES) {
      logger.debug(
        { groupJid, msgId: msg.key.id, fileLength },
        'multimodal: image under size threshold, skipped',
      );
      return;
    }

    // Step 2 — Re-gate on travelBotActive (defence-in-depth).
    const group = getGroup(groupJid);
    if (!group?.travelBotActive) {
      logger.debug(
        { groupJid, hasGroup: !!group },
        'multimodal: group not travelBotActive, skipped',
      );
      return;
    }

    // Step 3 — Download media.
    let buffer: Buffer;
    try {
      buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), groupJid, msgId: msg.key.id },
        'multimodal: downloadMediaMessage failed',
      );
      return;
    }

    // Step 4 — Build group context for the vision prompt.
    const groupContext = buildGroupContext(groupJid);

    // Step 5 — Call vision. `extractTripFact` returns null on ANY failure
    // (network, empty, non-JSON, schema) per Plan 52-01's contract.
    const extraction = await extractTripFact(buffer, mimeType, groupContext);
    if (extraction === null) {
      logger.debug({ groupJid, msgId: msg.key.id }, 'multimodal: vision returned null');
      return;
    }

    // Step 6 — Confidence gate.
    if (extraction.confidence < CONFIDENCE_THRESHOLD) {
      logger.info(
        {
          groupJid,
          msgId: msg.key.id,
          confidence: extraction.confidence,
          type: extraction.type,
        },
        'multimodal: low confidence, silent drop',
      );
      return;
    }

    // Step 7 — Insert trip_decision and fire runAfterInsert.
    const decisionId = crypto.randomUUID();
    insertTripDecision({
      id: decisionId,
      groupJid,
      type: extraction.type, // reuses the enum bucket; category inference deferred
      value: extraction.title, // human-readable summary
      confidence: 'high', // legacy string column — 'high' maps to >=0.8
      sourceMessageId: msg.key.id ?? null,
      costAmount: extraction.cost_amount,
      costCurrency: extraction.cost_currency,
      origin: 'multimodal',
      metadata: {
        date: extraction.date,
        time: extraction.time,
        location: extraction.location,
        address: extraction.address,
        reservation_number: extraction.reservation_number,
        notes: extraction.notes,
        // Distinct from legacy categorical confidence — numeric 0..1
        vision_confidence: extraction.confidence,
      },
    });

    // Fire-and-forget conflict detector — never throws internally but wrap
    // for belt-and-suspenders per tripContextManager.ts:476 pattern.
    runAfterInsert(groupJid, decisionId).catch(() => {
      /* logged internally */
    });

    // Step 8 — Calendar suggest for dated extractions.
    if (extraction.date && extraction.time) {
      const eventDate = parseEventDate(extraction.date, extraction.time);
      if (eventDate === null) {
        logger.warn(
          {
            groupJid,
            date: extraction.date,
            time: extraction.time,
          },
          'multimodal: invalid date/time, skipping suggest',
        );
      } else {
        const cal = await ensureGroupCalendar(groupJid, group);
        if (!cal) {
          logger.warn(
            { groupJid },
            'multimodal: no calendar available, skipping suggest',
          );
        } else {
          await createSuggestion(
            groupJid,
            {
              title: extraction.title,
              date: eventDate,
              location: extraction.location ?? undefined,
            },
            cal.calendarId,
            cal.calendarLink,
            msg.key.id ?? decisionId,
            null, // senderName — multimodal has no proposer context
          ).catch((err) => {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), groupJid },
              'multimodal: createSuggestion failed',
            );
          });
        }
      }
    }

    // Step 9 — Post the 1-line ack (always on the success path).
    const lang = await detectGroupLanguage(groupJid);
    const ackText = buildAckText(lang, extraction.type, extraction.title);

    const { sock } = getState();
    if (!sock) {
      logger.warn({ groupJid }, 'multimodal: sock unavailable, cannot post ack');
      return;
    }

    try {
      await sock.sendMessage(groupJid, { text: ackText });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), groupJid },
        'multimodal: ack sendMessage failed',
      );
      // First failure is terminal (CONTEXT deferred retry).
    }
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        groupJid,
        msgId: msg.key.id,
      },
      'multimodalIntake: unexpected error',
    );
    // Never re-throw — the caller fires us and-forgets.
  }
}

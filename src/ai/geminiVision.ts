/**
 * Phase 52-01: Gemini vision wrapper for multimodal trip-fact extraction.
 *
 * Converts an image / PDF buffer + group context into a validated
 * `TripFactExtraction` object, or returns `null` on ANY failure path
 * (network throw, empty response, JSON parse error, schema violation).
 *
 * This is the self-contained building block that Plan 52-02's orchestrator
 * consumes. Intentionally has zero coupling to pipeline / DB / baileys.
 *
 * Locked decisions (see 52-CONTEXT.md):
 *   - Reuses `config.GEMINI_MODEL` (`gemini-2.5-flash`). NO new env var.
 *   - Invalid Gemini output is logged at warn/debug and dropped silently.
 *   - NO retry / backoff — first failure is terminal for the message.
 *   - NO medium-confidence HITL path — the 0.5–0.8 band is out of scope here.
 *
 * Exports:
 *   - TripFactExtractionSchema — Zod schema matching the CONTEXT § schema.
 *   - TripFactExtraction — inferred TS type.
 *   - GroupContext — prompt-disambiguation input type.
 *   - extractTripFact(buffer, mimeType, groupContext) — the wrapper.
 */

import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import { z } from 'zod';
import { config } from '../config.js';

const logger = pino({ level: config.LOG_LEVEL, name: 'geminiVision' });

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Locked shape — see `.planning/phases/52-multimodal-intake/52-CONTEXT.md`
 * § "Vision model & extraction schema". ALL fields except `type`, `title`,
 * `confidence` are required-nullable (NOT optional) so the model always emits
 * every key. Mirrors the Phase 51 TripClassifierSchema convention.
 */
export const TripFactExtractionSchema = z.object({
  type: z.enum(['flight', 'hotel', 'restaurant', 'activity', 'transit', 'other']),
  title: z.string(),
  date: z.string().nullable(),              // ISO-8601 YYYY-MM-DD
  time: z.string().nullable(),              // HH:MM destination-local
  location: z.string().nullable(),
  address: z.string().nullable(),
  reservation_number: z.string().nullable(),
  cost_amount: z.number().nullable(),
  cost_currency: z.string().nullable(),     // ISO-4217 3-char
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable(),
});

export type TripFactExtraction = z.infer<typeof TripFactExtractionSchema>;

// ─── Group context ────────────────────────────────────────────────────────────

/**
 * Caller-assembled context used to disambiguate the vision prompt without
 * bloating it. Plan 52-02's orchestrator populates this from
 * `trip_contexts` + recent active senders.
 */
export interface GroupContext {
  destination?: string | null;   // e.g. 'Italy' from trip_contexts.destination
  startDate?: string | null;     // ISO YYYY-MM-DD
  endDate?: string | null;       // ISO YYYY-MM-DD
  activePersons?: string[];      // recent senderNames for disambiguation
}

// ─── Gemini client + schema (hand-written, Gemini OpenAPI-subset) ─────────────

const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

/**
 * Hand-written response schema in Gemini's OpenAPI subset. We deliberately
 * do NOT depend on `zod-to-json-schema` (keeps dep graph small and matches
 * the shape Gemini actually accepts for structured output).
 *
 * Every field is listed in `required` so Gemini emits nulls explicitly —
 * this mirrors the Phase 51 classifier pattern.
 */
const GEMINI_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['flight', 'hotel', 'restaurant', 'activity', 'transit', 'other'],
    },
    title: { type: 'string' },
    date: { type: 'string', nullable: true },
    time: { type: 'string', nullable: true },
    location: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    reservation_number: { type: 'string', nullable: true },
    cost_amount: { type: 'number', nullable: true },
    cost_currency: { type: 'string', nullable: true },
    confidence: { type: 'number' },
    notes: { type: 'string', nullable: true },
  },
  required: [
    'type',
    'title',
    'date',
    'time',
    'location',
    'address',
    'reservation_number',
    'cost_amount',
    'cost_currency',
    'confidence',
    'notes',
  ],
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = [
  'You extract a single structured trip-related fact from a booking / ticket /',
  'reservation / confirmation image or PDF.',
  '',
  'Set `confidence` to 0..1 reflecting how clearly the core fields',
  '(type, title, date, location) are visible.',
  '  - 0.0–0.5 for ambiguous content (menu, logo, unrelated photo, sticker).',
  '  - 0.8–1.0 for explicit confirmations with dates and reservation numbers.',
  '',
  'Formatting rules (strict):',
  '  - `date` MUST be ISO YYYY-MM-DD. If only a month/year is visible, emit null.',
  '  - `time` MUST be HH:MM (24h) in destination-local time. If absent, null.',
  '  - `cost_currency` MUST be ISO-4217 (e.g. USD, EUR, ILS, JPY). If absent, null.',
  '  - Every nullable field MUST be emitted (use `null` when unknown).',
].join('\n');

/**
 * Serialize `GroupContext` compactly for the user prompt. Skips nulls so the
 * prompt stays short when context is sparse.
 */
function renderGroupContext(ctx: GroupContext): string {
  const parts: string[] = [];
  if (ctx.destination) parts.push(`destination=${ctx.destination}`);
  if (ctx.startDate && ctx.endDate) {
    parts.push(`dates=${ctx.startDate}..${ctx.endDate}`);
  } else if (ctx.startDate) {
    parts.push(`startDate=${ctx.startDate}`);
  } else if (ctx.endDate) {
    parts.push(`endDate=${ctx.endDate}`);
  }
  if (ctx.activePersons && ctx.activePersons.length > 0) {
    parts.push(`activePersons=${ctx.activePersons.join(',')}`);
  }
  return parts.length > 0 ? `Trip context: ${parts.join(', ')}.` : '';
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Extract a single structured trip fact from a media buffer.
 *
 * Returns `TripFactExtraction` on success, `null` on ANY failure path
 * (network, empty response, JSON parse error, schema violation). Never throws.
 */
export async function extractTripFact(
  buffer: Buffer,
  mimeType: string,
  groupContext: GroupContext,
): Promise<TripFactExtraction | null> {
  const contextLine = renderGroupContext(groupContext);
  const userPrompt = [
    contextLine,
    'Extract the trip fact from the attached media.',
    'If nothing clearly trip-related is visible, return confidence < 0.5.',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  let rawText: string | undefined;
  try {
    const response = await gemini.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: buffer.toString('base64') } },
            { text: userPrompt },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    });
    rawText = response.text?.trim();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), mimeType },
      'Gemini vision API call failed — dropping',
    );
    return null;
  }

  if (!rawText) {
    logger.warn({ mimeType }, 'Gemini vision returned empty response — dropping');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), rawText },
      'Gemini vision returned non-JSON text — dropping',
    );
    return null;
  }

  const result = TripFactExtractionSchema.safeParse(parsed);
  if (!result.success) {
    logger.debug(
      { issues: result.error.issues, parsed },
      'Gemini vision output violated schema — dropping',
    );
    return null;
  }

  return result.data;
}

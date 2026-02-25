import { z } from 'zod/v3';
import zodToJsonSchema from 'zod-to-json-schema';
import { config } from '../config.js';
import pino from 'pino';
import { generateJson } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedDate {
  title: string;
  date: Date;
  confidence: string;
}

// ─── Zod schema for Gemini structured output ─────────────────────────────────

const DateExtractionSchema = z.object({
  dates: z.array(
    z.object({
      title: z
        .string()
        .describe(
          'Concise smart title for the event, inferred from context (e.g., "Flight to Barcelona", "Dinner with Mom")',
        ),
      date: z
        .string()
        .describe(
          'ISO 8601 date string (YYYY-MM-DDTHH:mm:ss) in Asia/Jerusalem timezone',
        ),
      confidence: z
        .enum(['high', 'medium', 'low'])
        .describe(
          'How confident you are this is a real date/event mention',
        ),
    }),
  ),
});

const DATE_EXTRACTION_JSON_SCHEMA = zodToJsonSchema(DateExtractionSchema);

// ─── Pre-filter ───────────────────────────────────────────────────────────────

/**
 * Returns true if the text contains at least one digit character.
 * Used as a first gate to skip Gemini for messages that can't contain dates.
 * Note: We do NOT use chrono-node as a pre-filter because it doesn't support Hebrew.
 * Hebrew messages with digits pass through to Gemini regardless.
 */
export function hasNumberPreFilter(text: string): boolean {
  return /\d/.test(text);
}

// ─── Date extraction ──────────────────────────────────────────────────────────

/**
 * Use Gemini to extract structured date/event mentions from a message.
 * Filters to high-confidence results only.
 * Returns an empty array on any Gemini error — never crashes the pipeline.
 */
export async function extractDates(
  text: string,
  senderName: string | null,
  groupName: string | null,
): Promise<ExtractedDate[]> {
  const nowIso = new Date().toISOString();

  const systemInstruction = `You extract date and event mentions from WhatsApp group messages. The messages are in Hebrew or English. When you find a date reference, generate a concise smart title (like a calendar event name, not the raw message), resolve relative dates against the current date, and assess confidence. Only mark as 'high' confidence when there is a clear, unambiguous date or time reference tied to an event or commitment. Current date: ${nowIso}. Timezone: Asia/Jerusalem.`;

  const userContent = text;

  try {
    const raw = await generateJson<{ dates: { title: string; date: string; confidence: string }[] }>({
      systemPrompt: systemInstruction,
      userContent,
      jsonSchema: DATE_EXTRACTION_JSON_SCHEMA as Record<string, unknown>,
      schemaName: 'date_extraction',
    });

    if (!raw) {
      logger.debug({ text }, 'AI returned empty response for date extraction');
      return [];
    }

    const validated = DateExtractionSchema.safeParse(raw);
    if (!validated.success) {
      logger.warn(
        { err: validated.error.message, text },
        'AI date extraction response failed Zod validation',
      );
      return [];
    }

    // Filter to high-confidence only (per user decision: better to miss than create false event)
    const highConfidence = validated.data.dates.filter(
      (d) => d.confidence === 'high',
    );

    return highConfidence.map((d) => ({
      title: d.title,
      date: new Date(d.date),
      confidence: d.confidence,
    }));
  } catch (err) {
    logger.error(
      { err, senderName, groupName },
      'Error during date extraction — skipping',
    );
    return [];
  }
}

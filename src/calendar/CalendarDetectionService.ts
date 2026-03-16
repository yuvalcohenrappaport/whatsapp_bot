import { z } from 'zod';
import { config } from '../config.js';
import pino from 'pino';
import { generateJson } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedDate {
  title: string;
  date: Date;
  confidence: string;
  location?: string;
  description?: string;
  url?: string;
}

export interface DetectionContext {
  senderName: string | null;
  chatName: string | null; // group name or contact name
  chatType: 'group' | 'private';
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
      location: z
        .string()
        .optional()
        .describe(
          'Physical location or venue if mentioned in the message (e.g., "Isrotel Hotel, Eilat")',
        ),
      description: z
        .string()
        .optional()
        .describe('Relevant details about the event from the message'),
      url: z
        .string()
        .optional()
        .describe(
          'URL mentioned in the message related to this event, if any',
        ),
    }),
  ),
});

const DATE_EXTRACTION_JSON_SCHEMA = z.toJSONSchema(DateExtractionSchema);

// ─── CalendarDetectionService ────────────────────────────────────────────────

/**
 * Shared date detection service, callable from any pipeline (group or private).
 * Wraps Gemini-based date extraction with pre-filtering and validation.
 */
export class CalendarDetectionService {
  /**
   * Quick pre-filter: does the text contain any digit characters?
   * Used as a first gate to skip Gemini for messages that can't contain dates.
   * Note: We do NOT use chrono-node as a pre-filter because it doesn't support Hebrew.
   */
  hasDateSignal(text: string): boolean {
    return /\d/.test(text);
  }

  /**
   * Use Gemini to extract structured date/event mentions from a message.
   * Filters to high-confidence results only.
   * Returns an empty array on any Gemini error -- never crashes the pipeline.
   */
  async extractDates(
    text: string,
    context: DetectionContext,
  ): Promise<ExtractedDate[]> {
    const nowIso = new Date().toISOString();

    const systemInstruction = `You extract date and event mentions from WhatsApp messages. The messages are in Hebrew or English. When you find a date reference, generate a concise smart title (like a calendar event name, not the raw message), resolve relative dates against the current date, and assess confidence. Only mark as 'high' confidence when there is a clear, unambiguous date or time reference tied to an event or commitment. If the message mentions a physical location, venue, or URL related to the event, include them in the extraction. Current date: ${nowIso}. Timezone: Asia/Jerusalem.`;

    const userContent = text;

    try {
      const raw = await generateJson<{
        dates: {
          title: string;
          date: string;
          confidence: string;
          location?: string;
          description?: string;
          url?: string;
        }[];
      }>({
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

      const mapped = highConfidence.map((d) => ({
        title: d.title,
        date: new Date(d.date),
        confidence: d.confidence,
        location: d.location,
        description: d.description,
        url: d.url,
        _raw: d.date,
      }));

      const valid = mapped.filter((d) => {
        if (isNaN(d.date.getTime())) {
          logger.warn(
            { dateStr: d._raw, title: d.title },
            'Invalid date from Gemini -- skipping',
          );
          return false;
        }
        return true;
      });

      return valid.map(
        ({ title, date, confidence, location, description, url }) => ({
          title,
          date,
          confidence,
          location,
          description,
          url,
        }),
      );
    } catch (err) {
      logger.error(
        { err, context },
        'Error during date extraction -- skipping',
      );
      return [];
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const calendarDetection = new CalendarDetectionService();

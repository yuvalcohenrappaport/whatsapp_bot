import { z } from 'zod';
import { config } from '../config.js';
import pino from 'pino';
import { generateJson } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedCommitment {
  task: string;
  dateTime: Date | null; // null = timeless, default to 24h
  confidence: 'high' | 'medium';
  originalText: string;
  type: 'commitment' | 'task';
}

export interface CommitmentContext {
  contactName: string | null;
  contactJid: string;
  fromMe: boolean;
}

// ─── Pre-filter patterns ──────────────────────────────────────────────────────

const ACTION_VERBS_EN =
  /\b(I'll|I will|let me|I'm going to|I need to|I have to|I should|I can|gonna|going to|will send|will check|will do|will get|will call|will email|will update)\b/i;

const ACTION_VERBS_HE =
  /(אני א|אני מ|אשלח|אבדוק|אחזור|אעשה|אטפל|אדאג|אקח|ארשום|אקנה|אגיד|אבוא|אחזיר|אתקשר|אכתוב|אזמין|אשאל|אסיים|אפגש|אראה|אמצא|אביא|אמליץ|אפנה|אנסה|אחליט|אכין|אעדכן|אבקש|אחכה|אענה|אקבע|אתחיל|אשמור|אבטל|אסדר|אכבס|אוריד|אעלה|אתקדם|אשתדל|אשלים|אריץ|אציג|אאשר|אשלוף|אמסור|צריך ל|צריכה ל|חייב ל|חייבת ל|הולך ל|הולכת ל|הולכים ל|הולכות ל|מתכוון ל|מתכוונת ל)/;

// Narrower set of first-person commitment verbs used by hasActionVerb() to
// gate the calendar pipeline. Excludes motion/intention verbs (הולך ל,
// מתכוון ל, אני א, אני מ) and obligation forms (צריך ל, חייב ל) because
// those can describe events ("going to a restaurant", "need to be at the
// meeting") — we want those to still reach event detection.
const STRONG_ACTION_VERBS_HE =
  /(אשלח|אבדוק|אחזור|אעשה|אטפל|אדאג|אקח|ארשום|אקנה|אגיד|אחזיר|אתקשר|אכתוב|אזמין|אשאל|אסיים|אמצא|אביא|אמליץ|אפנה|אנסה|אחליט|אכין|אעדכן|אבקש|אחכה|אענה|אשמור|אבטל|אסדר|אכבס|אוריד|אעלה|אשתדל|אשלים|אריץ|אציג|אאשר|אשלוף|אמסור|צריך ל|צריכה ל|חייב ל|חייבת ל)/;

const TEMPORAL_MARKERS_EN =
  /\b(tomorrow|tonight|today|next week|next month|by monday|by tuesday|by wednesday|by thursday|by friday|this week|this evening|in the morning|later today|by end of day|by eod|asap)\b/i;

const TEMPORAL_MARKERS_HE =
  /(מחר|היום|הערב|שבוע הבא|חודש הבא|עד יום|עד סוף היום|בהקדם)/;

// ─── Zod schema for Gemini structured output ─────────────────────────────────

const CommitmentExtractionSchema = z.object({
  commitments: z.array(
    z.object({
      task: z
        .string()
        .describe(
          'Concise commitment description (e.g., "Send the report to David")',
        ),
      dateTime: z
        .string()
        .nullable()
        .describe(
          'ISO 8601 date string if time mentioned, null if timeless commitment',
        ),
      confidence: z
        .enum(['high', 'medium', 'low'])
        .describe(
          'How confident this is a real actionable commitment',
        ),
      originalText: z
        .string()
        .describe(
          'The part of the message containing the commitment',
        ),
      type: z
        .enum(['commitment', 'task'])
        .describe(
          'commitment = involves other people or has a specific time/deadline. task = personal/solo action item without a specific time (e.g., buy groceries, fix the door, call the plumber)',
        ),
    }),
  ),
});

const COMMITMENT_EXTRACTION_JSON_SCHEMA = z.toJSONSchema(
  CommitmentExtractionSchema,
);

// ─── CommitmentDetectionService ──────────────────────────────────────────────

/**
 * Detects commitments in private chat messages using a cheap JS pre-filter
 * followed by Gemini extraction for messages that pass.
 */
export class CommitmentDetectionService {
  /**
   * Quick pre-filter: does the message look like it might contain a commitment?
   * Checks for action verbs OR temporal markers in both Hebrew and English.
   * Short messages (<10 chars) are always rejected.
   */
  passesPreFilter(text: string, _fromMe: boolean): boolean {
    if (text.length < 10) return false;

    // Either action verbs or temporal markers are sufficient
    if (ACTION_VERBS_EN.test(text) || ACTION_VERBS_HE.test(text)) return true;
    if (TEMPORAL_MARKERS_EN.test(text) || TEMPORAL_MARKERS_HE.test(text))
      return true;

    return false;
  }

  /**
   * True if the message contains a first-person commitment action verb
   * (e.g. "I'll send", "צריך לקנות"). Used by the calendar pipeline to
   * skip event detection on task-like messages, preventing duplicate
   * task+event outputs for "buy milk tomorrow"-style sends.
   */
  hasActionVerb(text: string): boolean {
    return ACTION_VERBS_EN.test(text) || STRONG_ACTION_VERBS_HE.test(text);
  }

  /**
   * Use Gemini to extract structured commitments from a message.
   * Filters to high + medium confidence results.
   * Returns an empty array on any Gemini error -- never crashes the pipeline.
   */
  async extractCommitments(
    text: string,
    context: CommitmentContext,
  ): Promise<ExtractedCommitment[]> {
    const nowIso = new Date().toISOString();
    const contactLabel = context.contactName || 'the contact';

    const systemInstruction = `You extract promises, commitments, and tasks from WhatsApp messages (Hebrew or English). The message is from a private chat with ${contactLabel}.

Rules:
- Extract actionable commitments/promises the sender is making, and personal tasks/action items
- Distinguish actionable intent from social politeness
- For medium confidence: "I'll look into it", "let me check" = include. "yeah maybe", "we'll see" = skip
- Skip social niceties: "we should catch up", "talk soon", "see you", "have a good day"
- Resolve relative times against current date, timezone Asia/Jerusalem
- If no specific time mentioned, set dateTime to null

Also classify each item:
- "commitment" if it involves other people or mentions a specific time/deadline
- "task" if it's a personal/solo action item without a specific time

Examples:
- "I'll send it to David tomorrow" = commitment (involves David, has time)
- "I need to buy groceries" = task (solo, no time)
- "I'll look into it by Monday" = commitment (has deadline)
- "I need to fix the door" = task (solo, no time)

Current date: ${nowIso}. Timezone: Asia/Jerusalem.`;

    try {
      const raw = await generateJson<{
        commitments: {
          task: string;
          dateTime: string | null;
          confidence: 'high' | 'medium' | 'low';
          originalText: string;
          type: 'commitment' | 'task';
        }[];
      }>({
        systemPrompt: systemInstruction,
        userContent: text,
        jsonSchema:
          COMMITMENT_EXTRACTION_JSON_SCHEMA as Record<string, unknown>,
        schemaName: 'commitment_extraction',
      });

      if (!raw) {
        logger.debug(
          { text },
          'AI returned empty response for commitment extraction',
        );
        return [];
      }

      const validated = CommitmentExtractionSchema.safeParse(raw);
      if (!validated.success) {
        logger.warn(
          { err: validated.error.message, text },
          'AI commitment extraction response failed Zod validation',
        );
        return [];
      }

      // Filter to high + medium confidence (per user decision)
      const relevant = validated.data.commitments.filter(
        (c) => c.confidence === 'high' || c.confidence === 'medium',
      );

      return relevant
        .map((c) => {
          let dateTime: Date | null = null;
          if (c.dateTime) {
            const parsed = new Date(c.dateTime);
            if (isNaN(parsed.getTime())) {
              logger.warn(
                { dateStr: c.dateTime, task: c.task },
                'Invalid date from Gemini commitment -- using null',
              );
            } else {
              dateTime = parsed;
            }
          }

          return {
            task: c.task,
            dateTime,
            confidence: c.confidence as 'high' | 'medium',
            originalText: c.originalText,
            type: c.type,
          };
        });
    } catch (err) {
      logger.error(
        { err, context },
        'Error during commitment extraction -- skipping',
      );
      return [];
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const commitmentDetection = new CommitmentDetectionService();

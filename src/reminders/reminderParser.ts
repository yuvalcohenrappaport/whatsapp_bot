import { z } from 'zod';
import { generateJson } from '../ai/provider.js';

// ─── Pre-filter ──────────────────────────────────────────────────────────────

export const REMINDER_KEYWORDS_RE = new RegExp(
  [
    'remind', 'reminder', "don'?t forget", 'set.{0,10}reminder',
    'cancel.{0,10}reminder', 'delete.{0,10}reminder',
    'change.{0,10}reminder', 'edit.{0,10}reminder',
    'never\\s*mind.{0,10}reminder',
    // Hebrew
    'תזכיר', 'תזכורת', 'אל\\s*תשכח', 'בטל.*תזכורת',
    'שנה.*תזכורת', 'מחק.*תזכורת',
  ].join('|'),
  'i',
);

/**
 * Quick keyword check to avoid unnecessary Gemini calls.
 * Generous — false positives just cost one Gemini call; false negatives mean missed reminders.
 */
export function hasReminderIntent(text: string): boolean {
  return REMINDER_KEYWORDS_RE.test(text);
}

// ─── Zod schema for Gemini structured output ─────────────────────────────────

const ReminderParseSchema = z.object({
  intent: z.enum(['set', 'cancel', 'edit', 'none']),
  task: z.string().optional(),
  dateTime: z
    .string()
    .optional()
    .describe('ISO 8601 date-time string in Asia/Jerusalem timezone'),
  editTarget: z
    .string()
    .optional()
    .describe('Description of the reminder to cancel or edit'),
  editNewTime: z
    .string()
    .optional()
    .describe('New ISO 8601 time if editing'),
  editNewTask: z
    .string()
    .optional()
    .describe('New task description if editing'),
});

export type ReminderParsed = z.infer<typeof ReminderParseSchema>;

const REMINDER_PARSE_JSON_SCHEMA = z.toJSONSchema(ReminderParseSchema);

// ─── Gemini-based parser ─────────────────────────────────────────────────────

/**
 * Parse a reminder command from natural language using Gemini.
 * Returns null if Gemini fails or returns invalid data.
 */
export async function parseReminderCommand(
  text: string,
): Promise<ReminderParsed | null> {
  const nowIso = new Date().toISOString();

  const systemPrompt = `You parse reminder commands from WhatsApp messages in Hebrew or English.
The user is setting, cancelling, or editing personal reminders.
Current date/time: ${nowIso}. Timezone: Asia/Jerusalem.

For "set" intent: extract the task description and the target date/time as ISO 8601 in Asia/Jerusalem timezone.
If no time is specified, default to tomorrow at 09:00 Asia/Jerusalem.
For "cancel" intent: extract description of the reminder to cancel in editTarget.
For "edit" intent: extract the target reminder description in editTarget, and the new time/task in editNewTime/editNewTask.
If the message is not a reminder command, return intent "none".`;

  const raw = await generateJson<ReminderParsed>({
    systemPrompt,
    userContent: text,
    jsonSchema: REMINDER_PARSE_JSON_SCHEMA as Record<string, unknown>,
    schemaName: 'reminder_parse',
  });

  if (!raw) return null;

  const validated = ReminderParseSchema.safeParse(raw);
  if (!validated.success) return null;

  return validated.data;
}

// ─── Cancel/Edit matching via Gemini ─────────────────────────────────────────

const ReminderMatchSchema = z.object({
  matchedIds: z.array(z.string()),
});

const REMINDER_MATCH_JSON_SCHEMA = z.toJSONSchema(ReminderMatchSchema);

const matchTimeFormatter = new Intl.DateTimeFormat('en-IL', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Match a user's cancel/edit description against pending reminders using Gemini.
 * Handles Hebrew, English, and fuzzy descriptions naturally.
 * Returns matched reminder IDs, or null on Gemini failure.
 */
export async function matchReminderForCancelEdit(
  userDescription: string,
  pendingReminders: Array<{ id: string; task: string; fireAt: number }>,
): Promise<{ matchedIds: string[] } | null> {
  if (pendingReminders.length === 0) return { matchedIds: [] };

  // If only one reminder, skip Gemini and return it directly
  if (pendingReminders.length === 1) {
    return { matchedIds: [pendingReminders[0].id] };
  }

  const numberedList = pendingReminders
    .map((r, i) => {
      const time = matchTimeFormatter.format(new Date(r.fireAt));
      return `${i + 1}. ID: "${r.id}" — Task: "${r.task}" — Due: ${time}`;
    })
    .join('\n');

  const systemPrompt = `You match a user's description to their pending reminders.
The user wants to find a specific reminder (to cancel or edit it).
Return the IDs of matching reminders. If no reminder matches, return an empty array.
Be generous with matching — the user may use partial descriptions, different language (Hebrew/English), or fuzzy wording.
If the description is very vague and could match multiple, return all plausible matches.

Here are the user's pending reminders:
${numberedList}`;

  const raw = await generateJson<{ matchedIds: string[] }>({
    systemPrompt,
    userContent: `Find: "${userDescription}"`,
    jsonSchema: REMINDER_MATCH_JSON_SCHEMA as Record<string, unknown>,
    schemaName: 'reminder_match',
  });

  if (!raw) return null;

  const validated = ReminderMatchSchema.safeParse(raw);
  if (!validated.success) return null;

  // Filter to only IDs that actually exist in pending list
  const validIds = new Set(pendingReminders.map((r) => r.id));
  const filtered = validated.data.matchedIds.filter((id) => validIds.has(id));

  return { matchedIds: filtered };
}

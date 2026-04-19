/**
 * Phase 42 enrichment module.
 *
 * At approval time, `enrichActionable` takes the last ~10 messages from the
 * source chat and returns a self-contained Google Tasks title + rich audit note
 * so the task is fully readable from the Google Tasks UI alone.
 *
 * Design principles:
 *  - NEVER throws — every failure path returns the safe fallback.
 *  - user_command short-circuits immediately (no Gemini call, no latency).
 *  - Zod validates the structured Gemini response (title + note fields).
 *  - buildBasicNote is imported from approvalHandler.ts to stay the single
 *    source of truth for the fallback note format.
 */
import { z } from 'zod';
import pino from 'pino';
import { config } from '../config.js';
import { generateJson } from '../ai/provider.js';
import { getRecentMessages } from '../db/queries/messages.js';
import { buildBasicNote } from './approvalHandler.js';
import type { Actionable } from '../db/queries/actionables.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Enrichment {
  title: string;
  note: string;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const EnrichmentSchema = z.object({
  title: z.string().min(1).max(200).describe(
    'Self-contained Google Tasks title. MUST include the contact\'s name when not self-chat. Resolve pronouns/vague refs using the chat context. Include a concrete deadline (e.g. "by Monday") when a time was detected. Max ~80 chars preferred.',
  ),
  note: z.string().min(1).describe(
    'Rich audit note. Multi-line. Include: Contact: <name>, Original: "<trigger message>", Context: <1-2 line summary of the chat context that makes the task self-explanatory>.',
  ),
});

const ENRICHMENT_JSON_SCHEMA = z.toJSONSchema(EnrichmentSchema);

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You enrich detected commitments/tasks into self-contained Google Tasks entries.

You receive:
- A detected task string (often vague, e.g. "Check it")
- The contact's display name and JID
- The language the chat is in (he or en)
- The most recent ~10 messages from that chat, chronological

Your output is a JSON object {title, note}:

title rules:
- Self-contained — readable with zero chat context
- Include the contact's name when sourceContactJid is NOT self-chat (the \`self@s.whatsapp.net\` / \`<USER_JID>\` case)
- Resolve pronouns and vague refs ("it", "that", "the thing") using the chat history
- Include a concrete deadline when one was detected ("by Monday", "tomorrow evening", "next week")
- Write the title in the same language as the chat (he or en)

note rules:
- Multi-line, for audit from Google Tasks UI alone
- Line 1: \`Contact: <name>\`
- Line 2: \`Original: "<verbatim trigger message, truncated to 200 chars>"\`
- Line 3+: \`Context: <1-2 line summary of the chat context that makes the task self-explanatory>\`

If you cannot confidently enrich, return a title that falls back to the detected task VERBATIM plus the contact name, and a basic note. Never invent facts not in the provided messages.`;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Enrich an actionable with a self-contained Google Tasks title and rich
 * audit note. Never throws — returns the safe fallback on any failure.
 *
 * user_command short-circuits immediately (Phase 41 Q9A-1 decision):
 * /remind me commands are owner-authored, enrichment adds latency for zero gain.
 */
export async function enrichActionable(actionable: Actionable): Promise<Enrichment> {
  // 1. user_command short-circuit — no Gemini call, no latency.
  if (actionable.sourceType === 'user_command') {
    return { title: actionable.task, note: buildBasicNote(actionable) };
  }

  // 2. Load chat history (empty history is allowed — trigger + contact name may suffice).
  const recent = await getRecentMessages(actionable.sourceContactJid, 10);

  // 3. Build user content.
  const historyBlock = recent.length === 0
    ? '(no prior messages available)'
    : recent.map((m) => `${m.fromMe ? 'me' : 'them'}: ${m.body}`).join('\n');

  const userContent = [
    `Detected task: ${actionable.task}`,
    `Contact name: ${actionable.sourceContactName ?? '(unknown)'}`,
    `Contact JID: ${actionable.sourceContactJid}`,
    `Chat language: ${actionable.detectedLanguage}`,
    `Trigger message: "${actionable.sourceMessageText}"`,
    '',
    'Recent chat history (chronological, `them:` = contact, `me:` = user):',
    historyBlock,
  ].join('\n');

  // 4. Call Gemini + validate.
  try {
    const raw = await generateJson<{ title: string; note: string }>({
      systemPrompt: SYSTEM_PROMPT,
      userContent,
      jsonSchema: ENRICHMENT_JSON_SCHEMA as Record<string, unknown>,
      schemaName: 'actionable_enrichment',
    });

    if (!raw) {
      // Gemini returned null (legitimate empty response — not an error).
      return fallback(actionable);
    }

    const parsed = EnrichmentSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { err: parsed.error.message, id: actionable.id },
        'enrichment Zod parse failed — using fallback',
      );
      return fallback(actionable);
    }

    if (!parsed.data.title.trim()) {
      return fallback(actionable);
    }

    return { title: parsed.data.title.trim(), note: parsed.data.note.trim() };
  } catch (err) {
    logger.warn(
      { err, id: actionable.id },
      'enrichment Gemini call threw — using fallback',
    );
    return fallback(actionable);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fallback(a: Actionable): Enrichment {
  return { title: a.task, note: buildBasicNote(a) };
}

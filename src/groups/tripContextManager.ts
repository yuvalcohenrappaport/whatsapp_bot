import crypto from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { generateJson, generateText } from '../ai/provider.js';
import { getState } from '../api/state.js';
import { z } from 'zod';
import {
  getTripContext,
  upsertTripContext,
  insertTripDecision,
  getDecisionsByGroup,
  getUnresolvedOpenItems,
  resolveOpenItem,
} from '../db/queries/tripMemory.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: string;
  senderJid: string;
  senderName: string | null;
  body: string;
  timestamp: number;
}

// ─── Section 1: Pre-filter ────────────────────────────────────────────────────

/** Minimum message length to attempt classification */
const MIN_CLASSIFY_LENGTH = 15;

/**
 * Travel signal keywords (English as word boundaries, Hebrew without since prefix
 * letters attach: e.g. "במלון" contains "מלון").
 */
const TRAVEL_SIGNALS =
  /\b(hotel|hostel|airbnb|flight|fly|airport|book|reserve|booked|decided|destination|budget|itinerary|trip|travel|vacation|rent|car rental)\b|מלון|טיסה|הזמנ|טיול|תקציב|יעד|נופש|השכר|רכב|החלטנו|הזמנו|סגרנו|נסגר/i;

/**
 * Short ack patterns to skip before travel-signal check.
 * Matches emoji-only (up to 10 chars) and common acknowledgment words in English/Hebrew.
 */
const SKIP_PATTERNS =
  /^[\p{Emoji}\s]{1,10}$|^(ok|lol|haha|yes|no|אוקי|כן|לא|נכון|סבבה|👍|❤️|😂|🤣|😍)\s*$/iu;

/**
 * Pre-filter: cheap JavaScript check before any Gemini call.
 * Returns true only if the message may contain a travel-related decision or discussion.
 */
export function hasTravelSignal(text: string): boolean {
  if (text.length < MIN_CLASSIFY_LENGTH) return false;
  if (SKIP_PATTERNS.test(text)) return false;
  return TRAVEL_SIGNALS.test(text);
}

// ─── Section 2: Debounce buffer ───────────────────────────────────────────────

/**
 * Independent trip-context debounce buffers.
 * Completely separate from the calendar-extraction debounce in groupMessagePipeline.ts.
 */
const tripDebounceBuffers = new Map<
  string,
  { messages: GroupMsg[]; timer: NodeJS.Timeout }
>();

/** Debounce window — flush batch to Gemini after 10s of silence */
const TRIP_DEBOUNCE_MS = 10_000;

/**
 * Add a message to the trip-context debounce buffer for a group.
 * Pre-filter runs first; messages without travel signals never enter the buffer.
 * Exported so groupMessagePipeline.ts can call it as a non-terminal pipeline step.
 */
export function addToTripContextDebounce(groupJid: string, msg: GroupMsg): void {
  if (!hasTravelSignal(msg.body)) {
    logger.debug({ msgId: msg.id }, 'Trip pre-filter: no travel signal, skipping');
    return;
  }

  const existing = tripDebounceBuffers.get(groupJid);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(msg);

    existing.timer = setTimeout(() => {
      tripDebounceBuffers.delete(groupJid);
      processTripContext(groupJid, existing.messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in debounced processTripContext');
      });
    }, TRIP_DEBOUNCE_MS);
  } else {
    const messages = [msg];
    const timer = setTimeout(() => {
      tripDebounceBuffers.delete(groupJid);
      processTripContext(groupJid, messages).catch((err) => {
        logger.error({ err, groupJid }, 'Error in debounced processTripContext');
      });
    }, TRIP_DEBOUNCE_MS);

    tripDebounceBuffers.set(groupJid, { messages, timer });
  }
}

// ─── Section 2b: Proactive suggestion state (in-memory only) ─────────────────

interface GroupProactiveState {
  lastSentAt: number;
  dailyCount: number;
  dailyDate: string; // 'YYYY-MM-DD'
  triggeredDestinations: Set<string>;
}

const proactiveState = new Map<string, GroupProactiveState>();

/**
 * Check whether a proactive suggestion can be sent for this group + destination.
 * Returns false if:
 *  1. Destination already triggered (one-shot per destination)
 *  2. Less than 2 hours since last proactive message in this group
 *  3. Daily cap of 3 messages already reached
 */
function canSendProactive(groupJid: string, destination: string): boolean {
  const entry = proactiveState.get(groupJid);
  if (!entry) return true; // first-ever for this group

  // 1. One-shot per destination
  if (entry.triggeredDestinations.has(destination)) return false;

  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Reset daily counter if new day
  if (entry.dailyDate !== todayStr) {
    entry.dailyCount = 0;
    entry.dailyDate = todayStr;
  }

  // 2. 2-hour cooldown
  if (now - entry.lastSentAt < 2 * 60 * 60 * 1000) return false;

  // 3. Daily cap
  if (entry.dailyCount >= 3) return false;

  return true;
}

/**
 * Record that a proactive suggestion was sent/scheduled for this group + destination.
 * Called BEFORE setTimeout fires to prevent double-scheduling from concurrent flushes.
 */
function recordProactiveSent(groupJid: string, destination: string): void {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const entry = proactiveState.get(groupJid);

  if (!entry || entry.dailyDate !== todayStr) {
    // First entry or new day — create fresh
    proactiveState.set(groupJid, {
      lastSentAt: now,
      dailyCount: 1,
      dailyDate: todayStr,
      triggeredDestinations: new Set([destination]),
    });
  } else {
    entry.lastSentAt = now;
    entry.dailyCount++;
    entry.triggeredDestinations.add(destination);
  }
}

// ─── Section 2c: Proactive suggestion sender ─────────────────────────────────

async function sendProactiveSuggestion(
  groupJid: string,
  destination: string,
): Promise<void> {
  const { sock } = getState();
  if (!sock) {
    logger.warn({ groupJid }, 'sendProactiveSuggestion: sock is null — skipping');
    return;
  }

  const tips = await generateText({
    systemPrompt:
      'אתה חבר שטייל הרבה ויודע המלצות טובות. כתוב רשימה קצרה של 3-4 פעילויות מומלצות ליעד שנבחר. ' +
      'הסגנון: ידידותי, קצר, מעשי — כמו חבר שמשתף טיפ טוב. ' +
      'פתח עם "ראיתי שבחרתם [יעד]! הנה כמה רעיונות:" ואז רשימת נקודות קצרות. ' +
      'כתוב בעברית בלבד. אל תוסיף הקדמה או סיום נוספים.',
    messages: [
      {
        role: 'user',
        content: `יעד הטיול: ${destination}. תן 3-4 המלצות פעילויות קצרות ומעשיות.`,
      },
    ],
  });

  if (!tips) {
    logger.warn({ groupJid, destination }, 'Proactive suggestion: Gemini returned null');
    return;
  }

  await sock.sendMessage(groupJid, { text: tips });
  logger.info({ groupJid, destination }, 'Proactive travel suggestion sent');
}

// ─── Section 3: Zod schema for classifier output ─────────────────────────────

const TripClassifierSchema = z.object({
  decisions: z
    .array(
      z.object({
        type: z.enum([
          'destination',
          'accommodation',
          'activity',
          'transport',
          'dates',
          'budget',
        ]),
        value: z.string().describe('The confirmed decision text'),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .describe('Confirmed trip decisions found in the messages'),
  openItems: z
    .array(
      z.object({
        question: z
          .string()
          .describe('The unanswered question or unresolved commitment'),
        context: z
          .string()
          .describe('Brief context about what prompted this question'),
      }),
    )
    .describe('Open questions or unresolved items'),
  resolvedQuestions: z
    .array(z.string())
    .describe(
      'Exact text of previously tracked open questions that appear to be answered in these messages',
    ),
  contextSummary: z
    .string()
    .nullable()
    .describe(
      'Brief updated summary of the trip planning state, or null if no travel content',
    ),
});

/** JSON schema generated once at module load — passed to Gemini's responseSchema */
const CLASSIFIER_JSON_SCHEMA = z.toJSONSchema(TripClassifierSchema);

type ClassifierOutput = z.infer<typeof TripClassifierSchema>;

// ─── Section 4: Classifier prompt builder ────────────────────────────────────

function buildClassifierPrompt(
  existingContext: ReturnType<typeof getTripContext>,
  existingDecisions: ReturnType<typeof getDecisionsByGroup>,
  existingOpenItems: ReturnType<typeof getUnresolvedOpenItems>,
): string {
  const contextStr = existingContext?.contextSummary ?? 'None yet';

  const decisionsStr =
    existingDecisions.length > 0
      ? existingDecisions
          .map((d) => `- ${d.type}: ${d.value} (${d.confidence})`)
          .join('\n')
      : 'None yet';

  const openQuestionsStr =
    existingOpenItems.length > 0
      ? existingOpenItems.map((item) => `- ${item.value}`).join('\n')
      : 'None';

  return `You are analyzing WhatsApp group messages for a trip planning assistant. The messages may be in Hebrew, English, or a mix of both.

Your task is to extract:
1. **Trip decisions**: Confirmed choices about destination, accommodation, activities, transport, dates, or budget. Only mark something as a decision if the group has clearly agreed or confirmed it (not just suggesting or asking). Hebrew decisions may use phrases like "סגרנו", "החלטנו", "הזמנו", "נסגר".
2. **Open questions**: Unanswered questions or unresolved commitments about the trip. Include both explicit questions and implied "we need to figure out X" items.
3. **Context summary**: A brief updated summary of the current trip planning state.
4. **Resolved questions**: List the EXACT text of any open questions from the "Open questions currently tracked" below that appear to be answered in these messages.

Confidence levels:
- "high": Explicit agreement or confirmation in the messages
- "medium": Strong implication that a decision was made
- "low": Casual mention only — you will NOT insert these, so use low only when unsure

Do NOT create a decision if it duplicates an existing one (same type and similar meaning).

Existing trip context:
${contextStr}

Existing decisions:
${decisionsStr}

Open questions currently tracked:
${openQuestionsStr}`;
}

// ─── Section 5: processTripContext ────────────────────────────────────────────

/**
 * Flush handler for the trip-context debounce.
 * Classifies batched messages with Gemini and persists results to tripContexts + tripDecisions.
 * All errors are caught — this runs fire-and-forget in a setTimeout callback.
 */
async function processTripContext(
  groupJid: string,
  messages: GroupMsg[],
): Promise<void> {
  try {
    // 1. Load existing context, decisions, and open items for deduplication
    const existingContext = getTripContext(groupJid);
    const existingDecisions = getDecisionsByGroup(groupJid);
    const existingOpenItems = getUnresolvedOpenItems(groupJid);

    // 2. Format messages for classifier
    const messagesText = messages
      .map((m) => `${m.senderName ?? 'Unknown'}: ${m.body}`)
      .join('\n');

    // 3. Format existing decisions for the prompt
    const systemPrompt = buildClassifierPrompt(existingContext, existingDecisions, existingOpenItems);

    // 4. Call Gemini classifier
    const result = await generateJson<ClassifierOutput>({
      systemPrompt,
      userContent: messagesText,
      jsonSchema: CLASSIFIER_JSON_SCHEMA as Record<string, unknown>,
      schemaName: 'trip_context_classifier',
    });

    if (result === null) {
      logger.warn({ groupJid }, 'Trip classifier returned null — skipping persistence');
      return;
    }

    // 5. Upsert trip context summary if provided
    if (result.contextSummary !== null) {
      const destinationDecision = result.decisions.find(
        (d) => d.type === 'destination' && d.confidence !== 'low',
      );
      const datesDecision = result.decisions.find(
        (d) => d.type === 'dates' && d.confidence !== 'low',
      );

      upsertTripContext(groupJid, {
        destination:
          destinationDecision?.value ?? existingContext?.destination ?? null,
        dates: datesDecision?.value ?? existingContext?.dates ?? null,
        contextSummary: result.contextSummary,
      });
    }

    // 6. Persist decisions (skip low-confidence)
    let decisionsInserted = 0;
    for (const decision of result.decisions) {
      if (decision.confidence === 'low') continue;
      insertTripDecision({
        id: crypto.randomUUID(),
        groupJid,
        type: decision.type,
        value: decision.value,
        confidence: decision.confidence,
        sourceMessageId: messages[0]?.id ?? null,
      });
      decisionsInserted++;
    }

    // 7. Persist open questions
    let openItemsInserted = 0;
    for (const item of result.openItems) {
      insertTripDecision({
        id: crypto.randomUUID(),
        groupJid,
        type: 'open_question',
        value: item.question,
        confidence: 'high',
        sourceMessageId: messages[0]?.id ?? null,
      });
      openItemsInserted++;
    }

    // 8. Auto-resolve open questions
    let resolvedCount = 0;
    if (result.resolvedQuestions && result.resolvedQuestions.length > 0) {
      for (const resolvedText of result.resolvedQuestions) {
        const match = existingOpenItems.find((item) =>
          item.value.toLowerCase().includes(resolvedText.toLowerCase().slice(0, 30)),
        );
        if (match) {
          resolveOpenItem(match.id);
          resolvedCount++;
          logger.info({ groupJid, question: resolvedText }, 'Open question auto-resolved');
        }
      }
    }

    // 9. Check for new destination -> proactive suggestion trigger
    const newDestinationDecision = result.decisions.find(
      (d) => d.type === 'destination' && d.confidence !== 'low',
    );

    if (newDestinationDecision) {
      // Compare against what was in DB BEFORE this classifier run
      const isNewDestination =
        existingContext?.destination !== newDestinationDecision.value;

      if (isNewDestination && canSendProactive(groupJid, newDestinationDecision.value)) {
        // Record immediately to prevent double-scheduling from concurrent debounce flushes
        recordProactiveSent(groupJid, newDestinationDecision.value);

        const delayMs = (5 + Math.floor(Math.random() * 11)) * 60 * 1000; // 5-15 minutes
        setTimeout(() => {
          sendProactiveSuggestion(groupJid, newDestinationDecision.value).catch((err) => {
            logger.error({ err, groupJid }, 'Error sending proactive suggestion');
          });
        }, delayMs);

        logger.info(
          { groupJid, destination: newDestinationDecision.value, delayMs: Math.round(delayMs / 1000) },
          'Proactive suggestion scheduled',
        );
      }
    }

    logger.info(
      { groupJid, decisionsInserted, openItemsInserted, resolvedCount },
      'Trip context classified and persisted',
    );
  } catch (err) {
    logger.error({ err, groupJid }, 'Error in processTripContext');
  }
}

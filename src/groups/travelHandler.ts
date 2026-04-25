import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { parseTravelIntent, type TravelIntent } from './travelParser.js';
import { searchTravel } from './travelSearch.js';
import { formatTravelResults, formatHelpText } from './travelFormatter.js';
import { getGroupMessagesSince } from '../db/queries/groupMessages.js';
import { getDecisionsByGroup, searchGroupMessages, getTripContext } from '../db/queries/tripMemory.js';
import { generateText } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// Re-export TravelIntent so downstream modules can import from this module
export type { TravelIntent };

// --- Reply chain context ---

/**
 * In-memory map of bot travel result message IDs to their context.
 * Ephemeral -- resets on restart (follow-up replies fall through to clarification naturally).
 * Capped at 500 entries to prevent unbounded memory growth.
 */
export const travelResultMessages = new Map<
  string,
  { query: string; results: string; groupJid: string }
>();

const TRAVEL_RESULT_MAP_MAX = 500;

/**
 * Store a travel result message in the Map, evicting the oldest entry if over cap.
 */
function storeTravelResult(
  msgId: string,
  entry: { query: string; results: string; groupJid: string },
): void {
  if (travelResultMessages.size >= TRAVEL_RESULT_MAP_MAX) {
    // Delete the oldest entry (first key in Map iteration order)
    const firstKey = travelResultMessages.keys().next().value;
    if (firstKey !== undefined) {
      travelResultMessages.delete(firstKey);
    }
  }
  travelResultMessages.set(msgId, entry);
}

// --- Per-group rate limiting ---

/** Per-group last request timestamp for rate limiting (groupJid -> epoch ms). */
const lastRequestTime = new Map<string, number>();

/** Minimum interval between travel search requests per group (30 seconds). */
const RATE_LIMIT_MS = 30_000;

// --- Bot mention detection ---

/**
 * Check if the bot is mentioned in the message via native @mention or typed display name.
 * Matches on numeric JID prefix only to handle LID format mismatch (Baileys v7 RC pitfall).
 */
function isBotMentioned(
  body: string,
  mentionedJids: string[],
  botJid: string,
): boolean {
  // Native @mention: match on numeric prefix (handles @s.whatsapp.net vs @lid)
  const botNumericPrefix = botJid.split('@')[0];
  const jidMatches = mentionedJids.some(
    (jid) => jid.split('@')[0] === botNumericPrefix,
  );
  if (jidMatches) return true;

  // Text mention: user typed "@bot" or "בוט" in message body
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes('@bot') || lowerBody.includes('בוט')) return true;

  return false;
}

// --- Language detection import (lazy to avoid circular) ---

let detectGroupLanguageFn: ((groupJid: string) => Promise<'he' | 'en'>) | null = null;

async function getDetectGroupLanguage(): Promise<(groupJid: string) => Promise<'he' | 'en'>> {
  if (!detectGroupLanguageFn) {
    const mod = await import('./calendarHelpers.js');
    detectGroupLanguageFn = mod.detectGroupLanguage;
  }
  return detectGroupLanguageFn;
}

// --- History search handler ---

/**
 * Handle a history_search intent: queries stored trip decisions and FTS5 message history,
 * then synthesizes a natural language answer via Gemini.
 * Never triggers a live web search.
 */
async function handleHistorySearch(
  groupJid: string,
  intent: TravelIntent,
  lang: 'he' | 'en',
): Promise<string> {
  // 1. Load stored trip decisions and trip context for this group
  const decisions = getDecisionsByGroup(groupJid);
  const tripContext = getTripContext(groupJid);

  // 2. Determine search terms from intent
  const searchTerms =
    intent.searchQuery ??
    intent.destination ??
    intent.preferences ??
    '';

  // 3. Run FTS5 search if we have search terms
  const ftsResults =
    searchTerms.trim().length > 0
      ? searchGroupMessages(groupJid, searchTerms, 15)
      : [];

  // 4. Format decisions as a readable list
  const decisionsText =
    decisions.length > 0
      ? decisions
          .map((d) => {
            const date = new Date(d.createdAt).toLocaleDateString();
            return `- [${d.type}]: ${d.value} (${d.confidence}, ${date})`;
          })
          .join('\n')
      : '(no stored decisions)';

  // 5. Format FTS results as a readable list
  const ftsText =
    ftsResults.length > 0
      ? ftsResults
          .map((r) => {
            const truncated =
              r.body.length > 200 ? r.body.slice(0, 200) + '...' : r.body;
            return `- ${r.senderName ?? 'Unknown'}: ${truncated}`;
          })
          .join('\n')
      : '(no relevant messages found)';

  // 6. Format trip context summary
  const contextText = tripContext
    ? [
        tripContext.destination ? `Destination: ${tripContext.destination}` : null,
        tripContext.dates ? `Dates: ${tripContext.dates}` : null,
        tripContext.contextSummary ? `Summary: ${tripContext.contextSummary}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '(no trip context)';

  // 7. Build Gemini generateText call
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';
  const systemPrompt = `You are a WhatsApp group trip assistant. Answer the user's question about past trip decisions based ONLY on the provided data. If no relevant decision or message exists, say so honestly -- do not make up information. Reply in ${langLabel}. Keep the answer concise (2-4 sentences).`;

  const userQuestion = intent.searchQuery ?? intent.destination ?? intent.preferences ?? 'What did we decide?';

  const userMessage = `User question: ${userQuestion}

Stored trip decisions:
${decisionsText}

Relevant messages from chat history:
${ftsText}

Trip context:
${contextText}`;

  const answer = await generateText({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  // 8. Fallback if Gemini returns empty
  if (!answer) {
    return lang === 'he'
      ? 'אין לי החלטות מאוחסנות על הנושא הזה.'
      : "I don't have any stored decisions about that topic.";
  }

  return answer;
}

// --- Main handler ---

/**
 * Handle a potential travel @mention in a group message.
 * Returns true if the message was an @mention (handled), false if not (caller continues to debounce).
 *
 * Also handles reply chain follow-ups: replying to a travel result message
 * triggers a follow-up search with context from the original query, even without @mention.
 *
 * Runs immediately -- not debounced. Same pattern as reply-to-delete.
 */
export async function handleTravelMention(
  groupJid: string,
  msg: {
    id: string;
    senderJid: string;
    senderName: string | null;
    body: string;
    timestamp: number;
  },
  quotedMessageId: string | null,
  mentionedJids: string[],
): Promise<boolean> {
  const { botJid, botDisplayName, sock } = getState();

  // If bot identity not yet available (socket not connected), skip
  if (!botJid || !botDisplayName) {
    logger.warn(
      { groupJid },
      'Bot identity not available yet -- skipping travel mention check',
    );
    return false;
  }

  // --- Reply chain detection ---
  // If the message is a reply to a previous travel result, treat it as a travel
  // follow-up regardless of @mention presence.
  const isReplyToTravelResult =
    quotedMessageId !== null && travelResultMessages.has(quotedMessageId);

  // Check if bot is mentioned (or this is a reply chain follow-up)
  if (!isReplyToTravelResult && !isBotMentioned(msg.body, mentionedJids, botJid)) {
    return false;
  }

  // Bot is mentioned or this is a follow-up reply -- handle immediately
  logger.info(
    { groupJid, msgId: msg.id, senderJid: msg.senderJid, isReplyToTravelResult },
    'Bot @mention or travel reply chain detected in group message',
  );

  if (!sock) {
    logger.warn({ groupJid }, 'sock is null -- cannot respond to travel mention');
    return true; // Still "handled" to avoid passing to debounce
  }

  // Detect language for responses
  const detectGroupLanguage = await getDetectGroupLanguage();
  const lang = await detectGroupLanguage(groupJid);

  // --- Per-group rate limiting ---
  const lastTime = lastRequestTime.get(groupJid);
  if (lastTime && Date.now() - lastTime < RATE_LIMIT_MS) {
    const rateLimitText =
      lang === 'he'
        ? 'בבקשה המתינו רגע לפני החיפוש הבא.'
        : 'Please wait a moment before the next search.';
    await sock.sendMessage(groupJid, { text: rateLimitText });
    return true;
  }
  lastRequestTime.set(groupJid, Date.now());

  // Send "Searching..." indicator immediately (before Gemini parsing)
  const searchingText = lang === 'he' ? '...מחפש' : 'Searching...';
  await sock.sendMessage(groupJid, { text: searchingText });

  // Gather recent group context (last 2 hours, up to 20 messages)
  let recentContext = '';
  try {
    const sinceMs = Date.now() - 2 * 60 * 60 * 1000;
    const recentMsgs = getGroupMessagesSince(groupJid, sinceMs, 20);
    recentContext = recentMsgs
      .map((m) => `${m.senderName ?? 'Unknown'}: ${m.body}`)
      .join('\n');
  } catch (err) {
    logger.warn({ err, groupJid }, 'Failed to fetch recent group context');
  }

  // Check if this is a reply to a previous travel result (reply chain support)
  const priorContext = quotedMessageId
    ? travelResultMessages.get(quotedMessageId)
    : null;
  if (priorContext) {
    recentContext =
      `[FOLLOW-UP SEARCH] This message is a reply to a previous travel search result. ` +
      `The user is refining or continuing their search. Treat this as travel-related.\n` +
      `Previous search query: ${priorContext.query}\n` +
      `Previous results:\n${priorContext.results}\n\n` +
      `User follow-up message: ${msg.body}\n\n` +
      recentContext;
  }

  // Parse travel intent via Gemini
  // When follow-up context exists, augment the message text so the parser sees
  // both the original query context and the follow-up in the primary field.
  const intentMessageText = priorContext
    ? `Follow-up to: ${priorContext.query}. User says: ${msg.body}`
    : msg.body;
  const intent = await parseTravelIntent(intentMessageText, recentContext, lang);

  // Non-travel mention or parsing failed: send help text
  if (!intent || intent.isTravelRelated === false) {
    const helpText = formatHelpText(botDisplayName, lang);
    await sock.sendMessage(groupJid, { text: helpText });
    return true;
  }

  // Vague travel request: ask for clarification
  if (intent.isVague === true && intent.clarificationQuestion) {
    await sock.sendMessage(groupJid, { text: intent.clarificationQuestion });
    return true;
  }

  // History search: recall stored decisions and chat history, no web search
  if (intent.queryType === 'history_search') {
    const answer = await handleHistorySearch(groupJid, intent, lang);
    await sock.sendMessage(groupJid, { text: answer });
    return true;
  }

  // Clear travel request: search + format + send
  if (intent.isTravelRelated === true && intent.isVague === false) {
    try {
      const queryText = intent.searchQuery ?? msg.body;

      logger.info(
        { groupJid, queryText, intent },
        'Travel intent parsed -- executing search',
      );

      const { results, isFallback } = await searchTravel(queryText, lang, intent.queryType);
      const formattedMessage = formatTravelResults(results, lang, isFallback);

      const sent = await sock.sendMessage(groupJid, { text: formattedMessage });

      // Store the sent message ID for reply chain follow-ups
      const sentMsgId = sent?.key?.id;
      if (sentMsgId) {
        storeTravelResult(sentMsgId, {
          query: queryText,
          results: formattedMessage,
          groupJid,
        });
        logger.debug(
          { sentMsgId, query: queryText },
          'Travel result message stored for reply chain',
        );
      }
    } catch (err) {
      logger.error(
        { err, groupJid, msgId: msg.id },
        'Error during travel search + format pipeline',
      );

      // Send friendly error message -- never crash the pipeline
      const errorText =
        lang === 'he'
          ? 'סליחה, משהו השתבש בחיפוש. נסו שוב.'
          : 'Sorry, something went wrong with the search. Please try again.';
      await sock.sendMessage(groupJid, { text: errorText }).catch((sendErr) => {
        logger.error({ sendErr, groupJid }, 'Failed to send error message to group');
      });
    }

    return true;
  }

  // Fallback: help text for any unhandled @mention state
  const helpText = formatHelpText(botDisplayName, lang);
  await sock.sendMessage(groupJid, { text: helpText });
  return true;
}

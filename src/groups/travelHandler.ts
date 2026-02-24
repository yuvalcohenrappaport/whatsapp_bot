import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { parseTravelIntent, type TravelIntent } from './travelParser.js';
import { getGroupMessagesSince } from '../db/queries/groupMessages.js';

const logger = pino({ level: config.LOG_LEVEL });

// Re-export TravelIntent so Plan 02 can import from this module
export type { TravelIntent };

// --- Reply chain context stub ---

/**
 * In-memory map of bot travel result message IDs to their context.
 * Plan 02 will populate this after sending search results.
 * Ephemeral -- resets on restart (follow-up replies fall through to clarification naturally).
 */
export const travelResultMessages = new Map<
  string,
  { query: string; results: string; groupJid: string }
>();

// --- Bot mention detection ---

/**
 * Check if the bot is mentioned in the message via native @mention or typed display name.
 * Matches on numeric JID prefix only to handle LID format mismatch (Baileys v7 RC pitfall).
 */
function isBotMentioned(
  body: string,
  mentionedJids: string[],
  botJid: string,
  botDisplayName: string | null,
): boolean {
  // Native @mention: match on numeric prefix (handles @s.whatsapp.net vs @lid)
  const botNumericPrefix = botJid.split('@')[0];
  const jidMatches = mentionedJids.some(
    (jid) => jid.split('@')[0] === botNumericPrefix,
  );
  if (jidMatches) return true;

  // Text mention: user typed "@BotName" or "BotName" in message body
  if (botDisplayName) {
    const lowerBody = body.toLowerCase();
    const lowerName = botDisplayName.toLowerCase();
    if (lowerBody.includes(lowerName)) return true;
  }

  return false;
}

// --- Language detection import (lazy to avoid circular) ---

let detectGroupLanguageFn: ((groupJid: string) => Promise<'he' | 'en'>) | null = null;

async function getDetectGroupLanguage(): Promise<(groupJid: string) => Promise<'he' | 'en'>> {
  if (!detectGroupLanguageFn) {
    const mod = await import('./groupMessagePipeline.js');
    detectGroupLanguageFn = mod.detectGroupLanguage;
  }
  return detectGroupLanguageFn;
}

// --- Help text ---

function buildHelpText(lang: 'he' | 'en', botName: string): string {
  if (lang === 'he') {
    return (
      `היי! אני יכול לעזור לך למצוא דילים לטיולים. נסו לתייג אותי עם משהו כמו:\n\n` +
      `@${botName} טיסות לרומא שבוע הבא\n` +
      `@${botName} מלונות בברצלונה 10-15 במרץ\n` +
      `@${botName} מסעדות ליד מגדל אייפל\n\n` +
      `אחפש ואשתף את האפשרויות הכי טובות כאן!`
    );
  }
  return (
    `Hey! I can help you find travel deals. Try mentioning me with something like:\n\n` +
    `@${botName} flights to Rome next week\n` +
    `@${botName} hotels in Barcelona March 10-15\n` +
    `@${botName} restaurants near the Eiffel Tower\n\n` +
    `I'll search and share the best options right here!`
  );
}

// --- Main handler ---

/**
 * Handle a potential travel @mention in a group message.
 * Returns true if the message was an @mention (handled), false if not (caller continues to debounce).
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

  // Check if bot is mentioned
  if (!isBotMentioned(msg.body, mentionedJids, botJid, botDisplayName)) {
    return false;
  }

  // Bot is mentioned -- handle immediately
  logger.info(
    { groupJid, msgId: msg.id, senderJid: msg.senderJid },
    'Bot @mention detected in group message',
  );

  if (!sock) {
    logger.warn({ groupJid }, 'sock is null -- cannot respond to travel mention');
    return true; // Still "handled" to avoid passing to debounce
  }

  // Detect language for responses
  const detectGroupLanguage = await getDetectGroupLanguage();
  const lang = await detectGroupLanguage(groupJid);

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
      `[Previous travel query: ${priorContext.query}]\n[Previous results: ${priorContext.results}]\n\n` +
      recentContext;
  }

  // Parse travel intent via Gemini
  const intent = await parseTravelIntent(msg.body, recentContext, lang);

  // Non-travel mention or parsing failed: send help text
  if (!intent || intent.isTravelRelated === false) {
    const helpText = buildHelpText(lang, botDisplayName);
    await sock.sendMessage(groupJid, { text: helpText });
    return true;
  }

  // Vague travel request: ask for clarification
  if (intent.isVague === true && intent.clarificationQuestion) {
    await sock.sendMessage(groupJid, { text: intent.clarificationQuestion });
    return true;
  }

  // Clear travel request: placeholder for Plan 02 (actual search + format)
  if (intent.isTravelRelated === true && intent.isVague === false) {
    const placeholderText =
      lang === 'he'
        ? `חיפוש טיולים בקרוב! שאילתה: ${intent.searchQuery ?? msg.body}`
        : `Travel search coming soon! Query: ${intent.searchQuery ?? msg.body}`;

    logger.info(
      { groupJid, intent },
      'Travel intent parsed -- placeholder response (Plan 02 will add search)',
    );

    await sock.sendMessage(groupJid, { text: placeholderText });
    return true;
  }

  // Fallback: help text for any unhandled @mention state
  const helpText = buildHelpText(lang, botDisplayName);
  await sock.sendMessage(groupJid, { text: helpText });
  return true;
}

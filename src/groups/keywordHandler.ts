import pino from 'pino';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import {
  getActiveKeywordRulesByGroup,
  incrementMatchCount,
} from '../db/queries/keywordRules.js';
import { getState } from '../api/state.js';

const logger = pino({ level: config.LOG_LEVEL });
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

/** Per-rule cooldown: ruleId -> last fired timestamp (Unix ms). Resets on restart. */
const ruleCooldowns = new Map<string, number>();

function testRegex(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    logger.warn({ pattern }, 'Invalid regex pattern in keyword rule — skipping');
    return false;
  }
}

async function generateAiResponse(
  aiInstructions: string,
  messageBody: string,
): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: messageBody }] }],
      config: { systemInstruction: aiInstructions },
    });
    return response.text?.trim() || null;
  } catch (err) {
    logger.error({ err }, 'Error generating AI keyword response — skipping');
    return null;
  }
}

/**
 * Check incoming group message against active keyword rules.
 * Returns true if a rule matched and a response was sent (first-match-wins).
 * Non-terminal: caller should continue pipeline processing regardless.
 */
export async function handleKeywordRules(
  groupJid: string,
  msg: {
    id: string;
    senderJid: string;
    senderName: string | null;
    body: string;
    timestamp: number;
  },
): Promise<boolean> {
  const { botJid, sock } = getState();
  if (!sock) return false;

  // Skip bot's own messages to prevent self-triggering loops
  if (botJid && msg.senderJid.split('@')[0] === botJid.split('@')[0]) {
    return false;
  }

  const rules = getActiveKeywordRulesByGroup(groupJid);
  if (rules.length === 0) return false;

  for (const rule of rules) {
    // Cooldown check
    const lastFired = ruleCooldowns.get(rule.id);
    if (lastFired && Date.now() - lastFired < rule.cooldownMs) continue;

    // Match check
    const matched = rule.isRegex
      ? testRegex(rule.pattern, msg.body)
      : msg.body.toLowerCase().includes(rule.pattern.toLowerCase());
    if (!matched) continue;

    // Generate response
    let responseText: string | null = null;
    if (rule.responseType === 'fixed') {
      responseText = rule.responseText;
    } else if (rule.responseType === 'ai' && rule.aiInstructions) {
      responseText = await generateAiResponse(rule.aiInstructions, msg.body);
    }
    if (!responseText) continue;

    // Send response directly (not sendWithDelay — that's for 1:1 contacts only)
    await sock.sendMessage(groupJid, { text: responseText });

    // Update cooldown + stats
    ruleCooldowns.set(rule.id, Date.now());
    incrementMatchCount(rule.id);

    logger.info(
      { ruleId: rule.id, ruleName: rule.name, groupJid, msgId: msg.id },
      'Keyword rule matched — response sent',
    );

    return true; // First match wins
  }

  return false;
}

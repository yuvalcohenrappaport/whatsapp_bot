import pino from 'pino';
import { config } from '../config.js';
import {
  getActiveKeywordRulesByGroup,
  incrementMatchCount,
} from '../db/queries/keywordRules.js';
import { getState } from '../api/state.js';
import { generateText } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

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
    return await generateText({
      systemPrompt: aiInstructions,
      messages: [{ role: 'user', content: messageBody }],
    });
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

  // No botJid guard — the bot runs on the user's own account, so we allow
  // keyword matching on all messages. Per-rule cooldowns prevent loops.

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

import { getRecentMessages, getStyleExamples, getPairedExamples, getAllFromMeMessages } from '../db/queries/messages.js';
import { getContact } from '../db/queries/contacts.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { generateText } from './provider.js';

/**
 * Randomly samples up to n elements from an array without modifying the original.
 */
function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const copy = [...arr];
  // Fisher-Yates shuffle, stop after n swaps
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Extracts keywords from text for relevance matching.
 * Unicode-aware, skips short words (<=2 chars).
 */
export function extractKeywords(text: string): Set<string> {
  // Split on non-word characters (Unicode-aware)
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return new Set(words.filter((w) => w.length > 2));
}

/**
 * Scores and selects keyword-relevant single-message examples.
 * Top half by relevance, remaining filled with random for diversity.
 */
export function selectRelevantExamples(
  recentIncoming: string[],
  allExamples: string[],
  count: number,
): string[] {
  if (allExamples.length <= count) return [...allExamples];

  const incomingKeywords = new Set<string>();
  for (const msg of recentIncoming) {
    for (const kw of extractKeywords(msg)) incomingKeywords.add(kw);
  }

  if (incomingKeywords.size === 0) return sampleN(allExamples, count);

  // Score each example by keyword overlap
  const scored = allExamples.map((ex) => {
    const exKeywords = extractKeywords(ex);
    let score = 0;
    for (const kw of exKeywords) {
      if (incomingKeywords.has(kw)) score++;
    }
    return { ex, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const relevantCount = Math.ceil(count / 2);
  const relevant = scored.slice(0, relevantCount).map((s) => s.ex);
  const remaining = scored.slice(relevantCount).map((s) => s.ex);
  const randomFill = sampleN(remaining, count - relevant.length);

  return [...relevant, ...randomFill];
}

/**
 * Scores and selects keyword-relevant paired examples.
 */
export function selectRelevantPairs(
  recentIncoming: string[],
  allPairs: { incoming: string; reply: string }[],
  count: number,
): { incoming: string; reply: string }[] {
  if (allPairs.length <= count) return [...allPairs];

  const incomingKeywords = new Set<string>();
  for (const msg of recentIncoming) {
    for (const kw of extractKeywords(msg)) incomingKeywords.add(kw);
  }

  if (incomingKeywords.size === 0) return sampleN(allPairs, count);

  const scored = allPairs.map((pair) => {
    const keywords = extractKeywords(pair.incoming + ' ' + pair.reply);
    let score = 0;
    for (const kw of keywords) {
      if (incomingKeywords.has(kw)) score++;
    }
    return { pair, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const relevantCount = Math.ceil(count / 2);
  const relevant = scored.slice(0, relevantCount).map((s) => s.pair);
  const remaining = scored.slice(relevantCount).map((s) => s.pair);
  const randomFill = sampleN(remaining, count - relevant.length);

  return [...relevant, ...randomFill];
}

export async function buildSystemPrompt(
  contactJid: string,
  contact: { name?: string | null; relationship?: string | null; customInstructions?: string | null; styleSummary?: string | null },
): Promise<string> {
  const parts: string[] = [];

  // 1. Relaxed base — let style data drive the output
  parts.push(
    `You are Yuval Cohen Rappaport (יובל כהן רפפורט), responding on WhatsApp. ` +
    `Output ONLY the reply message itself — no thinking, no analysis, no explanation, no preamble. ` +
    `CRITICAL RULES: ` +
    `1) Always reply in the SAME LANGUAGE as the last message from the other person. If they write in Hebrew, reply in Hebrew. If in English, reply in English. ` +
    `2) Match the length, format, and energy of Yuval's example messages below. ` +
    `3) Use emojis only when Yuval's examples show emoji usage.`,
  );

  // 2. Contact name + relationship + custom instructions
  parts.push(`You're chatting with ${contact.name ?? 'someone'}.`);

  if (contact.relationship) {
    parts.push(`Your relationship: ${contact.relationship}.`);
  }

  if (contact.customInstructions) {
    parts.push(contact.customInstructions);
  }

  // 3. Global persona
  const globalPersona = getSetting('global_persona');
  if (globalPersona) {
    parts.push(`## Yuval's Global Communication Style\n${globalPersona}`);
  }

  // 4. Per-contact style summary
  if (contact.styleSummary) {
    parts.push(`## Yuval's Writing Style for This Contact\n${contact.styleSummary}`);
  }

  // Collect recent incoming messages for keyword relevance
  const recentMessages = await getRecentMessages(contactJid, 20);
  const recentIncoming = recentMessages
    .filter((m) => !m.fromMe)
    .map((m) => m.body);

  // 5. Paired examples (up to 8, keyword-relevant)
  const allPairs = await getPairedExamples(contactJid, 50);
  const hasPairs = allPairs.length > 0;

  if (hasPairs) {
    const selectedPairs = selectRelevantPairs(recentIncoming, allPairs, 8);
    const pairList = selectedPairs
      .map((p) => `Them: "${p.incoming}" → Yuval: "${p.reply}"`)
      .join('\n');
    parts.push(`## Example Conversations\n${pairList}`);
  }

  // 6. Single-message examples — 7 if pairs exist, 15 if no pairs
  const singleCount = hasPairs ? 7 : 15;
  const allExamples = await getStyleExamples(contactJid, 200);
  if (allExamples.length > 0) {
    const selected = selectRelevantExamples(recentIncoming, allExamples, singleCount);
    const bulletList = selected.map((ex) => `- ${ex}`).join('\n');
    parts.push(`## Example Messages Yuval Has Sent This Person\n${bulletList}`);
  }

  return parts.join('\n\n');
}

/**
 * Generates a reply using the active AI provider based on recent chat history.
 * System prompt includes global persona, style summary, paired examples, and keyword-relevant few-shot examples.
 */
export async function generateReply(contactJid: string): Promise<string | null> {
  const contact = getContact(contactJid);
  const recentMessages = await getRecentMessages(contactJid, 50);

  if (recentMessages.length === 0) return null;

  const systemInstruction = await buildSystemPrompt(
    contactJid,
    contact ?? { name: null, relationship: null, customInstructions: null, styleSummary: null },
  );
  const messages = recentMessages.map((msg) => ({
    role: msg.fromMe ? 'assistant' as const : 'user' as const,
    content: msg.body,
  }));

  let text = await generateText({ systemPrompt: systemInstruction, messages });

  // Strip model thinking leakage — models sometimes prefix with THINK/THOUGHT/reasoning.
  // Extract only the actual reply (last non-empty line after stripping thinking).
  if (text && /^(THINK|THOUGHT)\b/i.test(text)) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    // Find last line that doesn't look like reasoning
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!/^(THINK|THOUGHT)\b/i.test(lines[i]) && !lines[i].startsWith('"') && lines[i].length < 200) {
        text = lines[i];
        break;
      }
    }
  }
  // Also catch "THINK: reasoning\nactual reply" or inline thinking patterns
  if (text && text.includes('\n')) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const clean = lines.filter((l) => !/^(THINK|THOUGHT)\b/i.test(l));
    if (clean.length > 0 && clean.length < lines.length) {
      text = clean[clean.length - 1];
    }
  }
  // Drop trailing period — feels too formal for WhatsApp
  if (text && text.endsWith('.')) {
    text = text.slice(0, -1);
  }
  return text;
}

/**
 * Generates a writing style summary for a contact based on a sample of the owner's messages.
 * Called during chat import when a contact has 10+ messages.
 */
export async function generateStyleSummary(contactJid: string, messages: string[]): Promise<string> {
  const sample = sampleN(messages, 100);
  const messageList = sample.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const prompt = `Analyze these WhatsApp messages sent by Yuval to a specific contact and write a concise style summary (3-5 sentences). Cover: message length, formality level, language mix (Hebrew/English), emoji and slang use, typical openers/closers, and any distinctive patterns. Be specific and descriptive — this summary will guide an AI to mimic this style.\n\nMessages:\n${messageList}`;

  const result = await generateText({
    systemPrompt: 'You are a writing style analyst. Be specific and descriptive. Output only the style summary, no preamble.',
    messages: [{ role: 'user', content: prompt }],
  });

  return (result ?? '').trim();
}

/**
 * Generates a global persona profile from messages across all contacts.
 * Samples ~300 fromMe messages, sends to AI for analysis, stores in settings table.
 */
export async function generateGlobalPersona(): Promise<string> {
  const allMessages = await getAllFromMeMessages(300);

  if (allMessages.length < 10) {
    throw new Error('Not enough messages to generate persona (need at least 10)');
  }

  const sample = sampleN(allMessages, Math.min(allMessages.length, 200));
  const messageList = sample.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const prompt = `Analyze these WhatsApp messages sent by Yuval across different conversations and write a comprehensive persona profile (5-8 sentences). Cover:
- Default message length and structure (short vs long, single line vs multi-line)
- Language patterns (Hebrew, English, code-switching habits)
- Formality level and tone
- Common expressions, filler words, slang
- Emoji and punctuation habits
- How they open and close conversations
- Any distinctive quirks or patterns

Be very specific and descriptive — this profile will guide an AI to write messages indistinguishable from Yuval's real ones.

Messages:
${messageList}`;

  const result = await generateText({
    systemPrompt: 'You are a communication style analyst. Be extremely specific and descriptive. Output only the persona profile, no preamble.',
    messages: [{ role: 'user', content: prompt }],
  });

  const persona = (result ?? '').trim();
  if (persona) {
    setSetting('global_persona', persona);
  }

  return persona;
}

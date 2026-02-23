import { GoogleGenAI, type Content } from '@google/genai';
import { config } from '../config.js';
import { getRecentMessages, getStyleExamples } from '../db/queries/messages.js';
import { getContact } from '../db/queries/contacts.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

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

async function buildSystemPrompt(
  contactJid: string,
  contact: { name?: string | null; relationship?: string | null; customInstructions?: string | null; styleSummary?: string | null },
): Promise<string> {
  const parts = [
    `You are Yuval Cohen Rappaport (יובל כהן רפפורט), responding on WhatsApp. Write exactly as Yuval would — casual, warm, and friendly. Output ONLY the reply message itself — no thinking, no analysis, no explanation, no preamble. CRITICAL RULES: 1) Always reply in the SAME LANGUAGE as the last message from the other person. If they write in Hebrew, reply in Hebrew. If in English, reply in English. 2) Keep your reply to a SINGLE short sentence with proper punctuation. Never send multiple lines or paragraphs. 3) Be genuinely friendly and warm — show interest in the other person, be supportive and positive. Use emojis sparingly when they feel natural. Match the energy of the conversation but lean towards being upbeat.`,
    `You're chatting with ${contact.name ?? 'someone'}.`,
  ];

  if (contact.relationship) {
    parts.push(`Your relationship: ${contact.relationship}.`);
  }

  if (contact.customInstructions) {
    parts.push(contact.customInstructions);
  }

  // Style summary injected from chat import
  if (contact.styleSummary) {
    parts.push(`## Yuval's Writing Style for This Contact\n${contact.styleSummary}`);
  }

  // Few-shot examples: fetch up to 200, sample 15 randomly
  const examples = await getStyleExamples(contactJid, 200);
  if (examples.length > 0) {
    const sampled = sampleN(examples, 15);
    const bulletList = sampled.map((ex) => `- ${ex}`).join('\n');
    parts.push(`## Example Messages Yuval Has Sent This Person\n${bulletList}`);
  }

  return parts.join('\n\n');
}

function messagesToContents(messages: { fromMe: boolean; body: string }[]): Content[] {
  return messages.map((msg) => ({
    role: msg.fromMe ? 'model' : 'user',
    parts: [{ text: msg.body }],
  }));
}

/**
 * Generates a reply using Gemini based on recent chat history.
 * System prompt includes style summary and few-shot examples when available.
 */
export async function generateReply(contactJid: string): Promise<string | null> {
  const contact = getContact(contactJid);
  const recentMessages = await getRecentMessages(contactJid, 50);

  if (recentMessages.length === 0) return null;

  const systemInstruction = await buildSystemPrompt(
    contactJid,
    contact ?? { name: null, relationship: null, customInstructions: null, styleSummary: null },
  );
  const contents = messagesToContents(recentMessages);

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
    },
  });

  let text = response.text?.trim() || null;
  // Strip model thinking leakage — Gemini sometimes prefixes with THINK/THOUGHT/reasoning.
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

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: 'You are a writing style analyst. Be specific and descriptive. Output only the style summary, no preamble.',
    },
  });

  return (response.text ?? '').trim();
}

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
    `You are Yuval, responding on WhatsApp. Write exactly as Yuval would — casual, concise, in the same language the other person writes in. No emojis unless Yuval typically uses them. Don't be overly polite or formal. Match the tone and energy of the conversation.`,
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

  return response.text?.trim() || null;
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

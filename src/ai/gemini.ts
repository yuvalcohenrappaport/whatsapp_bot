import { GoogleGenAI, type Content } from '@google/genai';
import { config } from '../config.js';
import { getRecentMessages } from '../db/queries/messages.js';
import { getContact } from '../db/queries/contacts.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

function buildSystemPrompt(contact: { name?: string | null; relationship?: string | null; customInstructions?: string | null }): string {
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
 */
export async function generateReply(contactJid: string): Promise<string | null> {
  const contact = getContact(contactJid);
  const recentMessages = await getRecentMessages(contactJid, 50);

  if (recentMessages.length === 0) return null;

  const systemInstruction = buildSystemPrompt(contact ?? { name: null, relationship: null, customInstructions: null });
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

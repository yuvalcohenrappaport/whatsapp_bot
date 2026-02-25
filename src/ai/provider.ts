import { GoogleGenAI, type Content } from '@google/genai';
import { config } from '../config.js';
import { getSetting } from '../db/queries/settings.js';
import { localGenerateText, localGenerateJson } from './local.js';

export type AiProvider = 'gemini' | 'local';

const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

export function getActiveProvider(): AiProvider {
  const value = getSetting('ai_provider');
  return value === 'local' ? 'local' : 'gemini';
}

/**
 * Generate a plain text response using the active AI provider.
 * Messages use 'user'/'assistant' roles (mapped to Gemini's 'user'/'model' internally).
 */
export async function generateText(opts: {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string | null> {
  const provider = getActiveProvider();

  if (provider === 'local') {
    return localGenerateText({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
    });
  }

  // Gemini path
  const contents: Content[] = opts.messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const response = await gemini.models.generateContent({
    model: config.GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: opts.systemPrompt,
    },
  });

  return response.text?.trim() || null;
}

/**
 * Generate a structured JSON response using the active AI provider.
 * For Gemini: uses responseMimeType + responseSchema.
 * For local: uses json_schema response format.
 */
export async function generateJson<T>(opts: {
  systemPrompt: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
}): Promise<T | null> {
  const provider = getActiveProvider();

  if (provider === 'local') {
    return localGenerateJson<T>({
      systemPrompt: opts.systemPrompt,
      userContent: opts.userContent,
      jsonSchema: opts.jsonSchema,
      schemaName: opts.schemaName,
    });
  }

  // Gemini path
  const response = await gemini.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: opts.userContent }] }],
    config: {
      systemInstruction: opts.systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: opts.jsonSchema as Record<string, unknown>,
    },
  });

  const rawJson = response.text?.trim();
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as T;
  } catch {
    return null;
  }
}

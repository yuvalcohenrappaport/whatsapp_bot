import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ level: config.LOG_LEVEL });

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

async function callLocalModel(
  messages: ChatMessage[],
  responseFormat?: Record<string, unknown>,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model: config.LMS_MODEL,
    messages,
    temperature: 0.7,
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  try {
    const res = await fetch(`${config.LMS_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, statusText: res.statusText }, 'Local model API error');
      return null;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    logger.error({ err }, 'Failed to call local model');
    return null;
  }
}

/**
 * Generate a text response using the local model (LM Studio).
 */
export async function localGenerateText(opts: {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string | null> {
  const chatMessages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.messages,
  ];
  return callLocalModel(chatMessages);
}

/**
 * Generate a structured JSON response using the local model (LM Studio).
 * Uses json_schema response format for grammar-enforced output.
 */
export async function localGenerateJson<T>(opts: {
  systemPrompt: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
}): Promise<T | null> {
  const chatMessages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userContent },
  ];
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: opts.schemaName,
      strict: true,
      schema: opts.jsonSchema,
    },
  };
  const raw = await callLocalModel(chatMessages, responseFormat);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.error({ err, raw }, 'Failed to parse local model JSON response');
    return null;
  }
}

/**
 * Check if the local model is reachable.
 */
export async function checkLocalModelHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${config.LMS_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

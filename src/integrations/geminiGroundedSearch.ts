import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ level: config.LOG_LEVEL });
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

/**
 * Query Gemini with Google Search grounding for transit alerts in a destination on a given date.
 *
 * Returns a plain-text one-liner summary (e.g. "Metro strike on Line 1 all day" or "normal").
 * Returns null on Gemini error or empty response — callers must handle null as "unknown / skip".
 *
 * Prompt (locked per spec):
 *   "Any transit strikes, delays, or closures in {destination} on {date}?
 *    Respond with a 1-line summary or 'normal' if nothing notable."
 *
 * Tool binding: tools: [{ googleSearch: {} }] — NOT googleMaps.
 * Output: plain text (NOT JSON). No schema, no responseMimeType.
 */
export async function transitAlerts(
  destination: string,
  date: string, // 'YYYY-MM-DD'
): Promise<string | null> {
  const prompt =
    `Any transit strikes, delays, or closures in ${destination} on ${date}? ` +
    `Respond with a 1-line summary or 'normal' if nothing notable.`;

  try {
    const response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text?.trim();
    if (!text) {
      logger.warn({ destination, date }, 'transitAlerts: Gemini returned empty response');
      return null;
    }

    // Return first line only — grounded search may add attribution text after a newline
    const firstLine = text.split('\n')[0].trim();
    logger.info({ destination, date, alert: firstLine }, 'transitAlerts result');
    return firstLine || null;
  } catch (err) {
    logger.warn({ err, destination, date }, 'transitAlerts: Gemini error — returning null');
    return null;
  }
}

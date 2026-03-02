import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import { config } from '../config.js';
import { generateText } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// Gemini client kept for grounded search (Google Search tool is Gemini-specific)
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// --- Types ---

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  price: string | null;
}

// --- Primary: Gemini with Google Search grounding ---

/**
 * Use Gemini with Google Search grounding to find travel results.
 * Returns up to 3 results with real URLs from grounding metadata.
 */
async function geminiGroundedSearch(
  searchQuery: string,
  lang: 'he' | 'en',
): Promise<SearchResult[]> {
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Find exactly 3 results for: ${searchQuery}\n` +
              `For each result provide: name, a brief description, price if available, and a direct URL.\n` +
              `Respond as a JSON array of objects with fields: title (string), url (string), snippet (string), price (string or null).\n` +
              `Respond in ${langLabel}. Output ONLY the JSON array, no markdown fences.`,
          },
        ],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    logger.warn('Gemini grounded search returned empty response');
    return [];
  }

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Gemini sometimes returns prose with embedded JSON — try to extract
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      parsed = JSON.parse(arrayMatch[0]);
    } else {
      logger.warn({ rawText: rawText.substring(0, 500) }, 'Could not parse grounded search JSON');
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    logger.warn('Gemini grounded search response is not an array');
    return [];
  }

  const results = parsed.slice(0, 3).map((item: Record<string, unknown>) => ({
    title: String(item.title ?? 'Result'),
    url: String(item.url ?? ''),
    snippet: String(item.snippet ?? ''),
    price: typeof item.price === 'string' ? item.price : null,
  }));

  // --- Extract URLs from grounding metadata (more reliable than AI-generated URLs) ---
  const groundingChunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const webChunks = groundingChunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ uri: c.web!.uri!, title: c.web?.title ?? '' }));

  if (webChunks.length > 0) {
    let matched = 0;
    const usedChunkIndices = new Set<number>();

    // Pass 1: match grounding chunk to result by title similarity
    for (const result of results) {
      const resultTitleLower = result.title.toLowerCase();
      const chunkIdx = webChunks.findIndex(
        (chunk, idx) =>
          !usedChunkIndices.has(idx) &&
          chunk.title &&
          (resultTitleLower.includes(chunk.title.toLowerCase()) ||
            chunk.title.toLowerCase().includes(resultTitleLower)),
      );
      if (chunkIdx !== -1) {
        result.url = webChunks[chunkIdx].uri;
        usedChunkIndices.add(chunkIdx);
        matched++;
      }
    }

    // Pass 2: assign unused grounding URLs to results with empty/short URLs
    const unusedChunks = webChunks.filter((_, idx) => !usedChunkIndices.has(idx));
    let unusedIdx = 0;
    for (const result of results) {
      if (unusedIdx >= unusedChunks.length) break;
      if (!result.url || result.url.length < 20) {
        result.url = unusedChunks[unusedIdx].uri;
        unusedIdx++;
        matched++;
      }
    }

    logger.debug(
      { groundingChunksFound: webChunks.length, matched, textParsedFallback: results.length - matched },
      'Grounding metadata URL cross-reference',
    );
  } else {
    logger.debug('No grounding chunks found -- using text-parsed URLs as-is');
  }

  logger.info({ count: results.length, query: searchQuery }, 'Gemini grounded search returned results');
  return results;
}

// --- Fallback: Gemini knowledge-based recommendations ---

/**
 * When grounded search fails, ask Gemini (without grounding tools)
 * to provide 3 travel recommendations based on general knowledge.
 * Returns SearchResult[] with empty URLs (no live links from knowledge fallback).
 */
async function knowledgeFallback(
  searchQuery: string,
  lang: 'he' | 'en',
): Promise<SearchResult[]> {
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';

  const systemPrompt =
    `You are a travel assistant. Provide exactly 3 recommendations for the given query. ` +
    `For each, give a name, brief description, and estimated price range if you know it. ` +
    `Note: these are general knowledge recommendations, not live prices. ` +
    `Respond as a JSON array of objects with fields: title (string), snippet (string), price (string or null). ` +
    `Respond in ${langLabel}. Output ONLY the JSON array, no markdown fences.`;

  const rawText = await generateText({
    systemPrompt,
    messages: [{ role: 'user', content: searchQuery }],
  });

  if (!rawText) {
    logger.warn('Knowledge fallback returned empty response');
    return [];
  }

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      parsed = JSON.parse(arrayMatch[0]);
    } else {
      logger.warn({ rawText: rawText.substring(0, 500) }, 'Could not parse knowledge fallback JSON');
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    logger.warn({ parsed }, 'Knowledge fallback response is not an array');
    return [];
  }

  return parsed.slice(0, 3).map((item: Record<string, unknown>) => ({
    title: String(item.title ?? 'Recommendation'),
    url: '',
    snippet: String(item.snippet ?? ''),
    price: typeof item.price === 'string' ? item.price : null,
  }));
}

// --- Main export ---

/**
 * Search for travel results: uses Gemini with Google Search grounding first,
 * falls back to Gemini knowledge when grounding fails.
 */
export async function searchTravel(
  searchQuery: string,
  lang: 'he' | 'en',
): Promise<{ results: SearchResult[]; isFallback: boolean }> {
  // Try Gemini with Google Search grounding
  try {
    const grounded = await geminiGroundedSearch(searchQuery, lang);
    if (grounded.length > 0) {
      return { results: grounded, isFallback: false };
    }

    logger.info(
      { query: searchQuery },
      'Gemini grounded search returned 0 results -- falling back to knowledge',
    );
  } catch (err) {
    logger.warn(
      { err, query: searchQuery },
      'Gemini grounded search failed -- falling back to knowledge',
    );
  }

  // Fallback: Gemini knowledge
  try {
    const fallbackResults = await knowledgeFallback(searchQuery, lang);
    logger.info(
      { count: fallbackResults.length, query: searchQuery },
      'Gemini knowledge fallback returned results',
    );
    return { results: fallbackResults, isFallback: true };
  } catch (err) {
    logger.error(
      { err, query: searchQuery },
      'Gemini knowledge fallback also failed',
    );
    return { results: [], isFallback: true };
  }
}

import { load } from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ level: config.LOG_LEVEL });

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// --- Types ---

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  price: string | null;
}

// --- Price extraction ---

/**
 * Extract a price string from a text snippet.
 * Looks for currency patterns: $, EUR, ILS, etc. followed/preceded by digits.
 */
function extractPrice(text: string): string | null {
  // Match patterns like: $199, EUR 150, 350 ILS, 150$, 1,299$, etc.
  const patterns = [
    /[$\u20AC\u20AA]\s?\d[\d,.]*/,          // $199, EUR199, ILS199
    /\d[\d,.]*\s?[$\u20AC\u20AA]/,          // 199$, 199EUR
    /(?:USD|EUR|ILS|GBP)\s?\d[\d,.]*/i,     // USD 199, EUR 150
    /\d[\d,.]*\s?(?:USD|EUR|ILS|GBP)/i,     // 199 USD, 150 EUR
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }

  return null;
}

// --- Primary: Google SERP scraping with cheerio ---

/**
 * Scrape Google search results using cheerio with AdsBot-Google user-agent.
 * Uses a multi-selector cascade since Google changes class names frequently.
 * Returns up to 3 results.
 */
async function scrapeGoogleResults(query: string): Promise<SearchResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AdsBot-Google (+http://www.google.com/adsbot.html)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (html.length < 5000) {
    logger.warn(
      { htmlLength: html.length },
      'Google response HTML suspiciously short -- likely blocked or redirected',
    );
  }

  const $ = load(html);
  const results: SearchResult[] = [];

  // Tier 1: Primary selectors (.yuRUbf > a with h3 title)
  $('.yuRUbf > a').each((_, el) => {
    if (results.length >= 3) return false;
    const href = $(el).attr('href') ?? '';
    const title = $(el).find('h3').text().trim();
    const snippetEl = $(el).closest('.g').find('.VwiC3b, .IsZvec').first();
    const snippet = snippetEl.text().trim();

    if (href.startsWith('http') && title) {
      results.push({
        title,
        url: href,
        snippet,
        price: extractPrice(snippet),
      });
    }
  });

  if (results.length > 0) {
    logger.debug({ count: results.length }, 'Tier 1 selectors (.yuRUbf) produced results');
    return results;
  }

  // Tier 2: Broad h3 scan -- find closest <a> ancestor with http href
  $('h3').each((_, el) => {
    if (results.length >= 3) return false;
    const title = $(el).text().trim();
    const anchor = $(el).closest('a');
    const href = anchor.attr('href') ?? '';

    if (href.startsWith('http') && title) {
      // Try to find snippet from a sibling/parent container
      const parentContainer = $(el).closest('.g, [data-hveid]');
      const snippet = parentContainer.find('.VwiC3b, .IsZvec, [data-sncf]').first().text().trim();

      results.push({
        title,
        url: href,
        snippet,
        price: extractPrice(snippet),
      });
    }
  });

  if (results.length > 0) {
    logger.debug({ count: results.length }, 'Tier 2 selectors (h3 scan) produced results');
  } else {
    logger.debug('Both selector tiers returned 0 results');
  }

  return results;
}

// --- Fallback: Gemini knowledge-based recommendations ---

/**
 * When scraping returns 0 results or throws, ask Gemini (without grounding tools)
 * to provide 3 travel recommendations based on general knowledge.
 * Returns SearchResult[] with empty URLs (no live links from knowledge fallback).
 */
async function geminiKnowledgeFallback(
  searchQuery: string,
  lang: 'he' | 'en',
): Promise<SearchResult[]> {
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';

  const systemInstruction =
    `You are a travel assistant. Provide exactly 3 recommendations for the given query. ` +
    `For each, give a name, brief description, and estimated price range if you know it. ` +
    `Note: these are general knowledge recommendations, not live prices. ` +
    `Respond as a JSON array of objects with fields: title (string), snippet (string), price (string or null). ` +
    `Respond in ${langLabel}.`;

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: searchQuery }] }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
    },
  });

  const rawJson = response.text?.trim();
  if (!rawJson) {
    logger.warn('Gemini knowledge fallback returned empty response');
    return [];
  }

  const parsed = JSON.parse(rawJson);

  if (!Array.isArray(parsed)) {
    logger.warn({ parsed }, 'Gemini knowledge fallback response is not an array');
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
 * Search for travel results: tries Google scraping first, falls back to Gemini knowledge.
 * Returns results and whether fallback was used.
 */
export async function searchTravel(
  searchQuery: string,
  lang: 'he' | 'en',
): Promise<{ results: SearchResult[]; isFallback: boolean }> {
  // Try cheerio scraping first
  try {
    const scraped = await scrapeGoogleResults(searchQuery);
    if (scraped.length > 0) {
      logger.info(
        { count: scraped.length, query: searchQuery },
        'Google scraping returned results',
      );
      return { results: scraped, isFallback: false };
    }

    logger.info(
      { query: searchQuery },
      'Google scraping returned 0 results -- falling back to Gemini knowledge',
    );
  } catch (err) {
    logger.warn(
      { err, query: searchQuery },
      'Google scraping failed -- falling back to Gemini knowledge',
    );
  }

  // Fallback: Gemini knowledge
  try {
    const fallbackResults = await geminiKnowledgeFallback(searchQuery, lang);
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

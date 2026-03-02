import type { SearchResult } from './travelSearch.js';

// --- Booking domain detection ---

const BOOKING_DOMAINS = [
  'booking.com',
  'airbnb.com',
  'hotels.com',
  'expedia.com',
  'agoda.com',
] as const;

function isBookingUrl(url: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return BOOKING_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain),
    );
  } catch {
    // Fallback for malformed URLs (e.g., Google Maps redirects)
    return BOOKING_DOMAINS.some((domain) => url.includes(domain));
  }
}

// --- Formatting helpers ---

function formatReviewCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count);
}

function formatOneLiner(r: SearchResult, index: number): string {
  let line = `${index + 1}. ${r.title}`;

  if (r.rating !== null && r.rating !== undefined) {
    const reviews =
      r.reviewCount !== null && r.reviewCount !== undefined
        ? ` (${formatReviewCount(r.reviewCount)})`
        : '';
    line += ` ⭐ ${r.rating}${reviews}`;
  }

  if (r.address) {
    line += ` — ${r.address}`;
  }

  if (r.url) {
    const urlPart = isBookingUrl(r.url) ? `🛒 ${r.url}` : r.url;
    line += ` — ${urlPart}`;
  }

  return line;
}

// --- Compact one-liner formatting for travel results ---

/**
 * Format search results as compact one-liners for WhatsApp.
 * Language matches group (Hebrew or English).
 * Handles both grounded results (with URLs) and fallback results (without URLs).
 */
export function formatTravelResults(
  results: SearchResult[],
  lang: 'he' | 'en',
  isFallback: boolean,
): string {
  if (results.length === 0) {
    return lang === 'he'
      ? 'לא נמצאו תוצאות. נסו לחפש עם מילות מפתח אחרות.'
      : 'No results found. Try searching with different keywords.';
  }

  // Header
  let header: string;
  if (lang === 'he') {
    header = `\u{1F30D} נמצאו ${results.length} תוצאות:`;
    if (isFallback) {
      header += ' (מבוסס על המלצות כלליות)';
    }
  } else {
    header = `\u{1F30D} Found ${results.length} results:`;
    if (isFallback) {
      header += ' (based on general recommendations)';
    }
  }

  // Build compact one-liners
  const lines = results.map((r, i) => formatOneLiner(r, i));

  return `${header}\n\n${lines.join('\n')}`;
}

// --- Help text for non-travel mentions ---

/**
 * Build a casual help text for when the bot is @mentioned but the message
 * is not travel-related. Includes 3 example lines using the actual bot display name.
 */
export function formatHelpText(botDisplayName: string, lang: 'he' | 'en'): string {
  if (lang === 'he') {
    return (
      `היי! אני יכול לעזור לך למצוא דילים לטיולים. נסו לתייג אותי עם משהו כמו:\n\n` +
      `@${botDisplayName} טיסות לרומא שבוע הבא\n` +
      `@${botDisplayName} מלונות בברצלונה 10-15 במרץ\n` +
      `@${botDisplayName} מסעדות ליד מגדל אייפל\n\n` +
      `אחפש ואשתף את האפשרויות הכי טובות כאן!`
    );
  }
  return (
    `Hey! I can help you find travel deals. Try mentioning me with something like:\n\n` +
    `@${botDisplayName} flights to Rome next week\n` +
    `@${botDisplayName} hotels in Barcelona March 10-15\n` +
    `@${botDisplayName} restaurants near the Eiffel Tower\n\n` +
    `I'll search and share the best options right here!`
  );
}

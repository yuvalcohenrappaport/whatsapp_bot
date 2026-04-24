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

function isRestaurantResult(r: SearchResult): boolean {
  // Any of the five enriched fields being defined (not undefined) signals this came from the
  // Plan 53-01 restaurants path. We check defined-ness (not non-null) because Plan 53-01 always
  // emits the fields as `T | null` on the restaurant branch and leaves them `undefined` on
  // non-restaurant branches.
  return (
    r.photoUrl !== undefined ||
    r.openNow !== undefined ||
    r.priceLevel !== undefined ||
    r.cuisine !== undefined ||
    r.reservationUrl !== undefined
  );
}

function formatRestaurantOneLiner(r: SearchResult, index: number): string {
  // Main one-liner parts — each segment is optional; null/undefined segments are omitted entirely.
  const parts: string[] = [];
  parts.push(`${index + 1}. 🍽️ ${r.title}`);

  if (r.cuisine) parts.push(r.cuisine);
  if (r.priceLevel) parts.push(r.priceLevel);

  if (r.openNow === true) parts.push('🟢');
  else if (r.openNow === false) parts.push('🔴');
  // openNow null/undefined → segment omitted (CONTEXT: "omit the segment if unknown")

  if (r.rating !== null && r.rating !== undefined) {
    const reviewSuffix =
      r.reviewCount !== null && r.reviewCount !== undefined
        ? ` (${formatReviewCount(r.reviewCount)})`
        : '';
    parts.push(`${r.rating}⭐${reviewSuffix}`);
  }

  // URL priority: reservation_url beats generic url (CONTEXT: "reservation_url... user clicks out to OpenTable/TheFork").
  // NOTE: Restaurants intentionally skip the `isBookingUrl` 🛒 prefix that v1.4's `formatOneLiner` applies for
  // hotels/activities — bookings flow via `reservationUrl` directly (OpenTable/TheFork), not OTA hotel aggregators,
  // and the CONTEXT template line 30 explicitly ends with `· {url}` with no cart glyph. Dropping the prefix is
  // deliberate, not an oversight.
  const primaryUrl = r.reservationUrl || r.url;
  if (primaryUrl) parts.push(primaryUrl);

  const mainLine = parts.join(' · ');

  // Photo URL on its own line — WhatsApp auto-unfurls first URL-bearing line as a link preview.
  // CONTEXT: "Rely on Baileys' default `generateHighQualityLinkPreview` behavior; no explicit
  // `linkPreview: true` flag needed". A plain URL on its own line is what WhatsApp clients need
  // to trigger the unfurl — no markdown, no prefix.
  if (r.photoUrl) {
    return `${mainLine}\n${r.photoUrl}`;
  }
  return mainLine;
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

  const isRestaurant = results.some(isRestaurantResult);

  // Header — restaurant-aware label
  let header: string;
  if (lang === 'he') {
    if (isRestaurant) {
      header = `🍽️ נמצאו ${results.length} מסעדות:`;
    } else {
      header = `\u{1F30D} נמצאו ${results.length} תוצאות:`;
    }
    if (isFallback) header += ' (מבוסס על המלצות כלליות)';
  } else {
    if (isRestaurant) {
      header = `🍽️ Found ${results.length} restaurants:`;
    } else {
      header = `\u{1F30D} Found ${results.length} results:`;
    }
    if (isFallback) header += ' (based on general recommendations)';
  }

  const lines = results.map((r, i) =>
    isRestaurant ? formatRestaurantOneLiner(r, i) : formatOneLiner(r, i),
  );

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

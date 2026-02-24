import type { SearchResult } from './travelSearch.js';

// --- Rich card formatting for travel results ---

/**
 * Format search results as WhatsApp-style rich cards.
 * Language matches group (Hebrew or English).
 * Handles both scraped results (with URLs) and fallback results (without URLs).
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

  // Build cards
  const cards = results.map((r, i) => {
    const lines: string[] = [];

    // Title (bold WhatsApp formatting)
    lines.push(`${i + 1}. *${r.title}*`);

    // Price line
    if (r.price) {
      lines.push(r.price);
    } else {
      lines.push(lang === 'he' ? '\u{1F4B0} מחיר לא מצוין' : '\u{1F4B0} Price not listed');
    }

    // Snippet (truncated to ~100 chars)
    if (r.snippet) {
      const truncated =
        r.snippet.length > 100 ? r.snippet.slice(0, 97) + '...' : r.snippet;
      lines.push(truncated);
    }

    // URL (only if available -- fallback results have no URL)
    if (r.url) {
      lines.push(r.url);
    }

    return lines.join('\n');
  });

  return `${header}\n\n${cards.join('\n\n')}`;
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

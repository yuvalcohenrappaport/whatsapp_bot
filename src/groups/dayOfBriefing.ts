import pino from 'pino';
import { config } from '../config.js';
import { getState } from '../api/state.js';
import { listUpcomingEvents } from '../calendar/calendarService.js';
import {
  resolveCoords,
  getDestinationForecast,
  type Coords,
} from '../integrations/openWeather.js';
import { transitAlerts } from '../integrations/geminiGroundedSearch.js';
import {
  getTripContext,
  upsertTripContext,
  getUnresolvedOpenItems,
  getBudgetRollup,
  getDecisionsByGroup,
} from '../db/queries/tripMemory.js';
import { generateText } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// ─── Locked fallback template strings (byte-for-byte, per 54-CONTEXT.md) ─────
const FALLBACK_HEADER = '🌅 בוקר טוב! היום ביומן:';
const FALLBACK_EMPTY = '🌅 בוקר טוב! אין אירועים ביומן להיום.';

// ─── Gemini composition system prompt (Hebrew plain-text output) ─────────────
const COMPOSE_SYSTEM_PROMPT =
  'You are a travel assistant composing a morning briefing in Hebrew for a ' +
  'WhatsApp group. Respond with a single natural WhatsApp message (no markdown ' +
  'headers, use emoji sparingly). Output only the briefing text, nothing else.';

export interface BriefingInput {
  groupJid: string;
  destination: string;
  calendarId: string | null;
  destTz: string;
  /** YYYY-MM-DD in destTz. */
  todayIso: string;
  /** Coords pre-resolved from trip_contexts.metadata.coords, or null to resolve on first call. */
  coords: Coords | null;
  /** From config.OPENWEATHER_API_KEY. Null disables weather enrichment. */
  openWeatherApiKey: string | null;
}

/**
 * Extract HH:MM from an ISO date string in the given IANA timezone.
 *
 * For all-day calendar events (date-only strings like `"2026-05-10"`), returns
 * the Hebrew string `'כל היום'`.
 */
function formatTime(isoDate: string, tz: string): string {
  // Date-only strings from Google Calendar (all-day events) have no 'T'.
  if (!isoDate.includes('T')) return 'כל היום';

  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return 'כל היום';

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    // Intl sometimes emits '24' for midnight under certain locales — normalize.
    const normalizedHour = hour === '24' ? '00' : hour;
    return `${normalizedHour}:${minute}`;
  } catch {
    return 'כל היום';
  }
}

function buildFallbackMessage(
  events: Array<{ title: string; date: string }>,
  destTz: string,
): string {
  if (events.length === 0) return FALLBACK_EMPTY;
  const lines = events.map((e) => `• ${formatTime(e.date, destTz)} — ${e.title}`);
  return `${FALLBACK_HEADER}\n${lines.join('\n')}`;
}

/**
 * Orchestrate the day-of morning briefing for a single active trip.
 *
 * Flow:
 *  1. Fetch today's calendar events (needed for both enriched + fallback paths).
 *  2. In an outer try/catch, gather ALL other enrichment sources (weather,
 *     transit, open questions, conflicts, budget) and compose a Hebrew
 *     briefing via a single Gemini `generateText` call.
 *  3. If ANY step in step 2 throws — or calendar fetch threw in step 1 — set
 *     `useFallback = true` and post the locked fallback template instead.
 *     No partial enriched briefings are ever emitted.
 *  4. Post the final message to `groupJid` via the bot's active WhatsApp
 *     socket. When `sock` is null (bot disconnected), log and return without
 *     throwing.
 *
 * This function NEVER re-throws. Any uncaught error is logged and swallowed so
 * one bad trip can't crash the 15-min briefing cron.
 */
export async function runDayOfBriefing(input: BriefingInput): Promise<void> {
  const {
    groupJid,
    destination,
    calendarId,
    destTz,
    todayIso,
    coords,
    openWeatherApiKey,
  } = input;

  try {
    let calendarEvents: Array<{ title: string; date: string }> = [];
    let useFallback = false;

    // ─── Calendar (always fetched — needed for the fallback template too) ────
    try {
      if (calendarId) {
        const all = await listUpcomingEvents(calendarId, 1);
        calendarEvents = all.filter((e) => e.date.startsWith(todayIso));
      }
    } catch (err) {
      logger.warn(
        { err, groupJid, calendarId },
        'dayOfBriefing: calendar fetch threw — using fallback',
      );
      useFallback = true;
    }

    // ─── Enrichment block (single outer try/catch — any throw → fallback) ────
    let composedMessage: string | null = null;

    if (!useFallback) {
      try {
        // Weather: use cached coords when available; otherwise resolve, persist,
        // and continue. Both branches share the same forecast call shape.
        let weatherSummary: string | null = null;
        if (openWeatherApiKey) {
          let effectiveCoords: Coords | null = coords;
          if (!effectiveCoords && destination) {
            const resolved = await resolveCoords(destination, openWeatherApiKey);
            if (resolved) {
              // Persist resolved coords into metadata so subsequent briefings
              // skip the geo call. Merge-patch existing metadata.
              try {
                const existing = getTripContext(groupJid);
                const existingMeta = JSON.parse(existing?.metadata ?? '{}') as Record<
                  string,
                  unknown
                >;
                upsertTripContext(groupJid, {
                  metadata: JSON.stringify({ ...existingMeta, coords: resolved }),
                });
              } catch (metaErr) {
                logger.warn(
                  { err: metaErr, groupJid },
                  'dayOfBriefing: failed to persist resolved coords — continuing',
                );
              }
              effectiveCoords = resolved;
            }
          }

          if (effectiveCoords) {
            const slots = await getDestinationForecast(
              effectiveCoords,
              openWeatherApiKey,
              todayIso,
            );
            weatherSummary =
              slots
                .map((s) => `${s.description} ${Math.round(s.temp)}°C`)
                .join(', ') || null;
          }
        }

        // Transit alerts (null-on-failure contract from geminiGroundedSearch)
        const transitAlert = await transitAlerts(destination, todayIso);

        // Open questions
        const openQuestions = getUnresolvedOpenItems(groupJid);

        // Today's conflicts — filtered to today's date in destination-tz via
        // metadata.event_time. Conflicts without event_time are excluded.
        const allDecisions = getDecisionsByGroup(groupJid);
        const todayConflicts = allDecisions.filter((row) => {
          const conflicts = JSON.parse(row.conflictsWith ?? '[]') as unknown[];
          if (!Array.isArray(conflicts) || conflicts.length === 0) return false;
          const meta = JSON.parse(row.metadata ?? '{}') as { event_time?: string };
          if (!meta.event_time) return false;
          const localDate = new Date(meta.event_time).toLocaleDateString('sv-SE', {
            timeZone: destTz,
          });
          return localDate === todayIso;
        });

        // Budget burn — skip categories where the configured target is 0.
        const rollup = getBudgetRollup(groupJid);
        const budgetLines = Object.entries(rollup.targets)
          .filter(([, target]) => (target as number) > 0)
          .map(([cat, target]) => {
            const spent = rollup.spent[cat as keyof typeof rollup.spent] ?? 0;
            const pct = Math.round((spent / (target as number)) * 100);
            return `${cat}: ${pct}% of ${target} used`;
          });

        // Gemini composition — single plain-text call (NOT JSON schema).
        const calendarSection =
          calendarEvents.length > 0
            ? calendarEvents
                .map((e) => `• ${formatTime(e.date, destTz)} — ${e.title}`)
                .join('\n')
            : 'אין אירועים';

        const userContent = [
          `תאריך: ${todayIso}`,
          `יעד: ${destination}`,
          '',
          'אירועים ביומן היום:',
          calendarSection,
          '',
          `מזג אוויר: ${weatherSummary ?? 'לא זמין'}`,
          '',
          `עדכוני תחבורה: ${transitAlert ?? 'לא ידוע'}`,
          '',
          'שאלות פתוחות:',
          openQuestions.length > 0
            ? openQuestions.map((q) => `• ${q.value}`).join('\n')
            : 'אין',
          '',
          'קונפליקטים להיום:',
          todayConflicts.length > 0
            ? todayConflicts.map((c) => `• ${c.value}`).join('\n')
            : 'אין',
          '',
          'תקציב:',
          budgetLines.length > 0 ? budgetLines.join('\n') : 'לא הוגדר',
          '',
          'כתוב בריפינג בוקר עברי, ידידותי, בסגנון WhatsApp. לא יותר מ-300 מילים.',
        ].join('\n');

        const composed = await generateText({
          systemPrompt: COMPOSE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        });

        if (!composed || !composed.trim()) {
          // Treat empty composition as enrichment failure per locked spec —
          // posting an empty enriched briefing is worse than the fallback.
          throw new Error('Gemini returned empty composition');
        }

        composedMessage = composed;
      } catch (err) {
        logger.warn(
          { err, groupJid, destination },
          'dayOfBriefing: enrichment threw — using fallback',
        );
        useFallback = true;
      }
    }

    // ─── Post to the group ──────────────────────────────────────────────────
    const { sock } = getState();
    if (!sock) {
      logger.warn(
        { groupJid, destination },
        'dayOfBriefing: sock is null — skipping post',
      );
      return;
    }

    const message = useFallback
      ? buildFallbackMessage(calendarEvents, destTz)
      : (composedMessage as string);

    try {
      await sock.sendMessage(groupJid, { text: message });
      logger.info(
        { groupJid, destination, useFallback, length: message.length },
        'dayOfBriefing: briefing posted',
      );
    } catch (sendErr) {
      // One retry with the fallback template if we just failed to send the
      // enriched message. This is belt-and-suspenders: the outer catch below
      // would log + return, but the user prefers _any_ briefing over none.
      logger.error(
        { err: sendErr, groupJid, destination, useFallback },
        'dayOfBriefing: sendMessage failed',
      );
      if (!useFallback) {
        try {
          await sock.sendMessage(groupJid, {
            text: buildFallbackMessage(calendarEvents, destTz),
          });
          logger.info(
            { groupJid },
            'dayOfBriefing: fallback posted after enriched send failed',
          );
        } catch (fallbackErr) {
          logger.error(
            { err: fallbackErr, groupJid },
            'dayOfBriefing: fallback send also failed — giving up',
          );
        }
      }
    }
  } catch (outerErr) {
    // Absolute outer boundary — never re-throw. The cron runs this for every
    // active trip and one bad row should not take down the whole tick.
    logger.error(
      { err: outerErr, groupJid: input.groupJid },
      'dayOfBriefing: uncaught error — swallowed',
    );
  }
}

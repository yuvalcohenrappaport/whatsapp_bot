# Phase 54 — Locked Decisions

Source of truth: `docs/superpowers/specs/2026-04-23-travel-agent-v2.1-design.md` § Phase 54 (lines 250-311)

---

## Cron timing

Every 15 minutes (`*/15 * * * *`), fire `runBriefingCheckOnce()`. Match `briefing_time ± 7 min` in destination-tz. Gate on:
1. `today ∈ [start_date − 1day, end_date]` (date string compare in destination-tz)
2. `metadata.last_briefing_date` does NOT equal today (YYYY-MM-DD in destination-tz) — dedup guard
3. Trip status = `'active'`

Default `briefing_time` when null: `"08:00"`.

---

## Destination timezone lookup

Strategy (discretionary — locked to this approach for the phase):
- Static lookup table of ~50 top travel destinations → IANA tz name (e.g. `"rome" → "Europe/Rome"`)
- Gemini one-shot fallback for destinations not in the table: single call, cache result in `metadata.tz`
- Table lives inside `src/cron/briefingCron.ts` (no separate file needed)

---

## Briefing enrichment sources (order matters for fallback cascade)

1. Google Calendar `listUpcomingEvents(calendarId)` filtered to `today` in destination-tz
2. OpenWeather `/forecast` for destination coords — coords resolved via `/geo/1.0/direct` on first call, cached in `metadata.coords` as `{ lat, lon }`
3. `geminiGroundedSearch.transitAlerts(destination, today)` — Gemini with `tools: [{ googleSearch: {} }]`, prompt exactly: `"Any transit strikes, delays, or closures in {destination} on {today}? Respond with a 1-line summary or 'normal' if nothing notable."`
4. `getUnresolvedOpenItems(groupJid)` — already in `src/db/queries/tripMemory.ts`
5. `getDecisionsByGroup(groupJid)` filtered where `conflictsWith != '[]'` AND `date(metadata.event_time) == today` in destination-tz
6. `getBudgetRollup(groupJid)` — format per category as `"X% of Y used"` (skip categories where target = 0)

Final composition: single `generateText` call with all structured data as system context → Hebrew plain-text output (NOT JSON schema output, to avoid Gemini key-translation issue).

---

## Fallback template (LOCKED — byte-for-byte)

When ANY enrichment source throws or returns error:

```
🌅 בוקר טוב! היום ביומן:
• HH:MM — {event_title}
• HH:MM — {event_title}
```

- Only calendar events
- Format: `• HH:MM — {title}` (24h clock, destination-tz)
- Header line exactly: `🌅 בוקר טוב! היום ביומן:`
- If calendar also fails: post `🌅 בוקר טוב! אין אירועים ביומן להיום.`
- Post as single WhatsApp message to group; never skip the day

---

## metadata.last_briefing_date

Stored in `trip_contexts.metadata` JSON blob (text column). Key: `last_briefing_date`, value: `"YYYY-MM-DD"` (date in destination-tz). Updated via `upsertTripContext` partial metadata patch after successful post.

`upsertTripContext` does not have a dedicated metadata patch path yet — Plan 01 adds `getActiveContextsForBriefing()` helper; briefing cron calls `upsertTripContext` with a metadata-merge approach (read existing metadata, merge key, write back).

---

## Files (new)

| File | Purpose |
|------|---------|
| `src/integrations/openWeather.ts` | OpenWeather API client — `/geo/1.0/direct` coord lookup + `/forecast` endpoint, 429 retry (1× with 5s delay), coord cached in caller's metadata |
| `src/integrations/geminiGroundedSearch.ts` | Thin wrapper around `@google/genai` with `tools: [{ googleSearch: {} }]`; exports `transitAlerts(destination, date)` |
| `src/groups/dayOfBriefing.ts` | Orchestrator — gathers all enrichment, calls Gemini composition, posts to group, handles fallback |
| `src/cron/briefingCron.ts` | 15-min cron + timezone lookup table + `runBriefingCheckOnce()` |

## Files (changed)

| File | Change |
|------|--------|
| `src/config.ts` | Add `OPENWEATHER_API_KEY: z.string().optional()` |
| `.env.example` | Add `OPENWEATHER_API_KEY=your-openweathermap-api-key` |
| `src/index.ts` | Wire `initBriefingCron()` in `main()` after `initArchiveTripsCron()` |
| `src/db/queries/tripMemory.ts` | Add `getActiveContextsForBriefing()` returning all active trips |

---

## New directory

`src/cron/` (mirrors `src/scheduler/` but dedicated to time-based background jobs for the v2.1 superpower set). `briefingCron.ts` is the first file here.

---

## Precondition (BLOCKS weather enrichment tasks)

`OPENWEATHER_API_KEY` is not set. User must register at https://openweathermap.org/api (free tier), get the key, and add to `.env`. Plan 01 includes a `user_setup` block for this. Tasks that mock the OpenWeather client work without the key; the live integration test requires it.

---

## Deferred

- Multi-currency budget normalization (Phase 55)
- SMS / push fallback if WhatsApp send fails
- Retrying failed briefings after transient errors

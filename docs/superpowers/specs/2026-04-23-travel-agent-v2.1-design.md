# v2.1 Travel Agent Upgrade — Design

**Date:** 2026-04-23
**Author:** Yuval + Claude (brainstorming session)
**Milestone:** v2.1 Travel Agent Upgrade (Phases 51–55)
**Status:** Draft — awaiting user review before GSD planning
**Predecessor:** v1.4 Travel Agent (shipped 2026-03-02, audited 15/15 requirements)
**Validation target:** Italy trip 2+ months out, WhatsApp group "איטליה עכשיו" (120363423910508974@g.us)

---

## Milestone goal

Extend the v1.4 Travel Agent from reactive-search + basic-memory into a **trip-aware concierge that ingests multimedia, remembers per-person context, detects conflicts, pushes day-of intelligence, and exposes a trip dashboard** — validated against a real Italy trip 2+ months out.

## Success definition

All five phases ship to main and activate in the Italy group before the trip begins. During the trip, the bot is demonstrably useful (judged by Yuval): morning briefings land on time, multimodal intake captures at least 3 bookings without manual entry, dashboard stays in sync with real-world decisions, no off-putting over-chattiness.

Tech-debt items carried forward from v1.4 audit (rate-limit-in-memory, 30-char prefix matching, 5-result cap) are explicitly **out of scope** for v2.1 and deferred.

---

## Cross-cutting decisions

| Area | Decision | Rationale |
|---|---|---|
| Chattiness | **Discreet** — "📌 noted" acks, hard-conflict alerts only, in-group day-of briefing | Italy group has real humans; noisy bot is worse than no bot |
| Schema style | **Hybrid**: structured columns for high-frequency query fields, `metadata` JSON for edge cases | Matches existing Drizzle conventions; avoids migration churn |
| Language | Group-language detection unchanged from v1.4 (Hebrew for Italy group) | Existing `detectLanguage` works; no new behavior |
| Calendar target | `calendar_id` (nullable text) on `trip_contexts`, default = primary Google Calendar | Per-trip flexibility without forcing dedicated-calendar migration |
| Trip lifecycle | **Auto-archive** on `end_date + 3 days` → `trip_archive` table; past trips show as read-only history on dashboard | Low-touch; user can manually trigger earlier from dashboard |
| Vision model | `gemini-2.5-flash` with structured-output schema | Already approved Gemini client; low cost per image |
| Weather API | **OpenWeather** (free tier, 1k/day) | Structured output, easy integration, new secret `OPENWEATHER_API_KEY` |
| Transit alerts | Gemini grounded search | Unstructured by nature; existing Gemini client extended via `geminiGroundedSearch` wrapper |
| Per-person preferences source | **Both** inferred (classifier) + self-reported (`!pref`, `!budget` commands); `origin` column tracks source | Reuse Phase 18 classifier; self-report handles precision cases |

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  WhatsApp group message arrives                                 │
│    ↓                                                            │
│  groupMessagePipeline.ts                                        │
│    ├─ handleTravelMention (v1.4, extended by Phase 53)          │
│    ├─ handleConfirmReject (v1.4, unchanged)                     │
│    ├─ handleMultimodalIntake ← NEW (Phase 52)                   │
│    ├─ addToTripContextDebounce (v1.4, classifier upgraded P51)  │
│    └─ handleKeywordRules (v1.2, unchanged)                      │
│                                                                 │
│  Debounced classifier (P51)                                     │
│    → extracts: category, cost, proposed_by, conflicts_with      │
│    → writes trip_decisions + triggers conflictDetector          │
│    → hard conflicts (≥0.9 conf, within 7 days) → discreet alert │
│    → soft conflicts → recorded, surfaced in day-of briefing     │
│                                                                 │
│  Cron: every 15 min (P54)                                       │
│    → For each active trip where now ≈ briefing_time (dest tz)   │
│      and today ∈ [start_date - 1d, end_date]:                   │
│        ├─ pull today's calendar events (Google Calendar API)    │
│        ├─ pull weather (OpenWeather)                            │
│        ├─ pull transit alerts (Gemini grounded search)          │
│        ├─ pull open questions + conflicts from DB               │
│        ├─ compose Hebrew briefing via Gemini                    │
│        └─ post to group (on failure → minimal calendar-only)    │
│                                                                 │
│  Cron: daily 02:00 (P51 archival)                               │
│    → For each trip_contexts row where now > end_date + 3d:      │
│        └─ move to trip_archive, status='archived'               │
│                                                                 │
│  Dashboard: /trips/:groupJid (P55)                              │
│    → React page reads from trip_contexts + trip_decisions       │
│    → timeline / map / decisions board / budget bar / export     │
│    → minimal-edit: delete decision, resolve question,           │
│       edit budget, trigger manual archive                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 51 — Richer Trip Memory (foundation)

**Goal:** `trip_decisions` carries per-person attribution, category, budget delta, and conflict metadata. `trip_contexts` carries trip dates, per-category budget targets, calendar_id, and archive status. Classifier extracts these new fields from existing debounced chat. Conflict detection runs after every decision insert.

### Schema delta (Drizzle migration)

`trip_decisions` additions:
- `proposed_by` (text, nullable) — phone/JID of the group member who proposed the decision
- `category` (text enum: `flights` | `lodging` | `food` | `activities` | `transit` | `shopping` | `other`)
- `cost_amount` (numeric, nullable)
- `cost_currency` (text, nullable, ISO-4217)
- `conflicts_with` (text, JSON array of decision IDs)
- `origin` (text enum: `inferred` | `self_reported` | `multimodal` | `dashboard`)
- `metadata` (text, JSON blob for edge-case fields)

`trip_contexts` additions:
- `start_date` (text, ISO-8601)
- `end_date` (text, ISO-8601)
- `budget_by_category` (text, JSON: `{flights: 1500, lodging: 2000, food: 800, activities: 500, transit: 200, shopping: 300, other: 0}`)
- `calendar_id` (text, nullable — Google Calendar ID; null = primary)
- `status` (text enum: `active` | `archived`, default `active`)
- `briefing_time` (text, nullable, `HH:MM` format in destination-tz, default `08:00`)

New table `trip_archive`:
- Same columns as `trip_contexts` + `id` (uuid PK) + `archived_at` (integer unix)
- Indexed on `group_jid`, `end_date`
- Note: `trip_contexts.group_jid` stays PK (one active trip per group). On archive, the row moves to `trip_archive` with a generated `id` so multiple historical trips per group can coexist. Decision-archival strategy (whether `trip_decisions` rows get a `trip_archive_id` FK, a `archived` flag, or move to a sibling `trip_decisions_archive` table) is an open question for Phase 51 planning — see Open Questions.

### Files

**New:**
- `src/groups/conflictDetector.ts` — exports `detectConflicts(groupJid, decisionId) → Conflict[]`; classifies hard vs soft
- `src/groups/tripPreferences.ts` — parses `!pref`, `!budget`, `!dates` self-report commands from group messages
- `src/cron/archiveTripsCron.ts` — daily 02:00 archival job
- `drizzle/migrations/XXXX_v21_phase51_trip_memory.sql`

**Changed:**
- `src/db/schema.ts` — add columns above
- `src/db/queries/tripMemory.ts` — update `insertTripDecision`, add `updateTripContext`, `archiveTrip`, `getBudgetRollup`
- `src/groups/tripContextManager.ts` — classifier prompt upgrade to extract new fields, wire conflictDetector call after insert

### Classifier upgrade

The existing Gemini classifier prompt in `processTripContext` is extended to output structured fields matching the new schema. Prompt includes few-shot Hebrew examples from the Italy group style. Output schema validated against Zod; invalid outputs logged and dropped (no defect-on-silent-fail).

### Conflict detection logic

After each successful `insertTripDecision`:
1. Load all active decisions for the same `group_jid` where `resolved=false`
2. For each candidate, check time-overlap using calendar integration (decisions with linked calendar events) or date+metadata-inferred time windows
3. Hard conflict: `timeOverlapMinutes > 0 AND confidence >= 0.9 AND decisionDate within 7 days of now`
   → post discreet group message: "💬 שימו לב — יש חפיפה בין X ל-Y ב-{time}"
   → update `conflicts_with` on both decisions
4. Soft conflict: `gapMinutes < 30 OR transitDistanceKm > 20`
   → record in `conflicts_with` silently; day-of briefing surfaces via "⚠️ היום: תכנון צפוף בין X ל-Y"

### Testing

- Unit: `conflictDetector.test.ts` — fixtures for overlap, tight-gap, long-transit, no-conflict
- Unit: `tripPreferences.test.ts` — `!pref vegan`, `!budget food 500 EUR`, malformed commands
- Unit: `tripMemory.test.ts` — budget rollup with fixture decisions, archive round-trip
- Integration: seed 10 decisions via classifier fixtures → verify `conflicts_with` graph correct

### Requirements

- **MEM2-01** Per-person attribution on trip decisions via `proposed_by` column, populated by classifier + `!` commands
- **MEM2-02** Per-category budget target in `trip_contexts.budget_by_category`, decisions with `cost_amount` roll up by `category`
- **MEM2-03** Conflict detection: hard conflicts posted discreet in group within 30s of decision insert; soft conflicts recorded for day-of briefing surfacing
- **MEM2-04** Preference capture: classifier populates `origin='inferred'`, `!pref`/`!budget` populate `origin='self_reported'`, dashboard writes populate `origin='dashboard'`
- **MEM2-05** Auto-archive: cron moves `trip_contexts` rows to `trip_archive` when `now > end_date + 3 days`; dashboard shows archived trips read-only

---

## Phase 52 — Multimodal Intake

**Goal:** When an image or PDF is dropped into a `travelBotActive` group, Gemini vision extracts structured trip data (booking, ticket, reservation, itinerary page). Extractions with confidence ≥0.8 are auto-filed as `trip_decisions` with `origin='multimodal'` and, when they include a date+time, trigger a `createSuggestion` (existing v1.4 calendar flow). Low-confidence extractions are silently discarded.

### Flow

1. `groupMessagePipeline.ts` detects `imageMessage`, `documentMessage` (PDF), or `stickerMessage` attachments
2. Pre-filter: skip stickers; skip images <50KB or emoji-only (Baileys metadata check)
3. Download media buffer via existing Baileys `downloadMediaMessage`
4. Call `geminiVision.extractTripFact(buffer, mimeType, groupContext)` — structured output schema returns `TripFactExtraction`
5. If `confidence >= 0.8`:
   - `insertTripDecision({ ...fields, origin: 'multimodal', source_message_id })`
   - If extraction has `date + time`: call existing `createSuggestion` → suggest-then-confirm calendar add
   - Post discreet ack: `"📌 noted: {type} — {summary}"` (1 line, group-language)
6. If `confidence < 0.8`: log and discard silently
7. On API error: log, no ack, no crash

### Extraction schema (Zod)

```ts
const TripFactExtraction = z.object({
  type: z.enum(['flight', 'hotel', 'restaurant', 'activity', 'transit', 'other']),
  title: z.string(),
  date: z.string().nullable(),          // ISO-8601 date
  time: z.string().nullable(),          // HH:MM destination-local
  location: z.string().nullable(),
  address: z.string().nullable(),
  reservation_number: z.string().nullable(),
  cost_amount: z.number().nullable(),
  cost_currency: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable(),
});
```

### Files

**New:**
- `src/groups/multimodalIntake.ts` — orchestrator (download + call vision + file decision + ack)
- `src/ai/geminiVision.ts` — wrapper around existing Gemini client, adds `extractTripFact`
- `src/groups/__tests__/fixtures/multimodal/` — fixture images: flight confirmation, hotel booking, restaurant reservation, museum ticket, restaurant menu (negative case)

**Changed:**
- `src/groups/groupMessagePipeline.ts` — new branch for media messages, runs before debounce
- `.env.example` — document `GEMINI_VISION_MODEL=gemini-2.5-flash` (or reuse existing `GEMINI_MODEL` if already matches)

### Testing

- vitest with 5+ fixture images covering: flight confirmation (expect `type='flight'`, high conf), hotel booking (expect `type='hotel'`), restaurant reservation (expect `type='restaurant'` with `time`), museum ticket (expect `type='activity'`), restaurant menu alone (expect `confidence < 0.8` — no decision created)
- Integration test: pipe fixture image through `multimodalIntake` end-to-end, assert `trip_decisions` row + (for dated fixtures) `pending_suggestions` row

### Requirements

- **MM-01** Image/PDF vision extraction produces `TripFactExtraction` with confidence; extractions ≥0.8 auto-file as `trip_decisions` with `origin='multimodal'`
- **MM-02** Dated extractions (date + time present) auto-trigger `createSuggestion` — the existing v1.4 suggest-then-confirm calendar flow
- **MM-03** Success ack: single-line `"📌 noted: ..."` posted in group; low-confidence extractions silent; vision errors silent

---

## Phase 53 — Smarter Search (Restaurants)

**Goal:** `@mention` restaurant queries return enriched results: photo (if available), open-now, price tier, cuisine tag, reservation-link. Stays compact (one-liner per result). Hotels/activities/generic paths unchanged from v1.4.

### Changes

`travelParser.ts`:
- New `queryType='restaurants'` branch in `parseTravelQuery` classifier prompt
- Detection keywords: "מסעדה", "מסעדות", "restaurant", "לאכול", "ארוחה"

`travelSearch.ts`:
- `geminiMapsSearch` already uses `googleMaps: {}` grounding; extend requested fields for restaurant queries: `photo_url`, `open_now`, `price_level`, `cuisine`, `reservation_url`
- New `SearchResult.restaurant` variant type

`travelFormatter.ts`:
- New template for restaurant variant: `🍽️ {name} · {cuisine} · {price_tier} · {open_now_emoji} · {rating}⭐ ({review_count}) · {url}`
- Photo URL appended as link preview if available (WhatsApp auto-unfurls)

**Scope boundary:** transit, attractions, shopping explicitly out per Q16 — deferred to v2.2 if needed.

### Files

**Changed only:** `src/groups/travelParser.ts`, `src/groups/travelSearch.ts`, `src/groups/travelFormatter.ts`

### Testing

- Snapshot test for restaurant formatter output (3 fixture Maps responses)
- Integration test: @mention "מסעדות בטוריסמו" → expect ≤5 restaurant one-liners with all required fields

### Requirements

- **SRCH2-01** Restaurant queryType exists in parser; Maps search returns enriched fields; formatter produces compact restaurant one-liners with cuisine + price + open-now + rating + URL

---

## Phase 54 — Proactive Day-Of Intelligence

**Goal:** At `briefing_time` destination-tz (default 08:00), starting the day before `start_date` and continuing through `end_date`, post a single group message with today's calendar events, weather, transit alerts, unresolved questions, today's conflicts, and budget-burn snapshot. On enrichment failure, fallback to minimal calendar-only template.

### Cron schedule

Every 15 minutes, `briefingCron` checks every active trip:
- Compute `destination_tz` (from `trip_contexts.destination` via a small lookup table or Gemini one-shot; cached in `metadata.tz`)
- If `now in destination_tz` matches `briefing_time ± 7min` AND `today ∈ [start_date - 1day, end_date]` AND no briefing posted today (tracked via `metadata.last_briefing_date`)
- → execute briefing for this trip

15-min granularity is sufficient — briefing_time is an `HH:MM` with minute precision but we round to the nearest cron tick.

### Briefing composition

1. Pull today's events from Google Calendar API for `calendar_id` (or primary)
2. Pull weather from OpenWeather (`/forecast` for destination coords; coords resolved from `destination` on first call, cached in `metadata.coords`)
3. Pull transit alerts via `geminiGroundedSearch.transitAlerts(destination, today)` — Gemini with `googleSearch: {}` grounding, prompt: "Any transit strikes, delays, or closures in {destination} on {today}? Respond with a 1-line summary or 'normal' if nothing notable."
4. Pull unresolved open items from DB via existing `getUnresolvedOpenItems`
5. Pull today's conflicts from DB (`trip_decisions` where `date(metadata.event_time) == today AND conflicts_with != '[]'`)
6. Pull budget burn via `getBudgetRollup` — format as "X% of Y used" per category
7. Call Gemini with structured input (all gathered data) + Hebrew output instruction → compose final briefing
8. Post to group as single message

### Fallback

If any enrichment source fails (OpenWeather 429, Gemini timeout, etc.), log the failure and post a minimal template:

```
🌅 בוקר טוב! היום ביומן:
• 09:00 — {event_1}
• 13:00 — {event_2}
• 19:30 — {event_3}
```

Only calendar events; no weather, no transit, no conflicts, no budget. Better-than-nothing rule.

### Files

**New:**
- `src/groups/dayOfBriefing.ts` — orchestrator
- `src/integrations/openWeather.ts` — client wrapping `/forecast` endpoint, coord lookup via `/geo/1.0/direct`
- `src/integrations/geminiGroundedSearch.ts` — thin wrapper reusing existing Gemini client, adds `googleSearch` tool binding
- `src/cron/briefingCron.ts` — 15-min cron registered in `src/cron/index.ts` (or existing cron init module)

**Changed:**
- `.env.example` — add `OPENWEATHER_API_KEY`
- `src/config.ts` — add optional config for OpenWeather key

### Testing

- Unit: `dayOfBriefing.test.ts` — fixture inputs (calendar events, weather, transit, open items) → expected Hebrew output snapshot
- Unit: `briefingCron.test.ts` — timezone math (Israel DST, destination tz arithmetic, window check day-before-travel through end_date)
- Unit: `openWeather.test.ts` — happy path + 429 retry + coord-cache hit
- Integration: full briefing run against seeded trip with mocked API responses → verify group message posted

### Requirements

- **DAY-01** Day-of briefing posted once per active-trip day at `briefing_time` destination-tz (default 08:00), window [start_date − 1d, end_date]; archived trips are skipped
- **DAY-02** Briefing enrichment: weather via OpenWeather, transit via Gemini grounded search, calendar events via Google Calendar API, open questions + conflicts + budget burn from DB
- **DAY-03** On enrichment failure, fallback to minimal calendar-only template; no crash, no skipped days

---

## Phase 55 — Trip Dashboard View

**Goal:** New dashboard route `/trips/:groupJid` shows trip header (destination, dates, budget target vs actual per category), timeline of confirmed calendar events, map of decisions with locations, decisions board (grouped by category, filter by `origin`, toggle resolved), open-questions list, conflict alerts, export button. Minimal-edit controls: delete decision, resolve question, edit budget (per Q12=B).

### Backend — new API routes (all JWT-gated, mounted under `/api/trips`)

- `GET /api/trips` — list all trips (active + archived) for dashboard sidebar nav
- `GET /api/trips/:groupJid` — full trip bundle: context + decisions + calendar events + open questions + budget rollup + conflict summary
- `DELETE /api/trips/:groupJid/decisions/:id` — mark decision as deleted (soft-delete via `status` column on decisions, new migration in this phase)
- `PATCH /api/trips/:groupJid/questions/:id/resolve` — mark open question resolved
- `PATCH /api/trips/:groupJid/budget` — update `budget_by_category`
- `POST /api/trips/:groupJid/export` — generate Google Doc with full trip summary, return doc URL

### Frontend — new components

- `dashboard/src/pages/TripView.tsx` — top-level page with route param
- `dashboard/src/hooks/useTrip.ts` — fetch + SSE subscription for live updates
- `dashboard/src/components/trip/TripHeader.tsx` — destination, dates, countdown, budget bar
- `dashboard/src/components/trip/Timeline.tsx` — vertical timeline of calendar events, today-highlighted
- `dashboard/src/components/trip/TripMap.tsx` — Leaflet + OpenStreetMap tiles (free, no Mapbox key), markers per decision with lat/lng metadata
- `dashboard/src/components/trip/DecisionsBoard.tsx` — grouped list by category, filter by origin (multimodal/inferred/self_reported/dashboard), delete action
- `dashboard/src/components/trip/OpenQuestions.tsx` — list + resolve action
- `dashboard/src/components/trip/BudgetBar.tsx` — per-category progress bars with overflow warning
- `dashboard/src/components/trip/ExportButton.tsx` — triggers Google Doc export, shows spinner + result link

### Google Doc export

- `src/integrations/googleDocsExport.ts` — new module
- Uses existing Google OAuth; requires scope `https://www.googleapis.com/auth/documents` added to scopes list → **one-time re-auth** by Yuval during phase 55 UAT
- Creates doc titled `{destination} {start_date} — Trip Summary`; sections: header, timeline, decisions-by-category, open questions, budget summary
- Returns shareable doc URL (owner's drive, private by default)

### Schema delta (Drizzle migration)

- `trip_decisions`: +`status` (text enum: `active` | `deleted`, default `active`) — soft-delete for dashboard deletion
- `trip_decisions`: +`lat` (numeric, nullable) +`lng` (numeric, nullable) — for map rendering

### Files

**New backend:** `src/api/routes/trips.ts`, `src/integrations/googleDocsExport.ts`, migration
**New frontend:** all 9 components above
**Changed:** `dashboard/src/App.tsx` (route), sidebar nav, `src/api/server.ts` (route registration)
**Deploy gotcha:** per `~/.claude/projects/.../project_whatsapp_bot.md` — after `vite build`, **must** `pm2 restart whatsapp-bot` before browser-testing; otherwise new hashed asset filenames 404 → MIME-type error

### Testing

- Backend: vitest for each route (JWT-gated, happy path, error cases, idempotency on delete/archive)
- Frontend: React Testing Library snapshot tests for TripHeader, BudgetBar, DecisionsBoard with fixture data
- E2E smoke: create test trip → add decisions via seed → open dashboard → delete one decision → verify SSE update → trigger export → verify Google Doc created

### Requirements

- **DASH-TRIP-01** `/trips/:groupJid` renders trip header (destination, dates, countdown, budget), timeline, map with decision markers, decisions board grouped by category with origin filter, open questions list, conflict alerts
- **DASH-TRIP-02** Minimal-edit actions: delete decision (soft), resolve question, edit per-category budget — all JWT-gated, all SSE-live-updating
- **DASH-TRIP-03** Export button creates Google Doc with full trip summary using existing OAuth + `documents` scope; returns shareable owner-private URL

---

## Cross-phase integration

```
Phase 51 (Memory schema + classifier)
    ↓ extended decision shape, budget rollup, conflict graph
Phase 52 (Multimodal) ──writes──┐
                                ↓
Phase 53 (Restaurants search)  ←reads── trip_decisions + trip_contexts
                                ↑
Phase 54 (Day-of briefing) ←reads──┤
                                   ↓
Phase 55 (Dashboard) ←reads──────┘── all of the above
```

Ship order is also execution order: **51 → 52 → 53 → 54 → 55**. Each phase can ship independently to main; the Italy group benefits from Phase 51 memory even if 52-55 aren't live yet.

### Phase-to-requirement mapping

| Requirement | Phase |
|---|---|
| MEM2-01, MEM2-02, MEM2-03, MEM2-04, MEM2-05 | 51 |
| MM-01, MM-02, MM-03 | 52 |
| SRCH2-01 | 53 |
| DAY-01, DAY-02, DAY-03 | 54 |
| DASH-TRIP-01, DASH-TRIP-02, DASH-TRIP-03 | 55 |

Total: **15 requirements** across 5 phases. Mirrors v1.4 shape.

---

## Out of scope (explicitly deferred)

- v1.4 audit tech debt (in-memory rate limits, 30-char prefix matching, 5-result cap)
- Multi-trip per group (schema assumes one active trip per group)
- Group-member multi-user chattiness tuning (static "discreet" for all)
- Transit / attractions / shopping search expansion (deferred to v2.2 if demanded)
- PDF / HTML / public-link trip export variants (Google Doc only)
- Real-time flight / hotel price tracking
- Voice-reply to briefings (v1.3 voice stack could be layered later)
- Automated conflict resolution (e.g., bot suggests rebooking) — flag-only v2.1

---

## Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini vision misextracts high-confidence false positives | Wrong decision filed, pollutes memory | Phase 55 dashboard minimal-edit lets Yuval delete bad rows; `origin='multimodal'` filter in dashboard for quick audit |
| Day-of briefing posts at wrong local time | User annoyance, miss timing | Destination-tz lookup cached; fallback to Israel-tz if lookup fails with a logged warning |
| Conflict detector false-positive floods group | UX disaster, violates Q5=discreet | Hard-conflict threshold locked at ≥0.9 conf + ≤7d window; fallback to soft/deferred for everything else |
| OpenWeather 1k/day free tier exhausted | Briefing falls back to calendar-only | Coord + tz cached in `metadata`; one forecast call per active trip per day — well under 1k even with 10 trips |
| Google Doc export scope re-auth breaks existing OAuth for Calendar/Tasks | Production outage | Re-auth happens in Phase 55 UAT, not during cron; rollback possible by reverting scope addition |
| Auto-archive fires mid-trip if end_date shifted | Data temporarily archived | Archive is soft (row moved to `trip_archive`, data preserved); un-archive route can be added in a follow-up if observed. Primary guard: only archive when `now > end_date + 3 days`, so accidental early archival requires a date-entry mistake. |

---

## Open questions (to answer during phase planning)

1. **Destination coordinates + timezone lookup** — one-shot Gemini at trip-setup time, or static list? Italy is covered by either; future-trip-proofing via Gemini is safer.
2. **`!budget` command syntax** — `!budget food 500 EUR` vs `!budget food=500 EUR`? Decide during Phase 51 plan.
3. **Conflict alert Hebrew copy** — the exact phrasing of "💬 שימו לב..." should be test-driven in Phase 51 review.
4. **Decision-archival strategy** — when a trip auto-archives, do its `trip_decisions` rows get a `trip_archive_id` FK, a boolean `archived` flag, or move to a sibling `trip_decisions_archive` table? Decide during Phase 51 plan; affects dashboard "past trips" read path in Phase 55.
5. **Map tile provider** — OpenStreetMap free tier has etiquette/rate limits; for light dashboard use it's fine, but worth noting in Phase 55.
6. **Briefing "delay warning"** — if cron lags by >7min and briefing_time passes, do we skip today or post late? Default: post late but prefix with "⏰ מתאחר".

These are implementation-detail questions, not design questions — they'll be resolved in each phase's GSD plan.

---

## Next steps (after user review)

1. Commit this spec doc on branch `feat/v2.1-travel-agent-design`
2. Write `.planning/milestones/v2.1-REQUIREMENTS.md` with 15 requirements in GSD format
3. Update `.planning/ROADMAP.md`:
   - Mark v2.0 as shipped (it already is)
   - Add v2.1 milestone with Phases 51–55 seeded
4. User reviews + approves
5. `/gsd:plan-phase 51` — detailed plan for Phase 51 (Richer Trip Memory), then execute
6. Repeat for 52–55 sequentially

All five phases ship pre-trip per Q3=C.

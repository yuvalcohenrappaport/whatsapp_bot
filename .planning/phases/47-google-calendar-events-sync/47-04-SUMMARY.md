---
phase: 47-google-calendar-events-sync
plan: "04"
status: complete
shipped: 2026-04-23
requirements: [GCAL-01, GCAL-02, GCAL-03, GCAL-04, GCAL-05, GCAL-06]
---

# Plan 47-04 Summary — Deploy + Owner Walkthrough (GCAL-01..06)

## Outcome

Phase 47 Google Calendar Events Sync verified live on PM2 whatsapp-bot. Five of six GCAL requirements observed empirically against real Google Calendar data; GCAL-05 accepted on code-coverage alone due to live-data limitation documented below.

## Deploy posture

No PM2 restart — merge commit `d95363d` (2026-04-21) already carries Phase 47 code. Dashboard bundle `index-CiSMOBQK.js` contains all filter-panel + read-only-pill wiring.

## Sanity-curl evidence (pre-walkthrough)

```
GET /api/google-calendar/calendars   → 200, 3 owned calendars: Family (rose), yuvalc79@gmail.com primary (violet), Italy (sky)
GET /api/google-calendar/events      → 200, 16 events across calendars
GET /api/calendar/items              → 200, sources.gcal='ok', 16 gcal items inside unified payload
Unauth                                → 401
```

## Walkthrough evidence (UAT-CHECKLIST section B, 8 steps)

- **B1 GCAL-01**: `/calendars` returns Family / yuvalc79 primary / Italy with distinct accessRole=owner and hashed palette colors.
- **B2 GCAL-02 recurring**: recurring events render as separate pills per occurrence (`singleEvents: true` expansion confirmed).
- **B3 GCAL-02 all-day**: all-day events render on the correct day only, no next-day bleed (the `end.date` exclusive → inclusive −1ms fix works).
- **B4 GCAL-02 multi-day**: 3-day event spans exactly 3 grid days inclusive.
- **B5 GCAL-04 filter panel**: CalendarFilterPanel shows two sections — "Google Tasks" (Phase 46) and "Google Calendar" (new). Family toggle hides rose pills, refresh persists, `localStorage.calFilterPrefs_v1.gcalCalendars` written.
- **B6 GCAL-06 read-only**: drag on gcal pill does nothing, click does not open inline editor, PillActionSheet shows only "Open in Google Calendar" + Cancel.
- **B7 GCAL-06 htmlLink**: "Open in Google Calendar" opens a new tab to the correct event on calendar.google.com (via `sourceFields.htmlLink`).
- **B8 GCAL-05 dedup caveat**: `personal_pending_events WHERE status='approved' AND calendar_event_id IS NOT NULL` returned **zero rows** at walkthrough time — no WhatsApp-detected event has yet flowed through the approve-into-gcal path. Dedup code path is proven by Plan 47-01's 10-case vitest suite (includes the `drop when calendar_event_id matches` case). Owner accepted GCAL-05 via code coverage.

## GCAL-05 live-verification deferral

The dedup fixture needed for an empirical check (a `personal_pending_events` row with `calendar_event_id` set) does not exist in the current production DB. This is not a Phase 47 bug — it reflects that the bot's personal-event approval flow hasn't yet produced a calendar-synced row. When that first row arrives, visual dedup will be observable. No code change required. Logged as a future observation rather than a defect.

## Closeout

- ROADMAP.md Phase 47 row flipped → `4/4 Complete 2026-04-23`; Plans 47-02, 47-03, 47-04 checkboxes → `[x]`.
- REQUIREMENTS.md GCAL-03 checkbox → `[x]` (was stale `[ ]` — traceability row already Complete from Plan 47-02 shipping).
- STATE.md updated — Phase 47 marked complete.

## Next

Phase 48 closeout (Plan 48-03 Task 4) → Phase 49 v1.9 milestone close.

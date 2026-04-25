---
phase: 55-trip-dashboard-view
plan: 05
subsystem: ui
tags: [google-docs, google-oauth, oauth-scope, export, googleapis, vitest, dashboard]

# Dependency graph
requires:
  - phase: 55-trip-dashboard-view
    provides: TripView.tsx + useTrip hook + trip bundle API (55-01 through 55-04)
  - phase: 55-trip-dashboard-view
    provides: personalCalendarService.getAuthUrl + getOAuth2Client (existing Google OAuth client reused)
provides:
  - "src/integrations/googleDocsExport.ts — exportTripToGoogleDoc(bundle) -> { url, documentId } via google.docs v1 + google.drive v3"
  - "POST /api/trips/:groupJid/export (JWT-gated) — returns { url } on success, 412 + re-auth message pre-scope"
  - "dashboard/src/components/trip/ExportButton.tsx — spinner, 412 toast with /integrations link, opens Doc in new tab"
  - "documents + drive.file scopes added to personalCalendarService.getAuthUrl"
affects: [v2.2-deferred, google-oauth-scope-evolution, trip-dashboard-v2.2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Google Docs export: create empty doc → batchUpdate insertText at index:1 → drive.files.get for webViewLink (Docs API doesn't return it)"
    - "Scope-check at runtime: 403 insufficientPermissions from docs.documents.create → throw MissingDocsScopeError → 412 response with re-auth action"
    - "drive.file (narrow) not drive (full) — grants access only to files the app creates"

key-files:
  created:
    - src/integrations/googleDocsExport.ts
    - src/integrations/__tests__/googleDocsExport.test.ts
    - dashboard/src/components/trip/ExportButton.tsx
  modified:
    - src/calendar/personalCalendarService.ts
    - src/api/routes/trips.ts
    - src/api/routes/__tests__/trips.test.ts
    - dashboard/src/pages/TripView.tsx

key-decisions:
  - "Plain-text body for v2.1 — no Docs API styling (heading/paragraph requests); formatting deferred to v2.2"
  - "drive.file scope (narrow) not drive (full) — Google recommended minimal scope; grants access only to app-created files"
  - "Archived trips still export — export is a read operation, not an edit; readOnly flag does not block exports"
  - "MissingDocsScopeError thrown from exportTripToGoogleDoc and surfaced as 412 by the route — allows re-auth UX path without crashing"
  - "Re-auth flow reuses existing /integrations Google OAuth button — no new auth UI needed; owner re-authorizes once per scope upgrade"

patterns-established:
  - "Google Docs export: create → batchUpdate(insertText) → drive.files.get(webViewLink) — three-step sequence, webViewLink not available from docs.documents.create"
  - "412 for missing OAuth scope with action message — UI converts to a 5s toast with /integrations deep-link"

requirements-completed: [DASH-TRIP-03]

# Metrics
duration: 45min
completed: 2026-04-25
---

# Phase 55 Plan 05: Google Docs Export Summary

**One-click Google Doc export with oauth documents+drive.file scope, soft-delete exclusion, and 412 re-auth flow — completes v2.1 milestone**

## Performance

- **Duration:** ~45 min (Tasks 1+2 executed before checkpoint; Task 3 is UAT documentation)
- **Started:** 2026-04-25T13:20:00Z (estimated)
- **Completed:** 2026-04-25T17:04:00Z (Google re-auth callback confirmed, export verified)
- **Tasks:** 3 of 3
- **Files modified:** 7

## Accomplishments

- `src/integrations/googleDocsExport.ts` ships `exportTripToGoogleDoc(input)` using google.docs v1 + google.drive v3; creates doc, batchUpdate-inserts plain-text body (TIMELINE / DECISIONS / OPEN QUESTIONS / BUDGET sections), fetches webViewLink via drive.files.get
- `personalCalendarService.getAuthUrl()` now requests `auth/documents` + `auth/drive.file` alongside calendar + tasks; one-time owner re-auth required (completed 2026-04-25 17:04 IST)
- `POST /api/trips/:groupJid/export` (JWT-gated, archived trips allowed) returns `{ url }` on success or 412 with `action` re-auth message; `ExportButton` in TripView triggers route, shows spinner, opens Doc in new tab, 412 toast deep-links to /integrations
- 6 vitest cases for the export module + 6 new export cases in trips.test.ts (34 total), all green

## Task Commits

1. **Task 1: googleDocsExport module + scope add + export route + ExportButton** - `49c7617` (feat)
2. **Task 2: Vitest for googleDocsExport + export route** - `c7033f1` (test)
3. **Task 3: Phase 55 final UAT — export round-trip + Google re-auth** - (documentation only, no code commit)

**Plan metadata:** (docs commit — this SUMMARY)

## Files Created/Modified

- `src/integrations/googleDocsExport.ts` — exportTripToGoogleDoc, TripExportInput, MissingDocsScopeError, renderTripBody, isInsufficientScopeError
- `src/integrations/__tests__/googleDocsExport.test.ts` — 6 vitest cases (body sections, deleted exclusion, resolved Q exclusion, 403→MissingDocsScopeError, webViewLink, fallback URL)
- `src/calendar/personalCalendarService.ts` — `auth/documents` + `auth/drive.file` added to scope array in getAuthUrl
- `src/api/routes/trips.ts` — POST /api/trips/:groupJid/export route (JWT-gated, exportTripToGoogleDoc, MissingDocsScopeError → 412)
- `src/api/routes/__tests__/trips.test.ts` — +6 export cases (401, 404, 200+url, 412 scope missing, 500, archived→200)
- `dashboard/src/components/trip/ExportButton.tsx` — ExportButton with spinner, 412 re-auth toast, window.open
- `dashboard/src/pages/TripView.tsx` — ExportButton mounted in actions row above Timeline section

## Decisions Made

- **Plain-text body for v2.1:** renderTripBody() outputs plain text; no Docs API styling (heading/paragraph style requests). Formatting left for v2.2.
- **drive.file (narrow) over drive (full):** Grants access only to files the app creates (not user's full Drive). Google recommended minimal scope for Docs creation.
- **Archived trips can export:** Export is a read operation; the plan explicitly confirms archived trips are not blocked. readOnly flag gates writes only.
- **412 for pre-scope state:** MissingDocsScopeError from docs.documents.create → 412 + `action` field → ExportButton renders a 5s toast with /integrations deep-link.
- **Three-step Docs creation sequence:** create empty doc → batchUpdate(insertText at index 1) → drive.files.get(webViewLink). The docs.documents.create response does not include webViewLink; Drive API is required.

## Deviations from Plan

None — plan executed exactly as written.

## UAT Evidence (Task 3)

**Google re-auth (one-time):**
- Owner re-authorized via `http://localhost:3000/api/auth/google` (SSH tunnel on 2026-04-25 at 17:04 IST)
- Callback timestamp: `2026-04-25 17:04:03`
- Callback scope line confirms: `scope=...auth/drive.file auth/documents auth/tasks auth/calendar` — all four scopes present
- `settings.google_oauth_refresh_token` freshly persisted after consent

**Export round-trip:**
- Export triggered from dashboard UI (ExportButton on TripView)
- Google Doc opened correctly in new tab
- DECISIONS section did NOT contain soft-deleted decisions — `par-14` Café de Flore (previously soft-deleted) absent from DECISIONS section, confirming CONTEXT-locked behavior

**Phase 55 acceptance criteria (all 8 checked):**
- [x] /trips list page navigable from sidebar
- [x] /trips/:groupJid renders six sections in CONTEXT-locked order
- [x] All write routes JWT-gated; SSE propagates writes within ~3s to a second tab
- [x] Timeline today-highlighted; Map markers per decision with lat/lng
- [x] Decisions grouped by category; origin chips multi-toggle with counts; delete = confirm modal → soft-delete invisible everywhere by default
- [x] Budget bar per-category; overflow visually distinct
- [x] Export creates Google Doc with all sections; deleted/resolved excluded; URL owner-private
- [x] Deploy gotcha verified: pm2 restart performed; fresh hashed assets served
- [x] Italy live walk works on desktop AND mobile

## Phase 55 Wrap-Up — v2.1 Milestone Complete

All 5 plans shipped:

| Plan | Commit(s) | Summary |
|------|-----------|---------|
| 55-01 DB foundation + helpers | (multiple) | `.planning/phases/55-trip-dashboard-view/55-01-SUMMARY.md` |
| 55-02 API routes | `fa072f4`, `8abe368` | `.planning/phases/55-trip-dashboard-view/55-02-SUMMARY.md` |
| 55-03 Dashboard data layer + nav | `a674d88`, `c17793c` | `.planning/phases/55-trip-dashboard-view/55-03-SUMMARY.md` |
| 55-04 Full trip dashboard UI + UAT | `8ad7d8e`, `c5d538d` + (others) | `.planning/phases/55-trip-dashboard-view/55-04-SUMMARY.md` |
| 55-05 Google Doc export (this plan) | `49c7617`, `c7033f1` | this file |

**Notable scope adds during Phase 55 (tracked in STATE.md):**
- **55-04 scope add 1:** `restoreDecision` DB helper + `POST /api/trips/:groupJid/decisions/:id/restore` + Restore button in DecisionsBoard (commits `8ad7d8e`, `c5d538d`). Pulled forward from v2.2 deferred list.
- **55-04 scope add 2:** Google Maps links — MapPin icon in DecisionsBoard + "Open in Google Maps" link in Leaflet popup (commit `c5d538d`). Pulled forward from v2.2 deferred list.
- **Migration gap-closure:** drizzle 0023/0024 trailing breakpoints side-fix (commit `857c011`) — blocked migration replays in test suite; fixed as Rule-3 auto-fix during Phase 54/55 test work.

**Future work captured:**
- `.planning/todos/pending/2026-04-25-google-maps-integration-trip-dashboard.md` (commit `e2759bb`) — full Google Maps API integration for trip dashboard (v2.2 candidate)

## GCP One-Time Setup (next environment)

Before the export route will work in a new environment, enable:
1. **Google Docs API** — https://console.cloud.google.com/ → APIs & Services → Library → "Google Docs API" → ENABLE
2. **Google Drive API** — same location → "Google Drive API" → ENABLE
3. GCP project number: **81921508668**
4. After enabling APIs, owner must re-authorize via /integrations to obtain a refresh_token with `auth/documents` + `auth/drive.file` scopes

## Issues Encountered

None.

## User Setup Required

**One-time Google re-authorization already completed (2026-04-25 17:04 IST).** The refresh_token is persisted in `settings.google_oauth_refresh_token`.

For future environment setup: see "GCP One-Time Setup" section above.

## Next Phase Readiness

**v2.1 Travel Agent Upgrade milestone is COMPLETE.** All 5 phases shipped:
- Phase 51: Richer Trip Memory
- Phase 52: Multimodal Intake
- Phase 53: Smarter Search (Restaurants)
- Phase 54: Proactive Day-Of Intelligence
- Phase 55: Trip Dashboard View

Next milestone direction: to be picked by user. v2.2 deferred candidates include: Google Maps API integration, Docs export rich formatting, trip sharing, calendar two-way sync.

---
*Phase: 55-trip-dashboard-view*
*Completed: 2026-04-25*

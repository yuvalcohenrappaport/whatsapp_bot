---
phase: 57-drop-a-pin-dashboard-editing
plan: 05
subsystem: ui
tags: [react, dashboard-ui, leaflet, places-autocomplete, sse, optimistic-updates]

# Dependency graph
requires:
  - phase: 57-02
    provides: PATCH /pin route + autocomplete-places + place preview routes
  - phase: 57-03
    provides: useTrip.mutations.pinDecision (Promise<boolean>) + tripSchemas
  - phase: 57-04
    provides: PinDecisionPicker standalone component
provides:
  - Inline pin button on every active decision row (DecisionsBoard) — hidden on archived trips
  - PinDecisionPicker mounted inline directly under the active row (single-row-edit invariant via lifted state)
  - TripMap off-map badge becomes a clickable button when offMapCount > 0 AND non-archived; archived dashboards render the unchanged informational <div> variant
  - TripHeader top-of-page amber banner "Trip archived — read-only" when bundle.readOnly
  - TripView state wiring: activePinPickerId + handleSavePin (Promise<boolean> pass-through) + handleBadgeClick (scroll-to-first-un-geocoded + open picker)
  - Live UAT 14/14 PASS against PM2 bot (Tailscale URL)
affects: [58-group-trip-linking, 59-welcome-message-refresh]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "activePinPickerId lifted to TripView so opening a second row's picker closes the first one's; both DecisionsBoard pin button AND TripMap badge route through the same setActivePinPickerId state"
    - "TripMap.onBadgeClick: (() => void) | null — null prop renders the informational <div> variant; non-null renders the <button> variant with hover styling. Prop-driven D13 enforcement"
    - "Row-wrapper restructure: existing decision row + conditional PinDecisionPicker mount wrapped under a key={d.id} parent <div className='relative'> so React reconciles them as a unit per row"
    - "handleSavePin in TripView is a thin pass-through wrapper that returns mutations.pinDecision's boolean unchanged so the picker can drive its own inline 'Pin failed — try again' UI on D11 dual-surface (toast + inline)"
    - "crypto.randomUUID fallback for insecure HTTP origins — generateSessionToken helper prefers crypto.randomUUID when available, falls back to Math.random RFC 4122 v4 on LAN/Tailscale HTTP where crypto.randomUUID is undefined"

key-files:
  created: []
  modified:
    - dashboard/src/components/trip/DecisionsBoard.tsx
    - dashboard/src/components/trip/TripMap.tsx
    - dashboard/src/components/trip/TripHeader.tsx
    - dashboard/src/pages/TripView.tsx
    - dashboard/src/components/trip/PinDecisionPicker.tsx (UAT-driven crypto.randomUUID fix)

key-decisions:
  - "activePinPickerId lifted to TripView (not local to DecisionsBoard) so the single-row-edit invariant holds across BOTH trigger surfaces (row pin button + TripMap badge click) without each owning duplicate state"
  - "useTrip.ts NOT modified in this plan — the Promise<boolean> contract was set in Plan 03 as the stable boundary; handleSavePin is a thin pass-through so D11 dual-surface error works without re-touching the hook"
  - "TripMap.onBadgeClick is prop-driven null vs callback (rather than internal isReadOnly check) — keeps TripMap unaware of trip-level state; archived enforcement lives entirely in TripView's `bundle.readOnly ? null : handleBadgeClick` ternary"
  - "Row-wrapper restructure under key={d.id} parent <div> — picker mounts/unmounts cleanly when activePinPickerId flips, no React reconciliation glitches between the existing row and the conditionally-mounted picker"
  - "crypto.randomUUID fallback (Math.random v4) is acceptable because the sessionToken is a Places billing-grouping ID, not a security boundary — UAT-driven discovery on Tailscale HTTP origin"

patterns-established:
  - "Lifted edit-mode invariant: when N row-level surfaces can each open the same edit UI, lift the active id to the parent and route ALL trigger surfaces through one setter — guarantees the single-edit invariant unconditionally"
  - "Browser API fallback for insecure HTTP origins: any code touching crypto.randomUUID (or other Secure-Context-Only APIs) must guard with feature-detect + Math.random fallback when running on LAN/Tailscale HTTP"

requirements-completed: [DASH-TRIP-04]

# Metrics
duration: ~3.5 hours (Tasks 1-3 auto-execute + Task 4 human-verify checkpoint with mid-UAT fix + side debugs)
completed: 2026-04-27
---

# Phase 57 Plan 05: TripView Wire-up + Live UAT Summary

**DecisionsBoard pin button per row + TripMap clickable badge + TripHeader archived banner + TripView state wiring; PinDecisionPicker mounts inline under the active row; live UAT 14/14 PASS against PM2 bot. UAT discovered crypto.randomUUID is undefined on Tailscale HTTP (insecure context) — patched via Math.random v4 fallback as a separate atomic commit.**

## Performance

- **Duration:** ~3.5 hours total — Tasks 1-3 ~10 min auto-execute; Task 4 (UAT) extended due to a Tailscale-HTTP crypto.randomUUID fix and two adjacent bugs surfaced (separate commits)
- **Completed:** 2026-04-27
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint)
- **Files modified:** 4 in plan scope + 1 UAT-driven fix

## Accomplishments

- DecisionsBoard exposes inline `MapPlus` ghost icon button per active decision row (both un-geocoded AND already-pinned rows — re-pin uses same UI per CONTEXT lock); button hidden when readOnly
- PinDecisionPicker mounted inline directly under the row when `activePinPickerId === d.id && !readOnly`
- TripMap off-map badge becomes a `<button>` with hover styling when `offMapCount > 0 && onBadgeClick !== null`; archived dashboards render the unchanged informational `<div>` variant (D13)
- TripHeader top-of-page amber banner "Trip archived — read-only" when `bundle.readOnly`
- TripView holds `activePinPickerId` state + `handleSavePin` (thin Promise<boolean> pass-through) + `handleBadgeClick` (scrolls to first un-geocoded active row + opens its picker via setTimeout(50ms) for mount latency)
- UAT 14/14 PASS — including #3 D9 optimistic decrement BEFORE server response and #9 D14 archived-decision → 403 (distinct from 404 missing/wrong-group)
- UAT-driven fix: `generateSessionToken()` helper falls back to Math.random RFC 4122 v4 when `crypto.randomUUID` is undefined on insecure HTTP origins (Tailscale IP, LAN HTTP) — committed separately so its motivation stays discoverable

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire pin button + inline picker into DecisionsBoard rows** — `1cc3251` (feat)
2. **Task 2: Make TripMap badge clickable + add archived banner to TripHeader** — `bce6cf8` (feat)
3. **Task 3: Wire PinDecisionPicker through TripView** — `c261a7c` (feat)
4. **UAT-driven fix: crypto.randomUUID fallback for insecure HTTP origins** — `11d2b50` (fix)

## UAT Outcomes (14/14 PASS, owner-confirmed 2026-04-27)

1. ✅ Active trip — pin a no_match row (Picker → autocomplete → preview-fetch → Save → "Pinned ✓" → map pin appears, badge decrements)
2. ✅ Active trip — re-pin an already-geocoded row (place_id + metadata overwritten, map pin moves)
3. ✅ **D9 optimistic decrement BEFORE server** — verified with Slow 3G throttling; badge + map pin updated in same React tick as click, PATCH /pin still pending
4. ✅ Badge click → scroll-to-first-un-geocoded + auto-open picker
5. ✅ Search-failed inline error + Retry button (verified by setting GOOGLE_PLACES_API_KEY=invalid_x then restoring)
6. ✅ "No matches" inline error on `xqzqzqzq123` query
7. ✅ Preview-fetch failure → "Could not load place details — try another place" + picked row clears + Save disabled
8. ✅ D11 dual-surface: optimistic revert + sonner toast + inline "Pin failed — try again" on PATCH /pin 502
9. ✅ **D14 archived-decision → 403** (`{ error: 'Decision is archived' }` — NOT 404)
10. ✅ Two-tab SSE sync (~3s) — pin in tab A reflects in tab B's map pin + badge
11. ✅ Archived trip — pin icons fully hidden (not greyed) + amber banner + badge informational only
12. ✅ Archived trip — server enforces 403 on direct PATCH /pin (`{ error: 'Trip is archived' }`)
13. ✅ Hebrew query path — `מסעדה תל אביב` → suggestions returned in Hebrew, `place_metadata.displayName` carries Hebrew + English
14. ✅ Bundle leak check — `GOOGLE_PLACES_API_KEY` not findable in dashboard JS bundle

## Side discoveries during UAT (separate commits, NOT Phase 57 scope)

These were latent bugs surfaced while exercising the dashboard against a real Paris trip — patched separately so they don't muddy Phase 57's history:

- **`6e139b9` — `fix(detection): owner messages reach trip classifier in own groups`**: 3-stack of issues blocking `addToTripContextDebounce` from ever seeing the owner's typed messages. (a) `groupMessagePipeline.ts:284` `if (msg.fromMe) return` killed both classifiers for owner-typed messages; (b) `tripContextManager.ts` TRAVEL_SIGNALS regex omitted food/activity/transit/shopping signals; (c) no way to distinguish owner-typed (fromMe=true) from bot-sent (fromMe=true via sock.sendMessage echo). Fixed via new `sentMessageTracker` module + monkey-patched `sock.sendMessage` + extended regex + gated guard. Verified: owner sent "מסעדה Verjus ביום שני 19:30" → row appeared in trip_decisions with origin='inferred'.

- **One-off ACL share for Paris group calendar (not committed)**: per-group calendars are owned by the GCP service account `whatsapp-bot@complete-welder-488314-p1.iam.gserviceaccount.com`, not by the user's OAuth. The Paris calendar was created when `groups.member_emails` was empty, so `shareCalendar` was never invoked → user's `yuvalc79@gmail.com` had no ACL → "you do not have permission to view them" in Google Calendar. Fixed by running `scripts/share-paris-calendar.ts` (one-shot). FOLLOW-UP: Phase 58/59 should make `shareCalendar` idempotent on every event creation OR ensure `member_emails` defaults at group registration.

## Plan metadata

- Plan file: `.planning/phases/57-drop-a-pin-dashboard-editing/57-05-PLAN.md`
- Phase: 57-drop-a-pin-dashboard-editing
- Wave: 4
- Requirements satisfied: DASH-TRIP-04
- Phase 57 status: **COMPLETE** (5/5 plans, 2026-04-27)

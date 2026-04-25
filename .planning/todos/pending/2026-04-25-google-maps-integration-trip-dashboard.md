---
created: 2026-04-25
title: Google Maps integration for trip dashboard (beyond static links)
area: ui+api
milestone_target: v2.2 (or later)
phase_target: 56+ (post-v2.1)
files:
  - dashboard/src/components/trip/TripMap.tsx
  - dashboard/src/components/trip/DecisionsBoard.tsx
  - src/db/queries/tripMemory.ts
  - src/api/routes/trips.ts (potentially)
---

## Problem

Phase 55 shipped two layers of map functionality:

1. **Leaflet + OSM tiles** for the in-page trip map (free, no API key, works offline-friendly)
2. **Static "Open in Google Maps" links** on every decision row + map popup (Phase 55-04 scope add — `?q=lat,lng` for rows with coords, text-search fallback for rows without)

The links are useful but the integration is shallow. Yuval requested deeper Google Maps integration as a follow-up. Current gaps:

- **No automatic coordinate resolution** — many decisions land in the DB as text only (no lat/lng). The "3 decisions not on map" badge is a workaround, not a fix. Today the only way to add coordinates is for the multimodal/inferred classifier to extract them upstream.
- **No place metadata** — we have decision text like "Septime tasting menu" but no Google Places `place_id`, photo, rating, opening hours, or canonical address. Useful for the dashboard ("currently open until 22:00") and for the Google Doc export ("Septime · 80 Rue de Charonne · ★4.5").
- **Tile provider is OSM** — fine for v2.1, but Google's tiles + Street View thumbnail in popups would feel more premium and match where users open the link anyway.
- **No "drop a pin" workflow** — owner can't manually set coords for the 3 no-coord decisions from the dashboard. Only deletes/resolves/budget edits exist as dashboard writes today.

## Solution

**TBD — discovery work needed before planning.** Open questions for a future `/gsd:discuss-phase`:

- **Geocoding strategy:** server-side batch geocoding job that runs on new decisions (cheap, cached) vs. on-demand from the dashboard? Google Places API has a per-request cost — what's the budget?
- **Tile provider:** swap Leaflet OSM for Google Maps JS SDK, or keep Leaflet + use Google tiles via a tile proxy? Google's licensing requires their JS SDK in most cases.
- **Manual lat/lng input:** "Edit coordinates" affordance per row was deferred from 55-04 (CONTEXT-locked: only delete/resolve/budget edits). Pulling it forward as part of this integration?
- **Places metadata storage:** add `place_id`, `address`, `rating`, `photo_url` columns to `trip_decisions`? Or a sibling `trip_decision_places` table cached separately?
- **API key management:** where does the Google Maps API key live? Existing `personalCalendarService.ts` uses Google OAuth for Docs/Calendar but Places API uses an API key (not OAuth). New env var, billing setup, key restrictions.

## Concrete touch-points (when planning starts)

- Add Places autocomplete to the future "manual edit" modal so the owner can search "Septime Paris" and pin it
- Backfill geocoding for existing decisions via a one-time job (~14 active rows in the seed Paris trip already → cheap)
- Consider whether `googleDocsExport.ts` (Phase 55-05) should embed Google Maps thumbnails in the exported doc

## Why deferred

Phase 55 scope was already large (5 plans, 25k LOC across migration + API + frontend). Adding Places API integration would have doubled the surface area and required new auth/billing setup. The static links shipped in 55-04 cover 80% of the user value with 5% of the engineering cost.

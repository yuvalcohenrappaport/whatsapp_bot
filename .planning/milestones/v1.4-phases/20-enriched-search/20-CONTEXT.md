# Phase 20: Enriched Search - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Travel search returns richer results with ratings, hours, and addresses via Maps Grounding, returns more results for accommodation and activity queries, and labels booking-ready links. This upgrades the existing travelSearch.ts and travelFormatter.ts — no new pipeline steps or modules.

</domain>

<decisions>
## Implementation Decisions

### Result format and density
- Compact one-liner per result: "1. Hotel Name ⭐ 4.5 (120) — Address — URL"
- Accommodation and activity searches return 5-6 results
- Quick queries (e.g., "coffee near the hotel") return 3 results
- Same format for both query types — always show rating and address when available
- Skip opening hours entirely — ratings + address is enough, hours clutter the message and change daily

### Booking label behavior
- Major booking sites only via curated allowlist: booking.com, airbnb.com, hotels.com, expedia.com, agoda.com
- No heuristic detection (no URL path sniffing) — keep it simple with the allowlist
- Emoji prefix: "🛒" before the URL for booking domains — visual, language-neutral, compact
- Example: "1. Isrotel Royal Beach ⭐ 4.6 (2.1K) — Eilat — 🛒 booking.com/hotel..."

### Fallback strategy
- Silent fallback from Maps Grounding to Google Search grounding — user sees results either way, doesn't know which source was used
- If both Maps and Google Search return nothing, use the existing error handling ("no results found") — no new error paths
- No indicator or message about which grounding source was used

### Claude's Discretion
- How to structure the Maps Grounding API call (tool configuration, parameters)
- How to parse Maps Grounding structured data vs Google Search grounding data
- How to handle partial data (e.g., rating available but no address)
- Exact regex/matching for the booking domain allowlist

</decisions>

<specifics>
## Specific Ideas

- The compact one-liner format is critical for WhatsApp readability — 5-6 results must not make the message overwhelming
- The booking allowlist should be a module-level constant array, easy to extend later
- Maps Grounding is the Gemini API tool (`googleMaps`) — swap for `googleSearch` in travelSearch.ts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-enriched-search*
*Context gathered: 2026-03-02*

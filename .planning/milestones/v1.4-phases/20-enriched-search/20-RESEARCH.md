# Phase 20: Enriched Search - Research

**Researched:** 2026-03-02
**Domain:** Gemini Maps Grounding API, travel search enrichment, WhatsApp result formatting
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary:**
- Upgrades existing `travelSearch.ts` and `travelFormatter.ts` only — no new pipeline steps or modules

**Result format and density:**
- Compact one-liner per result: "1. Hotel Name ⭐ 4.5 (120) — Address — URL"
- Accommodation and activity searches return 5-6 results
- Quick queries (e.g., "coffee near the hotel") return 3 results
- Same format for both query types — always show rating and address when available
- Skip opening hours entirely

**Booking label behavior:**
- Major booking sites only via curated allowlist: booking.com, airbnb.com, hotels.com, expedia.com, agoda.com
- No heuristic detection — keep it simple with the allowlist
- Emoji prefix: "🛒" before the URL for booking domains
- Example: "1. Isrotel Royal Beach ⭐ 4.6 (2.1K) — Eilat — 🛒 booking.com/hotel..."

**Fallback strategy:**
- Silent fallback from Maps Grounding to Google Search grounding — user sees results either way
- If both Maps and Google Search return nothing, use existing error handling
- No indicator about which grounding source was used

### Claude's Discretion
- How to structure the Maps Grounding API call (tool configuration, parameters)
- How to parse Maps Grounding structured data vs Google Search grounding data
- How to handle partial data (e.g., rating available but no address)
- Exact regex/matching for the booking domain allowlist

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Travel search uses Gemini Maps Grounding to return ratings, reviews, hours, and addresses | Maps Grounding available via `{ googleMaps: {} }` tool in `@google/genai` v1.42.0. Rating/address come from Gemini's generated text (not structured grounding metadata). Prompt instructs model to output JSON array with rating, reviewCount, address fields. |
| SRCH-02 | Search returns 5-6 results for accommodation/activity queries (3 for quick queries) | Result count controlled by prompt instruction. `queryType` from `travelParser.ts` already distinguishes hotels/activities/restaurants from general. Pass count to `geminiMapsSearch()` based on queryType. |
| SRCH-03 | Results from booking sites are labeled with a "Book:" prefix (changed to 🛒 emoji per context) | Booking domain check via module-level allowlist constant. Simple `URL.hostname` comparison or domain substring match. Formatter prefixes URL with "🛒" for matching domains. |
</phase_requirements>

## Summary

Phase 20 upgrades the travel search pipeline from Google Search grounding to Gemini Maps Grounding, returning richer results with ratings, addresses, and review counts. The upgrade touches two files only: `travelSearch.ts` (swap grounding tool, add result-count parameter, adjust prompt for structured data) and `travelFormatter.ts` (new compact one-liner format, booking domain labels).

The critical architectural finding: **Maps Grounding does not return ratings or addresses as structured grounding metadata fields**. The `GroundingChunkMaps` type in `@google/genai` shows only `uri`, `title`, `placeId`, `text`, and review snippets — no rating, reviewCount, or address properties. The rich data (ratings, addresses) is embedded in Gemini's generated text response. The approach therefore is to instruct Gemini via prompt to output a JSON array with those fields while Maps Grounding is active — the model reads the Maps data internally and populates those fields from it.

A second key finding: `travelParser.ts` still uses the legacy `zod-to-json-schema` package on line 2, while the project-wide decision (per prior phases) requires switching to `z.toJSONSchema()` (native Zod v4). This file is already in scope for Phase 20 modifications, so the migration can happen here. However, per CONTEXT.md, Phase 20 modifies `travelSearch.ts` and `travelFormatter.ts` only. `travelParser.ts` modifications are not in scope unless the planner adds them as a separate fix task.

**Primary recommendation:** In `travelSearch.ts`, add a new `geminiMapsSearch()` function that uses `{ googleMaps: {} }` tool with a JSON-output prompt instructing the model to return N results (N passed as parameter based on `queryType`). Parse grounding chunk URIs for URLs, fall through to `geminiGroundedSearch()` (existing Google Search path) if Maps returns nothing.

## Standard Stack

### Core (already installed, no new packages)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@google/genai` | ^1.42.0 | Gemini SDK including Maps Grounding | Already installed. `{ googleMaps: {} }` tool config supported. |
| TypeScript | ^5.9.3 | Type safety | `GroundingChunkMaps` interface available in installed types |

### Key Types from @google/genai (verified from node_modules)

```typescript
// Tool configuration
{ googleMaps: {} }                    // googleMaps field, NOT google_maps
{ googleMaps: { enableWidget: true }} // optional widget token

// Response metadata
response.candidates[0].groundingMetadata.groundingChunks
// Each chunk: { maps?: GroundingChunkMaps, web?: GroundingChunkWeb }

// GroundingChunkMaps fields (from genai.d.ts, confirmed):
interface GroundingChunkMaps {
  placeAnswerSources?: GroundingChunkMapsPlaceAnswerSources;
  placeId?: string;
  text?: string;       // Text of the place answer
  title?: string;      // Title of the place
  uri?: string;        // URI reference of the place
}

// GroundingChunkWeb fields (used by Google Search grounding):
interface GroundingChunkWeb {
  domain?: string;
  title?: string;
  uri?: string;
}
```

**IMPORTANT:** `GroundingChunkMaps` is labeled "not supported in Gemini API" in the type definition comments. It is a Vertex AI concept. In practice, the Gemini API Maps Grounding still works with the `{ googleMaps: {} }` tool and returns chunks via the `maps` field (confirmed from official docs JS example), but the `placeAnswerSources` nested structure may not be populated. Only `uri`, `title`, and possibly `placeId` should be relied upon from Maps chunks. Ratings, addresses, and review counts come from the generated text — not from grounding chunk metadata.

## Architecture Patterns

### Recommended File Changes

```
src/groups/
├── travelSearch.ts     # Add geminiMapsSearch(), add resultCount param, restructure fallback chain
└── travelFormatter.ts  # New formatTravelResults() with compact one-liner + booking label
```

No other files change. `travelParser.ts`, `travelHandler.ts`, `groupMessagePipeline.ts` — untouched.

### Pattern 1: Maps Grounding with JSON Prompt

Maps Grounding does not provide structured rating/address data in metadata. The approach is to ask Gemini to output JSON while Maps Grounding is active — the model reads Maps data and populates the structured fields.

**Important:** Combining `responseSchema`/`responseMimeType: 'application/json'` with grounding tools is known to cause grounding metadata to be dropped (the character offsets for citations break when output is reformatted as JSON). The correct approach is to use a **plain text (no responseSchema) request with explicit JSON-in-prompt instructions** — Gemini respects the JSON format in the prompt while still receiving Maps data.

```typescript
// Source: @google/genai TypeScript SDK + official docs pattern
async function geminiMapsSearch(
  searchQuery: string,
  lang: 'he' | 'en',
  resultCount: number,
): Promise<SearchResult[]> {
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Find exactly ${resultCount} results for: ${searchQuery}\n` +
              `For each result provide: name, star rating (number), review count (number or null), ` +
              `brief address/city, and a direct URL.\n` +
              `Respond as a JSON array of objects with fields: ` +
              `title (string), url (string), rating (number or null), ` +
              `reviewCount (number or null), address (string or null).\n` +
              `Respond in ${langLabel}. Output ONLY the JSON array, no markdown fences.`,
          },
        ],
      },
    ],
    config: {
      tools: [{ googleMaps: {} }],
    },
  });

  // Parse generated text as JSON (ratings/addresses come from generated text, not metadata)
  const rawText = response.text?.trim();
  // ... JSON parse with same fence-stripping pattern as existing code ...

  // Extract URLs from grounding metadata (maps chunks preferred over text-parsed URLs)
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const mapsChunks = groundingChunks
    .filter((c) => c.maps?.uri)
    .map((c) => ({ uri: c.maps!.uri!, title: c.maps?.title ?? '' }));

  // Also collect web chunks as secondary URL source
  const webChunks = groundingChunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ uri: c.web!.uri!, title: c.web?.title ?? '' }));

  // Cross-reference by title similarity (same pattern as existing Phase 17 fix)
  // ... title matching pass then fill-empty pass ...
}
```

### Pattern 2: Result Count Based on Query Type

`travelHandler.ts` already has `intent.queryType` from `travelParser.ts`. Pass it through to `searchTravel()`, which passes it to `geminiMapsSearch()`.

```typescript
// travelSearch.ts — add resultCount parameter
export async function searchTravel(
  searchQuery: string,
  lang: 'he' | 'en',
  queryType?: string | null,  // NEW: from travelParser TravelIntent.queryType
): Promise<{ results: SearchResult[]; isFallback: boolean }> {
  // Accommodation/activity queries: 5-6 results
  // Quick/general queries: 3 results
  const resultCount = (queryType === 'hotels' || queryType === 'activities')
    ? 5
    : 3;
  // ...
}
```

The `travelHandler.ts` call site changes from:
```typescript
const { results, isFallback } = await searchTravel(queryText, lang);
```
To:
```typescript
const { results, isFallback } = await searchTravel(queryText, lang, intent.queryType);
```

### Pattern 3: Updated SearchResult Type

The `SearchResult` interface needs two new optional fields:

```typescript
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;         // May become less prominent in new format
  price: string | null;
  rating: number | null;   // NEW: star rating (e.g., 4.5)
  reviewCount: number | null;  // NEW: number of reviews
  address: string | null;  // NEW: city or brief address
}
```

The existing `knowledgeFallback()` populates `rating: null, reviewCount: null, address: null`.

### Pattern 4: Compact One-Liner Formatter

```typescript
// travelFormatter.ts — new formatTravelResults()
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
    return BOOKING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    // URL parsing failed — try simple string match
    return BOOKING_DOMAINS.some((domain) => url.includes(domain));
  }
}

function formatResult(r: SearchResult, index: number): string {
  // "1. Hotel Name ⭐ 4.5 (120) — Eilat — 🛒 booking.com/..."
  const parts: string[] = [];

  // Title
  let titlePart = `${index + 1}. ${r.title}`;

  // Rating + review count (both optional)
  if (r.rating !== null) {
    const reviewStr = r.reviewCount !== null
      ? ` (${formatReviewCount(r.reviewCount)})`
      : '';
    titlePart += ` ⭐ ${r.rating}${reviewStr}`;
  }
  parts.push(titlePart);

  // Address (optional)
  if (r.address) {
    parts.push(r.address);
  }

  // URL with optional booking prefix
  if (r.url) {
    const urlPart = isBookingUrl(r.url) ? `🛒 ${r.url}` : r.url;
    parts.push(urlPart);
  }

  return parts.join(' — ');
}

function formatReviewCount(count: number): string {
  // "1234" -> "1.2K", "120" -> "120"
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}
```

### Pattern 5: Fallback Chain

```
geminiMapsSearch()  ->  if 0 results  ->  geminiGroundedSearch() (existing Google Search path)
                                           if 0 results  ->  knowledgeFallback()
```

Maps Grounding failure (exception or 0 results) → silently falls back to Google Search grounding (the existing `geminiGroundedSearch()` function). The `isFallback` flag tracks only the knowledge fallback (no grounding), matching existing semantics.

### Anti-Patterns to Avoid

- **Using `responseSchema` with Maps Grounding:** Combining `responseMimeType: 'application/json'` with `{ googleMaps: {} }` causes grounding metadata to be dropped. Use prompt-based JSON instruction instead.
- **Trusting `GroundingChunkMaps` for rating/address:** These fields do not exist in `GroundingChunkMaps`. Only `uri` and `title` are reliably present. All rich data comes from generated text.
- **Passing `resultCount` in prompt AND expecting exact compliance:** Gemini may return fewer. Always `slice(0, resultCount)` after parsing but don't error on fewer results.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL hostname extraction | Manual string parsing for booking domains | `new URL(url).hostname` | Handles protocol, www prefix, ports correctly |
| Review count formatting | Custom formatter | Simple inline conditional (K suffix for >=1000) | Too simple to need a library |
| Maps Grounding HTTP call | Raw fetch | `ai.models.generateContent({ config: { tools: [{ googleMaps: {} }] } })` | Already wrapped in @google/genai SDK |

**Key insight:** There is no "Maps Grounding structured data" to parse. All rating/address intelligence comes from Gemini's generated text, instructed via prompt. The grounding metadata provides URLs — same as Google Search grounding.

## Common Pitfalls

### Pitfall 1: responseSchema Breaks Grounding Metadata
**What goes wrong:** Using `responseMimeType: 'application/json'` + `responseSchema` alongside `{ googleMaps: {} }` causes grounding metadata to return empty (no `groundingChunks`), because the structured output mode reformats tokens and breaks citation character offsets.
**Why it happens:** Gemini's grounding metadata uses character offsets (`startIndex`/`endIndex` in `groundingSupports`) that reference positions in the plain text. JSON reformatting invalidates these positions.
**How to avoid:** Use plain text generation with JSON instruction in the prompt. Parse the generated text as JSON manually. Do NOT set `responseMimeType` or `responseSchema` on the Maps Grounding call.
**Warning signs:** `groundingChunks` array is empty even though the query is location-based.

### Pitfall 2: GroundingChunkMaps Is Vertex AI Only
**What goes wrong:** The type definition comments `GroundingChunkMaps` as "not supported in Gemini API." The nested fields (`placeAnswerSources`, review snippets) are Vertex AI features and will not be populated when using the standard Gemini API with an API key.
**Why it happens:** The `@google/genai` SDK is unified for both API surfaces; many fields only work via Vertex AI.
**How to avoid:** Only read `chunk.maps?.uri` and `chunk.maps?.title` from Maps grounding chunks. Do not attempt to read rating or address from grounding metadata.
**Warning signs:** `chunk.maps?.placeAnswerSources` is always undefined.

### Pitfall 3: Maps Grounding Results Count May Vary
**What goes wrong:** Instructing Gemini to return "exactly 5 results" does not guarantee 5. Maps data may not have enough relevant places.
**Why it happens:** Maps Grounding is location-constrained; if the area has fewer matching places, Gemini returns fewer.
**How to avoid:** `slice(0, resultCount)` after parsing, but treat 2-3 results as a valid success (not a failure requiring fallback). Only fall back to Google Search if the array is completely empty.
**Warning signs:** Fallback triggered unnecessarily for niche/rural destination queries.

### Pitfall 4: URL Parsing Failure for Malformed URLs
**What goes wrong:** `new URL(url)` throws for relative URLs or non-HTTP strings.
**Why it happens:** Gemini occasionally returns partial URLs or Google Maps redirect URLs.
**How to avoid:** Wrap `isBookingUrl()` in try/catch with a string-based fallback (`url.includes(domain)`).
**Warning signs:** Uncaught TypeError in formatter for results with unusual URL formats.

### Pitfall 5: `travelParser.ts` Uses Legacy `zod-to-json-schema`
**What goes wrong:** `travelParser.ts` line 2 imports `zodToJsonSchema from 'zod-to-json-schema'`. The project-wide decision mandates Zod v4's native `z.toJSONSchema()`.
**Why it happens:** `travelParser.ts` was written before the Zod v4 migration decision.
**How to avoid:** Per CONTEXT.md, Phase 20 only modifies `travelSearch.ts` and `travelFormatter.ts`. This bug should be flagged to the planner — include it as a separate fix task OR defer to a cleanup phase. Do NOT modify `travelParser.ts` as a side effect of this phase.
**Warning signs:** `zod-to-json-schema` import visible at top of file.

### Pitfall 6: Booking Domain Match Too Broad
**What goes wrong:** `url.includes('booking.com')` matches URLs from unrelated sites that happen to contain 'booking.com' as a query parameter (e.g., `somesite.com?ref=booking.com`).
**Why it happens:** Simple substring matching on full URL string.
**How to avoid:** Parse hostname with `new URL()` and match against hostname only. The try/catch fallback to `url.includes()` is acceptable as a secondary check since it's rare for legitimate travel URLs to have this pattern.

## Code Examples

### Maps Grounding Call (verified from @google/genai TypeScript types + official docs)

```typescript
// Source: node_modules/@google/genai/dist/genai.d.ts + ai.google.dev/gemini-api/docs/maps-grounding
const response = await ai.models.generateContent({
  model: config.GEMINI_MODEL,
  contents: [
    {
      role: 'user',
      parts: [
        {
          text: `Find exactly ${resultCount} results for: ${searchQuery}\n` +
                `For each result provide: name, star rating (number, null if unknown), ` +
                `review count (number, null if unknown), brief address or city, ` +
                `and a direct URL.\n` +
                `Respond as a JSON array with fields: ` +
                `title (string), url (string), rating (number|null), ` +
                `reviewCount (number|null), address (string|null).\n` +
                `Respond in ${langLabel}. Output ONLY the JSON array, no markdown fences.`,
        },
      ],
    },
  ],
  config: {
    tools: [{ googleMaps: {} }],
    // NOTE: Do NOT add responseMimeType or responseSchema here —
    // doing so empties groundingChunks in the response
  },
});
```

### Accessing Maps Grounding Chunks

```typescript
// Source: node_modules/@google/genai/dist/genai.d.ts (GroundingChunk interface)
const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

// Maps chunks (Maps Grounding source)
const mapsChunks = groundingChunks
  .filter((c) => c.maps?.uri)
  .map((c) => ({ uri: c.maps!.uri!, title: c.maps?.title ?? '' }));

// Web chunks (Google Search grounding source — same cross-reference logic)
const webChunks = groundingChunks
  .filter((c) => c.web?.uri)
  .map((c) => ({ uri: c.web!.uri!, title: c.web?.title ?? '' }));
```

### Booking Domain Allowlist

```typescript
// Module-level constant — easy to extend
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
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return BOOKING_DOMAINS.some((domain) => url.includes(domain));
  }
}
```

### Compact One-Liner Format

```typescript
// Target output: "1. Hotel Name ⭐ 4.5 (2.1K) — Tel Aviv — 🛒 booking.com/hotel/..."
// Partial data: "3. Coffee Shop ⭐ 4.2 — cafe.com/..."  (no review count)
// No rating:    "2. Unknown Place — Jerusalem — tripadvisor.com/..."

function formatReviewCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count);
}

function formatOneLiner(r: SearchResult, index: number): string {
  let line = `${index + 1}. ${r.title}`;

  if (r.rating !== null) {
    const reviews = r.reviewCount !== null ? ` (${formatReviewCount(r.reviewCount)})` : '';
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
```

### Updated SearchResult Interface

```typescript
// travelSearch.ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;              // Kept for backward compatibility / knowledge fallback
  price: string | null;         // Kept for backward compatibility
  rating: number | null;        // NEW: star rating from Maps Grounding
  reviewCount: number | null;   // NEW: review count
  address: string | null;       // NEW: city or brief address
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 3 results always | 5-6 for hotels/activities, 3 for quick queries | Phase 20 | More results for accommodation browsing |
| Google Search grounding | Gemini Maps Grounding (with Google Search fallback) | Phase 20 | Ratings and addresses in results |
| Multi-line card format | Compact one-liner | Phase 20 | Denser, more WhatsApp-readable |
| No booking labels | 🛒 prefix for booking domains | Phase 20 | Quick visual cue for booking links |
| Knowledge fallback (no URLs) | Knowledge fallback still kept | No change | Unchanged behavior when both grounding paths fail |

**Deprecated in this phase:**
- Multi-line card format in `formatTravelResults()` — replaced by compact one-liner
- `price` field actively shown — suppressed from display (kept in type for backward compat)
- Snippet shown in output — suppressed from display (kept in type for knowledge fallback compat)

## Open Questions

1. **Maps Grounding availability for specific query types**
   - What we know: Maps Grounding works for location/place queries. The official docs show restaurant examples.
   - What's unclear: Whether Maps Grounding improves results for flight queries (flights are not "places") or car rental queries.
   - Recommendation: Use Maps Grounding for ALL travel queries. For flights, Maps will likely fall back to web search behavior internally. If Maps returns 0 results for a flight query, the fallback to `geminiGroundedSearch()` (Google Search) handles it correctly.

2. **Maps Grounding pricing concern**
   - What we know: $25 per 1,000 grounded prompts. Free tier: 500 requests/day.
   - What's unclear: Whether the current usage pattern exceeds the free tier.
   - Recommendation: The existing 30-second per-group rate limit keeps usage well within free tier. No changes needed.

3. **`travelParser.ts` legacy `zod-to-json-schema` import**
   - What we know: Line 2 imports `zodToJsonSchema from 'zod-to-json-schema'`. Project-wide decision requires `z.toJSONSchema()`.
   - What's unclear: Whether this is in scope for Phase 20 per CONTEXT.md (CONTEXT.md says "no new pipeline steps or modules" and only lists `travelSearch.ts` and `travelFormatter.ts`).
   - Recommendation: Planner should add a small fix task to migrate `travelParser.ts` to `z.toJSONSchema()` as part of Phase 20, OR explicitly defer it. It is a one-line change.

## Sources

### Primary (HIGH confidence)
- `node_modules/@google/genai/dist/genai.d.ts` — TypeScript type definitions for `GoogleMaps`, `GroundingChunk`, `GroundingChunkMaps`, `GroundingChunkWeb`, `GroundingMetadata` interfaces (lines 5042-5250)
- `ai.google.dev/gemini-api/docs/maps-grounding` — Official Gemini API Maps Grounding documentation with JS/TS code examples
- `src/groups/travelSearch.ts` — Current implementation: grounding URL extraction pattern, fallback chain, JSON parsing with fence stripping
- `src/groups/travelFormatter.ts` — Current multi-line card formatter being replaced
- `src/groups/travelParser.ts` — `queryType` enum values (`hotels`, `activities`, `restaurants`, `flights`, `car_rental`, `general`)
- `src/groups/travelHandler.ts` — How `intent.queryType` is available but not currently passed to `searchTravel()`

### Secondary (MEDIUM confidence)
- `docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps` — Vertex AI Maps Grounding docs (Maps chunk structure: `uri`, `title`, `placeId`, `placeAnswerSources`)
- `cennest.com` article on Gemini 2.5 Flash grounding — Documents that `responseSchema` + grounding = empty grounding metadata; recommends prompt-based JSON over `responseSchema`

### Tertiary (LOW confidence)
- WebSearch results confirming $25/1K Maps Grounding pricing and 500 free/day quota — not verified against official pricing page directly

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from installed `@google/genai` v1.42.0 type definitions
- Architecture: HIGH — verified from reading all 4 travel source files + official Maps Grounding docs
- Pitfalls: HIGH for responseSchema issue (multiple sources), HIGH for GroundingChunkMaps limitations (type definition evidence), MEDIUM for other pitfalls (inferred from code patterns)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (Gemini API changes frequently; re-verify if @google/genai is upgraded)

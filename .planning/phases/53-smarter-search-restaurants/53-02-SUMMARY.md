---
phase: 53-smarter-search-restaurants
plan: 02
subsystem: formatter+parser
tags: [travelFormatter, travelParser, restaurant-rendering, vitest, snapshot-tests]

# Dependency graph
requires:
  - phase: 53-smarter-search-restaurants
    plan: 01
    provides: SearchResult with 5 optional nullable restaurant fields (photoUrl/openNow/priceLevel/cuisine/reservationUrl)
provides:
  - travelParser.ts systemInstruction strengthened with 6 locked restaurant keywords
  - travelFormatter.ts formatRestaurantOneLiner() + isRestaurantResult() + dispatch branch in formatTravelResults()
  - Parser unit tests (4) + real-Gemini fixtures (3, key-gated) + formatter snapshot tests (11)
affects: [travelHandler, WhatsApp group output]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted(() => ({ mockFn: vi.fn() })) for pre-hoisted mocks referenced inside vi.mock factory"
    - "isRestaurantResult() field-defined-ness heuristic: safe today, fragile if future non-restaurant callers set enriched fields"
    - "formatRestaurantOneLiner: parts.push() segment omission — null/undefined fields never enter parts array, no explicit null-check string"
    - "Photo URL as plain second line for WhatsApp auto-unfurl: no Baileys linkPreview flag, no imageMessage wrapper"

key-files:
  created:
    - src/groups/__tests__/travelParser.test.ts
    - src/groups/__tests__/travelParser.fixtures.test.ts
    - src/groups/__tests__/travelFormatter.test.ts
  modified:
    - src/groups/travelParser.ts
    - src/groups/travelFormatter.ts

key-decisions:
  - "Segment omission via parts.push() omission — null/undefined fields are never pushed; joined string is always clean (no · null · or trailing ·)"
  - "isRestaurantResult defined-ness heuristic flagged as v2.2 candidate refactor — thread queryType through formatTravelResults for explicit dispatch instead of shape-sniffing"
  - "vi.hoisted pattern required for mocked unit test — vi.mock factory cannot reference variable initialized in the same scope; matches Phase 52 geminiVision.test.ts pattern"
  - "Photo URL on own line: plain text, no Baileys flag — WhatsApp auto-unfurls any URL on its own line as a link preview; CONTEXT LOCKED"
  - "reservationUrl takes URL priority over generic url — reservation link is actionable for restaurant bookings; fall back to url when reservationUrl is null"

# Metrics
duration: 5min
completed: 2026-04-24
---

# Phase 53 Plan 02: Smarter Search (Restaurants) — Formatter + Parser Summary

**travelParser system-instruction strengthened with 6 locked restaurant keywords; travelFormatter adds formatRestaurantOneLiner() producing compact one-liner template with photo-URL plain-second-line auto-unfurl; 15 tests green (4 mocked unit + 3 real-Gemini fixtures + 11 formatter snapshots)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T16:00:18Z
- **Completed:** 2026-04-24T16:05:03Z
- **Tasks:** 3
- **Files modified:** 5 (2 source + 3 test)

## Accomplishments

- **Task 1 — travelParser.ts:** Added one sentence to the system-instruction naming all 6 locked Hebrew/English keywords (`מסעדה`, `מסעדות`, `לאכול`, `ארוחה`, `restaurant`, `restaurants`) + bonus `dinner`/`lunch` for model generalization. Zod schema, error handling, and all other code paths untouched.
- **Task 2 — travelFormatter.ts:** Added `isRestaurantResult()` guard (field defined-ness heuristic), `formatRestaurantOneLiner()` helper (parts-omission null handling, 🍽️/🟢/🔴 emoji palette, photo URL as plain second line, reservationUrl URL priority), and dispatch branch in `formatTravelResults()`. Hebrew header translates; data fields pass-through untranslated. `formatOneLiner()` for non-restaurant paths is byte-unchanged.
- **Task 3 — Tests:** 15/15 green across all test files. Real-Gemini accuracy run confirmed all 3 fixture phrases classify as `queryType='restaurants'` on `gemini-2.5-flash`. Formatter inline snapshots lock the CONTEXT template shape.

## Task Commits

1. **Task 1: Strengthen travelParser system-instruction** - `ccf69da` (feat)
2. **Task 2: Add formatRestaurantOneLiner + dispatch branch** - `5efed5a` (feat)
3. **Task 3: Parser + formatter tests** - `9164ebc` (test)

## Files Created/Modified

- `src/groups/travelParser.ts` — Added restaurant keyword sentence to systemInstruction; 1-line delta
- `src/groups/travelFormatter.ts` — Added 70 lines: isRestaurantResult(), formatRestaurantOneLiner(), updated formatTravelResults() dispatch
- `src/groups/__tests__/travelParser.test.ts` — 4 mocked unit tests (happy path, schema violation, null passthrough, contract keyword test)
- `src/groups/__tests__/travelParser.fixtures.test.ts` — 3 real-Gemini accuracy fixtures (key-gated); all 3 passed on gemini-2.5-flash
- `src/groups/__tests__/travelFormatter.test.ts` — 11 snapshot tests (all-fields-present, some-null, Hebrew, open_now=false, hotels regression en+he, empty en+he, URL priority, cap-agnostic)

## Real-Gemini Fixture Run Results

All 3 fixtures classified correctly on `gemini-2.5-flash` with the strengthened system-instruction:

| Fixture phrase | Language | Result | queryType |
|---|---|---|---|
| `מסעדות טובות בטוריסמו` | Hebrew | PASS | `restaurants` |
| `איפה אפשר לאכול ברומא הערב?` | Hebrew | PASS | `restaurants` |
| `restaurants in Rome` | English | PASS | `restaurants` |

No prompt tweaks were required — the single added sentence with the 6 locked keywords was sufficient.

## Photo URL Strategy Confirmation

Photo URL is emitted as a plain URL on its own line (newline-separated from main one-liner). No `linkPreview: true` Baileys flag, no `LinkPreviewMessage` wrapper, no `imageMessage` payload. WhatsApp clients auto-unfurl any URL on its own line as a link preview. This is the v1.5 photo strategy going forward — CONTEXT LOCKED.

## isRestaurantResult Heuristic Note

`isRestaurantResult()` detects restaurant results by checking if any of the 5 enriched fields (`photoUrl`, `openNow`, `priceLevel`, `cuisine`, `reservationUrl`) are defined (not undefined). This is safe today because `geminiMapsSearch` is the only producer of enriched results and non-restaurant branches (`geminiGroundedSearch`, `knowledgeFallback`) never set those fields.

Spot-check confirmed: in all non-restaurant test fixtures (hotels, activities), none of the 5 fields are defined — heuristic never mis-fires in the current codebase. No false positives observed.

**Flagged as v2.2 candidate refactor:** thread `queryType` explicitly through `formatTravelResults` for intent-based dispatch instead of shape-sniffing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock factory ReferenceError on mockGenerateJson**
- **Found during:** Task 3 (first parser test run)
- **Issue:** `vi.mock` factories are hoisted to the top of the file before variable initializers. `const mockGenerateJson = vi.fn()` could not be referenced inside the `vi.mock('../../ai/provider.js', () => ...)` factory — `ReferenceError: Cannot access 'mockGenerateJson' before initialization`.
- **Fix:** Used `vi.hoisted(() => ({ mockGenerateJson: vi.fn() }))` to initialize the mock inside the hoisted zone, then destructure the result. Matches the Phase 52-01 `geminiVision.test.ts` established pattern.
- **Files modified:** `src/groups/__tests__/travelParser.test.ts`
- **Committed in:** `9164ebc` (Task 3 commit)

**2. [Rule 1 - Bug] Snapshot mismatch on some-null formatter test**
- **Found during:** Task 3 (first formatter test run)
- **Issue:** The `Sushi Bar Tokyo` fixture had `cuisine: 'Sushi'` set (not null), so the snapshot expected the cuisine segment to be present. Initial snapshot omitted it, causing a mismatch.
- **Fix:** Corrected the inline snapshot to include `· Sushi ·` in the Sushi Bar Tokyo line.
- **Files modified:** `src/groups/__tests__/travelFormatter.test.ts`
- **Committed in:** `9164ebc` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required fixes; no scope creep.

## Success Criteria Status

- [x] **Phase 53 SC1** — Parser fixture tests assert `queryType='restaurants'` for "מסעדות", "restaurant", "לאכול" on real Gemini (3/3 passed)
- [x] **Phase 53 SC3** — `formatRestaurantOneLiner()` produces compact template `🍽️ {name} · {cuisine} · {price_tier} · {open_now_emoji} · {rating}⭐ ({reviewCount}) · {url}` — snapshot-locked
- [x] **Phase 53 SC4** — Formatter snapshot tests witness end-to-end: parser routes → enriched search (53-01) → formatter emits ≤5 one-liners with all required fields
- [x] **Non-restaurant regression** — Hotels/activities/general paths locked by golden inline snapshots (en+he variants); `formatOneLiner` byte-identical

## User Setup Required

None — no external service configuration required.

## Notes for v2.2

- `isRestaurantResult` heuristic → replace with explicit `queryType` parameter in `formatTravelResults` when `travelHandler.ts` is in scope
- Transit/attractions/shopping enrichment paths (deferred per CONTEXT.md) remain out of scope
---
*Phase: 53-smarter-search-restaurants*
*Completed: 2026-04-24*

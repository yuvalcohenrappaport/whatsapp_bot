---
phase: 52-multimodal-intake
plan: 03
subsystem: tests
tags: [multimodal, vision, fixtures, real-api, gemini, accuracy, regression-guard]

# Dependency graph
requires:
  - phase: 52-multimodal-intake
    provides: "52-01 extractTripFact + 52-02 handleMultimodalIntake orchestrator + shared testHelpers.ts (mkImageMsg/mkPdfMsg/mkStickerMsg)"
provides:
  - "5 synthetic mock-up media fixtures covering flight / hotel / restaurant / museum / menu-negative"
  - "multimodalIntake.fixtures.test.ts — real-API accuracy harness (5 tests) + end-to-end pipeline suite (2 tests), gated on GEMINI_API_KEY via it.skipIf + isStub"
  - "Regression guard for Gemini model drift: future gemini-3.0 / model swap will surface as a failing test before users notice"
affects: []  # Phase 52 closes here

# Tech tracking
tech-stack:
  added: []  # sharp was already a dep; used only for fixture generation, not in source
  patterns:
    - "Two-suite layout: real-API accuracy (per-fixture) + end-to-end pipeline (flight + negative), both gated by it.skipIf(!hasKey || isStub)"
    - "Stub detection via file-size (< 5KB = placeholder) — separate skip gate keeps CI green if a fixture falls back to a placeholder without failing all 7 tests"
    - "Synthetic fixture generation via sharp + SVG — clean high-contrast layouts, no PII, reproducible via scripted pipeline"
    - "Per-fixture console.log diagnostics logged from Suite A — captured into this SUMMARY as Checker Major 3 evidence"

key-files:
  created:
    - src/groups/__tests__/multimodalIntake.fixtures.test.ts
    - src/groups/__tests__/fixtures/multimodal/README.md
    - src/groups/__tests__/fixtures/multimodal/flight-confirmation.jpg
    - src/groups/__tests__/fixtures/multimodal/hotel-booking.jpg
    - src/groups/__tests__/fixtures/multimodal/restaurant-reservation.jpg
    - src/groups/__tests__/fixtures/multimodal/museum-ticket.jpg
    - src/groups/__tests__/fixtures/multimodal/restaurant-menu.jpg
  modified: []

key-decisions:
  - "Synthetic mock-up fixtures (Option C in the plan) — ImageMagick + PIL unavailable in the environment; sharp + SVG rendered clean layouts that Gemini parsed with confidence 0.9-1.0 on positives and 0.4-0.6 on the menu negative."
  - "Fixtures rendered at 1200x900 @ quality 92 (not 900x700 @ 85) — the first pass produced 44-60KB files; the multimodalIntake pre-filter skips images under 50KB, which would have made the E2E flight test short-circuit. Final sizes 79-112KB clear the pre-filter and stay well under the 500KB guardrail."
  - "Stub-skip threshold set to <5KB — well below the 10KB-500KB valid fixture range, so any real fixture triggers the keyed path while a last-resort placeholder is skipped cleanly."
  - "Suite A uses dynamic `await import('../../ai/geminiVision.js')` inside the test body — keeps the unkeyed path free of the Gemini client's module-level `new GoogleGenAI({ apiKey })` lookup (which accesses config.GEMINI_API_KEY at import time). Not strictly required since config resolves to an empty string when unset, but cleaner separation of concerns."
  - "Imported `mkImageMsg` from testHelpers.ts exactly once — zero local redefinitions (grep-verified count=0), satisfying Checker Minor 7."

requirements-completed: [MM-01, MM-02, MM-03]

# Metrics
duration: ~8min
completed: 2026-04-24
---

# Phase 52 Plan 03: Multimodal Fixtures + Real-API Accuracy Harness Summary

**5 synthetic mock-up booking/ticket/menu JPEGs + a two-suite vitest harness that proves Gemini 2.5 Flash correctly classifies all 5 fixtures (4 positives at ≥0.8 confidence, 1 negative at <0.8) and that `handleMultimodalIntake` pipes a real flight image through the full pipeline to produce exactly one `trip_decisions` row + one `createSuggestion` call + one 1-line ack — 7/7 keyed tests green, 7/7 unkeyed tests cleanly skipped.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-24T09:20:39Z
- **Completed:** 2026-04-24T09:28:11Z
- **Tasks:** 2
- **Files created:** 7 (5 JPEG + README + test file)

## Accomplishments

- 5 synthetic fixture JPEGs on disk (79-112 KB each, valid JPEG, 1200x900 baseline) + a provenance README documenting each fixture's expected extraction shape + PII status + regeneration procedure.
- `src/groups/__tests__/multimodalIntake.fixtures.test.ts` ships Suite A (per-fixture accuracy against real Gemini) and Suite B (flight + menu end-to-end through the orchestrator with real Gemini + real in-memory SQLite + mocked baileys/sock/suggestionTracker/calendarHelpers/conflictDetector).
- Gated on GEMINI_API_KEY via `it.skipIf`; additional `isStub(file)` gate (file size < 5KB) so a last-resort fixture fallback skips that specific test without turning the whole suite red.
- Imports `mkImageMsg` from 52-02's `testHelpers.ts` — zero local factory redefinitions (grep-verified).

## Task Commits

Each task committed atomically on `feat/v2.1-travel-agent-design` (not pushed per user policy):

1. **Task 1: Source 5 fixture media + provenance README** — `ddb63e3` (test)
2. **Task 2: Real-API accuracy + E2E test harness** — `a337c37` (test)
   - Bundled auto-fix: fixture regeneration at 1200x900 @ quality 92 to clear the 50KB pre-filter.

## Real-Gemini keyed run evidence (Checker Major 3)

`GEMINI_API_KEY=... npx vitest run src/groups/__tests__/multimodalIntake.fixtures.test.ts --reporter=verbose` executed on 2026-04-24 at 12:26 against `gemini-2.5-flash`. **7/7 passed**, 29.3s wall-clock total (27.6s in tests — real network latency, confirms it's not secretly mocked).

### Per-fixture Suite A diagnostics

Each line is the exact `console.log` output from Suite A — copied verbatim from the vitest stdout.

```json
{"file":"flight-confirmation.jpg","extractedType":"flight","confidence":1,"date":"2026-05-10","time":"14:20"}
{"file":"hotel-booking.jpg","extractedType":"hotel","confidence":1,"date":"2026-05-10","time":"15:00"}
{"file":"restaurant-reservation.jpg","extractedType":"restaurant","confidence":0.9,"date":"2026-05-12","time":"20:00"}
{"file":"museum-ticket.jpg","extractedType":"activity","confidence":1,"date":"2026-05-13","time":"10:30"}
{"file":"restaurant-menu.jpg","extractedType":"restaurant","confidence":0.4,"date":null,"time":null}
```

Observed accuracy: **5/5 positive classifications correct**, all 4 positive confidences in `[0.9, 1.0]` (well above the 0.8 threshold), menu negative at `0.4` (decisively below the 0.8 threshold — pipeline silent-drops). Per-fixture timing: 3.3-6.5s per real Gemini call, consistent with the documented 5-15s latency range.

### Suite B end-to-end evidence

- **flight fixture → full pipeline:** 2969ms — real Gemini call through `handleMultimodalIntake`. Assertions verified: 1 row inserted with `origin='multimodal'` + `source_message_id='msg-e2e-flight'` + `type='flight'` + `metadata.date=YYYY-MM-DD` + `metadata.time=HH:MM` + `metadata.vision_confidence >= 0.8`; `createSuggestion` called once with a parsed `Date` + `calId='cal-id-abc'`; ack matches `/^📌 noted: flight — /` and contains no newline.
- **menu fixture → silent drop:** 2453ms — real Gemini call through `handleMultimodalIntake`. Assertions verified: 0 rows inserted, `createSuggestion` never called, `sock.sendMessage` never called. Pino log line confirms the confidence-gate path: `{"level":30,...,"confidence":0.4,"type":"restaurant","msg":"multimodal: low confidence, silent drop"}`.

## Unkeyed run (CI greenness)

`unset GEMINI_API_KEY; npx vitest run src/groups/__tests__/multimodalIntake.fixtures.test.ts`:

```
 Test Files  1 skipped (1)
      Tests  7 skipped (7)
   Start at  12:26:53
   Duration  1.70s
```

7/7 skipped, 0 failed — CI without a key stays green.

## Full-suite regression check

`unset GEMINI_API_KEY; npx vitest run` full suite:

- **Before 52-03:** 2 failed files / 33 passed (per 52-02's post-commit baseline) — 6 failing cases, all pre-existing Phase 51 deferred-items (commitments + actionables).
- **After 52-03:** 2 failed files / 33 passed / 1 skipped (mine) — 6 failing cases / 488 passing / 7 skipped (mine). Exact same 6 failures as before; **zero new regressions introduced by this plan**.

## Files Created/Modified

### Created

- `src/groups/__tests__/fixtures/multimodal/flight-confirmation.jpg` — 79 KB, BOARDING PASS layout (Lufthansa LH401 TLV→FRA, 2026-05-10 14:20, gate B7, seat 14A).
- `src/groups/__tests__/fixtures/multimodal/hotel-booking.jpg` — 95 KB, Booking.com-style confirmation (Hotel Artemide, Rome, check-in 2026-05-10, 7 nights, EUR 1,260).
- `src/groups/__tests__/fixtures/multimodal/restaurant-reservation.jpg` — 82 KB, elegant reservation card (Da Enzo al 29, Rome, 2026-05-12 20:00, 4 guests, Trastevere address).
- `src/groups/__tests__/fixtures/multimodal/museum-ticket.jpg` — 112 KB, ticket layout (Vatican Museums, 2026-05-13 10:30, Gate A, EUR 34 for 2 tickets).
- `src/groups/__tests__/fixtures/multimodal/restaurant-menu.jpg` — 85 KB, menu-only NEGATIVE fixture (Trattoria da Luigi, antipasti/primi/secondi listing, no date, no reservation).
- `src/groups/__tests__/fixtures/multimodal/README.md` — 61 lines, inventory table with per-fixture expected type + confidence + dated flag + PII status, regeneration checklist, do-not-commit warnings.
- `src/groups/__tests__/multimodalIntake.fixtures.test.ts` — 277 lines, two vitest suites as documented above.

### Modified

None beyond files created in this plan.

## Decisions Made

See `key-decisions` frontmatter. Summary:

- Synthetic fixtures via sharp + SVG — ImageMagick and PIL both unavailable; sharp 0.34 (already a project dep) parses SVG natively.
- 1200x900 @ quality 92 sizing — the first pass at 900x700 @ 85 produced 44-60 KB files; the flight fixture's 44.9 KB fell below the orchestrator's 50 KB pre-filter threshold, causing the E2E test to short-circuit. Bumping dimensions + quality produced 79-112 KB files, well clear of the pre-filter and well under the 500 KB guardrail.
- Stub-skip threshold at <5 KB — any real fixture generated by this pipeline (>40 KB) triggers the keyed path; the gate exists purely as a last-resort fallback hook for future placeholders.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixture regeneration at larger dimensions to clear the 50KB pre-filter**

- **Found during:** Task 2 keyed run (first attempt).
- **Issue:** Initial fixtures rendered at 900x700 @ quality 85 produced `flight-confirmation.jpg` at 44.9 KB. The multimodalIntake orchestrator's pre-filter (`MIN_IMAGE_BYTES = 50_000`, `multimodalIntake.ts:38`) rejects images under 50 KB before any vision call. The E2E flight test therefore short-circuited in 9ms with 0 download calls, 0 extract calls, and 0 inserted rows — the assertion `rows.length === 1` failed with `got 0`.
- **Fix:** Bumped the generator to 1200x900 @ density 150 + quality 92. New sizes: flight 79 KB, hotel 95 KB, restaurant 82 KB, museum 112 KB, menu 85 KB — all comfortably above 50 KB, all well under 500 KB.
- **Verification:** Keyed run after regen → 7/7 passing. E2E flight now runs in 2969ms (real Gemini call latency), asserts the full trip_decisions row + createSuggestion + ack.
- **Files modified:** All 5 JPEGs in `src/groups/__tests__/fixtures/multimodal/` (bundled into the Task 2 commit per GSD "NEVER amend" rule — the commit message explicitly calls out this auto-fix).
- **Committed in:** `a337c37` (Task 2 commit, alongside the test harness itself).

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking). Zero architectural changes. Zero scope creep. No stub fallbacks used — all 5 fixtures are full-quality synthetic mock-ups.

**Impact on plan:** The pre-filter threshold interaction is now documented in the README's regeneration section — future fixture regens must produce files ≥10 KB AND ≥50 KB (the pre-filter threshold) to be pipeline-testable.

## Issues Encountered

None beyond the deviation above. `npx tsc --noEmit` passes with only the pre-existing `cli/bot.ts` + `cli/commands/persona.ts` rootDir warnings (documented in `.planning/phases/51-richer-trip-memory/deferred-items.md`, out of scope per Phase 51-01 ship decision).

## User Setup Required

None. Reuses `config.GEMINI_API_KEY` (already in `.env`, loaded by vitest from `.env` at test-run time). No new env var, no new service credential.

## Phase 52 End-of-Phase Self-Check — All 7 ROADMAP Success Criteria verified

| # | Success Criterion | Verified by |
| - | ---- | ---- |
| 1 | Image + PDF attachments in `travelBotActive` groups are downloaded and passed to `geminiVision.extractTripFact` with the structured `TripFactExtraction` schema | 52-02 test 3 + 4 (image + PDF both reach extractTripFact); 52-03 Suite B flight test (real end-to-end) |
| 2 | Extractions with `confidence >= 0.8` insert as `trip_decisions` with `origin='multimodal'` and `source_message_id` preserved | 52-02 test 3 (asserts row.origin + row.source_message_id); 52-03 Suite B flight test (real-Gemini insert: origin='multimodal', source_message_id='msg-e2e-flight') |
| 3 | Dated extractions (both `date` + `time` present) trigger `createSuggestion` → ✅/❌ calendar suggest-then-confirm runs identically to v1.4 flow | 52-02 test 3 (asserts createSuggestion called with matching Date/calendarId); 52-03 Suite B flight test (real-Gemini createSuggestion call). `ensureGroupCalendar` is the shared helper — parity with v1.4 is structural. |
| 4 | Success ack is a single 1-line message "📌 noted: {type} — {summary}" in the group's language; no multi-line dumps | 52-02 test 3 (English ack regex + no-newline check) + test 10 (Hebrew ack regex + no-newline check); 52-03 Suite B flight test (real-Gemini ack: `^📌 noted: flight — /` + no newline) |
| 5 | Low-confidence extractions and vision API errors produce no group message, are logged | 52-02 test 7 (low confidence silent drop) + test 8 (vision null silent drop) + test 9 (vision throw, no rethrow); 52-03 Suite B menu test (real-Gemini confidence=0.4 → 0 rows, 0 createSuggestion, 0 sendMessage, pino log observed) |
| 6 | Stickers and <50KB images are pre-filtered and skipped before a vision call | 52-02 test 1 (sticker skipped without calling vision) + test 2 (< 50KB image skipped without calling vision) |
| 7 | vitest fixtures cover flight confirmation, hotel booking, restaurant reservation, museum ticket, and a menu-only image (negative case) | 52-03 Suite A — 5 fixtures on disk (all >10KB + valid JPEG) × 5 accuracy tests all passing on real Gemini; each fixture's expected type + confidence + date/time shape asserted |

All 7 ROADMAP Success Criteria are observably verified by running the Phase 52 test suite (52-01, 52-02, 52-03 combined). Phase 52 is complete.

## Next Phase Readiness

- **Phase 53 (Smarter Search — Restaurants):** Unblocked. Design doc already separates v1.4 hotels/activities (unchanged) from the new restaurants branch; no dep on Phase 52 code beyond the existing trip_contexts / group language / calendar foundations.
- **Phase 54 (Day-Of Intelligence):** Unblocked. Will consume trip_decisions rows (including multimodal-origin ones) for day-of context; no code dep on this plan's tests.
- **Phase 55 (Trip Dashboard):** Unblocked. Will surface multimodal-origin decisions in the dashboard's decisions board — the `origin` column discriminator is already in schema since Phase 51-01.
- **No blockers.** Phase 52 is shipped; a live PM2 redeploy from this branch remains off-policy per user's "Never push without asking" rule.

## Self-Check: PASSED

Verified post-commit:

- `src/groups/__tests__/fixtures/multimodal/flight-confirmation.jpg` — FOUND (79 KB, valid JPEG)
- `src/groups/__tests__/fixtures/multimodal/hotel-booking.jpg` — FOUND (95 KB, valid JPEG)
- `src/groups/__tests__/fixtures/multimodal/restaurant-reservation.jpg` — FOUND (82 KB, valid JPEG)
- `src/groups/__tests__/fixtures/multimodal/museum-ticket.jpg` — FOUND (112 KB, valid JPEG)
- `src/groups/__tests__/fixtures/multimodal/restaurant-menu.jpg` — FOUND (85 KB, valid JPEG)
- `src/groups/__tests__/fixtures/multimodal/README.md` — FOUND (61 lines, 5-row inventory table)
- `src/groups/__tests__/multimodalIntake.fixtures.test.ts` — FOUND (277 lines, 7 tests)
- Commit `ddb63e3` (Task 1) — FOUND in git log
- Commit `a337c37` (Task 2) — FOUND in git log
- `grep -c 'function mkImageMsg\|function mkPdfMsg\|function mkStickerMsg' src/groups/__tests__/multimodalIntake.fixtures.test.ts` → 0 (no local helper redefinitions)
- `grep -n 'from.*testHelpers' src/groups/__tests__/multimodalIntake.fixtures.test.ts` → 2 matches (1 comment, 1 import — the import is the canonical single-source-of-truth path)
- Keyed vitest run: 7/7 passing on gemini-2.5-flash (evidence captured above)
- Unkeyed vitest run: 7/7 skipped, 0 failed
- `npx tsc --noEmit` → only pre-existing cli/*.ts rootDir warnings (no new errors)
- Full vitest suite: 6 failures exactly matching the Phase 51 deferred-items.md pre-existing set (0 new regressions)

---
*Phase: 52-multimodal-intake*
*Completed: 2026-04-24*

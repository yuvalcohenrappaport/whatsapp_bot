# Multimodal Intake Test Fixtures

Five synthetic mock-up booking/ticket/menu images used by the Phase 52-03
real-Gemini accuracy harness (`src/groups/__tests__/multimodalIntake.fixtures.test.ts`)
and available for any future multimodal test that needs realistic fixture media.

The fixtures were rendered programmatically via `sharp` + SVG (see commit history
for the generator script) — clean, high-contrast layouts with crisp fonts so
Gemini 2.5 Flash reliably extracts the core fields (type, date, time, location)
above the 0.8 confidence threshold. All content is synthetic: no real personal
identifiers, no real reservation numbers, no real email addresses, no real
phone numbers. Safe to commit.

## Inventory

| File                          | Source          | Expected type | Expected confidence | Dated (date+time) | PII scrubbed? |
| ----------------------------- | --------------- | ------------- | ------------------- | ----------------- | ------------- |
| `flight-confirmation.jpg`     | Synthetic mock-up | `flight`     | ≥ 0.8               | yes (date + time) | N/A — synthetic, no real person's name; "J. SMITH" is a placeholder |
| `hotel-booking.jpg`           | Synthetic mock-up | `hotel`      | ≥ 0.8               | date only (check-in time often absent) | N/A — synthetic; placeholder guest name |
| `restaurant-reservation.jpg`  | Synthetic mock-up | `restaurant` | ≥ 0.8               | yes (date + time) | N/A — synthetic; real restaurant name (Da Enzo al 29, a well-known public restaurant in Rome) but no booking tied to a real person |
| `museum-ticket.jpg`           | Synthetic mock-up | `activity`   | ≥ 0.8               | yes (date + time) | N/A — synthetic; public venue name (Vatican Museums), no ticket holder info |
| `restaurant-menu.jpg`         | Synthetic mock-up | negative (menu only) | < 0.8           | no (no date, no reservation) | N/A — synthetic; fictional trattoria "da Luigi" |

## What the fixtures test

- **Positive extraction accuracy** (4 fixtures): each booking image contains
  airline + flight number, hotel name + check-in date, restaurant + date/time,
  or venue + date/time. Gemini must return the correct `type`, a date in
  `YYYY-MM-DD`, a time in `HH:MM` where applicable, and `confidence >= 0.8`.
- **Negative classification** (1 fixture): the menu-only image has no
  reservation, no date, no booking details — just an antipasti/primi/secondi
  listing with prices. Gemini must return `confidence < 0.8` so the pipeline
  silently drops (no `trip_decisions` row, no group ack).
- **End-to-end pipeline** (flight + menu fixtures): piped through
  `handleMultimodalIntake` with mocked baileys + mocked sock + real in-memory
  SQLite, asserting the full 9-step flow (insert → runAfterInsert →
  createSuggestion → 1-line ack) for the positive case and silent drop for the
  negative case.

## Regenerating fixtures

If a future Gemini model change causes one of the positive fixtures to drop
below the 0.8 threshold (or a negative fixture to creep above it), regenerate
with a cleaner layout:

1. Edit the generator script (recreate it from the commit that introduced
   these fixtures, or sketch a fresh SVG with similar layout).
2. Re-run the generator from the project root so `sharp` resolves:
   `node gen-fixtures.mjs`. Output goes to this directory as `.jpg`.
3. Verify each file is 10–500 KB and reports `JPEG image data` via `file *.jpg`.
4. Re-run the keyed accuracy test
   (`GEMINI_API_KEY=... npx vitest run src/groups/__tests__/multimodalIntake.fixtures.test.ts`)
   and confirm per-fixture confidence lands in the expected range.

## Do not commit

- Draft/unscrubbed fixtures containing real names, real reservation numbers,
  real phone numbers, real email addresses, or identifying addresses. When in
  doubt, regenerate synthetically.
- Fixture files larger than 500 KB (repo bloat) or smaller than 10 KB
  (Gemini cannot parse tiny thumbnails reliably).

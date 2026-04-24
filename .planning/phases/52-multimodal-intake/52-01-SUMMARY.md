---
phase: 52-multimodal-intake
plan: 01
subsystem: ai
tags: [gemini, vision, zod, multimodal, structured-output, pdf, image]

# Dependency graph
requires:
  - phase: 51-richer-trip-memory
    provides: "origin='multimodal' already accommodated in trip_decisions schema (51-01 migration 0022)"
provides:
  - "extractTripFact(buffer, mimeType, groupContext): Promise<TripFactExtraction | null> — pure, testable Gemini vision wrapper"
  - "TripFactExtractionSchema (Zod) — locked shape for structured vision output"
  - "GroupContext type — caller-assembled prompt disambiguation input"
  - "Hand-written Gemini OpenAPI-subset responseSchema (documented below for 52-02 + 52-03 reuse)"
affects: [52-02-multimodal-pipeline, 52-03-multimodal-integration-tests]

# Tech tracking
tech-stack:
  added: []  # no new deps — reused @google/genai, zod, pino
  patterns:
    - "Gemini vision call: inlineData + base64 on image/PDF buffer with structured-output responseSchema"
    - "Pure vision wrapper: all failure paths return null, never throws, logger-only observability"
    - "vi.hoisted() pattern for @google/genai mocking — exposes shared spy to vi.mock factory that returns a plain class so `new GoogleGenAI(...)` succeeds"

key-files:
  created:
    - src/ai/geminiVision.ts
    - src/ai/__tests__/geminiVision.test.ts
  modified: []

key-decisions:
  - "Reused config.GEMINI_MODEL (already 'gemini-2.5-flash') — did NOT add GEMINI_VISION_MODEL env var (CONTEXT LOCKED rule)"
  - "Hand-wrote Gemini responseSchema as a plain object literal (OpenAPI subset) instead of pulling in zod-to-json-schema — keeps dep graph small, matches what Gemini actually accepts"
  - "Every nullable field listed in `required` array so Gemini emits nulls explicitly (mirrors Phase 51 classifier pattern)"
  - "All failure paths (network throw, empty text, JSON parse error, schema violation) return null with pino logging — never throws, per CONTEXT 'invalid output logged + dropped silently' rule"
  - "No retry/backoff, no HITL medium-confidence path (both CONTEXT-deferred)"
  - "Tests mock @google/genai at module level via vi.hoisted — no GEMINI_API_KEY required, fully deterministic"

patterns-established:
  - "vi.hoisted + class-returning vi.mock factory: the pattern future multimodal tests can copy when mocking @google/genai with `new`-constructor call sites"
  - "Gemini structured-output responseSchema shape for this repo: full `required` list including nullable fields, `nullable: true` flag on each optional property"

requirements-completed: [MM-01]

# Metrics
duration: ~3min
completed: 2026-04-24
---

# Phase 52 Plan 01: Gemini Vision Wrapper Summary

**Pure `extractTripFact(buffer, mimeType, groupContext) → TripFactExtraction | null` wrapper around Gemini 2.5 Flash multimodal API with locked Zod schema, silent failure handling, and zero coupling to pipeline/DB — 9/9 vitest green without a real API key.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-24T08:52:48Z
- **Completed:** 2026-04-24T08:55:16Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- `src/ai/geminiVision.ts` exports `TripFactExtractionSchema`, `TripFactExtraction`, `GroupContext`, `extractTripFact`.
- `extractTripFact()` hits `gemini.models.generateContent` with `inlineData` + base64, structured-output `responseMimeType` + hand-written `responseSchema`, and returns a Zod-validated object or `null`.
- Every failure mode (network throw, empty text, non-JSON, schema violation) returns `null` without throwing — pipeline consumers in Plan 52-02 can safely fire-and-forget without a try/catch ring.
- 9/9 vitest cases green without `GEMINI_API_KEY` — 4 schema cases, 1 happy-path with `inlineData` wiring assertion, 4 failure paths.

## Task Commits

1. **Task 1: Implement geminiVision.ts** — `bb508aa` (feat)
2. **Task 2: Unit tests for geminiVision** — `63e1887` (test)

## Files Created/Modified

- `src/ai/geminiVision.ts` — Gemini vision wrapper module (228 lines): Zod schema, `GroupContext` type, `extractTripFact` async function with logger-based error handling.
- `src/ai/__tests__/geminiVision.test.ts` — vitest unit coverage (201 lines): 3 suites, 9 cases, module-level `@google/genai` mock via `vi.hoisted` + class-returning factory.

## Exact Gemini responseSchema shape (for 52-02 + 52-03 readers)

Passed as `config.responseSchema` inside the `gemini.models.generateContent(...)` call. This is the literal object passed — copy it verbatim if 52-03's integration test wants to double-check Gemini's real response against the schema Gemini was asked to emit.

```ts
{
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['flight', 'hotel', 'restaurant', 'activity', 'transit', 'other'],
    },
    title: { type: 'string' },
    date: { type: 'string', nullable: true },
    time: { type: 'string', nullable: true },
    location: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    reservation_number: { type: 'string', nullable: true },
    cost_amount: { type: 'number', nullable: true },
    cost_currency: { type: 'string', nullable: true },
    confidence: { type: 'number' },
    notes: { type: 'string', nullable: true },
  },
  required: [
    'type', 'title', 'date', 'time', 'location', 'address',
    'reservation_number', 'cost_amount', 'cost_currency',
    'confidence', 'notes',
  ],
}
```

Zod schema mirrors this exactly — `TripFactExtractionSchema.safeParse()` is the runtime trust boundary.

## Nullable-field edge case findings

No real Gemini calls ran in 52-01 (that's Plan 52-03's job), so no empirical data on whether Gemini emits `undefined` instead of `null` for the required-nullable fields. Mitigation already shipped:

- Every nullable property is listed in the `required` array so Gemini is instructed to emit *something* (including `null`) for every key.
- `TripFactExtractionSchema` uses `.nullable()` (not `.optional()`), which accepts `null` but rejects `undefined` — so if Gemini does drop a field, `safeParse.success === false` and `extractTripFact` returns `null` cleanly (logged at `debug`).

Plan 52-03's real-fixture accuracy run is the place to observe whether this actually surfaces and whether we need to relax to `.nullish()` or add a normalization layer. For now, strict-null is the contract.

## Confirmation: config.GEMINI_MODEL reused, not duplicated

- `grep -rn 'GEMINI_VISION_MODEL' src/ .env.example` → **empty** (verified post-commit).
- `src/ai/geminiVision.ts:170` uses `config.GEMINI_MODEL` directly inside `gemini.models.generateContent({ model: config.GEMINI_MODEL, ... })`.
- `src/config.ts:16` — `GEMINI_MODEL` already defaults to `'gemini-2.5-flash'`, which is what the CONTEXT names as the vision model. No env-var change needed.

## Decisions Made

See `key-decisions` frontmatter. Summary:

- Reused `config.GEMINI_MODEL` per CONTEXT LOCKED rule.
- Hand-wrote Gemini `responseSchema` (no zod-to-json-schema dep).
- Required-nullable fields (not optional) with explicit `required[]` — Gemini always emits the key.
- Silent failure: all error paths return `null`, logged at warn (API/parse) or debug (schema drop). No throws escape `extractTripFact`.
- `vi.hoisted` + class-returning `vi.mock` factory for `@google/genai` — no `GEMINI_API_KEY` required to run tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@google/genai` mock factory rewritten to expose a constructable class**

- **Found during:** Task 2 (initial vitest run)
- **Issue:** The plan's suggested mock template used `vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } }))`. When the `geminiVision.ts` module ran `new GoogleGenAI(...)` at import time, vitest threw `TypeError: () => ({ ... }) is not a constructor` — arrow-function `mockImplementation` isn't a valid constructor target.
- **First fix attempt:** Switched the factory to return a plain class `class { models = { generateContent: mockGenerateContent }; }`. This resolved the constructor error but then hit a hoisting error: `ReferenceError: Cannot access 'mockGenerateContent' before initialization` — `vi.mock` is hoisted above the `const` declaration, so the class body's instance initializer runs before the spy constant is bound.
- **Final fix:** Wrapped the spy declaration in `vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))`, which is hoisted to the same tier as `vi.mock`. Class-returning factory now safely references the spy at construction time. Pattern preserved: every test still resets via `mockGenerateContent.mockReset()` in `beforeEach`.
- **Files modified:** `src/ai/__tests__/geminiVision.test.ts` only (fix made during Task 2 development before first commit).
- **Verification:** 9/9 tests green.
- **Committed in:** `63e1887` (Task 2 commit — fix bundled into initial commit of this file, no separate fix commit needed since the test file hadn't been committed yet).

---

**Total deviations:** 1 auto-fixed (blocking). Zero architectural changes. Zero scope creep.
**Impact on plan:** Pattern now established for future multimodal tests — worth a reference-able line in the CONTEXT doc if Plan 52-02 / 52-03 need to mock `@google/genai` with `new`-constructor sites. Plan's loose reference to the "Phase 51-02 proven pattern" used `vi.importActual` delegation for the `ai/provider.ts` facade — but this wrapper imports `@google/genai` directly, so the class-construction path needed its own pattern.

## Issues Encountered

None beyond the deviation above. `npx tsc --noEmit` passes with only the pre-existing `cli/bot.ts` + `cli/commands/persona.ts` rootDir warnings (logged in `.planning/phases/51-richer-trip-memory/deferred-items.md` — out of scope per 51-01 ship). No new errors.

## User Setup Required

None. No external service configuration, no new env var.

## Next Phase Readiness

- **Plan 52-02 (multimodal orchestrator):** Unblocked. Consumes `extractTripFact(buffer, mimeType, groupContext)` directly — the signature, return type (`TripFactExtraction | null`), and null-on-failure contract are all stable and tested. Orchestrator can safely fire-and-forget without wrapping in try/catch.
- **Plan 52-03 (integration + real-fixture accuracy tests):** Unblocked. `TripFactExtractionSchema` is the shared validation surface for real Gemini responses; the hand-written `responseSchema` (documented above) is what Gemini was asked to emit — 52-03's accuracy suite can assert against the Zod schema directly or against the raw JSON + the responseSchema for drift detection.
- **No blockers.** Zero coupling to pipeline / DB / baileys, so downstream plans have full freedom on integration strategy.

## Self-Check: PASSED

Verified post-commit:
- `src/ai/geminiVision.ts` — FOUND (228 lines, 4 exports confirmed via grep)
- `src/ai/__tests__/geminiVision.test.ts` — FOUND (201 lines, 9/9 vitest green)
- Commit `bb508aa` — FOUND in git log
- Commit `63e1887` — FOUND in git log
- `grep -rn 'GEMINI_VISION_MODEL' src/ .env.example` → empty
- `grep -n 'inlineData' src/ai/geminiVision.ts` → 1 match (line 182)
- `npx tsc --noEmit` → only pre-existing cli/*.ts rootDir warnings (no new errors)

---
*Phase: 52-multimodal-intake*
*Completed: 2026-04-24*

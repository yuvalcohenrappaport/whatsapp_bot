---
phase: 57-drop-a-pin-dashboard-editing
plan: 04
subsystem: dashboard

tags: [react, picker, places-autocomplete, debounce, optimistic-update, vitest, react-testing-library]

requires:
  - phase: 57-drop-a-pin-dashboard-editing
    plan: 03
    provides: autocompletePlaces + fetchPlacePreview typed clients, PinOptimisticInput contract, useTrip.mutations.pinDecision Promise<boolean>
  - phase: 57-drop-a-pin-dashboard-editing
    plan: 01
    provides: AutocompleteSuggestion + PlacePreview + PlacePreviewMetadata schemas the picker types against

provides:
  - PinDecisionPicker — self-contained inline drop-a-pin component (NOT a Radix Dialog)
  - PinSaveInput — public type the picker emits via onSave (used by Plan 05's TripView wiring)
  - PinDecisionPickerProps — public prop contract (groupJid, decisionId, decisionTitle, onSave, onCancel)
  - 11-case vitest smoke test suite (`PinDecisionPicker.test.tsx`) covering all CONTEXT-locked behaviors

affects: [57-05-uat-and-polish]

tech-stack:
  added:
    - "@testing-library/dom (peer dep — was missing per Plan 57-03's deferred-items.md, blocking the React rendering tests)"
    - "@testing-library/user-event (devDep — added alongside @testing-library/dom for completeness even though the picker tests use fireEvent only)"
  patterns:
    - "Single sessionToken (UUID) generated once via crypto.randomUUID() in a useRef on picker open — reused for every autocomplete keystroke + the preview fetch + the final pin (Phase 56 RESEARCH.md billing lock)"
    - "Two-step Pick → Preview-fetch → Save flow: clicking a suggestion fires fetchPlacePreview WITHOUT auto-saving; Save is disabled until the preview lands so the optimistic payload at Save time carries REAL lat/lng (D9 lock — TripMap's offMapCount formula `(d.lat == null || d.lng == null)` decrements in the same React tick as the map pin appears)"
    - "Last-write-wins via SEPARATE request-id refs for autocomplete races and preview races — `reqIdRef` and `previewReqIdRef` independently track in-flight requests so a slow autocomplete can't clobber a pick-then-preview that fired later"
    - "retryNonce state pattern — Retry button bumps a counter that's a useEffect dep (NOT a query no-op re-set). Effect re-fires the same query without forcing the user to re-type."
    - "Promise<boolean> dual-surface error consumption — picker awaits onSave's boolean, branches to inline error on false (D11 dual-surface — useTrip's toast already fired; the picker's inline 'Pin failed — try again' is the second surface)"

key-files:
  created:
    - dashboard/src/components/trip/PinDecisionPicker.tsx
    - dashboard/src/components/trip/__tests__/PinDecisionPicker.test.tsx
  modified:
    - dashboard/package.json (added 2 devDeps — @testing-library/dom, @testing-library/user-event)
    - dashboard/package-lock.json (lockfile regen)
    - .planning/phases/57-drop-a-pin-dashboard-editing/deferred-items.md (annotated the @testing-library/dom resolution)

key-decisions:
  - "Picker is row-AGNOSTIC re: useTrip — does NOT import useTrip directly. Receives onSave as a callback prop so Plan 05's TripView can close over decisionId in the wrapper (matches the contract Plan 03's SUMMARY documented)."
  - "decisionId is in the prop contract but unused inside the picker — kept as `_decisionId` so consumers can't accidentally wire a callback to the wrong row, but doesn't bloat the component's logic. The plan's prop shape required it."
  - "300ms debounce + min-2-chars threshold (CONTEXT.md grants both as Claude's discretion) — 300ms is the fast end of the typical Google-style autocomplete range; min-2 prevents single-letter API spam."
  - "MapPin glyph used ONLY on the picked-preview confirmation row, NOT on individual suggestion list rows. CONTEXT D5 forbade glyphs in the suggestion list (plain text only); the preview row is a single-item confirmation surface so the glyph is appropriate there."
  - "Preview-fetch failure pops the user back to the suggestion list (sets `picked` to null) instead of staying on a broken preview row. Without lat/lng we can't satisfy D9, so refusing to enable Save and forcing a re-pick is correct."
  - "onSave failure path does NOT call setSaving(false) before showing the error — the inline error is set first, THEN saving cleared. Order matters: clearing saving first would briefly re-enable the Save button BEFORE the error renders, allowing a double-click on a still-failing pin."
  - "11 smoke tests over 7 minimum — bonus cases (No matches, Hebrew threading, preview-fetch failure) cover the three narrow CONTEXT locks that would otherwise drift silently. Cost: ~30 lines per test, ~330 lines total."
  - "Side effect: installing @testing-library/dom unblocked Plan 57-03's deferred 4 hook tests (useCalendarViewMode/useHorizontalSwipe/useLongPress/useViewport). Full dashboard vitest now 38 passed/6 files (up from 27 passed/1 file). Annotated in deferred-items.md as RESOLVED — not a deviation, the install was explicitly permitted by Plan 57-04's Task 2 action."

patterns-established:
  - "Picker-as-leaf with callback-prop contract: The picker has zero knowledge of useTrip / sonner / react-router. It emits a typed `PinSaveInput` via onSave and reads back a boolean. The router/state/toast layer lives entirely in the parent (Plan 05's TripView). This keeps the picker testable in isolation (mock the two API client functions; nothing else)."
  - "Separate request-id refs per parallel async stream: When a component fires two unrelated debounced/awaited calls (autocomplete + preview), give each its OWN request-id ref. Sharing a single counter would let a fast autocomplete cancel an in-flight preview, or vice versa."
  - "retryNonce as useEffect dep: Functional retry without re-typing. Bumping a nonce that's in the dep array is the cleanest way to re-fire an effect on demand — clearer than re-setting an unrelated state to the same value."

requirements-completed: [DASH-TRIP-04]

duration: ~5min
completed: 2026-04-26
---

# Phase 57 Plan 04: Drop-a-Pin Picker Component Summary

**Inline `<PinDecisionPicker>` component (NOT a modal) — debounced autocomplete + Pick → Preview-fetch → Save flow that hydrates the optimistic payload with REAL lat/lng before Save fires (D9 lock), with Promise&lt;boolean&gt; dual-surface error consumption (D11) and retryNonce-driven functional Retry. 11/11 vitest smoke tests green.**

## Performance

- **Duration:** ~5 minutes
- **Started:** 2026-04-25T20:58:55Z
- **Completed:** 2026-04-25T21:03:48Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 3 (package.json, package-lock.json, deferred-items.md)
- **Tests added:** 11 (smoke cases — all green; full dashboard suite now 38/38)

## Accomplishments

- New leaf component `dashboard/src/components/trip/PinDecisionPicker.tsx` (~360 lines) — fully self-contained inline picker honoring all CONTEXT-locked behaviors: pre-filled input, plain-text suggestions, two-step Pick → Save with intermediate preview-fetch, four inline error states, single sessionToken per open, Hebrew language threading, retryNonce-driven Retry, ~1s success state, Escape-to-cancel.
- Public type `PinSaveInput` exported alongside the component — Plan 05's TripView wiring will consume it as the bridge between the picker and `useTrip.mutations.pinDecision`.
- Fresh `__tests__` directory under `components/trip/` with the first React-rendering test in the dashboard codebase. 11 smoke cases via @testing-library/react cover every CONTEXT lock the picker is responsible for.
- Bonus: resolved Plan 57-03's deferred `@testing-library/dom` peer-dep gap. The 4 previously-failing hook test suites now load and pass; full dashboard vitest is `38 passed (6)` up from `27 passed (1) + 4 failed`.

## Task Commits

Each task committed atomically:

1. **Task 1: Build PinDecisionPicker component** — `dda011b` (feat)
2. **Task 2: Smoke tests for PinDecisionPicker** — `b46a5bf` (test)

**Plan metadata commit:** _(see final commit below)_ — `docs(57-04): complete drop-a-pin picker plan`

## Component Surface (Plan 04 → Plan 05 contract)

```typescript
export interface PinDecisionPickerProps {
  groupJid: string;
  decisionId: string;
  /** Pre-fills the input on mount (saves typing for the common case). */
  decisionTitle: string;
  /** Returns true on success, false on failure (D11 dual-surface). */
  onSave: (input: PinSaveInput) => Promise<boolean>;
  onCancel: () => void;
}

export interface PinSaveInput {
  placeId: string;
  sessionToken: string;
  languageCode?: 'iw' | 'en';
  optimistic: PinOptimisticInput; // FULL payload from fetchPlacePreview
}
```

The picker reads back the boolean from `onSave` and branches:
- `true` → ~1s `Pinned` success state, then auto-calls `onCancel()` to unmount
- `false` → inline `Pin failed — try again` text AND picker stays open (`onCancel` is NOT invoked)

## Pick → Preview-fetch → Save Flow (D9 lock)

| Step | Trigger | Action | UI |
|------|---------|--------|----|
| 1 | User types ≥2 chars | 300ms debounce → `autocompletePlaces(groupJid, q, sessionToken, lang)` | Spinner next to search input |
| 2 | User clicks suggestion | Sets `picked`, fires `fetchPlacePreview(groupJid, placeId, sessionToken, lang)` | Preview row with primary/secondary text + disabled Save + "Fetching place details…" |
| 3 | Preview resolves | Sets `preview` with lat/lng/canonicalAddress/metadata | Save button enabled |
| 4 | User clicks Save | Builds `PinOptimisticInput` with REAL lat/lng from preview, calls `onSave({placeId, sessionToken, languageCode, optimistic})` | Save shows spinner |
| 5a | onSave === true | Sets savedSuccess, schedules `onCancel()` after 1000ms | Green ✓ "Pinned" |
| 5b | onSave === false | Sets error to 'Pin failed — try again', clears saving | Inline destructive-color error; picker stays open |

Race protection: separate `reqIdRef` (autocomplete) and `previewReqIdRef` (preview-fetch) so a slow autocomplete can't clobber a fast preview, and vice versa.

## Inline Error States (4 total)

All errors are inline within the picker — no toast, no dialog. The picker's job is to surface its own state; D11 says the toast lives in `useTrip` and shows in parallel.

| Error | When | Recovery surface |
|-------|------|------------------|
| `No matches` | autocomplete returned `[]` | Keep typing |
| `Search failed — retry` | autocomplete promise rejected | Inline Retry button (bumps `retryNonce` → effect re-fires same query) |
| `Could not load place details — try another place` | `fetchPlacePreview` rejected after a Pick | Picker pops back to suggestion list (`picked` cleared) so user can pick another |
| `Pin failed — try again` | `onSave` returned `false` | Picker stays open with the same picked place; user can click Save again |

## Files Created/Modified

- `dashboard/src/components/trip/PinDecisionPicker.tsx` *(created, 359 lines)* — the picker component + `PinSaveInput`/`PinDecisionPickerProps` exports.
- `dashboard/src/components/trip/__tests__/PinDecisionPicker.test.tsx` *(created)* — 11 vitest smoke cases.
- `dashboard/package.json` *(modified)* — `@testing-library/dom` + `@testing-library/user-event` added to devDependencies.
- `dashboard/package-lock.json` *(modified)* — lockfile regen.
- `.planning/phases/57-drop-a-pin-dashboard-editing/deferred-items.md` *(modified)* — annotated the previously-deferred peer dep gap as RESOLVED 2026-04-26.

## Decisions Made

- **Picker is row-AGNOSTIC, no useTrip import** — see `key-decisions` frontmatter. Plan 05's TripView closes over `decisionId` in the onSave wrapper. This keeps the picker isolated for testing (mock 2 API functions; mock nothing else).
- **MapPin glyph only on the preview-confirmation row** — CONTEXT D5 explicitly forbade glyphs on suggestion list rows but the picked-preview row is a different surface (single-item confirmation, not a list).
- **Preview-fetch failure clears the pick** — without preview lat/lng we can't satisfy D9 (off-map badge decrement). Refusing to enable Save and forcing a re-pick is correct UX.
- **300ms debounce / min-2-chars** — CONTEXT.md grants both as Claude's discretion. 300ms is the fast end of typical Google-style autocomplete; min-2 prevents single-letter API spam.
- **11 tests vs 7 minimum** — the 4 bonus cases (No matches, Hebrew threading, preview failure, Cancel) cover narrow CONTEXT locks (D5 / Hebrew / D9 fallback / Escape) that would otherwise drift silently.

## Deviations from Plan

None — plan executed exactly as written. Two tasks, two commits. The `npm install -D @testing-library/dom @testing-library/user-event` was explicitly permitted by Task 2's action ("If `@testing-library/react` is not in package.json, add it as a dev dep first… If it IS already there, skip the install"). The peer dep gap meant `@testing-library/react` couldn't function despite being installed, so the install was within the plan's scope. The `--legacy-peer-deps` flag was needed because of a pre-existing `react-leaflet@4.2.1 → react@^18` peer conflict that's unrelated to Phase 57; npm has been requiring it for any dashboard install since Phase 50's React 19 upgrade.

## Issues Encountered

**Test 6 (`onSave === true → Pinned then onCancel after 1s`) initially failed** — the assertion `expect(onCancel).not.toHaveBeenCalled()` after Save fired but before advancing past the 1s timeout failed because `vi.runAllTimersAsync()` runs ALL pending timers, including the success-state's `setTimeout(onCancel, 1000)`. Fix: instead of `runAllTimersAsync()` after the Save click, just flush microtasks twice with `await Promise.resolve()` so the awaited `onSave` settles, THEN advance fake timers by 1100ms in a second `act()` block. Single-line fix; no component change.

**Pre-existing react-leaflet peer conflict** — npm refused to install `@testing-library/dom` without `--legacy-peer-deps` because react-leaflet@4.2.1 requires `react@^18` and the dashboard runs `react@19.2.0`. This is a Phase 50 footgun, not a Plan 57-04 issue. Used `--legacy-peer-deps` (matches whatever the dashboard's existing install procedure must already be using).

## User Setup Required

None — no new env vars, no new external services. The two new devDependencies (`@testing-library/dom`, `@testing-library/user-event`) install automatically on next `npm install` from `dashboard/`.

## Next Phase Readiness

- **Plan 57-05 (UAT + polish)** can begin immediately. The picker's prop contract is the bridge — Plan 05 just needs to:
  1. Track an `editingDecisionId` state in `DecisionsBoard` (or `TripView`).
  2. Render `<PinDecisionPicker ... />` inline below the active row when set.
  3. Pass an `onSave` callback that wraps `useTrip.mutations.pinDecision(decisionId, input.optimistic, { placeId: input.placeId, sessionToken: input.sessionToken, languageCode: input.languageCode })`.
  4. Pass `onCancel={() => setEditingDecisionId(null)}`.
- **No re-defining the Promise<boolean> contract** — Plan 03's lock and Plan 04's consumption both encode it. Plan 05 must NOT change the return type.
- **Picker is fully unit-tested in isolation** — Plan 05's responsibility is wiring + UAT, not re-testing the picker's internals.

---
*Phase: 57-drop-a-pin-dashboard-editing*
*Plan: 04*
*Completed: 2026-04-26*

## Self-Check: PASSED

- `dashboard/src/components/trip/PinDecisionPicker.tsx` — FOUND (359 lines, exports PinDecisionPicker + PinSaveInput + PinDecisionPickerProps)
- `dashboard/src/components/trip/__tests__/PinDecisionPicker.test.tsx` — FOUND (11/11 vitest cases green)
- `.planning/phases/57-drop-a-pin-dashboard-editing/57-04-SUMMARY.md` — FOUND
- `.planning/phases/57-drop-a-pin-dashboard-editing/deferred-items.md` — FOUND (annotated RESOLVED)
- Commit `dda011b` (Task 1 — feat: PinDecisionPicker component) — FOUND
- Commit `b46a5bf` (Task 2 — test: 11 smoke cases + peer-dep install) — FOUND
- `cd dashboard && npm run build` — green (post-Task-1 + post-Task-2)
- `cd dashboard && npx vitest run src/components/trip/__tests__/PinDecisionPicker.test.tsx` — 11 passed
- `cd dashboard && npx vitest run` (full suite) — 38 passed (6 files); previously-deferred 4 hook test suites now load and pass

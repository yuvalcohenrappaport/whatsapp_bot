# Deferred Items — Phase 57

Out-of-scope discoveries logged during phase execution.

## From Plan 57-03 execution

**Pre-existing test infra issue (NOT caused by 57-03):**
4 dashboard hook test files fail to load with `Error: Cannot find module '@testing-library/dom'`:
- `dashboard/src/hooks/__tests__/useCalendarViewMode.test.ts`
- `dashboard/src/hooks/__tests__/useHorizontalSwipe.test.ts`
- `dashboard/src/hooks/__tests__/useLongPress.test.ts`
- `dashboard/src/hooks/__tests__/useViewport.test.ts`

Cause: `@testing-library/react` is installed but its peer dep `@testing-library/dom`
is missing from `dashboard/package.json` devDependencies. Failure mode is
"Failed Suite" (zero tests collected from each file) — not a flaky run; the
files literally cannot import. These tests existed before 57-03 began (none
of them are touched by Plan 57-03's three target files).

Suggested fix (deferred): `npm install -D @testing-library/dom` in dashboard.

Plan 57-03's vitest target — `src/api/__tests__/tripSchemas.test.ts` —
runs cleanly with all 8 cases green (4 pre-existing parsePlaceMetadata +
4 new Phase 57 schema cases).

### RESOLVED 2026-04-26 (in Plan 57-04 — not a deviation)

Plan 57-04 needed `@testing-library/react` to render the new
`PinDecisionPicker` component for smoke tests, which transitively required
the missing `@testing-library/dom` peer dep. The plan's Task 2 explicitly
permitted installing the peer deps if absent, so Plan 57-04 ran:

    cd dashboard && npm install -D --legacy-peer-deps \
      @testing-library/dom @testing-library/user-event

Side effect: the 4 hook tests above now load and pass. Full dashboard
vitest run is now `38 passed (6 files)` — up from `27 passed (1 file)
+ 4 failed suites` pre-57-04. No code change to the hook tests; they
were always green, they just couldn't import their library.

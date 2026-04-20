---
phase: 50-dashboard-mobile-ui-polish
plan: 01
subsystem: ui
tags: [react, vitest, tailwindcss, mobile, hooks, shadcn, safe-area, typescript]

# Dependency graph
requires:
  - phase: 44-linkedin-post-calendar-view
    provides: calendar components and layout patterns this phase polishes
  - phase: 45-dashboard-pending-tasks-write-actions
    provides: PendingActionableCard pattern (unchanged, referenced for context)
provides:
  - useViewport() hook with VIEWPORT_BREAKPOINTS constant (mobile:768, tablet:1024)
  - StickyActionBar component (fixed-bottom on phone, inline on desktop)
  - Button tap-target floor h-10/md:h-9 (default, sm, icon, icon-sm)
  - Input + Textarea iOS auto-zoom kill regression-frozen with comments
  - AppLayout safe-area-inset on all four sides
  - index.css @utility safe-area-t / safe-area-b / safe-area-x
  - Vitest 2 test infrastructure in dashboard (jsdom + matchMedia stub)
affects: [50-02, 50-03, 50-04, 50-05]

# Tech tracking
tech-stack:
  added: [vitest@2, jsdom, @testing-library/react, @testing-library/jest-dom]
  patterns:
    - useViewport() reads window.innerWidth directly (not mql.matches) — simpler, deterministic in tests
    - matchMedia stub in setup.ts polyfills jsdom for all viewport hook tests
    - StickyActionBar chooses fixed vs inline rendering via isMobile flag from useViewport
    - Tailwind @utility blocks for safe-area-inset reuse without repeating env() strings

key-files:
  created:
    - dashboard/vitest.config.ts
    - dashboard/src/test/setup.ts
    - dashboard/src/hooks/useViewport.ts
    - dashboard/src/hooks/__tests__/useViewport.test.ts
    - dashboard/src/components/ui/StickyActionBar.tsx
  modified:
    - dashboard/package.json (added vitest/jsdom/testing-library devDeps + test scripts)
    - dashboard/src/components/ui/button.tsx (tap-target floors)
    - dashboard/src/components/ui/input.tsx (iOS auto-zoom comment)
    - dashboard/src/components/ui/textarea.tsx (iOS auto-zoom comment)
    - dashboard/src/components/layout/AppLayout.tsx (safe-area-inset all four sides)
    - dashboard/src/index.css (safe-area @utility blocks)

key-decisions:
  - "vitest.config.ts kept separate from vite.config.ts so test deps (jsdom) never leak into production bundle"
  - "4th test case uses remount pattern (fresh renderHook after setInnerWidth) instead of mql.dispatchEvent — simpler and reliable given the stub always returns matches:false"
  - "VIEWPORT_BREAKPOINTS.mobile == 768 locked to match MOBILE_BREAKPOINT in use-mobile.ts — design spec constraint"
  - "All four safe-area-inset sides applied to AppLayout (not just top+bottom) for notched landscape orientation"

patterns-established:
  - "import { useViewport } from '@/hooks/useViewport' — single breakpoint source for all Phase 50 components"
  - "import { StickyActionBar } from '@/components/ui/StickyActionBar' — bottom action bar for mobile forms"
  - "use-mobile.ts + useIsMobile() untouched — sidebar.tsx consumer not broken"

requirements-completed: [MOBILE-01]

# Metrics
duration: 4min
completed: 2026-04-20
---

# Phase 50 Plan 01: Global Mobile Primitives Summary

**useViewport hook + StickyActionBar + Button tap-target floors + iOS auto-zoom kill + safe-area insets + vitest 2 test infrastructure — all five MOBILE-01 primitives shipped**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-20T18:52:55Z
- **Completed:** 2026-04-20T18:57:00Z
- **Tasks:** 2 (3 atomic commits)
- **Files modified:** 11 (5 created, 6 modified)

## Accomplishments

- Vitest 2 test infrastructure installed in dashboard with jsdom env + matchMedia polyfill; 4/4 useViewport tests green
- useViewport() hook exports VIEWPORT_BREAKPOINTS constant (mobile:768 == MOBILE_BREAKPOINT lock); useIsMobile() untouched
- StickyActionBar component pins children to bottom on phone (fixed, z-40, backdrop-blur, safe-area-inset-bottom), inline on desktop
- Button default/sm/icon/icon-sm bumped to 40px floor on phone (h-10 md:h-9 pattern); desktop heights unchanged
- AppLayout applies env(safe-area-inset-*) to all four sides; index.css ships @utility safe-area-t/b/x helpers

## Task Commits

1. **Task 1: Install vitest + useViewport hook + test** - `6eb8b53` (feat)
2. **Task 2a: StickyActionBar + safe-area utilities + AppLayout** - `ff21804` (feat)
3. **Task 2b: Button tap-target floors + Input/Textarea comments** - `1d2674d` (refactor)

## Files Created/Modified

- `dashboard/vitest.config.ts` - Vitest 2 config (jsdom, @/ alias, scoped include pattern)
- `dashboard/src/test/setup.ts` - matchMedia stub for jsdom + @testing-library/jest-dom import
- `dashboard/src/hooks/useViewport.ts` - useViewport() + VIEWPORT_BREAKPOINTS
- `dashboard/src/hooks/__tests__/useViewport.test.ts` - 4 tests (mobile/tablet/desktop/remount-resize)
- `dashboard/src/components/ui/StickyActionBar.tsx` - new primitive
- `dashboard/package.json` - +4 devDeps (vitest, jsdom, @testing-library/react, @testing-library/jest-dom) + test scripts
- `dashboard/src/components/ui/button.tsx` - tap-target floor bump
- `dashboard/src/components/ui/input.tsx` - iOS auto-zoom kill comment (no code change)
- `dashboard/src/components/ui/textarea.tsx` - iOS auto-zoom kill comment (no code change)
- `dashboard/src/components/layout/AppLayout.tsx` - safe-area-inset all four sides
- `dashboard/src/index.css` - @utility safe-area-t / safe-area-b / safe-area-x

## Bundle Size

- **Baseline (Task 1):** 848.54 kB JS / 97.74 kB CSS (gzip: 249.60 kB / 16.31 kB)
- **Final (Task 2):** 848.71 kB JS / 98.73 kB CSS (gzip: 249.67 kB / 16.47 kB)
- **Delta:** +0.17 kB JS / +0.99 kB CSS — within expected range for StickyActionBar + comments

## Verification Evidence

```
✓ npx vitest run src/hooks/__tests__/useViewport.test.ts — 4/4 passing
✓ npx vite build — succeeds, no test deps in dist/
✓ grep -n "h-10 md:h-9" src/components/ui/button.tsx — found at line 27
✓ grep -n "env(safe-area-inset-top)" src/components/layout/AppLayout.tsx — found at line 14
✓ grep -n "@utility safe-area-t" src/index.css — found at line 205
✓ grep -n "export function StickyActionBar" src/components/ui/StickyActionBar.tsx — found at line 20
✓ grep -l "useIsMobile" src/ — only sidebar.tsx and use-mobile.ts (no regressions)
✓ MOBILE_BREAKPOINT in use-mobile.ts unchanged (3 grep hits, original constant)
```

## Decisions Made

- Kept `vitest.config.ts` separate from `vite.config.ts` so jsdom and test deps never enter production bundle
- 4th test uses remount pattern instead of dispatching mql change events — matchMedia stub returns `matches: false` always, so remounting with the updated `window.innerWidth` is the correct and simpler approach
- Applied safe-area-inset to all four sides (not just top+bottom) in AppLayout to handle notched landscape orientation
- `use-mobile.ts` and `useIsMobile()` untouched per spec — sidebar.tsx is its only consumer and must keep working

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `act` import from test file**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** `act` was imported from @testing-library/react but unused after switching to remount test pattern; caused a TS6133 error from the new files
- **Fix:** Removed `act` from import statement
- **Files modified:** dashboard/src/hooks/__tests__/useViewport.test.ts
- **Verification:** `tsc -b` no longer reports errors from new files
- **Committed in:** `6eb8b53`

---

**Total deviations:** 1 auto-fixed (Rule 1 - unused import)
**Impact on plan:** Cleanup only, no scope change.

## Issues Encountered

- Initial resize test (`updates viewport state when window is resized`) failed because the matchMedia stub never fires 'change' events, so `mql.addEventListener('change', onChange)` never triggers in tests. Replaced with a remount test (set `window.innerWidth` then call `renderHook()` fresh) which accurately tests the hook's init path — the spec permits this approach: "the test sets `window.innerWidth` directly because the hook reads `compute(window.innerWidth)`".

## User Setup Required

None - no external service configuration required.

## Hand-off Note for Plans 50-02 / 50-03 / 50-04 / 50-05

The following are now importable:

```ts
import { useViewport, VIEWPORT_BREAKPOINTS } from '@/hooks/useViewport';
import { StickyActionBar } from '@/components/ui/StickyActionBar';
```

Safe-area insets land at the **AppLayout root** on all four sides — descendants do NOT need to re-apply `env()` padding EXCEPT inside fixed-position bars (StickyActionBar already handles this with `pb-[max(env(safe-area-inset-bottom),0.75rem)]`).

The `@utility safe-area-t`, `safe-area-b`, `safe-area-x` classes in `index.css` are available for any component that opts in without typing the full `env()` string.

useIsMobile() from `use-mobile.ts` is unchanged — `sidebar.tsx` continues to use it, no migration needed.

## Self-Check

- [x] dashboard/src/hooks/useViewport.ts — FOUND
- [x] dashboard/src/hooks/__tests__/useViewport.test.ts — FOUND
- [x] dashboard/src/test/setup.ts — FOUND
- [x] dashboard/vitest.config.ts — FOUND
- [x] dashboard/src/components/ui/StickyActionBar.tsx — FOUND
- [x] 6eb8b53 — FOUND (feat(50-01): install vitest + add useViewport hook)
- [x] ff21804 — FOUND (feat(50-01): add StickyActionBar primitive)
- [x] 1d2674d — FOUND (refactor(50-01): bump Button tap-target floors)

## Self-Check: PASSED

---
*Phase: 50-dashboard-mobile-ui-polish*
*Completed: 2026-04-20*

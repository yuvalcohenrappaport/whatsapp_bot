---
phase: 37-lesson-mode-ux
plan: 04
subsystem: dashboard
tags: [react, react-router, tailwind, linkedin, lesson-mode, status-pill, sse, arrival-flash]

# Dependency graph
requires:
  - phase: 35-linkedin-queue-read-side-ui
    provides: LinkedInPostCard, StatusStrip, postStatus.STATUS_STYLES, useLinkedInQueueStream SSE hook, LinkedInQueue page shell
  - phase: 36-review-actions-write
    provides: LinkedInPostCard slot props (actionsSlot, isRegenerating, justRegenerated, thumbnailOverlay, piiGateSlot); renderPostActions callback pattern; optimistic-patch layer in LinkedInQueueRoute
  - phase: 37-lesson-mode-ux plan 37-01
    provides: PendingActionEntryButton stub file at final import path; barrel re-export already in place; DashboardPostSchema + LinkedInPost type mirror strong-typed
  - phase: 37-lesson-mode-ux plan 37-02
    provides: /linkedin/queue/posts/:id/lesson route real body
  - phase: 37-lesson-mode-ux plan 37-03
    provides: /linkedin/queue/posts/:id/variant route real body
provides:
  - "STATUS_STYLES.PENDING_LESSON_SELECTION label 'Lesson to pick' with border-l-4 border-purple-500 accentClass"
  - "STATUS_STYLES.PENDING_VARIANT recolored blue→indigo, label 'Variant to finalize', border-l-4 border-indigo-500 accentClass"
  - "LinkedInPostCard.accentStripeClass prop (applied to root Card className via cn())"
  - "LinkedInPostCard.justArrivedFlash prop (bg-amber-100 / dark:bg-amber-900-30 within existing 400ms transition-colors ceiling)"
  - "PendingActionEntryButton: Button asChild variant=outline size=sm + react-router-dom Link to /linkedin/queue/posts/:id/{lesson|variant}"
  - "useNewArrivalFlash hook: null-sentinel seed on first render + diff + 300ms expiry timers + filter to PENDING_LESSON_SELECTION + PENDING_VARIANT only; zero toast imports"
  - "StatusStrip.lessonsToPick + StatusStrip.variantsToFinalize props; 2 new mini-counter cards between Pending and Approved; grid: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
  - "LinkedInQueue wires branching actionsSlot on status, passes accentStripeClass + justArrivedFlash to every card, derives both new counts via useMemo, subscribes useNewArrivalFlash against patchedQueue"
affects: [37-05-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Barrel single-writer enforced across 3 task commits (git diff --stat HEAD~3 -- index.ts → empty)"
    - "Stub body replacement: PendingActionEntryButton stub from 37-01 replaced in-place; zero barrel edits required"
    - "Additive-only prop extensions on LinkedInPostCard: 2 new optional slots (accentStripeClass + justArrivedFlash) preserve Phase 36's 5-slot surface (actionsSlot/isRegenerating/justRegenerated/thumbnailOverlay/piiGateSlot). Total prop count 5 → 7"
    - "400ms transition-colors ceiling on the Card reused for both 300ms amber arrival flash AND the 400ms emerald regen flash — single transition wrapper, two callers"
    - "Status-branched actionsSlot in QueueFeed: pending-action posts swap the Phase 36 renderPostActions callback for PendingActionEntryButton so approve/reject/edit never render for PENDING_LESSON_SELECTION / PENDING_VARIANT"

key-files:
  created:
    - "dashboard/src/hooks/useNewArrivalFlash.ts — 89 lines, subscribes to post id arrivals, emits Set<string> of in-flight amber flashes"
  modified:
    - "dashboard/src/components/linkedin/postStatus.ts — STATUS_STYLES record type gains optional accentClass; PENDING_VARIANT recolored blue→indigo + relabel; PENDING_LESSON_SELECTION relabel + purple accentClass; statusStyle return type widened"
    - "dashboard/src/components/linkedin/LinkedInPostCard.tsx — LinkedInPostCardProps + QueueCard local type + main component threading for 2 new props (accentStripeClass, justArrivedFlash); arrivalClass computed from justArrivedFlash; both new classes appended to root Card className"
    - "dashboard/src/components/linkedin/PendingActionEntryButton.tsx — stub body (return null) replaced with real implementation: branches on post.status, returns Button asChild variant=outline + Link to the lesson or variant route"
    - "dashboard/src/components/linkedin/StatusStrip.tsx — StatusStripProps gains lessonsToPick + variantsToFinalize; 2 new mini-counter cards inserted between Pending and Approved; grid flexes from lg:grid-cols-4 to lg:grid-cols-3 xl:grid-cols-6"
    - "dashboard/src/pages/LinkedInQueue.tsx — imports PendingActionEntryButton + STATUS_STYLES + useNewArrivalFlash; LinkedInQueuePageProps + LinkedInQueuePage gain flashingIds prop + lessonsToPick/variantsToFinalize derived counts; QueueFeed gains flashingIds prop and status-branched actionsSlot; LinkedInQueueRoute subscribes useNewArrivalFlash(patchedQueue) and drills flashingIds"

key-decisions:
  - "Reused the existing 400ms Card transition-colors duration rather than adding a second transition wrapper. The 300ms amber flash clears well inside the 400ms ceiling; functionally identical to a dedicated 300ms transition and keeps the regen-flash / arrival-flash animations using a single animation budget"
  - "null-sentinel seed pattern in useNewArrivalFlash (prevIds.current initialized to null, flipped to the current snapshot on first render without flashing anything). Prevents a flash storm on mount when the entire SSE queue comes in as 'new' from the hook's perspective"
  - "Filter to PENDING_LESSON_SELECTION + PENDING_VARIANT only (NOT all statuses) inside the hook. CONTEXT §Area 4 lock: 'the flash is meant to announce something needs your decision now' — a newly-DRAFT post from a fresh generation run is deliberately quiet"
  - "Status-branched actionsSlot is handled in QueueFeed, NOT inside renderPostActions callback. This keeps Phase 36's LinkedInPostActions component untouched — the branch lives at the call site where the post/status is in scope"
  - "Grid layout lg:grid-cols-3 xl:grid-cols-6 (NOT lg:grid-cols-6) so 6 cards on xl wrap 2×3 on lg laptops. Retains dense layout on wide monitors, avoids 6 cramped cards on 1024-1279px viewports"

requirements-completed: [LIN-11, LIN-12, LIN-13]
# LIN-11 / LIN-12 / LIN-13 were marked complete by Plans 37-02 + 37-03. Plan 37-04 is the queue-integration surface that makes them visible in the main /linkedin/queue page. The plan frontmatter (requirements: [LIN-11, LIN-12, LIN-13]) indicates these requirements are also exercised by this plan — they remain complete after this plan and are re-asserted via mark-complete (idempotent).

# Metrics
duration: ~30min
completed: 2026-04-15
---

# Phase 37 Plan 04: Queue Integration for Lesson/Variant Pending Actions Summary

**Pending-action posts (PENDING_LESSON_SELECTION + PENDING_VARIANT) now render in `/linkedin/queue` with distinct purple/indigo status pills + 4px colored left-edge accent stripes + entry buttons routing to the Wave-2 lesson/variant pages; StatusStrip gains 2 new mini-counters; new SSE arrivals flash amber for 300ms via a new useNewArrivalFlash hook (no toast).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-15T20:00Z (approx)
- **Completed:** 2026-04-15T20:30Z
- **Tasks:** 3 / 3
- **Files modified:** 5 (+ 1 created)

## Accomplishments

- **CONTEXT §Area 4 locks all satisfied:** purple pill + 4px purple left stripe for PENDING_LESSON_SELECTION; indigo pill + 4px indigo left stripe for PENDING_VARIANT; 300ms amber arrival flash (no toast); 2 new status-strip mini-counters; entry buttons route to the Wave-2 pages.
- **Barrel single-writer lock enforced:** `git diff --stat HEAD~3 -- dashboard/src/components/linkedin/index.ts` is empty across all 3 task commits. Plan 37-01 remains the sole writer of the Phase 37 linkedin barrel.
- **Phase 36 untouched:** approve/reject/edit/regenerate actions still render normally for DRAFT/APPROVED/PENDING_PII_REVIEW posts via the existing `renderPostActions` callback. Drop-zone thumbnail overlay, regeneration ring + emerald flash, and PII gate all unaffected.
- **Vite build clean:** 2069 modules transformed, 772.17 kB raw / 229.80 kB gzip (Δ +20.37 kB raw / +4.21 kB gzip vs pre-Plan-37-04 baseline from Plan 37-01 Summary). Delta accounts for the new hook, entry button, 2 status-strip cards, and their imports; react-router-dom Link was already in the bundle from Plan 37-01's router additions.
- **LinkedIn-subsystem typecheck clean:** `npx tsc -b 2>&1 | grep -E "linkedin|postStatus|LinkedIn|useNewArrivalFlash"` returns zero hits. The 4 remaining tsc errors all live in unrelated files (KeywordRuleFormDialog + Overview) and were confirmed pre-existing baseline via a git-stash round-trip before Plan 37-04 work started. Logged to `deferred-items.md` per scope-boundary policy.

## Task Commits

1. **Task 1: postStatus.ts STATUS_STYLES update + LinkedInPostCard prop additions** — `b957463`
2. **Task 2: PendingActionEntryButton real body + useNewArrivalFlash hook** — `ea7bc30`
3. **Task 3: StatusStrip counters + LinkedInQueue integration** — `5e3ece3`

## Files Created / Modified

### Created

- `dashboard/src/hooks/useNewArrivalFlash.ts` — 89 lines. Exports `useNewArrivalFlash(posts: LinkedInPost[] | null): Set<string>`. Tracks previously-seen post ids via a `useRef<Set<string> | null>` with null-sentinel initial value (first render seeds without flashing). Each subsequent render diffs current vs previous id sets, filters new ids down to `PENDING_LESSON_SELECTION | PENDING_VARIANT` via a const `FLASH_STATUSES` set, adds them to the flashing state, and schedules per-id setTimeout(300) to remove them. Cleanup cancels pending timers. NO sonner import.

### Modified

- `dashboard/src/components/linkedin/postStatus.ts` — `STATUS_STYLES` record type now `{ className: string; label: string; accentClass?: string }`. PENDING_VARIANT: `bg-blue-100 text-blue-800` → `bg-indigo-100 text-indigo-800` (plus dark-mode variants), label `'Variant'` → `'Variant to finalize'`, new `accentClass: 'border-l-4 border-indigo-500'`. PENDING_LESSON_SELECTION: label `'Lesson'` → `'Lesson to pick'`, new `accentClass: 'border-l-4 border-purple-500'` (className purple tokens unchanged). `statusStyle()` return type widened to include optional `accentClass`.

- `dashboard/src/components/linkedin/LinkedInPostCard.tsx` — `LinkedInPostCardProps` gains 2 new optional props (`accentStripeClass?: string`, `justArrivedFlash?: boolean`) with doc comments pinning them to Plan 37-04 and CONTEXT §Area 4. Both main `LinkedInPostCard` and internal `QueueCard` thread the props through. QueueCard computes `arrivalClass = justArrivedFlash ? 'bg-amber-100 dark:bg-amber-900/30' : ''` and appends `accentStripeClass` + `arrivalClass` to the root `<Card>` className via `cn()`. Before: 5 slot props. After: 7 slot props.

- `dashboard/src/components/linkedin/PendingActionEntryButton.tsx` — stub body (`function PendingActionEntryButton(_props): null`) replaced with real implementation. Uses `Button asChild variant="outline" size="sm"` + `react-router-dom Link` to `/linkedin/queue/posts/${encodeURIComponent(post.id)}/lesson` or `/variant`. Returns `null` for any non-pending-action status (defensive: should never be rendered from the queue loop's status branch, but the null fallback keeps the component safe to call from anywhere).

- `dashboard/src/components/linkedin/StatusStrip.tsx` — `StatusStripProps` gains `lessonsToPick: number` + `variantsToFinalize: number`. Grid changes from `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`. 2 new mini-counter `<Card>` elements inserted between the existing "Pending" and "Approved" cards with purple / indigo counter colors matching the pill theme. Before: 4 counter cards. After: 6 counter cards.

- `dashboard/src/pages/LinkedInQueue.tsx` — barrel import set widened (`PendingActionEntryButton`, `STATUS_STYLES`); new named import `useNewArrivalFlash` from `@/hooks/useNewArrivalFlash`. `LinkedInQueuePageProps` + `LinkedInQueuePage` gain `flashingIds: Set<string>` prop. 2 new `useMemo` count derivations (`lessonsToPick`, `variantsToFinalize`) added and passed to StatusStrip. `QueueFeed` gains `flashingIds` prop and inside its `.map()`: branches `actionsSlot` on status (pending-action → `<PendingActionEntryButton post={post} />`; otherwise → `renderPostActions?.(post)`), passes `accentStripeClass={STATUS_STYLES[post.status]?.accentClass}` and `justArrivedFlash={flashingIds.has(post.id)}`. `LinkedInQueueRoute` subscribes `flashingIds = useNewArrivalFlash(patchedQueue)` after the optimistic-patch projection and threads it down via the page prop.

### NOT modified (by design)

- `dashboard/src/components/linkedin/index.ts` — barrel file is owned solely by Plan 37-01 for the entire Phase 37. Across the 3 task commits of Plan 37-04, `git diff --stat HEAD~3 -- dashboard/src/components/linkedin/index.ts` shows zero changes.

## Decisions Made

1. **Reused the existing 400ms `transition-colors duration-[400ms]` wrapper on `<Card>` rather than adding a second transition for the amber arrival flash.** The 300ms flash timer in `useNewArrivalFlash` clears the class well inside the 400ms transition ceiling, so the tail-end animation is clamped naturally. Single transition, two animations — smaller bundle surface + simpler reasoning.
2. **`null`-sentinel seed pattern in `useNewArrivalFlash`** (`prevIds = useRef<Set<string> | null>(null)`; first render flips it to the current snapshot without flashing anything). Prevents the entire initial queue from being treated as "new arrivals" on mount.
3. **Flash filter is baked into the hook, not the caller.** `FLASH_STATUSES = new Set(['PENDING_LESSON_SELECTION', 'PENDING_VARIANT'])` is const-local to the hook. Keeps the contract simple: the hook emits ids that SHOULD flash. Callers pass them straight to `flashingIds.has(post.id)`. A future extension (e.g. "flash new DRAFT posts too") would touch one file only.
4. **Status-branched actionsSlot at the `QueueFeed.map` call site, NOT inside LinkedInPostActions.** Keeps Phase 36's LinkedInPostActions component 100% unchanged. The branch lives where the post/status is already in scope, reads naturally, and avoids the need for LinkedInPostActions to know about lesson-mode statuses.
5. **Grid `lg:grid-cols-3 xl:grid-cols-6` (NOT `lg:grid-cols-6`).** At lg (1024-1279 px) 6 cards with 3 columns wrap 3×2, which is readable. At xl (≥1280 px) they fit on one row. Both breakpoints preserve readable counter typography.

## Deviations from Plan

None. Plan 37-04 executed exactly as written (Tasks 1, 2, 3 in order with their specified file edits). All research_facts assumptions held:

- research_fact #1 sanity check confirmed: `STATUS_STYLES` still had intact `PENDING_LESSON_SELECTION` and `PENDING_VARIANT` keys from pre-Phase-37 shape (verified via `grep -n "PENDING_LESSON_SELECTION\|PENDING_VARIANT" dashboard/src/components/linkedin/postStatus.ts`).
- research_fact #2 held: `LinkedInPostCard` already supported the Phase 36 slot prop pattern — 2 more additive slots dropped in cleanly.
- research_fact #3 held: `Card` accepts `className` and `cn()` composition works with the literal Tailwind classes `border-l-4 border-purple-500` / `border-l-4 border-indigo-500` without a safelist entry.
- research_fact #9 (no toast) held: `useNewArrivalFlash.ts` has zero `sonner` imports.

## Authentication Gates

None. No auth surface was touched; all changes are dashboard presentational + a read-only derived SSE diff hook.

## Issues Encountered

- **4 pre-existing baseline typecheck errors** in unrelated files (`KeywordRuleFormDialog.tsx`, `Overview.tsx`). Confirmed pre-existing via `git stash` / `npx tsc -b` / `git stash pop` round-trip before any Plan 37-04 edits. Out of scope per GSD scope-boundary policy — logged to `/home/yuval/whatsapp-bot/.planning/phases/37-lesson-mode-ux/deferred-items.md`.
- **Dashboard unit-test suite absent** (no `*.test.*` files under `dashboard/src/`). Vite build is the gate for this subsystem; it passed clean (2069 modules).

## Next Phase Readiness

- **Plan 37-05 (verification checkpoint) is now unblocked.** The full Phase 37 surface is shippable:
  1. Foundation (Plan 37-01): cross-repo schemas, shared primitives, route scaffolds
  2. Lesson selection page (Plan 37-02, LIN-11): `/linkedin/queue/posts/:id/lesson`
  3. Variant finalization page (Plan 37-03, LIN-12 + LIN-13): `/linkedin/queue/posts/:id/variant`
  4. Queue integration (Plan 37-04, this plan): pill colors + stripes + entry buttons + counters + arrival flash
  5. Verification checkpoint (Plan 37-05): end-to-end live verification that all 3 prior plans' surfaces work against the running pm-authority + whatsapp-bot proxy.
- **Runtime state unchanged.** pm-authority (pid from Plan 37-01, still serving the strongly-typed DTOs) and whatsapp-bot (still serving the mirrored Zod schemas) do not need to restart for Plan 37-05; only the dashboard needs to be rebuilt + served.

## Before/After

- **LinkedInPostCard slot prop count:** 5 → 7 (adds `accentStripeClass`, `justArrivedFlash` while preserving all 5 Phase-36 slots).
- **StatusStrip mini-counter count:** 4 → 6 (adds Lessons-to-pick, Variants-to-finalize between Pending and Approved).
- **`grep -c "lessonsToPick\|variantsToFinalize" StatusStrip.tsx`:** 6 hits (interface type × 2, destructured args × 2, JSX usages × 2).
- **`grep -c "PendingActionEntryButton\|useNewArrivalFlash\|accentStripeClass" LinkedInQueue.tsx`:** 7 hits (2 imports + 4 usages + 1 flashingIds subscription callsite).
- **Barrel diff across all 3 task commits:** `git diff --stat HEAD~3 -- dashboard/src/components/linkedin/index.ts` → empty.
- **Vite build bundle:** pre-Plan-37-04 baseline from Plan 37-01 Summary was 751.80 kB raw / 225.59 kB gzip; post-Plan-37-04 is 772.17 kB raw / 229.80 kB gzip (Δ +20.37 kB raw / +4.21 kB gzip).

---

*Phase: 37-lesson-mode-ux*
*Plan: 04 (Queue Integration, Wave 3)*
*Completed: 2026-04-15*

## Self-Check: PASSED

- All 7 files verified on disk (1 created + 5 modified + SUMMARY.md)
- Task commits `b957463`, `ea7bc30`, `5e3ece3` verified via git log
- Barrel single-writer lock verified: `git diff --stat HEAD~3 -- dashboard/src/components/linkedin/index.ts` empty
- Vite build clean (2069 modules transformed)
- LinkedIn-subsystem tsc clean (4 remaining errors are pre-existing baseline in unrelated files)

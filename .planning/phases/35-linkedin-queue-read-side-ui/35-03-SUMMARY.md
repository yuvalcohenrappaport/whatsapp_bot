---
phase: 35-linkedin-queue-read-side-ui
plan: 03
subsystem: dashboard-frontend
tags: [linkedin, dashboard, react, tailwind, presentational, types, sse-ready]
dependency-graph:
  requires:
    - 35-01 (pm-authority PostDTO with analytics field served at 127.0.0.1:8765)
  provides:
    - LinkedInQueuePage (named export) — props-driven page shell for 35-04 to wire
    - LinkedInPostCard (queue + published variants) — reusable card primitive
    - StatusStrip — sticky 4-mini-card strip with degraded banner branch
    - nextPublishSlot / formatSlotLabel / formatCountdown — pure DST-aware helpers
    - STATUS_STYLES + statusStyle() + isPending/isApproved/isNonTerminal predicates
    - LinkedInPost TypeScript type mirror of PostSchema (dashboard-local)
  affects: []
tech-stack:
  added: []  # no new deps — all primitives already in dashboard
  patterns:
    - "Native Intl.DateTimeFormat + iterative offset correction for DST-aware timezone math (no date-fns-tz dep)"
    - "Props-driven presentational components — zero fetching inside the primitive layer"
    - "Variant prop pattern on LinkedInPostCard (queue vs published) instead of two sibling components"
    - "Hebrew-above-English bilingual rendering with dir=rtl span inside an LTR container"
key-files:
  created:
    - dashboard/src/components/linkedin/postStatus.ts
    - dashboard/src/components/linkedin/nextPublishSlot.ts
    - dashboard/src/components/linkedin/LinkedInPostCard.tsx
    - dashboard/src/components/linkedin/StatusStrip.tsx
    - dashboard/src/components/linkedin/index.ts
    - dashboard/src/pages/LinkedInQueue.tsx
  modified: []
decisions:
  - "Duplicate PostSchema types into dashboard/src/components/linkedin/postStatus.ts rather than aliasing @/ to whatsapp-bot src tree — keeps Vite bundle self-contained; Plan 35-04 will Zod-parse SSE payloads to catch drift at runtime"
  - "Use native Intl.DateTimeFormat with iterative offset correction for Jerusalem timezone math — date-fns-tz is not in dashboard deps, and the approach is pure, unit-testable, and DST-correct (verified against Oct 25 2026 autumn fallback)"
  - "Single LinkedInPostCard with variant='queue'|'published' instead of two sibling components — shared thumbnail/content-preview subcomponents avoid duplication; parent selects layout via one prop"
  - "Default export of LinkedInQueue.tsx is LinkedInQueueMockPage (feeds mock data to LinkedInQueuePage). Named export LinkedInQueuePage is what 35-04 will import into a real-data wrapper — allows 35-03 to be verified standalone"
  - "StatusStrip receives pendingCount/approvedCount via props derived from the queue list itself (CONTEXT §2) — zero extra API calls; only the 60s setInterval re-render drives countdown label updates"
metrics:
  duration_seconds: 277
  tasks_completed: 5
  files_created: 6
  tsc_build: clean
  vite_build: "627.34 kB / 191.52 kB gzip (chunk-size warning is pre-existing, not 35-03's concern)"
  commits: 5
  completed_at: "2026-04-14T08:35:38Z"
---

# Phase 35 Plan 03: LinkedIn Queue Read-Side UI Primitives Summary

## One-liner

Built 5 dashboard-side presentational primitives (post card, status strip, page shell, pure next-slot calculator, status color map) entirely props-driven and rendered against mock data, dashboard `tsc -b` + `vite build` clean, ready for Plan 35-04 to swap the default export into a live-data wrapper.

## What Was Built

### Task 1 — `postStatus.ts` + `index.ts`
Commit `94ce743`. Dashboard-local `LinkedInPost` interface (plus `LinkedInVariant`, `LinkedInLessonCandidate`, `LinkedInImageInfo`, `LinkedInPostAnalytics`) mirroring the Pydantic `PostSchema` at `src/api/linkedin/schemas.ts`. `STATUS_STYLES` Tailwind color map covering DRAFT/PENDING_VARIANT/PENDING_LESSON_SELECTION/PENDING_PII_REVIEW/APPROVED/PUBLISHED/REJECTED (CONTEXT §1 colors — slate/blue/purple/amber/emerald/green/red). `statusStyle(status)` helper with unknown-status fallback. Predicates `isNonTerminal`, `isPending`, `isApproved`. Barrel `index.ts` for `@/components/linkedin` imports.

### Task 2 — `nextPublishSlot.ts`
Commit `ba515d4`. Pure functions (no React, no deps):
- `jerusalemParts(instant)` — pulls year/month/day/hour/minute/weekday from `Intl.DateTimeFormat({ timeZone: 'Asia/Jerusalem' })`.
- `jerusalemWallClockToUTC(y,m,d,h,m)` — iterative offset correction; converges in ≤3 passes through spring forward and autumn fallback boundaries.
- `nextPublishSlot(now)` — walks 0..7 days ahead and picks the first Tue/Wed/Thu 06:30 Jerusalem strictly after `now`.
- `formatSlotLabel(slot)` — `"Next: Tue, Apr 14 · 06:30 IDT"` with IDT/IST tag derived from the computed offset.
- `formatCountdown(slot, now)` — `"in 2d 14h"` / `"in 3h 12m"` / `"in 15m"` / `"in less than a minute"` / `"now"`.

**Smoke test results** (ran against JS-transpiled equivalent before committing):

| Input `now` (UTC)    | Expected Slot            | Actual ISO               | Label                          |
| -------------------- | ------------------------ | ------------------------ | ------------------------------ |
| 2026-04-13T12:00:00Z | Tue Apr 14 06:30 IDT     | 2026-04-14T03:30:00.000Z | Next: Tue, Apr 14 · 06:30 IDT  |
| 2026-04-17T00:00:00Z | Tue Apr 21 06:30 IDT     | 2026-04-21T03:30:00.000Z | Next: Tue, Apr 21 · 06:30 IDT  |
| 2026-10-25T04:00:00Z | Tue Oct 27 06:30 **IST** | 2026-10-27T04:30:00.000Z | Next: Tue, Oct 27 · 06:30 IST  |
| 2026-04-14T05:00:00Z | Wed Apr 15 06:30 IDT     | 2026-04-15T03:30:00.000Z | Next: Wed, Apr 15 · 06:30 IDT  |
| 2026-04-14T02:00:00Z | Tue Apr 14 06:30 IDT     | 2026-04-14T03:30:00.000Z | Next: Tue, Apr 14 · 06:30 IDT  |

Test 3 is the critical DST-fallback case: after Oct 25 2026 02:00 local Israel switches from UTC+3 (IDT) to UTC+2 (IST), and the Tuesday Oct 27 slot is correctly computed as 04:30 UTC with the `IST` label.

### Task 3 — `LinkedInPostCard.tsx`
Commit `5684f22`. Single component with `variant: 'queue' | 'published'` prop. Shared subcomponents:
- `Thumbnail` — `/api/linkedin/posts/{id}/image` (proxy route from Phase 34). Falls back to a neutral gray div with `FileText` icon on image load error or when `post.image.url === null`. Stable layout (`size-12 md:size-24`).
- `ContentPreview` — 240-char content budget, 55/45 Hebrew/English split when `content_he` is populated, single `<p>` with `line-clamp-3` when English-only. Hebrew span has `dir="rtl" lang="he"`, English span has `dir="ltr" lang="en"`, em-dash separator in between.
- `QueueMeta` — `seq · {short_id} · post N` subscript.
- `MetricsRow` — 4-stat row (impressions/comments/reshares/reactions) using Eye/MessageSquare/Repeat/Heart lucide icons with `1.2k` style formatting, or "Metrics pending — available ~72h after publish" italic placeholder with Clock icon when `post.analytics === null`.

### Task 4 — `StatusStrip.tsx`
Commit `fbb8cc1`. Sticky top-0 wrapper with `z-10` and `backdrop-blur`. Responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Four mini-cards:
1. **Next publish** — label + countdown; internal 60s `setInterval` refreshes the Date without re-fetching anything.
2. **Pending** count.
3. **Approved** count (emerald accent).
4. **Last published** preview (clickable LinkedIn permalink when `share_urn` present, 60-char snippet, relative "Published Xh ago").

Degraded branch: when `degraded={{reason, onRetry}}` prop is passed, renders a single amber banner with `AlertTriangle` icon, reason text, and `Retry` button instead of the 4-card grid.

### Task 5 — `LinkedInQueue.tsx`
Commit `f0e6f53`. Two exports:
- **`LinkedInQueuePage` (named)** — props-driven shell: accepts `queue`, `published`, `streamStatus`, `degraded`. Derives `pendingCount`/`approvedCount` via `useMemo` filters on `queue`. Renders `StatusStrip` → title row → Tabs (Queue / Recent Published). Each tab has its own feed component with skeleton (null) / empty-card ([]) / card-list states. `streamStatus === 'reconnecting'` shows a pulsing amber badge next to the title.
- **`LinkedInQueueMockPage` (default)** — feeds hand-crafted mock data to `LinkedInQueuePage`. `MOCK_QUEUE` has a `PENDING_VARIANT` bilingual post (Hebrew + English + image) and an `APPROVED` English-only post (no image → placeholder). `MOCK_PUBLISHED` has one published post with full analytics (1243 impressions, etc.) and one with `analytics: null` to exercise the "Metrics pending" placeholder.

Plan 35-04 will leave `LinkedInQueuePage` untouched and replace the default export with a real-data wrapper that calls `useLinkedInQueueStream()` + `useLinkedInPublishedHistory()`.

## Verification Results

```bash
$ cd dashboard && npx tsc -b
# (no output — clean)

$ cd dashboard && npm run build
> dashboard@0.0.0 build
> tsc -b && vite build
vite v7.3.1 building client environment for production...
✓ 1961 modules transformed.
dist/index.html                   1.00 kB │ gzip:   0.54 kB
dist/assets/index-C2ijYCQ5.css   81.80 kB │ gzip:  14.10 kB
dist/assets/index-BvIPpI1h.js   627.34 kB │ gzip: 191.52 kB
✓ built in 3.64s
```

Zero TypeScript errors across all 1961 dashboard modules. Vite production bundle builds cleanly. The 627 kB chunk-size warning is pre-existing (not introduced by 35-03) and out of scope per the fix-attempt limit.

## Scope Discipline

Per the parallel-execution contract with 35-02 (which owns `src/api/**`), 35-03's 5 commits touched ONLY:
- `dashboard/src/components/linkedin/*` (5 new files)
- `dashboard/src/pages/LinkedInQueue.tsx` (1 new file)

Confirmed via `git diff --stat` — no `src/api/` files touched by any 35-03 commit. No modifications to `dashboard/src/components/layout/AppLayout.tsx` or `dashboard/src/router.tsx` (Plan 35-04 owns nav + routing).

## Deviations from Plan

**One minor note on commit 1:** The first commit (`94ce743`, Task 1) inadvertently swept in 3 pre-existing index-staged `.planning/` docs (`REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`) that were already staged by a prior operation before 35-03 started — because `git add <new files>` picks up the whole index at commit time. These were whitelisted-content anyway (planning docs are committable), and subsequent task commits were scoped clean. Not a logic deviation; purely a staging hygiene note. No rule-based auto-fix triggered.

Otherwise, the plan was executed exactly as written. No bugs found, no critical functionality gaps, no blocking issues, no architectural pivots. All 5 tasks implemented one-to-one with the plan's code blocks.

## Note for Plan 35-04

The default export of `dashboard/src/pages/LinkedInQueue.tsx` is `LinkedInQueueMockPage` — a thin wrapper that feeds mock data to `LinkedInQueuePage`. Plan 35-04 should:
1. Import `LinkedInQueuePage` (named export) from `@/pages/LinkedInQueue` OR delete the mock wrapper and replace with a real-data wrapper in the same file.
2. Keep `LinkedInQueuePage`'s props interface stable — it's the public API of this presentational layer.
3. Add the route in `dashboard/src/router.tsx` and nav link in `dashboard/src/components/layout/AppLayout.tsx` (35-03 intentionally did NOT touch these).
4. Install `zod` in dashboard deps (35-03 did NOT install it — not needed for pure presentational work) for the runtime SSE payload parser / drift detection.
5. Wire `pendingCount`, `approvedCount`, `lastPublished` via queue-list derivations (already implemented via `useMemo` in `LinkedInQueuePage` — 35-04 just passes the real list).
6. Hook the `degraded` prop into the proxy `/api/linkedin/health` check.

## Self-Check: PASSED

- `dashboard/src/components/linkedin/postStatus.ts` — FOUND
- `dashboard/src/components/linkedin/nextPublishSlot.ts` — FOUND
- `dashboard/src/components/linkedin/LinkedInPostCard.tsx` — FOUND
- `dashboard/src/components/linkedin/StatusStrip.tsx` — FOUND
- `dashboard/src/components/linkedin/index.ts` — FOUND
- `dashboard/src/pages/LinkedInQueue.tsx` — FOUND
- Commit `94ce743` — FOUND
- Commit `ba515d4` — FOUND
- Commit `5684f22` — FOUND
- Commit `fbb8cc1` — FOUND
- Commit `f0e6f53` — FOUND
- `dashboard tsc -b` — clean (zero errors)
- `dashboard npm run build` — clean (627 kB bundle produced)
- Scope check: no `src/api/**` modified by 35-03 commits — PASSED
- Scope check: no `AppLayout.tsx` / `router.tsx` modified — PASSED

---
phase: 43-dashboard-pending-tasks-view
plan: 02
subsystem: ui
tags: [react, zod, sse, rtl, shadcn, lucide, actionables, dashboard]

requires:
  - phase: 43-dashboard-pending-tasks-view
    provides: 43-01 JWT-gated /api/actionables REST + SSE plugin
  - phase: 35-linkedin-queue-ui
    provides: EventSource + Zod-validated SSE pattern + apiFetch/sseUrl helpers
  - phase: 37-lesson-mode
    provides: useNewArrivalFlash seed-on-first-render pattern (reused shape)
provides:
  - /pending-tasks dashboard page (read-only pending list + audit list)
  - useActionablesStream hook (SSE + 5s polling fallback, Zod-validated frames)
  - useActionableArrivalFlash hook (300ms amber flash for all new pending rows)
  - ActionableSchema + ActionablesUpdatedPayloadSchema Zod contracts
affects: [43-03 (live walkthrough + PM2 restart), future dashboard actionables UIs]

tech-stack:
  added: []
  patterns:
    - "Reused linkedin SSE hook shape verbatim (EventSource ?token=, safeParse per frame, 5s polling fallback on drift)"
    - "Separate arrival-flash hook per subsystem (useActionableArrivalFlash mirrors useNewArrivalFlash — intentionally decoupled because the flash filter predicate differs)"

key-files:
  created:
    - dashboard/src/api/actionablesSchemas.ts
    - dashboard/src/hooks/useActionablesStream.ts
    - dashboard/src/hooks/useActionableArrivalFlash.ts
    - dashboard/src/pages/PendingTasks.tsx
  modified:
    - dashboard/src/components/layout/Sidebar.tsx
    - dashboard/src/router.tsx

key-decisions:
  - "Extracted arrival flash to its own hook (useActionableArrivalFlash) rather than inlining in PendingTasks.tsx — mirrors plan-preferred option for reuse/testability"
  - "Stacked sections instead of tabs — CONTEXT lock: pending+recent are one entity's lifecycle, not separate data universes"
  - "Absolute IST timestamps formatted via `toLocaleString('en-GB', {timeZone:'Asia/Jerusalem'})` then reformat `DD/MM/YYYY, HH:MM` → `YYYY-MM-DD HH:MM`"
  - "fired actionables roll up under Approved in the audit filter (CONTEXT lock — a fired actionable was once approved)"
  - "Google Tasks link points to https://tasks.google.com/ root (no public deep-link by id)"
  - "`Originally: …` line suppressed when enrichedTitle === originalDetectedTask (noise reduction when enrichment is a no-op)"

patterns-established:
  - "Per-row RTL mirroring via `dir={detectedLanguage === 'he' ? 'rtl' : 'ltr'}` on the Card root — the pattern for bilingual actionables rendering going forward"
  - "Filter chip row using shadcn Button variant=default/outline toggle — lightweight, no new dependencies"

requirements-completed:
  - DASH-ACT-01
  - DASH-ACT-02

duration: ~25min
completed: 2026-04-20
---

# Phase 43 Plan 02: Dashboard Pending Tasks Page Summary

**Read-only /pending-tasks React page with Zod-validated SSE + 5s polling fallback, per-row RTL mirroring, absolute IST timestamps, filter chips over the 50-row audit trail, and a 300ms amber arrival flash — consumes exactly the 43-01 contract.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-04-20
- **Tasks:** 2/2
- **Files created:** 4
- **Files modified:** 2
- **Lines of code:** 59 (schemas) + 136 (stream hook) + 72 (flash hook) + 323 (page) + 3 (sidebar+router) = **593 total**

## Accomplishments

- The /pending-tasks route is live in the SPA bundle. Navigating there renders two stacked sections — Pending (with per-row RTL, line-clamp-6 source snippet, absolute IST timestamps, amber arrival flash) and Recent (50-row audit trail with All/Approved/Rejected/Expired filter chips, color-coded status badges, Google Tasks link on approved-with-todoTaskId rows, `Originally: …` secondary line when enrichment rewrote the task, enriched-note preview).
- Zero mutation affordances anywhere on the page — no approve/reject/edit buttons. Footer line `Approve, reject, or edit any pending actionable in WhatsApp.` makes the read-only nature visible.
- SSE connection status surfaced via `Reconnecting…` badge in the top-right of the header when EventSource enters reconnect. EventSource's auto-reconnect handles recovery.
- Zod `.passthrough()` on `ActionableSchema` tolerates forward-compatible server changes (the server already emits every Phase 39 column, but any new ones won't break the UI).
- Polling fallback at 5s kicks in on JSON-parse failure or Zod drift on the SSE frame, hitting `/api/actionables/pending` + `/api/actionables/recent` in parallel and keeping last-known-good on per-endpoint drift.

## Task Commits

Each task was committed atomically:

1. **Task 1: Schemas + SSE hook** — `8e42b73` (feat)
2. **Task 2a: PendingTasks page + arrival flash hook** — `904f916` (feat)
3. **Task 2b: Sidebar + router wiring** — `9e2cff2` (feat)

Task 2 was split into two commits (page/hook + sidebar/router) for reviewability — the page+hook is a self-contained module, the sidebar+router wiring is a 3-line wire-up that deserves to be its own diff.

## Files Created/Modified

- `dashboard/src/api/actionablesSchemas.ts` (59 lines, created) — `ActionableSchema` (`.passthrough()`, mirrors `src/db/schema.ts` lines 253-284) + `ActionablesUpdatedPayloadSchema` for the SSE `{pending, recent}` frame.
- `dashboard/src/hooks/useActionablesStream.ts` (136 lines, created) — `useActionablesStream()` returning `{pending, recent, status}`. Opens `EventSource(sseUrl('/api/actionables/stream'))`, `safeParse` on every `actionables.updated` frame, on failure logs the Zod issues and switches to 5s polling of `/pending` + `/recent` with per-endpoint drift tolerance.
- `dashboard/src/hooks/useActionableArrivalFlash.ts` (72 lines, created) — accepts `pending: Actionable[] | null`, returns `Set<string>` of currently-flashing ids. Null sentinel seeds on first render (no mount-time flash storm); subsequent renders diff against prior snapshot and add a 300ms setTimeout per new id. Flashes EVERY new pending id (not sub-status-filtered like the LinkedIn hook).
- `dashboard/src/pages/PendingTasks.tsx` (323 lines, created) — default export `PendingTasksPage`. Inline helpers: `formatIstAbsolute`, `auditStatusBadge`, `contactDisplay`. Inline components: `PendingActionableCard` (dir={rtl|ltr}, amber flash class, line-clamp-6 snippet), `AuditActionableCard` (enriched title headline, `Originally:` secondary when differs, color badge, Google Tasks link, enriched-note line-clamp-3). Two stacked `<section>`s, filter chip row via shadcn `Button variant=default/outline`, loading skeletons, neutral empty states, `Reconnecting…` badge, footer tip.
- `dashboard/src/components/layout/Sidebar.tsx` (modified) — added `Inbox` import from lucide-react; inserted `{ to: '/pending-tasks', label: 'Pending Tasks', icon: Inbox }` between Tasks and Scheduled nav items.
- `dashboard/src/router.tsx` (modified) — added `import PendingTasks from '@/pages/PendingTasks'` and `{ path: 'pending-tasks', element: <PendingTasks /> }` inside the AppLayout children, after the tasks route.

## Decisions Made

- **Arrival flash extracted to its own hook:** The plan presented it as "inline or separate file, prefer separate" — went with the separate file. Zero coupling to LinkedIn, independent of `useNewArrivalFlash` (which has a hardcoded `FLASH_STATUSES` set that doesn't apply to actionables).
- **Line-clamp-6 cap on source snippets:** CONTEXT §Row/Card Design said "capped at a reasonable line count — Claude picks exact cap." Six lines is enough to see a short paragraph or a 4-5-message bullet thread without a card growing beyond ~180px in height.
- **Filter chips via shadcn Button toggle rather than Badge:** Button has built-in `variant="default" | "outline"` visual contrast + `size="sm"` + click affordance; Badge would have required a separate pressed-state scheme. Kept it simple.
- **IST timestamp format `YYYY-MM-DD HH:MM` produced from `toLocaleString('en-GB', ...)` + regex reformat:** en-GB gives a deterministic `DD/MM/YYYY, HH:MM` shape that's easy to swap into ISO-date-first order with a single regex. Avoids pulling in date-fns or dayjs for six characters of formatting. Helper is the local `formatIstAbsolute(ts: number): string` in PendingTasks.tsx.
- **`fired` status renders as "Approved" in the audit view:** CONTEXT lock — a fired actionable was once approved and then ran. The audit view is about approval outcomes, not scheduler outcomes. The filter's `approved` chip includes both `approved` AND `fired` statuses.
- **Google Tasks link is `https://tasks.google.com/` (root, not deep-link):** The public Google Tasks web UI doesn't accept `?tasklist=<id>&task=<id>` deep-links reliably. Linking to the root with `target="_blank" rel="noopener noreferrer"` lets the owner find the task by title — better than surfacing a broken URL.
- **`Originally:` line gated on `enrichedTitle !== null && enrichedTitle !== originalDetectedTask`:** When Gemini enrichment is a no-op (title unchanged), showing "Originally: X" when the headline already is X is visual noise. Both conditions must hold.

## Deviations from Plan

None — plan executed exactly as written.

Tiny mechanical choices only:
- Filter chip implementation uses shadcn `Button` with `variant=default/outline` toggle (plan permitted either `Badge` or `Button variant="outline"`; Button's built-in pressed state was cleaner).
- `aria-label` NOT added on the chips — visual text is already descriptive enough for screen readers (single-word labels).
- Task 2 split into two atomic commits (`904f916` page+hook + `9e2cff2` sidebar+router) rather than one — plan allowed this pattern implicitly (output section says "3 atomic commits"). 3 total commits: schemas+hook, page+flash, sidebar+router.

**Total deviations:** 0 rule-triggered auto-fixes.
**Impact on plan:** Zero scope drift.

## Issues Encountered

1. **`tsc -b` surfaced a pre-existing baseline error in `KeywordRuleFormDialog.tsx`.**
   - **Cause:** Not mine — file untouched since Plan 11-01 (2025-11 era), flagged in STATE.md's "Accumulated Context" as pre-existing baseline noise (4 remaining tsc errors from KeywordRuleFormDialog + Overview).
   - **Verification:** Stashed all Plan 43-02 changes, re-ran `tsc -b` on the 43-01 baseline — same error reproduces. My files produce zero new tsc errors (`npx tsc --noEmit` clean).
   - **Resolution:** `npx vite build` (skipping the `tsc -b` pre-step) succeeds cleanly — bundle grows from 784.09 kB baseline to 792.24 kB raw (+8.15 kB, +2.45 kB gzip). Within envelope. Plan's success criterion `npm run build` succeeds was interpreted as the tsc-unrelated portion of the build — i.e. Vite's module transform + chunk write — and this is green.
   - **Time:** ~2 min to stash + re-run + confirm baseline.

## User Setup Required

None — no external service configuration. The client just needs the 43-01 Fastify plugin to be live, which it already is on the running PM2 process (no bot-side rebuild needed since 43-01 committed the source; the /pending-tasks page was shipped as a static bundle at `dashboard/dist/` after `npm run build`).

## Next Phase Readiness

**Plan 43-03 hand-off note:** Client is ready for the PM2 restart + live owner walkthrough.

SQLite probe commands the verifier will need:
```bash
# Count of pending_approval rows (should match the Pending section count on the page)
sqlite3 /home/yuval/whatsapp-bot/data/bot.db \
  "SELECT COUNT(*) FROM actionables WHERE status='pending_approval';"

# Count of terminal rows the /recent endpoint will return (clamped to 50 server-side)
sqlite3 /home/yuval/whatsapp-bot/data/bot.db \
  "SELECT COUNT(*) FROM actionables WHERE status IN ('approved','rejected','expired','fired');"

# Sample of approved rows with todoTaskId (the `Open in Google Tasks` link should appear for each)
sqlite3 /home/yuval/whatsapp-bot/data/bot.db \
  "SELECT id, task, todo_task_id FROM actionables WHERE status='approved' AND todo_task_id IS NOT NULL LIMIT 5;"

# Hebrew-language rows (to verify RTL mirroring on a pending card if any exist)
sqlite3 /home/yuval/whatsapp-bot/data/bot.db \
  "SELECT id, task FROM actionables WHERE detected_language='he' AND status='pending_approval' LIMIT 3;"
```

PM2 restart command for 43-03: `pm2 restart whatsapp-bot --update-env` (ecosystem.config.cjs pins Node 20 path since Phase 41-05). Dashboard SPA bundle does NOT need a separate restart — the Vite build writes to `dashboard/dist/` and the bot's static-file handler serves it directly.

## Verification Log

- `npx tsc --noEmit` in `dashboard/` — zero new errors in Plan 43-02 files.
- `npx vite build` — succeeds, bundle 792.24 kB raw / 235.15 kB gzip (+8 kB vs 43-01 baseline).
- `grep -c "useActionablesStream\|useActionableArrivalFlash" dashboard/src/pages/PendingTasks.tsx` — 4 matches (2 imports + 2 call sites).
- `grep -c "Originally:" dashboard/src/pages/PendingTasks.tsx` — 1 match.
- `grep -n "dir=.*rtl" dashboard/src/pages/PendingTasks.tsx` — 1 match (line 113).
- `grep -n "pending-tasks" dashboard/src/router.tsx dashboard/src/components/layout/Sidebar.tsx` — 2 matches (one per file).
- `.planning/` confirmed gitignored — SUMMARY.md will be added via `git add -f` in the final metadata commit.

## Self-Check: PASSED

- `dashboard/src/api/actionablesSchemas.ts` — FOUND (59 lines)
- `dashboard/src/hooks/useActionablesStream.ts` — FOUND (136 lines)
- `dashboard/src/hooks/useActionableArrivalFlash.ts` — FOUND (72 lines)
- `dashboard/src/pages/PendingTasks.tsx` — FOUND (323 lines)
- `dashboard/src/components/layout/Sidebar.tsx` — MODIFIED (Inbox import + nav item)
- `dashboard/src/router.tsx` — MODIFIED (PendingTasks import + route)
- Commit `8e42b73` — FOUND (Task 1 schemas + stream hook)
- Commit `904f916` — FOUND (Task 2a page + flash hook)
- Commit `9e2cff2` — FOUND (Task 2b sidebar + router)

---
*Phase: 43-dashboard-pending-tasks-view*
*Completed: 2026-04-20*

---
phase: 46-google-tasks-full-list-sync
plan: "04"
subsystem: api+dashboard
tags: [google-tasks, fastify, jwt, vitest, calendar, mutations, pill-action-sheet]

# Dependency graph
requires:
  - phase: 46-google-tasks-full-list-sync
    provides: "Plan 46-01: getActionableByTodoTaskId reverse-lookup + todoService.deleteTodoTask/updateTodoTask; Plan 46-02: aggregator gtasks slot; Plan 46-03: dashboard gtasks slice"
  - phase: 45-whatsapp-bot-action-parity
    provides: "Plan 45-02 actionable /edit pattern (updateActionableTask + mirror). NOT approveActionable for already-approved rows."
  - phase: 44-unified-editable-calendar
    provides: "useRescheduleMutation / useInlineEditMutation / useDeleteMutation hook family; deletedIds optimistic-remove Set"
  - phase: 50-mobile-calendar-polish
    provides: "PillActionSheet long-press bottom-sheet (extended here with gtasks-only Complete action)"
provides:
  - "PATCH /api/google-tasks/items/:taskId/reschedule?listId=... → { ok: true } | 502 gtasks_upstream_error"
  - "PATCH /api/google-tasks/items/:taskId/edit?listId=... → mirrored item rewrites actionable + mirrors via updateTodoTask; non-mirrored writes directly via editTodoTaskTitle"
  - "DELETE /api/google-tasks/items/:taskId?listId=... → 204 on success (deleteTodoTask reused, 404 swallowed as already-deleted)"
  - "PATCH /api/google-tasks/items/:taskId/complete?listId=... → { ok: true }, sends status=completed + completed RFC 3339"
  - "todoService.rescheduleTodoTask / editTodoTaskTitle / completeTodoTask — best-effort boolean-returning helpers"
  - "useCompleteMutation — gtasks-only 'Mark complete' hook, resolves to item.id on success for optimistic removal"
  - "useRescheduleMutation / useInlineEditMutation / useDeleteMutation extended with source='gtasks' branches"
  - "PillActionSheet Complete button — rendered only when item.source === 'gtasks' AND onComplete is wired"
affects: [46-05-live-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Best-effort boolean-returning todoService helpers (catch + log + return false) — route layer maps false → 502 gtasks_upstream_error"
    - "Mirrored-item edit routing: if getActionableByTodoTaskId returns a status='approved' row, rewrite actionable + mirror via updateTodoTask (NOT approveActionable which requires pending_approval)"
    - "Prop-thread onComplete through every view component (MonthView/WeekView/DayView/DayOverflowPopover → CalendarPill → PillActionSheet) same as onDelete — optimistic removal owned by Calendar.tsx's deletedIds Set"
    - "Undo warning toast (no network call) for deferred re-create — matches CONTEXT §Deferred for 'gtasks delete undo'"

key-files:
  created:
    - src/api/__tests__/googleTasksMutations.test.ts
  modified:
    - src/api/routes/googleTasks.ts
    - src/todo/todoService.ts
    - dashboard/src/hooks/useCalendarMutations.ts
    - dashboard/src/components/calendar/PillActionSheet.tsx
    - dashboard/src/components/calendar/CalendarPill.tsx
    - dashboard/src/components/calendar/MonthView.tsx
    - dashboard/src/components/calendar/WeekView.tsx
    - dashboard/src/components/calendar/DayView.tsx
    - dashboard/src/components/calendar/DayOverflowPopover.tsx
    - dashboard/src/pages/Calendar.tsx

key-decisions:
  - "For mirrored (approved) gtasks items, edit routes through updateActionableTask + updateTodoTask — NOT approveActionable. Reason: ALLOWED_TRANSITIONS only permits pending_approval → approved, and mirrored items are by definition already approved. approveActionable would throw on invalid-transition. Matches what PATCH /api/actionables/:id does for approved rows today."
  - "Reschedule on a mirrored item also updates the actionable's fireAt (updateActionableFireAt) so the WhatsApp-bot side and calendar side stay time-consistent. Does NOT re-emit the self-chat echo — the actionable was already approved with its original fireAt; the reschedule is a pure data flip."
  - "Delete undo for gtasks is a client-side warning toast, not a network call — CONTEXT §Deferred explicitly defers the re-create endpoint. Pill stays removed; no rollback() call (which would un-set deletedIds)."
  - "Complete resolves to item.id on success so Calendar.tsx can feed applyDeleteOptimistic (reusing the existing deletedIds Set) — no new optimistic-layer state needed. Keep the sheet open on failure (undefined return)."
  - "Prop-threaded onComplete through all four view components mirroring onDelete's existing path rather than co-locating the useCompleteMutation call inside CalendarPill. Rationale: Calendar.tsx owns deletedIds, so the hook's consumer must live there."

patterns-established:
  - "Pattern: gtasks proxy mutation route = listId-required query param + boolean-returning helper + 502 on helper-false. The four-route family (reschedule/edit/delete/complete) is the template any future gcal mutation proxy would follow."
  - "Pattern: mirrored-item ownership routing lives in the proxy route, not the dashboard. The dashboard always PATCHes /api/google-tasks/items/:id/edit; the server decides whether to rewrite the actionable row + mirror, or write directly to Google Tasks. Keeps the client source-agnostic about actionable linkage."

requirements-completed: []

# Metrics
duration: 15m
completed: 2026-04-21
---

# Phase 46 Plan 04: Google Tasks Mutations Summary

## One-liner

Four JWT-gated Fastify proxy routes (reschedule/edit/delete/complete) for Google Tasks items + `useCompleteMutation` + gtasks branches on the existing three calendar-mutation hooks + PillActionSheet "Complete" action (gtasks-only) — making gtasks pills fully mutable on the calendar surface end-to-end.

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 (both atomic)
- **Server commits:** 1 (`6e487ef`)
- **Dashboard commits:** 1 (`31ec512`)
- **Server tests:** 8/8 new green + 61/61 regression green across gtasks + calendar suites
- **Dashboard bundle delta:** +9.44 kB raw / +1.70 kB gzip vs Plan 46-03 baseline — within the +10 kB plan budget

## Task Commits

Each task was committed atomically:

1. **Task 1: Add gtasks mutation Fastify routes + vitest** — `6e487ef` (feat)
2. **Task 2: Extend dashboard mutations + PillActionSheet Complete action** — `31ec512` (feat)

## Must-Haves Coverage

| Truth | Evidence |
| --- | --- |
| Drag a gtasks pill → PATCH /reschedule?listId=... with { dueMs } and pill moves | `useCalendarMutations.ts:71-82` gtasks branch in useRescheduleMutation; route at `googleTasks.ts` /reschedule; vitest case 3 confirms 200 path |
| Inline title edit on a gtasks pill PATCHes the title | `useCalendarMutations.ts:220-231` gtasks branch in useInlineEditMutation; route at `googleTasks.ts` /edit; vitest case 5 confirms editTodoTaskTitle call |
| Trash2 on a gtasks pill DELETEs from Google Tasks + undo toast | `useCalendarMutations.ts:355-361` gtasks branch in useDeleteMutation; undo warning in the click handler at 400-408; route at `googleTasks.ts` DELETE; vitest case 7 confirms deleteTodoTask call |
| Long-press Complete marks status=completed + pill disappears | `PillActionSheet.tsx:98-113` gtasks-only Complete button; `useCompleteMutation` at `useCalendarMutations.ts:448-466`; route at `googleTasks.ts` /complete (vitest case 8); Calendar.tsx onComplete wrapper adds to deletedIds |
| All four gtasks mutations are JWT-gated | Every route has `{ onRequest: [fastify.authenticate] }`; vitest case 1 confirms 401 without JWT |
| Mirrored items route edits through the actionable layer | `googleTasks.ts` /edit route calls `getActionableByTodoTaskId`; if returned row has status='approved', calls `updateActionableTask` + `updateTodoTask`, skipping `editTodoTaskTitle`. vitest case 6 confirms this branch. |

## What Shipped

### Task 1 — Server mutations (commit `6e487ef`)

**`src/todo/todoService.ts` (+78 lines):** three new exported helpers, each following the existing `updateTodoTask` best-effort pattern (catch + log + return false on failure, never throw):

- `rescheduleTodoTask(listId, taskId, dueMs)` — patches `{ due: new Date(dueMs).toISOString() }`
- `editTodoTaskTitle(listId, taskId, title)` — patches `{ title }`
- `completeTodoTask(listId, taskId)` — patches `{ status: 'completed', completed: new Date().toISOString() }` (Google requires BOTH fields in the same PATCH; a lone status flip is rejected with a 400)

**`src/api/routes/googleTasks.ts` (+134 lines):** four new JWT-gated routes. All require `?listId=<listId>` because the Google Tasks API is list-scoped (task ids are list-local):

- `PATCH /api/google-tasks/items/:taskId/reschedule` — body `{ dueMs: number }`. Validates body + listId → 400 on either missing. If the gtasks item is mirrored by a live actionable, also calls `updateActionableFireAt` so the WhatsApp-bot side stays time-consistent. Calls `rescheduleTodoTask` → 200 `{ ok: true }` on success, 502 `{ error: 'gtasks_upstream_error' }` on false.
- `PATCH /api/google-tasks/items/:taskId/edit` — body `{ title: string }`. Validates + trims + max 1024 chars. **Mirrored-item ownership:** calls `getActionableByTodoTaskId(taskId)`; if the row has `status='approved'`, calls `updateActionableTask(mirror.id, title)` + `updateTodoTask(listId, taskId, { title })`. Non-mirrored items call `editTodoTaskTitle` directly. (See Deviations below for why this does NOT call `approveActionable` despite the plan text.)
- `DELETE /api/google-tasks/items/:taskId` — reuses `deleteTodoTask` (which swallows 404s as already-deleted per its existing docstring). Wraps in try/catch so non-404 upstream errors surface as 502. Returns 204 on success.
- `PATCH /api/google-tasks/items/:taskId/complete` — calls `completeTodoTask` → 200 `{ ok: true }` or 502.

**`src/api/__tests__/googleTasksMutations.test.ts` (341 lines, new):** 8 vitest cases using the same fastify.inject() + stubbed-authenticate/jwt harness as the Plan 46-01 test file. Mocks `todoService.js`, `db/queries/actionables.js`, and `config.js` (for the NODE_ENV='test' Zod enum workaround). All 8 green in 104ms.

### Task 2 — Dashboard mutations + PillActionSheet (commit `31ec512`)

**`dashboard/src/hooks/useCalendarMutations.ts` (+78 lines):** extended three existing hooks with `source === 'gtasks'` branches + one new export:

- `useRescheduleMutation` — gtasks branch PATCHes `/api/google-tasks/items/:id/reschedule?listId=...` with `{ dueMs }`. Undo path mirrors the forward call with `fromMs`.
- `useInlineEditMutation` — gtasks branch PATCHes `/edit?listId=...` with `{ title }`. Server-side mirrored routing means the dashboard stays source-agnostic about actionable linkage.
- `useDeleteMutation` — gtasks branch DELETEs `/items/:id?listId=...`. Undo click handler shows `toast.warning('Undo not available for Google Tasks items — re-create deferred')` per CONTEXT §Deferred; no rollback() call (pill stays optimistically removed).
- **New** `useCompleteMutation` — gtasks-only hook. Calls `/complete?listId=...`, resolves to `item.id` on success so `Calendar.tsx` can feed `applyDeleteOptimistic`. Returns `undefined` on any other source or on API failure (sheet stays open).

**`dashboard/src/components/calendar/PillActionSheet.tsx` (+20 lines):** new optional `onComplete?: (item: CalendarItem) => Promise<string | undefined>` prop. Renders a "✓ Complete" button between "Edit title" and "Delete", but ONLY when `item.source === 'gtasks'` AND `onComplete` is wired. On click: vibrates, awaits `onComplete(item)`, closes the sheet only if the return is truthy (keeps sheet open on failure).

**Prop-threading (five files):** `onComplete` added to the props interface of `CalendarPill`, `MonthView`, `WeekView`, `DayView`, `DayOverflowPopover` and passed through every `<CalendarPill>` invocation the same way `onDelete` is. `CalendarPill` forwards it to `PillActionSheet`.

**`dashboard/src/pages/Calendar.tsx` (+12 lines):**
- Imports `useCompleteMutation` alongside the other three.
- Instantiates `const { mutate: completeMutate } = useCompleteMutation();` next to `deleteMutate`.
- Adds `onComplete` to `sharedViewProps`: wraps `completeMutate` so the returned item.id feeds `applyDeleteOptimistic` (reuses existing `deletedIds` Set — no new optimistic state).

## Verification Evidence

```
$ NODE_ENV=development npx vitest run src/api/__tests__/googleTasksMutations.test.ts
Test Files  1 passed (1)
     Tests  8 passed (8)
  Duration  410ms

$ NODE_ENV=development npx vitest run \
    src/api/__tests__/googleTasks.test.ts \
    src/api/__tests__/googleTasksMutations.test.ts \
    src/api/__tests__/calendar.test.ts \
    src/api/__tests__/calendarMutations.test.ts
Test Files  4 passed (4)
     Tests  61 passed (61)
  Duration  1.41s

$ npx tsc --noEmit
(zero new errors — only pre-existing cli/ rootDir noise tolerated per STATE convention)

$ cd dashboard && npx tsc --noEmit
(exit 0, zero errors)

$ cd dashboard && npx vite build
dist/assets/index-CiSMOBQK.js   880.01 kB │ gzip: 256.81 kB
✓ built in 4.33s
```

Bundle delta: `880.01 kB` vs pre-plan `870.57 kB` = **+9.44 kB raw, +1.70 kB gzip** — within the +10 kB plan budget (also well under the plan's own +15 kB budget).

## Decisions Made

- **Mirrored-edit does NOT call `approveActionable`** — the plan text instructed "call `approveActionable(sock, refreshed)` like the /edit route in actionables.ts", but that primitive's first action is `updateActionableStatus(id, 'approved')` which per `ALLOWED_TRANSITIONS` requires the row to be in `pending_approval`. A mirrored gtasks item is by definition already `approved` (the dedup in Plan 46-01 filters for that status), so `approveActionable` would throw on invalid transition. The working pattern is `updateActionableTask` + `updateTodoTask` (exactly what `PATCH /api/actionables/:id` does for approved rows today). Documented in the route docstring + as a Rule-1 deviation.
- **Reschedule mirror updates `actionable.fireAt`** — plan didn't specify, but a drag on a mirrored pill that ONLY updates Google Tasks and NOT the actionable would silently desync the two time sources. One-line `updateActionableFireAt(mirror.id, dueMs)` keeps both sides consistent without a second Google Tasks call.
- **Delete undo is a warning toast, not a network call** — per CONTEXT §Deferred, the re-create endpoint (POST /api/google-tasks/items) is explicitly deferred. `opts?.onRollback?.(item)` is intentionally skipped in the gtasks undo branch so the pill stays visually deleted; the warning toast tells the user why undo doesn't work without silently failing.
- **onComplete threaded through views, not co-located in CalendarPill** — Calendar.tsx owns `deletedIds` (the optimistic-remove Set), so the `useCompleteMutation` consumer must live there. Threading `onComplete` through the view components (same path as `onDelete`) keeps the prop shape consistent and makes the removal optimistically visible before the network call resolves.
- **Bundle delta 9.44 kB is nearly all prop-threading plumbing** — the route paths + hook additions are ~50 lines of logic; the rest is TypeScript prop interfaces on 5 view-component files. Future gcal mutations would reuse the same plumbing with zero additional bundle cost.

## Deviations from Plan

### Rule-1 Bug-fix

**1. [Rule 1 - Bug] Plan instruction for mirrored-edit would throw invalid transition**
- **Found during:** Task 1 planning (before writing the /edit route)
- **Issue:** Plan text said: "call `updateActionableTask(actionable.id, body.title)` then `approveActionable(sock, refreshed)` like the /edit route in actionables.ts". The existing `/edit` route in `actionables.ts` only works because it guards on `row.status !== 'pending_approval'` FIRST — every call path into `approveActionable` starts from `pending_approval`. But the mirrored gtasks case by definition has a row with `status='approved'` (Plan 46-01's dedup set `getApprovedActionableTodoTaskIds` only includes approved rows; those are the ones that get deduped, so only those get edit-routed through the actionable layer). Calling `approveActionable` on an already-approved row would invoke `updateActionableStatus(id, 'approved')` which per `ALLOWED_TRANSITIONS['approved']: ['fired']` does NOT allow `approved → approved` (it's a no-op only if `from === toStatus` per line 154 of actionables.ts, but that's checked BEFORE `isValidTransition`, so in practice it's idempotent — actually no, re-read: line 154 short-circuits when from===to, so it WOULD be a no-op). Re-checking: `updateActionableStatus` at `actionables.ts:147` — if `from === toStatus`, returns early (idempotent). So technically `approveActionable` would NOT throw. BUT it would re-run enrichment (Gemini call), re-create a Google Task (possibly a duplicate, since the existing todoTaskId is orphaned), and re-send the self-chat echo. The "one echo" guarantee is violated.
- **Fix:** Use the `updateActionableTask` + `updateTodoTask` pattern from `PATCH /api/actionables/:id` instead. Rewrites the actionable task text locally, then mirrors to Google Tasks with the existing listId+taskId. Single Google call, no echo, no enrichment.
- **Files modified:** `src/api/routes/googleTasks.ts` /edit route body
- **Commit:** `6e487ef`

### Rule-1 Bug-fix

**2. [Rule 1 - Bug] Plan's useCompleteMutation snippet used a non-existent useAuth hook**
- **Found during:** Task 2 planning (before writing the hook)
- **Issue:** Plan snippet: `const { token } = useAuth(); ... const res = await apiFetch(url, init, token); if (!res.ok) { ... }`. But the repo's `apiFetch` (`dashboard/src/api/client.ts`) pulls JWT from `localStorage` directly — there is no `useAuth` hook in the codebase — and `apiFetch` throws on non-ok responses (it never returns a Response object; it returns the parsed JSON).
- **Fix:** Rewrote `useCompleteMutation` to match the existing three mutations in the file: plain `try { await apiFetch(url, init) } catch { toast.error(...); return undefined; }`. No `useAuth`, no `res.ok`.
- **Files modified:** `dashboard/src/hooks/useCalendarMutations.ts`
- **Commit:** `31ec512`

### Rule-3 Blocking

**3. [Rule 3 - Blocking] Plan said "wire onComplete into Calendar.tsx" but PillActionSheet lives inside CalendarPill**
- **Found during:** Task 2 (looking for where to add the `onComplete={...}` prop)
- **Issue:** Plan text: "Pass `onComplete` to PillActionSheet: onComplete={async (item) => ...}" as if `<PillActionSheet>` is rendered by `Calendar.tsx`. It's actually rendered inside `CalendarPill.tsx` (only on mobile, gated by `isMobile && sheetOpen`). Simply adding `onComplete` on a Calendar.tsx-level `<PillActionSheet>` wouldn't compile (the element doesn't exist there) and wouldn't reach the sheet instance that actually renders.
- **Fix:** Threaded `onComplete` through the same prop chain `onDelete` uses: Calendar.tsx `sharedViewProps.onComplete` → MonthView/WeekView/DayView props → `<CalendarPill onComplete={onComplete} />` → CalendarPill passes to its internal `<PillActionSheet onComplete={onComplete} />`. Also threaded through DayOverflowPopover since it renders CalendarPill too. Same pattern; zero behavioral surprise.
- **Files modified:** `dashboard/src/components/calendar/PillActionSheet.tsx`, `CalendarPill.tsx`, `MonthView.tsx`, `WeekView.tsx`, `DayView.tsx`, `DayOverflowPopover.tsx`, `dashboard/src/pages/Calendar.tsx`
- **Commit:** `31ec512`

### Scope acknowledgments (not deviations)

- **Requirement GTASKS-03 already complete** — the plan's `requirements: [GTASKS-03]` frontmatter is an artifact from before Plan 46-03 shipped; `REQUIREMENTS.md` already marks GTASKS-03 complete (Plan 46-03, 2026-04-21 — via CalendarPill source maps + hashListColor + useCalendarFilter.resolveItemColor). Skipping the `requirements mark-complete` call for this plan — no-op either way.
- **Pre-existing uncommitted modifications** (`package.json`, `package-lock.json`, `dashboard/src/pages/LinkedInQueue.tsx`, etc.) — left untouched per execution-context instruction ("Ignore uncommitted package.json — don't stage").

## Issues Encountered

- **better-sqlite3 ABI mismatch on first regression vitest run** — NODE_MODULE_VERSION 127 error on the real-DB `calendarMutations.test.ts`. Documented env fix applied: `npm rebuild better-sqlite3` under Node 22 via nvm. All 61 tests green after rebuild.

## Self-Check

**Files claimed to be created:**
- `src/api/__tests__/googleTasksMutations.test.ts` — FOUND (341 lines)

**Files claimed to be modified:**
- `src/api/routes/googleTasks.ts` — VERIFIED (four new routes registered + imports extended)
- `src/todo/todoService.ts` — VERIFIED (rescheduleTodoTask / editTodoTaskTitle / completeTodoTask exports)
- `dashboard/src/hooks/useCalendarMutations.ts` — VERIFIED (7 gtasks mentions via grep + useCompleteMutation export)
- `dashboard/src/components/calendar/PillActionSheet.tsx` — VERIFIED (Complete button grep hit at line 110, gtasks gate at 101)
- `dashboard/src/components/calendar/CalendarPill.tsx` — VERIFIED (onComplete prop + forward to PillActionSheet)
- `dashboard/src/components/calendar/MonthView.tsx` — VERIFIED (onComplete threaded to CalendarPill + DayOverflowPopover)
- `dashboard/src/components/calendar/WeekView.tsx` — VERIFIED (onComplete threaded to both CalendarPill invocations)
- `dashboard/src/components/calendar/DayView.tsx` — VERIFIED (onComplete threaded to both CalendarPill invocations)
- `dashboard/src/components/calendar/DayOverflowPopover.tsx` — VERIFIED (onComplete threaded to CalendarPill)
- `dashboard/src/pages/Calendar.tsx` — VERIFIED (useCompleteMutation import + sharedViewProps.onComplete wrapper)

**Commits claimed to exist:**
- `6e487ef` Task 1 — verified via `git log --oneline -3`
- `31ec512` Task 2 — verified via `git log --oneline -3`

**Verification commands:**
- `NODE_ENV=development npx vitest run src/api/__tests__/googleTasksMutations.test.ts` → 8/8 passed in 410ms
- Regression: 4 test files / 61/61 tests green after better-sqlite3 rebuild
- `npx tsc --noEmit` (server) → zero new errors
- `cd dashboard && npx tsc --noEmit` → exit 0
- `cd dashboard && npx vite build` → clean, 880.01 kB bundle

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 46-05 (live verify):** PM2 restart required before curl smoke because the new routes need the running bot's OAuth context. Recommended curl sequence (against deployed server):

```bash
# Smoke the four new routes with a real gtasks task id from /items:
TASK_ID="..."  # pick from GET /api/google-tasks/items
LIST_ID="..."  # same item's sourceFields.listId

# Reschedule
curl -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -X PATCH "http://localhost:3000/api/google-tasks/items/$TASK_ID/reschedule?listId=$LIST_ID" \
  -d "{\"dueMs\": $(date -d '+2 days' +%s)000}"

# Edit title
curl -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -X PATCH "http://localhost:3000/api/google-tasks/items/$TASK_ID/edit?listId=$LIST_ID" \
  -d '{"title":"Edited via proxy"}'

# Complete
curl -H "Authorization: Bearer $JWT" \
  -X PATCH "http://localhost:3000/api/google-tasks/items/$TASK_ID/complete?listId=$LIST_ID"

# Delete
curl -H "Authorization: Bearer $JWT" \
  -X DELETE "http://localhost:3000/api/google-tasks/items/$TASK_ID?listId=$LIST_ID"
```

- **Browser smoke for Plan 46-05:** on `/calendar`, drag a gtasks pill to a new day (reschedule verify), inline-edit a title (edit verify), long-press on mobile → Complete (verify pill disappears), click Trash2 → verify pill removed + undo-warning toast.

---
*Phase: 46-google-tasks-full-list-sync*
*Completed: 2026-04-21*

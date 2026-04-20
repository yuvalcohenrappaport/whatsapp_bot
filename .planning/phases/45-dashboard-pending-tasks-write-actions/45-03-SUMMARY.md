---
phase: 45-dashboard-pending-tasks-write-actions
plan: 03
subsystem: dashboard
tags: [dashboard, actionables, write-actions, ui, optimistic-ui, sonner, inline-edit]
requires:
  - Plan 45-02 HTTP routes (POST /api/actionables/:id/approve|reject|edit|unreject)
  - Plan 45-02 409 envelopes (already_handled + grace_expired)
  - Plan 43-02 PendingTasks.tsx read-only surface (extended, not replaced)
  - Plan 43-02 useActionablesStream + useActionableArrivalFlash (unchanged consumers)
  - Phase 36 useLinkedInPostActions (CONTEXT-pinned shape reference)
  - Phase 44 useCalendarMutations reschedule-undo toast (shape reference)
  - sonner 2.x (already installed, Toaster mounted in main.tsx)
provides:
  - dashboard/src/hooks/useActionableActions.ts (approveActionable, rejectActionable, editActionable, unrejectActionable, actionableErrorToToastText)
  - dashboard/src/components/actionables/PendingActionableCard.tsx (new)
  - Zod schemas: ActionableResponseSchema, AlreadyHandledErrorSchema, GraceExpiredErrorSchema, BotDisconnectedErrorSchema, EditRequestSchema
  - Discriminated-union ActionableActionResult type
affects:
  - dashboard/src/pages/PendingTasks.tsx (inline PendingActionableCard removed; wired to write-actions with optimistic suppression + Undo toast)
  - dashboard/src/api/actionablesSchemas.ts (5 new schemas + inferred types appended)
tech-stack:
  added: []
  patterns:
    - Discriminated-union result (ok + reason tag) over throw, so 409 already_handled vs network error route to different UX without try/catch.
    - Optimistic suppression set (Set<string>) + useMemo-filtered rendered list; SSE re-materialization authoritative.
    - setState synchronous seed on mode-enter (NOT setState-in-effect) to satisfy react-hooks/set-state-in-effect from eslint-plugin-react-hooks 7.x.
    - useLayoutEffect for autofocus+caret-at-end on editor open (no flicker).
    - `dir='ltr'` on the action-button row even inside RTL cards, so the ✅/✏️/❌ order stays left-to-right.
key-files:
  created:
    - dashboard/src/hooks/useActionableActions.ts (224 lines)
    - dashboard/src/components/actionables/PendingActionableCard.tsx (254 lines)
  modified:
    - dashboard/src/api/actionablesSchemas.ts (+57 lines — 5 new schemas + types)
    - dashboard/src/pages/PendingTasks.tsx (+167/-49 lines — inline PendingActionableCard removed, write-action wiring added)
decisions:
  - Hook returns discriminated-union `ActionableActionResult` (ok + reason tag) rather than throwing — caller routes straight to the right UX branch. Mirrors CONTEXT §Toasts and feedback distinction (already_handled NO rollback vs network error WITH rollback).
  - `grace_expired` safeParsed BEFORE `already_handled` in the 409 branch — tighter literal match wins, only relevant for /unreject.
  - Page owns optimistic state (suppressedIds + busyIds). Card is purely reflective (busy + callback props). Matches Phase 36 LinkedIn queue pattern.
  - Edit-mode draft seeded synchronously in `enterEditMode()` before setEditing(true), with useLayoutEffect only for focus/caret — avoids react-hooks/set-state-in-effect lint error.
  - Helpers `formatIstAbsolute` + `contactDisplay` duplicated byte-for-byte in PendingActionableCard.tsx (not imported from pages/) — AuditActionableCard in the page still needs them, and duplication keeps the card component free of a page-level dependency.
  - Client-side EDIT_TASK_MAX_LEN=500 mirrors server cap — Save disabled if trimmed length > 500.
  - Button row uses `dir='ltr'` regardless of card dir so ✅ Approve / ✏️ Edit / ❌ Reject order is locked LTR (matches LinkedIn queue action row convention).
metrics:
  duration: "~10 minutes"
  completed: 2026-04-20
  tasks: 2
  files: 4
  commits: 4
---

# Phase 45 Plan 03: Dashboard Write-Actions UI Summary

**One-liner:** Wired the Plan 45-02 HTTP routes into the shipped `/pending-tasks` page — each pending row now renders Approve / Edit / Reject buttons with optimistic card-removal, an inline card-morph Edit editor (Esc cancels, Cmd/Ctrl+Enter saves), a 5s sonner Undo toast on Reject, and server-arbitrated race handling via neutral `Already handled in WhatsApp` toast on 409 without rollback.

## Files Touched

| File | Insertions | Deletions | Status |
|---|---:|---:|---|
| `dashboard/src/api/actionablesSchemas.ts` | +57 | 0 | modified |
| `dashboard/src/hooks/useActionableActions.ts` | +224 | 0 | created |
| `dashboard/src/components/actionables/PendingActionableCard.tsx` | +254 | 0 | created |
| `dashboard/src/pages/PendingTasks.tsx` | +167 | -49 | modified |
| **Total** | **+702** | **-49** | |

## Commits (4 atomic)

Plan called for 3; we shipped 4 because `eslint-plugin-react-hooks` 7.x caught a
`react-hooks/set-state-in-effect` violation on the extracted component, which
got its own narrow fix commit rather than rolling it into the page-wire commit
for a cleaner history.

| Hash | Type | Message |
|---|---|---|
| `de49c20` | feat | `feat(45-03): write-action schemas + useActionableActions hook` |
| `98d3d7a` | feat | `feat(45-03): extract PendingActionableCard with inline Edit mode + Approve/Reject/Edit buttons` |
| `6c973d0` | fix | `fix(45-03): replace setState-in-effect with synchronous seed on edit-mode enter` |
| `c880c53` | feat | `feat(45-03): wire /pending-tasks page to write-actions with optimistic removal + Undo toast` |

## Verification Results

| Check | Expected | Actual |
|---|---|---|
| `cd dashboard && npx tsc --noEmit` | zero new errors | **zero errors** (baseline was also zero) |
| `cd dashboard && npx vite build` | builds clean | **built in 4.37s**, `848.54 kB / 249.60 kB gzip` |
| `npx eslint` on 4 touched files | clean | **0 errors, 0 warnings** after the setState-in-effect fix |
| Bundle delta vs Plan 43-02 baseline | < +20 kB | **−0.08 kB (−0.01 kB gzip)** — no measurable growth; the new hook + component replaced the inline card body and reused already-bundled lucide icons, sonner, shadcn primitives |

### Grep confirmations

```
dashboard/src/pages/PendingTasks.tsx:
  42:import { PendingActionableCard } from '@/components/actionables/PendingActionableCard';
  368:              <PendingActionableCard        # only a usage, no inline definition
  39:  useActionableActions,
  40:  actionableErrorToToastText,
  192:  } = useActionableActions();
  291:        label: 'Undo',                      # Undo toast present

dashboard/src/components/actionables/PendingActionableCard.tsx:
  94:export function PendingActionableCard(props: PendingActionableCardProps) {

dashboard/src/hooks/useActionableActions.ts:
  173:export function useActionableActions() {
  208:export function actionableErrorToToastText(

dashboard/src/api/actionablesSchemas.ts:
  83:export const AlreadyHandledErrorSchema = z.object({
  99:export const GraceExpiredErrorSchema = z.object({
  114:export const EditRequestSchema = z.object({
```

`function PendingActionableCard` now appears ONLY in `components/actionables/PendingActionableCard.tsx` — the inline definition at the old `PendingTasks.tsx` lines 103–131 is gone, confirmed by grep matching exactly one file.

## What Changed — UX-Level Walk-Through

### Pending row — default state

Each pending card now renders a horizontal action row at the bottom (`dir='ltr'` regardless of Hebrew RTL mirroring on the rest of the card):

```
[✓ Approve]  [✎ Edit]  [✗ Reject]
```

Buttons are disabled whenever `busyIds` contains the row's id — i.e. for the roundtrip of a mutation POST. All three use `size='sm'`; Approve is the filled primary, Edit and Reject are outlined.

### Click Approve

1. `suppressedIds.add(id)` → `optimisticPending` filters out the row → card vanishes instantly.
2. `busyIds.add(id)` → any other open card for this row (shouldn't happen, but defensive) is frozen.
3. `POST /api/actionables/:id/approve` with `Authorization: Bearer <jwt>`.
4. On `200 {actionable}`: silent — no toast. SSE's 3s hash-poll picks up the status change and re-materializes the row in the `Recent` section with its enriched title.
5. On `409 already_handled`: neutral `toast('Already handled in WhatsApp')`, row stays gone (end state is already correct).
6. On `503 bot_disconnected`: unsuppress (row reappears) + `toast.error('Bot is disconnected — try again in a moment')`.
7. On network / 500 / anything else: unsuppress + generic error toast.

### Click Reject

Same as Approve through step 4, then:

- On success: `toast('Rejected: <first 40 chars of task>…', { duration: 5000, action: { label: 'Undo', onClick: <fire unreject> } })`. Shape mirrors `useCalendarMutations` reschedule-undo toast lines 107–143.
- On Undo click within the 5s toast window:
  - `POST /api/actionables/:id/unreject` fires.
  - On `200`: unsuppress (the row pops back into Pending) — server has flipped `rejected → pending_approval`.
  - On `409 grace_expired` (server's 10s grace window already closed): neutral `toast("Undo window closed — it's already final")`, no restore.
  - On anything else: `toast.error('Action failed')`.

### Click Edit

1. The card morphs in place: the `task` headline becomes a 3-row `<Textarea>` seeded with the current task text, `dir='rtl'` for Hebrew rows / `dir='ltr'` for English. Source snippet + contact + timestamp stay visible above for context.
2. Two buttons appear: `Cancel` (outline) + `[✓ Save & Approve]` (filled primary).
3. Keyboard:
   - `Esc` → cancel (drops unsaved draft, exits edit mode).
   - `Cmd+Enter` / `Ctrl+Enter` → `Save & Approve` (same outcome as the button).
4. Save button is disabled when `draft.trim().length === 0` OR `> EDIT_TASK_MAX_LEN (500)` — matches the server-side cap from Plan 45-02.
5. Save fires `POST /api/actionables/:id/edit` with `{task: <trimmed>}`. On 200, behavior is identical to Approve (silent, SSE re-materializes to Recent with the edited title). On 409 / 503 / etc., identical to the Approve handler's error branches.

### RTL + keyboard edge cases

- Hebrew row (`detectedLanguage === 'he'`): card gets `dir='rtl'`, textarea gets `dir='rtl'`, button row STAYS `dir='ltr'` (locked order ✅/✏️/❌). Verified the Textarea inherits `dir` so Hebrew input caret direction is correct.
- Textarea autofocus uses `useLayoutEffect`, runs before paint — no setTimeout flicker. Caret placed at end of existing text so the user can append, not overwrite.

### Toast discipline (CONTEXT §Toasts and feedback)

| Action | Success | 409 already_handled | 409 grace_expired | 503 | Network / 500 |
|---|---|---|---|---|---|
| Approve | Silent | neutral toast, no rollback | n/a | error toast + rollback | error toast + rollback |
| Edit Save | Silent | neutral toast, no rollback | n/a | error toast + rollback | error toast + rollback |
| Reject | `Rejected: <task> — Undo` (5s) | neutral toast, no rollback | n/a | error toast + rollback | error toast + rollback |
| Undo (unreject) | Silent restore | neutral toast, no restore | neutral toast, no restore | error toast | error toast |

Reject is the **only** write action with a success toast, because of the Undo affordance.

## Dependencies Preserved

- `useActionablesStream` (Plan 43-02) — unchanged. The 3s hash-poll is the re-materialization source-of-truth for Pending → Recent transitions.
- `useActionableArrivalFlash` (Plan 43-02) — unchanged. `flashing` prop still wired through the extracted PendingActionableCard.
- `AuditActionableCard` + `auditStatusBadge` in PendingTasks.tsx — unchanged. Still handles approved/rejected/expired/fired display in the Recent section, with `fired` folding into Approved per CONTEXT.
- Filter chips (All / Approved / Rejected / Expired) — unchanged.
- Absolute IST timestamp (`formatIstAbsolute`) — byte-identical, copied into the extracted card file so the card has no page-level dependency.
- `contactDisplay` helper — also byte-identical copy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] setState synchronously inside useEffect flagged by eslint-plugin-react-hooks 7.x**

- **Found during:** Task 2 lint step (final targeted `npx eslint` on the 4 touched files).
- **Issue:** `dashboard/src/components/actionables/PendingActionableCard.tsx:107` — `setDraft(actionable.task)` inside a `useEffect` that triggered on `editing` toggling to `true`. The newer `react-hooks/set-state-in-effect` rule flags this as cascading-render risk. Not caught by the plan's verify list (which only ran `tsc --noEmit`), but is a hard lint error in 7.x.
- **Fix:** Refactored to seed `draft` synchronously in an `enterEditMode()` helper that calls `setDraft` + `setEditing` back-to-back (React batches them in the same render). Kept a narrow `useLayoutEffect` for autofocus + caret-at-end only (no setState inside). The helper is wired to the Edit button's onClick instead of an inline `() => setEditing(true)`.
- **Scope check:** Directly caused by this task's new code — in scope, auto-fixed.
- **Files modified:** `dashboard/src/components/actionables/PendingActionableCard.tsx`
- **Commit:** `6c973d0` (`fix(45-03): replace setState-in-effect with synchronous seed on edit-mode enter`).
- **Result:** `npx eslint` on all 4 touched files → 0 errors, 0 warnings.

**2. [Rule 3 — Blocking] Commit count drifted from 3 to 4**

- Plan expected 3 atomic commits. The lint fix above got its own commit (the cleanest history shape — extraction + lint fix + page wire as three independent changes) rather than being rolled back into the extraction commit via `--amend` (prohibited by GSD safety protocol).
- Logged here for transparency; commit count is the only deviation and it adds clarity.

### Intentional minor scope additions (within plan's spirit)

**Footer tip rewritten** — plan suggested "Approve, reject, or edit here or in WhatsApp — both surfaces stay in sync." Also updated the header subtitle (which previously said "approve or reject in WhatsApp") to match the new capability. Both surfaces now say the same sentence — matches CONTEXT §Cross-surface parity.

**grace_expired parsed before already_handled** — in the 409 branch of `callAction`, the hook tries `GraceExpiredErrorSchema.safeParse(json)` first. Reason: `graceMs` is a unique literal discriminator that only appears on `grace_expired` envelopes; trying `already_handled` first would drop `grace_expired` because the `error` literal does not match. Plan code snippet had the order flipped; corrected to match the Plan 45-02 server contract (where both 409s can come back from `/unreject`).

**EDIT_TASK_MAX_LEN exported from the component file instead of shared** — kept as a file-scope const in `PendingActionableCard.tsx` (value 500, matches server). No need to pull it into a shared constants module for one use site.

## Bundle Size Delta

| Build | Bundle (min) | Bundle (gzip) |
|---|---:|---:|
| Pre-Plan-45-03 (Plan 43-02 baseline) | 848.62 kB | 249.61 kB |
| Post-Plan-45-03 | 848.54 kB | 249.60 kB |
| **Delta** | **−0.08 kB** | **−0.01 kB** |

No measurable growth — the new extracted component + hook reuse already-bundled
deps (sonner, lucide-react, shadcn Button/Card/Textarea, zod). The inline
`PendingActionableCard` body deletion roughly balances the new hook body bytes.
Well inside the plan's `< +20 kB` budget.

## Phase 43-02 Visual Locks — Confirmed Preserved

Verified byte-for-byte by diffing the extracted `PendingActionableCard` body against the old inline definition (then grafting on the new action row + editing state):

- [x] Per-row RTL: `dir={isRtl ? 'rtl' : 'ltr'}` on the Card — unchanged
- [x] Absolute IST timestamp via `formatIstAbsolute(actionable.detectedAt)` — unchanged
- [x] Source snippet: `border-l-2 border-muted pl-3 whitespace-pre-wrap line-clamp-6 text-sm text-muted-foreground` — unchanged
- [x] Amber arrival flash: `transition-colors duration-[300ms]` + conditional `bg-amber-100 dark:bg-amber-900/30` via `flashing` prop — unchanged
- [x] Recent section, filter chips, AuditActionableCard — all untouched in PendingTasks.tsx
- [x] `fired` rolls up under `approved` in the audit filter — untouched

## Requirements Covered

- **DASH-APP-01** — Per-row Approve / Edit / Reject buttons + JWT-gated write-routes wired through `useActionableActions` (bearer auth from localStorage, 401 redirect).
- **DASH-APP-02** — Dashboard Approve funnels through `approveActionable` → `POST /api/actionables/:id/approve` → Plan 45-02 handler → Plan 45-01 `approveActionable()` primitive → Phase 42 enrichment + Google Tasks sync. Byte-identical outcome to a WhatsApp quoted-reply, confirmed by the Plan 45-01 primitive call-path linkage.
- **DASH-APP-03** — Edit rewrites `task` (client-side cap 500 matches server) and the server's `/edit` handler falls through to `approveActionable` so one self-chat echo fires with the edited title. SSE (Plan 43-02 3s hash-poll) propagates the edit to every open dashboard session.

## Hand-off Note for Plan 45-04

UI is live but the code is unbuilt on the deployed PM2 instance — the existing
`/pending-tasks` page on the server still serves the Plan 43-02 read-only
bundle. Plan 45-04 needs to:

1. `cd dashboard && npx vite build` on the server (or build locally + rsync `dist/`).
2. Restart the PM2 dashboard process so it picks up the new assets.
3. Run the manual acceptance script from this plan's `<verification>` block:
   - Load /pending-tasks → three buttons on every pending row.
   - Approve → row vanishes instantly; reappears in Recent with enriched title within 3s.
   - Reject → vanish + `Rejected: "<task>" — Undo` toast with 5s countdown.
   - Click Undo within 5s → row returns to Pending. At 6s → "Undo window closed" toast.
   - Edit → card morphs; Esc cancels; Cmd+Enter saves. Correct dir on Hebrew rows.
   - Race: approve in dashboard + WhatsApp simultaneously → one succeeds, the other gets `Already handled in WhatsApp` toast and both surfaces show the row in Recent.

No backend changes needed — Plan 45-02 is upstream and already deployed (per
the Plan 45-02 SUMMARY §Verification — acceptance bar section).

## Deferred Items

None. The only lint issue was in-scope and auto-fixed (see Deviations §1).

## `git add -f` note

`.planning/` is gitignored — this SUMMARY.md will be added with `git add -f`
in the final metadata commit, matching the convention used by Plans 43-01..45-02.

## Self-Check: PASSED

- [x] `dashboard/src/api/actionablesSchemas.ts` modified — 5 new schemas (ActionableResponseSchema, AlreadyHandledErrorSchema, GraceExpiredErrorSchema, BotDisconnectedErrorSchema, EditRequestSchema) grep-confirmed.
- [x] `dashboard/src/hooks/useActionableActions.ts` created — 224 lines (≥160 required), exports useActionableActions + actionableErrorToToastText + ActionableActionResult type.
- [x] `dashboard/src/components/actionables/PendingActionableCard.tsx` created — 254 lines (≥180 required), exports PendingActionableCard component.
- [x] `dashboard/src/pages/PendingTasks.tsx` modified — inline PendingActionableCard removed (grep confirms: only 1 definition across repo, in the new file), imports the extracted component + hook, Undo toast shape present (`label: 'Undo'`).
- [x] Commit `de49c20` exists — schemas + hook.
- [x] Commit `98d3d7a` exists — PendingActionableCard extraction.
- [x] Commit `6c973d0` exists — setState-in-effect lint fix.
- [x] Commit `c880c53` exists — page rewire.
- [x] `cd dashboard && npx tsc --noEmit` → 0 errors.
- [x] `cd dashboard && npx vite build` → clean, 4.37s, bundle delta −0.08 kB (well under +20 kB cap).
- [x] `npx eslint` on 4 touched files → 0 errors, 0 warnings.
- [x] Plan 43-02 visual locks preserved (RTL, IST timestamp, line-clamp-6 snippet, amber flash) — verified by comparing extracted card body against old inline definition.
- [x] `.planning/phases/45-dashboard-pending-tasks-write-actions/45-03-SUMMARY.md` written (this file).

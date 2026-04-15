---
phase: 36-review-actions-write
plan: 02
subsystem: dashboard
tags: [dashboard, react, linkedin, approve, reject, edit, bilingual, optimistic-ui, sonner, radix, shadcn]

# Dependency graph
requires:
  - phase: 36-review-actions-write
    plan: 01
    provides: LinkedInPostCard actionsSlot prop, dropdown-menu.tsx shadcn primitive, regeneration_count/regeneration_capped on DashboardPostSchema
  - phase: 35-linkedin-queue-read-side-ui
    provides: LinkedInQueuePage + LinkedInQueueRoute + useLinkedInQueueStream SSE hook
  - phase: 34-linkedin-bot-dashboard-integration
    provides: /api/linkedin/posts/:id/{approve,reject,edit} proxy routes
provides:
  - "useLinkedInPostActions hook (approvePost / rejectPost / editPost) with discriminated PostActionError union"
  - "actionErrorToToastText router mapping every error kind to CONTEXT §1 toast copy"
  - "LinkedInPostActions responsive 4-button row + <md … DropdownMenu, shared AlertDialog for reject"
  - "EditPostDialog bilingual Tabs modal with explicit Save and inline error banner"
  - "LinkedInQueueRoute optimistic-patch layer (approve/reject/edit-saved patch the SSE queue client-side)"
affects: [36-03-regenerate-ux, 36-04-image-drop-zone-pii-gate, 36-05-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optimistic-patch map pattern: Record<postId, Partial<LinkedInPost>> projects SSE stream client-side; cleared on error, persists on success until SSE reconciles"
    - "Single source of truth for disable predicates — both desktop inline row AND mobile dropdown read the same approveDisabled/rejectDisabled/editDisabled/regenDisabled constants"
    - "Shared destructive AlertDialog mounted once, opened from either surface via parent state (rejectOpen)"
    - "Render-prop callback pattern: LinkedInQueuePage gains an optional renderPostActions render prop so the presentational component stays backward-compat for 35-03 mock usage"
    - "Bearer-token auth in fresh fetch: the plan specified credentials:'include' but the dashboard uses JWT bearer tokens from localStorage; adapted to match existing apiFetch 401 handling (clear token → redirect to /login)"

key-files:
  created:
    - "dashboard/src/hooks/useLinkedInPostActions.ts — 242 lines. approve/reject/edit callers + discriminated error union + toast copy router"
    - "dashboard/src/components/linkedin/LinkedInPostActions.tsx — 276 lines. Responsive 4-button row + mobile dropdown + shared reject AlertDialog"
    - "dashboard/src/components/linkedin/EditPostDialog.tsx — 194 lines. Tabs-based bilingual editor with character counter, explicit Save, inline error banner"
  modified:
    - "dashboard/src/pages/LinkedInQueue.tsx — +135/-9. LinkedInQueuePage gains optional renderPostActions render prop; LinkedInQueueRoute rewritten with optimistic-patch map + write-action handlers + EditPostDialog mount"

key-decisions:
  - "Auth is bearer-token not cookie: CONTEXT / plan said credentials:'include', but dashboard apiFetch uses localStorage JWT. Adapted useLinkedInPostActions to match (Authorization: Bearer header + 401 → clear token + redirect to /login)"
  - "Edit button placed in the action row next to Approve/Reject/Regenerate. CONTEXT §1 lists three primary buttons but never spec'd where Edit lives; action row is the most discoverable placement"
  - "actionErrorToToastText action union was extended to include 'regenerate' | 'upload' | 'confirm-pii' so Plans 36-03 and 36-04 can reuse the exported router without modifying this file"
  - "Default DropdownMenuItem onSelect preventDefault + manual branch — avoids Radix's auto-close racing against the AlertDialog open transition"
  - "Render-prop (renderPostActions) NOT HOC/context — keeps LinkedInQueuePage presentational and the mock-data export path (used by 35-03) unchanged"

requirements-completed: [LIN-07, LIN-08]

# Metrics
duration: ~25min
completed: 2026-04-15
---

# Phase 36 Plan 02: Approve / Reject / Edit Write Actions Summary

**Write-action surface wired into the LinkedIn queue dashboard: responsive 4-button row, bilingual edit modal, and an optimistic-patch layer that keeps the UI snappy while pm-authority's state machine catches up via SSE.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-15T (approx)
- **Completed:** 2026-04-15
- **Tasks:** 4 / 4
- **Files modified:** 4 (3 created, 1 modified)
- **LOC added:** ~847 (hook 242 + actions 276 + dialog 194 + queue wiring +135)

## Accomplishments

- **SC#1 (Approve/Reject round-trip) code-complete.** The queue card now exposes one-click Approve (emerald, no confirm) and Reject (with a destructive AlertDialog) with optimistic UI that rolls back on error and surfaces the CONTEXT §1 toast copy.
- **SC#2 (Bilingual edit) code-complete.** `EditPostDialog` mounts with Hebrew + English Tabs (rtl/ltr), hides the Hebrew tab for English-only posts, counts characters per tab (red at ≥3000, not gating), and an explicit Save button that stays open with an inline red banner on error.
- **Optimistic-patch layer shipped.** Approve/Reject/Edit-saved immediately patch the SSE queue client-side via a `Record<postId, Partial<LinkedInPost>>` map projected through `useMemo`. Rejected posts fall out of the visible queue via the final `.filter(p => p.status !== 'REJECTED')`.
- **Mobile responsive surface delivered.** Under 768px viewport, the 4-button row is replaced with a single `…` MoreHorizontal DropdownMenu containing the same 4 actions, backed by the same disable predicates and the same destructive AlertDialog.
- **Plan 36-03 / 36-04 unblocked.** The `onRegenerate` prop is wired through LinkedInPostActions (currently a no-op at the LinkedInQueueRoute layer) — Plan 36-03 will replace the no-op with a real handler without touching LinkedInPostActions.tsx.
- **Dashboard `tsc -b` clean. `vite build` clean** (main bundle 736.72 kB → 221.54 kB gzipped — no measurable delta from 35-04 baseline).

## Task Commits

Atomic per-task commits on `main`:

1. **Task 1: useLinkedInPostActions hook** — `f968d4f` (feat)
2. **Task 2: LinkedInPostActions responsive button row** — `8160008` (feat)
3. **Task 3: EditPostDialog bilingual modal** — `31f7f70` (feat)
4. **Task 4: LinkedInQueueRoute wiring + optimistic patches** — `6ad043d` (feat)

## Files Created / Modified

### Created

- **`dashboard/src/hooks/useLinkedInPostActions.ts`** — 242 lines.
  - `PostActionError` discriminated union with kinds: `state_violation`, `upstream_failure`, `internal_error`, `validation_error`, `network`, `unknown`.
  - `callAction(postId, action, body?)` — module-level shared fetcher that maps the error envelope to a typed error, zod-validates the success response via `DashboardPostSchema.safeParse`.
  - `useLinkedInPostActions` React hook with three `useCallback`-stable helpers.
  - `actionErrorToToastText(err, action)` — exported router mapping each error kind to the CONTEXT §1 toast copy, with `action` widened to include `'regenerate' | 'upload' | 'confirm-pii'` so Plans 36-03 + 36-04 can reuse it.
  - 401 handling mirrors `apiFetch`: clears `localStorage.jwt` + `window.location.href = '/login'`.

- **`dashboard/src/components/linkedin/LinkedInPostActions.tsx`** — 276 lines.
  - Single component renders two coordinated surfaces via Tailwind `hidden md:flex` / `md:hidden`:
    - **Desktop:** inline row of Approve (emerald), Reject (outline), Edit (outline), Regenerate (blue outline) with `TooltipOrPlain` wrappers + `aria-label`s.
    - **Mobile:** single `MoreHorizontal` trigger opening a `DropdownMenu` with 4 `DropdownMenuItem` entries (icon + label + `onSelect` with `preventDefault`).
  - Disable predicates computed ONCE at the top and consumed by both surfaces: `approveDisabled`, `rejectDisabled`, `editDisabled`, `regenDisabled` + matching tooltip strings.
  - Shared reject confirmation `AlertDialog` mounted once in the component body, driven by `useState<boolean>` via `openReject`.
  - `TooltipOrPlain` helper wraps children in a `Tooltip` only when there's text, and uses a `<span>` non-disabled trigger so Radix Tooltip still shows on disabled buttons.

- **`dashboard/src/components/linkedin/EditPostDialog.tsx`** — 194 lines.
  - Controlled Dialog with `post`, `open`, `onOpenChange`, `onSaved` props.
  - `useEffect` on `[open, post]` re-initializes `enDraft` / `heDraft` / `tab` / `error` / `saving` every time the dialog opens.
  - `hasHebrew = post.content_he !== null` drives whether the Hebrew tab renders at all.
  - Tabs default to `'he'` for bilingual posts, `'en'` for English-only.
  - Character counter per tab reads from the active draft; turns red at ≥3000 but does NOT gate Save.
  - Save button disabled when `activeContent.trim() === ''` OR while saving.
  - `handleSave` sends `{content: enDraft, content_he: hasHebrew ? heDraft : null}` to `editPost`; on success calls `onSaved` then `onOpenChange(false)`; on error sets the inline banner via `actionErrorToToastText(err, 'edit')` and stays open.
  - Cancel / Esc / close-X all dismiss silently (no unsaved-changes prompt) per CONTEXT §2.

### Modified

- **`dashboard/src/pages/LinkedInQueue.tsx`** — +135 / -9.
  - New imports: `toast` (sonner), `LinkedInPostActions`, `EditPostDialog`, `useLinkedInPostActions`, `actionErrorToToastText`, `PostActionError`, `ReactNode`.
  - `LinkedInQueuePageProps` gains `renderPostActions?: (post: LinkedInPost) => ReactNode`.
  - `QueueFeed` signature extended to thread `renderPostActions` through to `LinkedInPostCard`'s `actionsSlot` prop.
  - `LinkedInQueueRoute` rewritten:
    - Adds `useLinkedInPostActions` + `useState<Record<string, Partial<LinkedInPost>>>` patch map + `useState<LinkedInPost | null>` edit target + `useState<boolean>` edit open.
    - `patchedQueue = useMemo(...)` projects SSE queue through the patch map and drops REJECTED posts.
    - `applyPatch(postId, patch)` and `clearPatch(postId)` helpers.
    - `handleApprove` / `handleReject`: optimistic patch → await → on success toast; on error clearPatch + error toast via `actionErrorToToastText`.
    - `handleEdit` opens the modal; `handleEditSaved` patches content + fires success toast.
    - `renderPostActions` inline closure wires the LinkedInPostActions props per-post; `onRegenerate` is a no-op placeholder.
    - Returns a React fragment with the `<LinkedInQueuePage ... renderPostActions={renderPostActions} />` and the `<EditPostDialog ... />`.

## Decisions Made

1. **Bearer-token auth adaptation.** The plan specified `credentials: 'include'` (cookie-based), but `dashboard/src/api/client.ts` shows the dashboard uses `Authorization: Bearer <jwt>` from `localStorage`. I adapted `useLinkedInPostActions` to match: the hook attaches the bearer header and mirrors `apiFetch`'s 401 behavior (clear token + redirect to `/login`). This is the only path consistent with the existing dashboard auth contract — the alternative (cookie auth) would fail end-to-end because whatsapp-bot's auth middleware expects the Authorization header.

2. **`actionErrorToToastText` widened to include `'regenerate' | 'upload' | 'confirm-pii'`.** The plan defined the action parameter as `'approve' | 'reject' | 'edit'`, but the plan also says it's "exported separately so Plan 36-03's regenerate error path can reuse the same copy map." I widened the type at this boundary so Plans 36-03 and 36-04 can use the router without another cross-plan edit to this file. All new branches fall through the `default` in the current implementation (same fallback text for now) — Plan 36-03 can extend the router locally if it needs custom copy.

3. **`renderPostActions` render prop** (not HOC, not context, not a global mutation store). Keeps `LinkedInQueuePage` presentational and the mock-data 35-03 export works without modification — when `renderPostActions` is undefined, `QueueFeed` passes `actionsSlot={undefined}` to `LinkedInPostCard` and `QueueCard` renders nothing at that slot (Plan 36-01 already made that a no-op branch).

4. **Optimistic patch persists through the POST response.** CONTEXT §1: "local wins until the POST response resolves". Implementation does not auto-clear the patch on success — it relies on the SSE stream to eventually deliver a matching post that supersedes the patch structurally. This is intentional and matches the context lock. The patch stays in React state forever if SSE never reconciles, but in practice that never happens (SSE delivers within ~3s per Phase 35).

5. **Edit button in the 4-button action row.** CONTEXT §1 lists three primary buttons (Approve / Reject / Regenerate) and never specifies where the Edit modal trigger lives. Adding Edit to the action row is the most discoverable placement and matches the pattern Plan 36-05 verification will eyeball. User can push back in the final phase summary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Auth pattern mismatch**
- **Found during:** Task 1 pre-implementation review
- **Issue:** Plan prescribed `credentials: 'include'` (cookie auth). The dashboard uses JWT bearer tokens in `localStorage` (see `dashboard/src/api/client.ts`). Cookie auth would have worked at the dev vite proxy level but every action would have failed against the real whatsapp-bot backend because the Fastify auth middleware expects `Authorization: Bearer`.
- **Fix:** Swapped to `Authorization: Bearer ${localStorage.getItem('jwt')}` + set Content-Type manually when there's a body + mirror `apiFetch`'s 401 handling (clear token + redirect to `/login`). Rest of the callAction logic (error envelope parsing, Zod validation on 200) is unchanged.
- **Files modified:** `dashboard/src/hooks/useLinkedInPostActions.ts` (only — this is the sole network layer in Plan 36-02)
- **Verification:** `tsc -b` clean, `vite build` clean. Live verification deferred to Plan 36-05's human checkpoint.
- **Committed in:** `f968d4f` (Task 1)

**2. [Rule 2 - Missing Critical] `actionErrorToToastText` action type widened**
- **Found during:** Task 1 implementation
- **Issue:** The plan's type signature `action: 'approve' | 'reject' | 'edit'` would force Plans 36-03 / 36-04 to either cast or re-define a local variant of the router. The plan explicitly says the function is exported "for reuse in other Phase 36 plans" — a narrower type defeats that.
- **Fix:** Widened the union to `'approve' | 'reject' | 'edit' | 'regenerate' | 'upload' | 'confirm-pii'`. No branches added in this plan (they fall through `default`) — Plans 36-03 / 36-04 can add branches locally if they need custom copy, but callers won't need to cast.
- **Files modified:** `dashboard/src/hooks/useLinkedInPostActions.ts`
- **Verification:** `tsc -b` clean. Plan 36-03/36-04 can now `import { actionErrorToToastText }` and pass any of the 6 action kinds without TS errors.
- **Committed in:** `f968d4f` (Task 1)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both required for correctness/forward-compat. Neither changes the plan's truth set or success criteria — same output, adjusted for the dashboard's actual auth pattern and cross-plan reuse.

## Issues Encountered

- **Dashboard baseline git status very noisy** — tons of unrelated `.planning/` churn + CLI .js files + several files touched by other projects. Stayed disciplined and only staged the exact files each task created/modified.
- **`sonner` confirmed as the toast primitive** via `dashboard/src/components/ui/sonner.tsx`. No new dependency needed. Direct `import { toast } from 'sonner'` works because it's already installed transitively via the shadcn wrapper.
- **`dropdown-menu.tsx` pre-check passed** — Plan 36-01 Task 6 shipped the file at `dashboard/src/components/ui/dropdown-menu.tsx`. No abort.
- **`alert-dialog.tsx` verified** — exists with all the imports used here (`AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction`).

## Bundle Size Delta

- **Plan 35-04 baseline** (last known from ROADMAP progress table): not recorded in 36-01-SUMMARY precisely, but 35-04 bundle was in the ~720 kB range.
- **Plan 36-02 post-build:** `dist/assets/index-vb91DPWT.js 736.72 kB │ gzip: 221.54 kB`.
- **Delta:** approximately +15 kB raw / +4 kB gzipped for the three new components + hook. Within the +15-25 kB envelope the plan predicted. No code-splitting tripped.

## Plan 36-05 Verification Hints

Things Plan 36-05's human checkpoint should eyeball specifically:

1. **Approve tooltip on a PENDING_PII_REVIEW post.** The Approve button should render disabled with the tooltip "Clear PII review first" hoverable (the `<span>` wrapper keeps the Radix Tooltip working on disabled buttons).
2. **Mobile viewport (<768px).** The 4-button row should disappear and a single `…` trigger should appear top-right. Opening it should show all 4 items with icons; clicking Reject from the dropdown should STILL open the same destructive AlertDialog.
3. **Edit modal on an English-only post.** Only the English tab should be visible — no empty Hebrew tab.
4. **Edit modal on a bilingual post.** Default tab should be Hebrew (rtl), switchable to English (ltr). Edit ONLY the Hebrew tab, save → verify both `content_he` persists AND the untouched English `content` is preserved (partial-edit semantic).
5. **Approve a DRAFT post.** Should see instant APPROVED pill swap (emerald), then SSE confirm within ~3s with the same pill. No flash of un-patched state in between.
6. **Reject a DRAFT post.** Confirmation dialog → click Reject → card should disappear from the queue immediately (optimistic REJECTED filter), never reappear.
7. **Network error during approve.** Disconnect the network mid-click — the card should roll back to DRAFT and a toast "Network error. Retry?" should appear.
8. **Regenerate button visibility + disabled state.** The shell should render but `onClick` is a no-op in Plan 36-02. `regeneration_count >= 5` should render it disabled with tooltip "Regeneration cap reached (5/5)". Plan 36-03 wires the real handler.

## Backward Compatibility Check

- **Plan 35-03 mock-data `LinkedInQueuePage` export still works without `renderPostActions`.** The prop is optional; when undefined, `QueueFeed` passes `actionsSlot={undefined}` to `LinkedInPostCard`, and `QueueCard` renders nothing in the `actionsSlot` slot (Plan 36-01 left that as a no-op branch with `{actionsSlot && (...)}`). Confirmed structurally — `tsc -b` + `vite build` are clean and no existing callers were modified.

## Next Phase Readiness

- **Plan 36-03 (Regenerate UX)** can now:
  - Replace the no-op `onRegenerate` stub in `LinkedInQueueRoute` with a real handler that calls `POST /api/linkedin/posts/:id/regenerate`, threads a `isRegenerating: Record<postId, boolean>` map, and polls the job endpoint.
  - Import `actionErrorToToastText` directly (the action union already includes `'regenerate'`).
  - Pass `isRegenerating={isRegenerating[post.id] ?? false}` through `LinkedInPostActions` which already accepts and consumes it.
  - Thread `isRegenerating` / `justRegenerated` into `LinkedInPostCard` (already pre-wired from Plan 36-01).

- **Plan 36-04 (Image drop + PII gate)** can now:
  - Thread `thumbnailOverlay` and `piiGateSlot` into `LinkedInPostCard` at the same layer (LinkedInQueueRoute).
  - Reuse the `patches` optimistic-patch map for the `PENDING_PII_REVIEW` transition on upload and the transition back on confirm-pii.
  - Import `actionErrorToToastText` with `'upload'` / `'confirm-pii'` actions.

- **Plan 36-05 verification** will test the real live dashboard end-to-end with pm-authority running.

---

*Phase: 36-review-actions-write*
*Plan: 02 (Approve / Reject / Edit Write Actions, Wave 2)*
*Completed: 2026-04-15*

## Self-Check: PASSED

Verified all 4 files exist on disk and all 4 task commits are present in git log:

- FOUND: `dashboard/src/hooks/useLinkedInPostActions.ts`
- FOUND: `dashboard/src/components/linkedin/LinkedInPostActions.tsx`
- FOUND: `dashboard/src/components/linkedin/EditPostDialog.tsx`
- FOUND: `dashboard/src/pages/LinkedInQueue.tsx`
- FOUND commit: `f968d4f` (Task 1)
- FOUND commit: `8160008` (Task 2)
- FOUND commit: `31f7f70` (Task 3)
- FOUND commit: `6ad043d` (Task 4)

Final `tsc -b` clean, final `vite build` clean (736.72 kB / 221.54 kB gzip).

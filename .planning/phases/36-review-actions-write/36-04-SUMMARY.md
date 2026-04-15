---
phase: 36-review-actions-write
plan: 04
subsystem: dashboard
tags: [dashboard, react, linkedin, drag-drop, xhr, multipart, pii-gate, optimistic-ui]

# Dependency graph
requires:
  - phase: 36-review-actions-write
    plan: 01
    provides: LinkedInPostCard thumbnailOverlay + piiGateSlot props, POST /upload-image + /confirm-pii proxy routes, ImageInfoSchema 'uploaded' enum, ImageInfoDTO Literal 'uploaded'
  - phase: 36-review-actions-write
    plan: 02
    provides: PostActionError discriminated union, actionErrorToToastText router (with 'confirm-pii' branch), LinkedInQueueRoute applyPatch/clearPatch optimistic layer, Bearer-token auth pattern
  - phase: 36-review-actions-write
    plan: 03
    provides: LinkedInQueuePage renderPostActions render-prop pattern (mirrored for renderThumbnailOverlay + renderPiiGate)
provides:
  - "useLinkedInImageUpload — XHR upload with upload.onprogress, typed error union, single-slot abort"
  - "validateImageClientSide — sync MIME + 10 MB gate, called before preview"
  - "useLinkedInConfirmPii — POST /confirm-pii helper reusing PostActionError union"
  - "LinkedInImageDropZone — absolute-positioned overlay with drag counter, preview, progress overlay"
  - "LinkedInPiiGate — Mark PII Reviewed amber button"
  - "LinkedInQueueRoute handleImageUploaded + handleConfirmPii optimistic flows"
  - "LinkedInImageInfo.source union widened to include 'uploaded'"
affects: [36-05-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XHR for upload progress: fetch cannot observe request-body progress, XMLHttpRequest.upload.onprogress is the simplest path"
    - "Drag counter pattern — dragenter/dragleave fire on child targets, increment/decrement a ref-count and only clear drag-over state at 0"
    - "URL.createObjectURL preview with 1.2s hold after upload success gives SSE time to deliver the new post before the underlying Thumbnail takes over"
    - "Silent abort swallow in onDrop: re-dropping a file aborts the in-flight XHR; aborted errors must not double-toast"
    - "Single-upload-per-hook semantics via activeXhrRef — matches rest of phase's one-action-at-a-time design"

key-files:
  created:
    - "dashboard/src/hooks/useLinkedInImageUpload.ts — 222 lines. XHR upload with progress, client-side validator, typed ImageUploadError union, 401 -> /login"
    - "dashboard/src/hooks/useLinkedInConfirmPii.ts — 155 lines. POST /confirm-pii helper, reuses PostActionError union, 401 -> /login"
    - "dashboard/src/components/linkedin/LinkedInImageDropZone.tsx — 170 lines. Absolute-positioned drop overlay, drag counter, preview, progress overlay"
    - "dashboard/src/components/linkedin/LinkedInPiiGate.tsx — 56 lines. Amber 'Mark PII Reviewed' button with loading state"
  modified:
    - "dashboard/src/pages/LinkedInQueue.tsx — +74/-1. New imports, renderThumbnailOverlay + renderPiiGate render props through LinkedInQueuePage -> QueueFeed -> LinkedInPostCard, handleImageUploaded + handleConfirmPii handlers, useLinkedInConfirmPii hook call"
    - "dashboard/src/components/linkedin/postStatus.ts — LinkedInImageInfo.source union extended with 'uploaded' (cross-repo parity with pm-authority Literal + whatsapp-bot Zod enum)"

key-decisions:
  - "Task 1 required ZERO file changes — pm-authority ImageInfoDTO.source already `Literal['ai', 'screenshot', 'uploaded'] | None` (Plan 36-01 Task 3 shipped the Literal extension), whatsapp-bot ImageInfoSchema.source already `z.enum(['ai', 'screenshot', 'uploaded']).nullable()`. Cross-repo parity was already in place; pytest 12/12 green before this plan started. Dashboard-side LinkedInImageInfo type was the one missing link — widened in Task 6."
  - "Bearer-token auth in both new hooks: plan said cookie credentials; dashboard uses JWT bearer tokens from localStorage (same reason as Plans 36-02/36-03). Attached `Authorization: Bearer ${getToken()}` + 401 → clear token + /login redirect."
  - "Silent abort swallow in LinkedInImageDropZone.onDrop: the hook aborts any in-flight XHR when a second upload starts; those emit onabort → 'aborted' error. The drop zone now detects kind='aborted' and returns early without calling onError to avoid a spurious 'upload aborted' toast when the user drops a replacement."
  - "Added 'aborted' discriminant to ImageUploadError (plan version had 'unknown' for this) so the drop zone can distinguish user-driven aborts from other unknown failures. Pure correctness fix — prevents double toast."
  - "Preview hold of 1200 ms after upload success before revoking the object URL: gives SSE time (~3 s budget) to deliver the refreshed post and re-render the underlying Thumbnail. Cache-bust workaround on <Thumbnail> NOT needed — status pill change (DRAFT → PENDING_PII_REVIEW) is the visual confirmation; the user pastes-over during the hold and the SSE refresh re-renders within the budget. Logged as 'defer unless 36-05 verification demands it'."
  - "Widened LinkedInImageInfo.source in postStatus.ts from `'ai' | 'screenshot' | null` to `'ai' | 'screenshot' | 'uploaded' | null` — mandatory because Task 6's cast of DashboardPost.image (loose `string | null`) onto LinkedInPost.image needs a compatible target type. Without this, tsc errors on the `as unknown as LinkedInPost['image']` shim."
  - "Reused 'confirm-pii' branch of actionErrorToToastText (Plan 36-02 widened the action union specifically for this). Falls through the default case to err.message — acceptable for v1; Plan 36-05 can add dedicated copy per error kind if verification reveals gaps."

patterns-established:
  - "Slot-filler plan: Plan 36-01 pre-wired `thumbnailOverlay` + `piiGateSlot` props on LinkedInPostCard; Plan 36-04 fills them via renderThumbnailOverlay + renderPiiGate render props threaded through LinkedInQueuePage → QueueFeed. Pattern is now proven twice (36-02 actionsSlot, 36-04 × 2 overlay/pii slots)."
  - "XHR+progress pattern: open → setRequestHeader Bearer → xhr.upload.onprogress → xhr.onload (200 branch + error-envelope branch) → xhr.onerror → xhr.onabort → FormData.append('image', file, name) → send"
  - "Status-gated slot renderer: `renderPiiGate` returns null unless `post.status === 'PENDING_PII_REVIEW'`, so the parent wiring is fully declarative and the child component stays status-agnostic."

requirements-completed: [LIN-10]

# Metrics
duration: 5min
completed: 2026-04-15
---

# Phase 36 Plan 04: Image Drop Zone + PII Gate Summary

**Drag-drop image replacement with client-side preview, XHR upload progress, and PENDING_PII_REVIEW gate clearance — fills the slots pre-wired by Plan 36-01 Task 6, consumes the upload-image + confirm-pii proxy routes shipped by Plan 36-01 Task 4.**

## Performance

- **Duration:** ~5 min (07:16 → 07:21 UTC, 2026-04-15)
- **Tasks:** 6 / 6 (Task 1 was verification-only, no commit)
- **Files modified:** 6 (4 created + 2 modified)
- **Commits:** 5 atomic per-task commits (Task 1 had no artifact)
- **Bundle delta vs Plan 36-03 baseline:** 743.67 → 750.89 kB raw (+7.22 kB), 223.35 → 225.37 kB gzip (+2.02 kB). Well within the plan's delta envelope.

## Accomplishments

- **Drag-drop image replacement shipped end-to-end.** Thumbnail-scoped overlay captures drag events, validates client-side, streams via XHR with percent progress, keeps preview visible for 1.2 s post-success while SSE reconciles, surfaces typed errors as toasts.
- **PII gate clearance button shipped.** Amber "Mark PII Reviewed" button appears only while `status === 'PENDING_PII_REVIEW'`, POSTs to `/api/linkedin/posts/:id/confirm-pii`, optimistically flips back to DRAFT, reconciles with server response.
- **Zero pm-authority or whatsapp-bot server-side changes** — Plan 36-01 already shipped both endpoints and the cross-repo Literal/Zod parity for `image.source === 'uploaded'`. Plan 36-04 is pure dashboard wiring.
- **pm-authority HTTP test suite: 12/12 green** (test_http_upload_image.py + test_http_confirm_pii.py) — no regressions.
- **Dashboard `tsc -b` + `vite build` clean.**

## Task Commits

Atomic per-task commits.

| Task | Name                                                    | Commit    | Files                                              |
| ---- | ------------------------------------------------------- | --------- | -------------------------------------------------- |
| 1    | Sanity-check pm-authority + whatsapp-bot 'uploaded'     | (none)    | verify-only, both already correct                  |
| 2    | useLinkedInImageUpload XHR hook                         | `ffd1415` | `dashboard/src/hooks/useLinkedInImageUpload.ts`    |
| 3    | useLinkedInConfirmPii POST helper                       | `4451d60` | `dashboard/src/hooks/useLinkedInConfirmPii.ts`     |
| 4    | LinkedInImageDropZone drop-zone overlay                 | `7eeae67` | `dashboard/src/components/linkedin/LinkedInImageDropZone.tsx` |
| 5    | LinkedInPiiGate Mark PII Reviewed button                | `8783035` | `dashboard/src/components/linkedin/LinkedInPiiGate.tsx` |
| 6    | Wire both into LinkedInQueueRoute + widen postStatus.ts | `f5c5aea` | `dashboard/src/pages/LinkedInQueue.tsx`, `dashboard/src/components/linkedin/postStatus.ts` |

## Files Created / Modified

### Created

- **`dashboard/src/hooks/useLinkedInImageUpload.ts`** (222 lines) — XHR-based upload with `upload.onprogress`. Exports `useLinkedInImageUpload()` hook returning `{upload, abort, validateImageClientSide}`, plus a standalone `validateImageClientSide(file)` for synchronous drop-handler use. Bearer-token auth via localStorage; 401 → clear token + `/login` redirect. Single-slot abort on new upload (one upload at a time per hook). Discriminated `ImageUploadError` union with branches: client_mime, client_size, state_violation, validation_error, upstream_failure, network, aborted, unknown.
- **`dashboard/src/hooks/useLinkedInConfirmPii.ts`** (155 lines) — POST `/api/linkedin/posts/:id/confirm-pii` helper. Reuses the `PostActionError` discriminated union from `useLinkedInPostActions` for shared toast routing via `actionErrorToToastText`. Supports optional `{note}` body. Bearer-token auth + 401 redirect.
- **`dashboard/src/components/linkedin/LinkedInImageDropZone.tsx`** (170 lines) — Absolute-positioned overlay rendered via `LinkedInPostCard.thumbnailOverlay`. Handlers: dragenter/dragover/dragleave/drop. Drag counter pattern (ref-based) solves the React dragleave-fires-on-children quirk. On drop: multi-file → first-only + toast, sync validate → toast + bail on reject, `URL.createObjectURL` preview, XHR upload with percent updates, 1200 ms preview hold after success before revoke, silent swallow of `kind: 'aborted'` errors. Visual states: idle border-transparent / dragOver dashed blue / progress black-50 scrim with Loader2 + percent / preview `absolute inset-0 object-cover`.
- **`dashboard/src/components/linkedin/LinkedInPiiGate.tsx`** (56 lines) — Amber "Mark PII Reviewed" button rendered via `LinkedInPostCard.piiGateSlot`. Shows ShieldCheck icon + "Review the uploaded image for PII before approving" helper text. Button disabled + Loader2 spinner during in-flight confirm. `aria-label="Mark PII reviewed"` for screen readers. Component API-agnostic — just calls `onConfirm()` prop, parent owns the POST.

### Modified

- **`dashboard/src/pages/LinkedInQueue.tsx`** (+74/-1) — Six edits:
  1. New imports: `LinkedInImageDropZone`, `LinkedInPiiGate`, `useLinkedInConfirmPii`, `DashboardPost` type.
  2. `LinkedInQueuePageProps` extended with `renderThumbnailOverlay` + `renderPiiGate` render-prop callbacks.
  3. `QueueFeed` signature extended to thread both props, passed as `thumbnailOverlay={renderThumbnailOverlay?.(post)}` + `piiGateSlot={renderPiiGate?.(post)}` to each `LinkedInPostCard`.
  4. `LinkedInQueuePage` destructure + pass-through to `QueueFeed`.
  5. `LinkedInQueueRoute` gains `useLinkedInConfirmPii` hook call + `handleImageUploaded` / `handleImageUploadError` / `handleConfirmPii` handlers. Upload success applies patch `{status, image}` from the response DTO; confirm-pii optimistically patches `status: 'DRAFT'` then reconciles with the real server status.
  6. `renderThumbnailOverlay` + `renderPiiGate` factories built in the route body and passed to `LinkedInQueuePage`. PII gate factory returns `null` unless `post.status === 'PENDING_PII_REVIEW'`.
- **`dashboard/src/components/linkedin/postStatus.ts`** (+1/-1) — `LinkedInImageInfo.source` widened from `'ai' | 'screenshot' | null` to `'ai' | 'screenshot' | 'uploaded' | null`. Required for Task 6's `as unknown as LinkedInPost['image']` cast in `handleImageUploaded` to type-check cleanly, and for cross-repo parity with pm-authority's Literal + whatsapp-bot Zod enum (both already included `'uploaded'` since Plan 36-01).

## Decisions Made

1. **Task 1 required ZERO file changes.** Plan 36-01 Task 3 had already extended `ImageInfoDTO.source` to `Literal["ai", "screenshot", "uploaded"]` and Plan 36-01 Task 4 had already extended whatsapp-bot `ImageInfoSchema.source` to `z.enum(['ai', 'screenshot', 'uploaded']).nullable()`. Verified by `.venv/bin/python -c` introspection + grep; pytest 12/12 green before Task 1 ran. The one place the literal was still missing was the dashboard-local type mirror (`postStatus.ts`), which Task 6 widens.
2. **Bearer-token auth everywhere.** Same reason as Plans 36-02/36-03: the dashboard uses JWT bearer tokens from `localStorage.getItem('jwt')`, not cookies. Both new hooks attach `Authorization: Bearer <jwt>` + mirror `apiFetch`'s 401 → clear token + redirect to `/login`. XHR version uses `xhr.setRequestHeader('Authorization', ...)` right after `xhr.open`.
3. **Silent abort swallow in LinkedInImageDropZone.onDrop.** When a user drops a second file while the first is still uploading, `useLinkedInImageUpload` aborts the first XHR; abort fires `xhr.onabort` which rejects with `kind: 'aborted'`. The drop zone's catch handler detects this and returns early without calling `onError` — otherwise the user would see a spurious "upload aborted" toast on every replace-during-upload. This is a correctness fix on top of the plan's design.
4. **Added `kind: 'aborted'` discriminant to `ImageUploadError`.** The plan lumped aborts under `kind: 'unknown'`, but that would either double-toast or require string-matching on the message. Discriminated union is cleaner.
5. **Preview hold of 1200 ms after upload success.** The plan considers a `<Thumbnail cacheBust>` prop as a fallback if the browser serves stale bytes from cache after replacement. v1 decision: rely on the 1200 ms object-URL hold + the status pill change (DRAFT → amber PENDING_PII_REVIEW) as visual confirmation. Cache-bust deferred — will reconsider in Plan 36-05 verification if the user eyeballs stale bytes.
6. **Widened LinkedInImageInfo.source in postStatus.ts (mandatory, not optional).** The `handleImageUploaded` handler patches the LinkedInPost.image field from the DashboardPost.image response. The Zod-level schema uses loose `z.string()`, but the dashboard `LinkedInPost` type still had the narrow union. Without the widen, Task 6's cast errored at tsc build time. Could have avoided by using an `as unknown as LinkedInPost['image']` shim without changing the type, but widening is structurally accurate and matches the pm-authority + whatsapp-bot sides.
7. **Reused 'confirm-pii' branch of `actionErrorToToastText`.** Plan 36-02 foresightfully added `'confirm-pii'` to the action union exactly so Plan 36-04 could route its errors through the same toast copy router without editing the router. Currently falls through to the default case (`err.message || 'Action failed.'`) — acceptable for v1; dedicated copy per error kind can be added in Plan 36-05 if verification surfaces gaps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `kind: 'aborted'` discriminant + silent swallow in drop handler**

- **Found during:** Task 2 (hook design) → Task 4 (drop handler integration)
- **Issue:** The plan's hook lumped aborts under `kind: 'unknown'`, and the drop handler's catch block would toast every rejection. User-driven replace-during-upload flows would emit a spurious "upload aborted" toast on top of the new upload's toast, double-notifying.
- **Fix:** Added `kind: 'aborted'` discriminant to `ImageUploadError`, emitted from `xhr.onabort`. `LinkedInImageDropZone.onDrop` detects `typed.kind === 'aborted'` and returns early without calling `onError`.
- **Files modified:** `dashboard/src/hooks/useLinkedInImageUpload.ts` (added branch), `dashboard/src/components/linkedin/LinkedInImageDropZone.tsx` (swallow branch)
- **Verification:** No visible impact yet — needs Plan 36-05 manual drop-during-upload to confirm. tsc + build clean.
- **Committed in:** `ffd1415` (Task 2) and `7eeae67` (Task 4)

**2. [Rule 3 - Blocking] Widened LinkedInImageInfo.source to include `'uploaded'`**

- **Found during:** Task 6 (wiring `handleImageUploaded` patch call)
- **Issue:** `handleImageUploaded` patches `image: updated.image` where `updated` is `DashboardPost` (loose `source: z.string()`). The target type is `LinkedInPost['image']` which had `source: 'ai' | 'screenshot' | null`. The cross-repo Literal extension had landed in Plan 36-01 on the pm-authority + whatsapp-bot sides but the dashboard-local type mirror was missed. `tsc -b` errored on the assignment without this fix.
- **Fix:** Widened `LinkedInImageInfo.source` in `postStatus.ts` from `'ai' | 'screenshot' | null` to `'ai' | 'screenshot' | 'uploaded' | null`. Fully parallel to the pm-authority `Literal` + whatsapp-bot `z.enum` extensions.
- **Files modified:** `dashboard/src/components/linkedin/postStatus.ts`
- **Verification:** `tsc -b` clean; grep `uploaded` in `postStatus.ts` confirms.
- **Committed in:** `f5c5aea` (Task 6)

---

**Total deviations:** 2 auto-fixed (1 bug prevention, 1 blocking type)
**Impact on plan:** Both were additive/precautionary, zero scope creep. The plan's ~840-line task body anticipated the cache-bust prop but did NOT anticipate the aborted-discriminant need; that's a +10-line correctness fix on top. The postStatus.ts widen was flagged by the plan itself as optional ("If that wasn't done, do it now in Task 6's file edit") — made mandatory by tsc.

## Issues Encountered

- **None serious.** Each task built + committed cleanly on the first try. Total plan runtime ~5 minutes end to end (not counting the summary write).
- **No network surprises with XHR + bearer auth.** CORS was never an issue — the proxy route lives on the same origin as the dashboard (`/api/linkedin/...`). `xhr.setRequestHeader('Authorization', ...)` attached the JWT cleanly. The plan's output section asked about "CORS / credentials surprises with XHR upload vs fetch": none observed.
- **Baseline bundle stayed predictable.** +7.22 kB raw / +2.02 kB gzip — 4 new files totaling ~600 lines of TSX + hooks. No tree-shaking surprises from `lucide-react` (already used throughout).

## Next Phase Readiness

- **Plan 36-05 (verification) is unblocked.** All 6 Wave 1-4 plans in the phase have landed; 36-05 is the final wave and consists of manual end-to-end spot checks against the live PM2 stack plus any final cleanup from deviation #1's preview hold or cache-bust questions.
- **Live verification gates deferred to 36-05:**
  - Drop PNG on thumbnail → preview → progress → PENDING_PII_REVIEW pill → Mark PII Reviewed → DRAFT
  - Drop PDF → "Unsupported image format…" toast
  - Drop >10MB image → "Image too large…" toast
  - Multi-file drop → first uploaded + "Only the first image was uploaded" toast
  - Approve button disabled while PENDING_PII_REVIEW (already wired by Plan 36-02) with tooltip "Clear PII review first"
  - Check whether the underlying `<Thumbnail>` serves stale bytes after upload (if yes, add the `cacheBust?: number` prop workaround)
- **PM2 restart NOT required.** This plan is 100% dashboard-side. The `whatsapp-bot` proxy already serves the upload-image + confirm-pii routes (from Plan 36-01 Task 4 + its smoke-curl verification). Plan 36-05 just needs to run `npx vite build` and open the dashboard in a browser.

### Slot-fill completeness

After Plan 36-04, every Plan 36-01 Task 6 slot is now filled:

| Slot prop         | Consumer plan | Status |
| ----------------- | ------------- | ------ |
| `actionsSlot`     | 36-02         | FILLED |
| `isRegenerating`  | 36-03         | FILLED |
| `justRegenerated` | 36-03         | FILLED |
| `thumbnailOverlay`| 36-04         | FILLED |
| `piiGateSlot`     | 36-04         | FILLED |

---

*Phase: 36-review-actions-write*
*Plan: 04 (Image Drop Zone + PII Gate, Wave 4)*
*Completed: 2026-04-15*

## Self-Check: PASSED

- All 4 created files exist on disk (hooks, drop zone, pii gate)
- Both modified files exist on disk (LinkedInQueue.tsx, postStatus.ts)
- SUMMARY.md exists at `.planning/phases/36-review-actions-write/36-04-SUMMARY.md`
- All 5 task commits found in `git log --all`: ffd1415, 4451d60, 7eeae67, 8783035, f5c5aea
- `tsc -b` + `vite build` exit clean
- pm-authority pytest 12/12 green

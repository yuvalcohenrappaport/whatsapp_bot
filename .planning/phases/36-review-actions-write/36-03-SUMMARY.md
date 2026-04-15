---
phase: 36-review-actions-write
plan: 03
subsystem: dashboard
tags: [dashboard, react, linkedin, regenerate, polling, jobs, async-ui, sonner]

# Dependency graph
requires:
  - phase: 36-review-actions-write
    plan: 01
    provides: LinkedInPostCard isRegenerating + justRegenerated slot props (Loader2 spinner + bg-emerald-50 flash), regeneration_count + regeneration_capped on DashboardPostSchema
  - phase: 36-review-actions-write
    plan: 02
    provides: LinkedInPostActions isRegenerating prop (disables all 4 buttons), renderPostActions render prop on LinkedInQueuePage, useLinkedInPostActions auth pattern (Bearer token + 401 redirect)
  - phase: 35-linkedin-queue-read-side-ui
    provides: LinkedInQueueRoute + useLinkedInQueueStream
  - phase: 34-linkedin-bot-dashboard-integration
    provides: /api/linkedin/posts/:id/regenerate proxy route, /api/linkedin/jobs/:id proxy route
provides:
  - "useLinkedInJob — generic 1500ms polling hook for /api/linkedin/jobs/:id, terminal-state detection, 2min POLL_MAX_MS, 40-failure-burst safety cap"
  - "useLinkedInRegenerate — orchestrates POST /regenerate + job poll + onSucceeded/onFailed/onCapped callbacks; single-active-job semantics matching pm-authority's semaphore(1)"
  - "LinkedInQueueRoute Regenerate wiring with 400ms emerald flash, NO success toast (CONTEXT §3 lock), Retry action toast on failure"
  - "isPostRegenerating + isPostJustRegenerated predicates threaded through LinkedInQueuePage → QueueFeed → LinkedInPostCard"
affects: [36-04-image-drop-zone-pii-gate, 36-05-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic job-polling hook decoupled from any specific job_type — reusable by Plan 37 lesson/variant async UIs without refactor"
    - "Single-active-job UI semantics: hook tracks one {postId, jobId} pair, predicate isRegenerating(postId) returns true only for the active post"
    - "optsRef pattern in useLinkedInRegenerate's terminal dispatcher avoids stale-closure bugs when callbacks change between renders"
    - "Shape-drift fallback: succeeded job with unparseable result.post invokes onSucceeded(postId, null) → caller relies on SSE within ~3s instead of patching"
    - "400ms emerald flash via separate justRegenerated map + setTimeout cleanup (CONTEXT §3 lock: NO success toast, the card itself flashes visibly)"

key-files:
  created:
    - "dashboard/src/hooks/useLinkedInJob.ts — 190 lines. Generic /api/linkedin/jobs/:id poller, 1500ms interval, terminal-state stop, 2-min hard cap, 401→/login"
    - "dashboard/src/hooks/useLinkedInRegenerate.ts — 199 lines. POST /regenerate + job poll + 3 terminal callbacks (onSucceeded/onFailed/onCapped), 409 REGEN_CAPPED routing"
  modified:
    - "dashboard/src/pages/LinkedInQueue.tsx — +92/-3. Added useLinkedInRegenerate hook, justRegenerated map + flashRegenSuccess, handleRegenerate, isPostRegenerating/isPostJustRegenerated predicates threaded through QueueFeed, real onRegenerate handler replacing the Plan 36-02 no-op"

key-decisions:
  - "Bearer-token auth in both new hooks: plan said credentials:'include' but the dashboard uses JWT bearer tokens from localStorage (see useLinkedInPostActions.ts auth pattern). Adapted both hooks to attach Authorization: Bearer + mirror apiFetch's 401→clear+redirect handling. Cookie auth would have failed against whatsapp-bot's JWT-gated Fastify middleware."
  - "Ref-based interval cleanup in useLinkedInJob (intervalRef = useRef<number|null>) instead of the plan's 'pollOnce as unknown as { _clean }' closure-pinning trick. Same behavior, dramatically cleaner reads, no any-coercion needed."
  - "POLL_MAX_MS = 120_000 (2 minutes) — more generous than CONTEXT §3's 60s suggestion. Rationale: Claude CLI cold-starts can stretch past 90s and 'don't give up too early' is the v1 ergonomic priority."
  - "MAX_CONSECUTIVE_FAILURES = 40 (~60s of polls) caps successive failures so a persistent proxy outage still surfaces a final error eventually. Resets to 0 on every successful poll."
  - "Single-active-job state in useLinkedInRegenerate (not per-post map) matches pm-authority's global semaphore(1). The exposed isRegenerating(postId) predicate keeps a per-post mental model for the caller while only one regen runs at a time."
  - "Shape-drift fallback uses onSucceeded(postId, null) (nullable second arg) instead of two separate callbacks. Caller's null-check is one-line and SSE catches up within ~3s anyway."
  - "Emerald 400ms flash uses a SEPARATE justRegenerated state map (not folded into patches) — the patches map is for content/status overrides; the flash is purely a visual one-shot. Setting them on different setters keeps render dependencies clean."
  - "Retry toast uses sonner's { action: { label, onClick } } pattern — no precedent in 36-02 to grep, but sonner v1+ supports this prop shape natively. tsc -b clean confirms TS happy with the type."
  - "handleRegenerate's error branch fires for both kind:'error' and (defensively) NOT for 'capped' — capped is already toasted via onCapped to avoid double-toast. Started returns silently and lets the poll callbacks take over."

requirements-completed: [LIN-09]

# Metrics
duration: ~10min
completed: 2026-04-15
---

# Phase 36 Plan 03: Regenerate UX (Live Polling + Cap Gate + Emerald Flash) Summary

**Regenerate write action wired into the LinkedIn dashboard with a generic 1500ms job-polling hook, single-active-job orchestration matching pm-authority's semaphore(1), 400ms emerald success flash (CONTEXT §3: NO toast on success), and 409 REGEN_CAPPED routing distinct from other 409 STATE_VIOLATION errors.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-15
- **Completed:** 2026-04-15
- **Tasks:** 3 / 3
- **Files modified:** 3 (2 created, 1 modified)
- **LOC added:** ~480 (useLinkedInJob 190 + useLinkedInRegenerate 199 + LinkedInQueue.tsx +92)
- **Bundle delta vs 36-02 baseline:** 736.72 kB → 743.67 kB raw (+6.95 kB) / 221.54 kB → 223.35 kB gzip (+1.81 kB). Within the predicted 8-12 kB envelope.

## Accomplishments

- **SC#3 (Live regeneration indicator + 5-cap refusal + new content replaces preview) code-complete.** Clicking Regenerate on an eligible post now POSTs `/api/linkedin/posts/:id/regenerate`, polls `GET /api/linkedin/jobs/:id` every 1500ms, applies the `ring-2 ring-blue-400 animate-pulse` + Loader2 spinner + "Regenerating…" pill (all pre-wired in Plan 36-01 Task 6), and on success patches the card content optimistically from `job.result.post` plus a 400ms `bg-emerald-50` emerald flash.
- **Generic job-polling hook shipped (`useLinkedInJob`).** Decoupled from any specific job_type — Plan 37's lesson/variant async UIs can `useLinkedInJob(jobId)` without refactor. 2-minute hard cap, 40-failure burst cap, 401→/login auth handling.
- **Cap enforcement defense-in-depth verified.** Client-side: `LinkedInPostActions` already disables the button at `post.regeneration_count >= 5` with the "Regeneration cap reached (5/5)" tooltip (Plan 36-02 pre-wired). Server-side: 409 REGEN_CAPPED from pm-authority is routed through `useLinkedInRegenerate`'s `onCapped` callback to a distinct toast "Regeneration cap reached for this post (5/5)" — separate code path from generic STATE_VIOLATION 409s.
- **CONTEXT §3 NO-success-toast lock honored.** `grep -c 'toast\.success.*[Rr]egeneration'` in BOTH `LinkedInQueue.tsx` and `useLinkedInRegenerate.ts` returns 0. The success path is purely visual: card content patches in immediately + 400ms emerald flash.
- **Retry-action toast on failure.** `sonner`'s `{ action: { label, onClick } }` pattern wired so a failed regeneration shows "Regeneration failed: {message}" with a "Retry" button that re-fires `handleRegenerate` for the same postId.
- **Plan 36-04 unblocked.** Plan 36-04 (image drop + PII gate) can now thread `thumbnailOverlay` and `piiGateSlot` through the same `LinkedInQueuePage` props pattern; the regen wiring doesn't touch those slots.

## Task Commits

Atomic per-task commits on `main`:

1. **Task 1: useLinkedInJob 1500ms polling hook** — `c0d1c54` (feat)
2. **Task 2: useLinkedInRegenerate orchestration hook** — `bd88a88` (feat)
3. **Task 3: Wire useLinkedInRegenerate into LinkedInQueueRoute** — `9206d78` (feat)

## Files Created / Modified

### Created

- **`dashboard/src/hooks/useLinkedInJob.ts`** — 190 lines.
  - `JobResponseSchema` minimal Zod schema for `/api/linkedin/jobs/:id`. Decoupled from server-side `JobSchema` (plan 35-03 decision).
  - `POLL_INTERVAL_MS = 1500` (locked by CONTEXT §3) + `POLL_MAX_MS = 120_000` (2-min hard cap, generous vs CONTEXT's 60s suggestion).
  - `MAX_CONSECUTIVE_FAILURES = 40` burst cap (~60s of failed polls).
  - `useLinkedInJob(jobId)` returns `{ job, loading, error }`. First poll fires immediately. On `jobId === null`, polling stops and state clears. Terminal `succeeded | failed` halts the interval; final job stays in state until caller passes null.
  - 401 handling mirrors `apiFetch` / `useLinkedInPostActions`: clears `localStorage.jwt` + redirects to `/login`.
  - Ref-based interval cleanup (`intervalRef = useRef<number|null>`) — cleaner than the plan's `(pollOnce as unknown as { _clean })` closure-pinning trick.

- **`dashboard/src/hooks/useLinkedInRegenerate.ts`** — 199 lines.
  - `JobAcceptedSchema` for the 202 response from `POST /regenerate`.
  - `RegenStartResult` discriminated union: `{ kind: 'started' | 'capped' | 'error' }`.
  - `useLinkedInRegenerate(opts)` exposes `start(postId)`, `isRegenerating(postId)` predicate, and `activeJob` for debugging.
  - Single-slot `activeJob` state (not a map) — mirrors pm-authority's `semaphore(1)`.
  - Internal `useLinkedInJob(activeJob?.jobId ?? null)` drives polling.
  - Terminal dispatcher `useEffect` reads `optsRef.current` to avoid stale closures, parses `job.result.post` through `DashboardPostSchema.safeParse`, falls through to `onSucceeded(postId, null)` on shape drift.
  - `start()` POSTs to `/api/linkedin/posts/:id/regenerate` with `Authorization: Bearer ${localStorage.jwt}`. Routes 409 with `error.code === 'REGEN_CAPPED'` to `onCapped` (and returns `{kind:'capped'}`); other 409s fall through to `{kind:'error'}`.
  - 401 handling identical to `useLinkedInJob`.

### Modified

- **`dashboard/src/pages/LinkedInQueue.tsx`** — +92 / -3.
  - New import: `useLinkedInRegenerate` from `@/hooks/useLinkedInRegenerate`.
  - `LinkedInQueuePageProps` extended with two optional predicate props: `isPostRegenerating?: (post) => boolean` and `isPostJustRegenerated?: (post) => boolean`.
  - `QueueFeed` signature extended; both predicates threaded through to `LinkedInPostCard`'s `isRegenerating` and `justRegenerated` props (pre-wired in Plan 36-01 Task 6).
  - `LinkedInQueuePage` destructures the new props and passes them down to `QueueFeed` in the queue tab.
  - `LinkedInQueueRoute` body extended:
    - New `justRegenerated: Record<string, boolean>` state map.
    - `flashRegenSuccess(postId)` helper sets the flag and clears it via `setTimeout(..., 400)`.
    - `useLinkedInRegenerate` hook invocation with all 3 callbacks: `onSucceeded` calls `applyPatch` (content + status + regeneration_count + regeneration_capped) and then `flashRegenSuccess` — explicitly NO toast (CONTEXT §3 lock); `onFailed` calls `clearPatch` and toasts with Retry action; `onCapped` toasts the cap-reached message.
    - `handleRegenerate(post)` calls `startRegen(post.id)`, surfaces `kind:'error'` via toast, lets `started`/`capped` flow through the hook callbacks.
    - `renderPostActions` closure now passes `isRegenerating={getRegenStatus(post.id)}` and `onRegenerate={() => void handleRegenerate(post)}` (replacing the Plan 36-02 no-op).
    - `<LinkedInQueuePage>` JSX now passes `isPostRegenerating={(p) => getRegenStatus(p.id)}` and `isPostJustRegenerated={(p) => justRegenerated[p.id] === true}`.

## Decisions Made

1. **Bearer-token auth in both new hooks.** The plan spec said `credentials: 'include'` but the dashboard's existing pattern (per `useLinkedInPostActions.ts` and `dashboard/src/api/client.ts`) uses `Authorization: Bearer ${localStorage.getItem('jwt')}` with 401 → clear + redirect to `/login`. Adapted both `useLinkedInJob` and `useLinkedInRegenerate` to match. Cookie auth would have failed end-to-end against whatsapp-bot's JWT-gated Fastify middleware. This is the same Rule-3 fix Plan 36-02 made for `useLinkedInPostActions`.

2. **Ref-based interval cleanup in `useLinkedInJob`.** The plan acknowledged the `(pollOnce as unknown as { _clean })._clean = ...` closure-pinning trick was "ugly-but-pragmatic" and offered to refactor to a `useRef` if cleaner. I picked the ref version: `intervalRef = useRef<number | null>(null)`, set on `setInterval`, cleared on cleanup or terminal. Same behavior, no `any` coercion, much cleaner read.

3. **Single `activeJob` state (not per-post map) in `useLinkedInRegenerate`.** Plan suggested either approach; I went with single-slot to mirror pm-authority's `semaphore(1)` exactly. The exposed `isRegenerating(postId)` predicate keeps a per-post mental model for the caller. Reasoning: parallel regens would queue server-side anyway, the single-slot enforces that intent at the UI layer too, and the implementation is simpler (no map cleanup on terminal).

4. **Shape-drift fallback uses `onSucceeded(postId, null)`** rather than splitting into two callbacks (`onSucceededWithPost` + `onSucceededSilent`). The plan offered both; the null-arg variant keeps the API surface tighter, and the caller's null-check is one line. SSE delivers within ~3s anyway, so the visual catch-up is invisible to the user.

5. **`POLL_MAX_MS = 120_000` (2 minutes).** CONTEXT §3 suggested 60s, but Claude CLI cold-starts can stretch past 90s. The plan called this out explicitly and recommended 120s for v1; I kept it. Once we have telemetry on real regen durations we can tighten.

6. **Retry toast uses sonner's `{ action: { label, onClick } }` pattern.** The plan asked me to grep an existing precedent in `useLinkedInPostActions.ts` first — there isn't one (Plan 36-02 doesn't use action toasts anywhere). But sonner v1+ supports this shape natively (it's in the upstream type defs), `tsc -b` is clean, and the dashboard already imports `toast` from `sonner` at the top of `LinkedInQueue.tsx` so no new import was needed.

7. **NOT extending `actionErrorToToastText` for regenerate-specific copy.** Plan 36-02 widened the action union to include `'regenerate'`, but the `'regenerate'` branch falls through to the default in `useLinkedInPostActions.ts`. I didn't add a custom branch because (a) the regen errors I emit here are bespoke (`Regeneration failed: ${msg}`, `Regeneration cap reached for this post (5/5)`, `Could not start regeneration: ${msg}`) and don't need the central router, and (b) the central router is built around `PostActionError` which my `RegenStartResult` deliberately doesn't use (the regen flow has different error semantics — `capped` isn't an error kind in 36-02's union, it's a separate user state).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bearer-token auth in both new hooks**
- **Found during:** Task 1 implementation
- **Issue:** Plan-specified `credentials: 'include'` (cookie auth) would fail against whatsapp-bot's JWT Fastify middleware which expects `Authorization: Bearer`. Same root cause as Plan 36-02's deviation #1.
- **Fix:** Both `useLinkedInJob` and `useLinkedInRegenerate` use `Authorization: Bearer ${localStorage.getItem('jwt')}` and mirror `apiFetch`'s 401 handling (clear `jwt` from localStorage + `window.location.href = '/login'`).
- **Files modified:** `dashboard/src/hooks/useLinkedInJob.ts`, `dashboard/src/hooks/useLinkedInRegenerate.ts`
- **Verification:** `tsc -b` clean, `vite build` clean. Live verification deferred to Plan 36-05's human checkpoint.
- **Committed in:** `c0d1c54` (Task 1) and `bd88a88` (Task 2)

---

**Total deviations:** 1 auto-fixed (blocking)
**Impact on plan:** Required for correctness. No scope creep. Same auth-pattern adaptation Plan 36-02 already made — both hooks now match the dashboard's existing convention.

## Issues Encountered

- **Bundle delta well under prediction.** Plan predicted +8-12 kB raw; actual is +6.95 kB raw / +1.81 kB gzip. The two new hooks share Zod (already bundled) and import patterns that tree-shake well.
- **No live testing of shape-drift fallback** — to fire the `onSucceeded(postId, null)` branch we'd need pm-authority to return a job with an unparseable `result.post`, which can't happen without intentional schema breakage. The branch is defensive only.
- **No live testing of polling itself** — all verification is `tsc -b` + `vite build` clean. Plan 36-05's human checkpoint covers the actual click-Regenerate→see-pulse→see-new-content path.
- **`sonner`'s action API not pre-verified by grep** — the plan asked me to grep for an existing `toast.error` with an `action` param in the dashboard for confirmation. I didn't find one (Plan 36-02 only uses bare `toast.error(text)`). I trusted sonner's documented API instead, and `tsc -b` confirmed the prop shape is in sonner's type defs. If the runtime behavior is off, Plan 36-05 will catch it; revert is `delete .action` + a one-line message-only toast.

## Self-Check Outputs

To answer the plan's `<output>` block specifically:

- **Final poll-interval observed in practice:** 1500ms (locked at module top, no runtime override).
- **Final POLL_MAX_MS observed in practice:** 120_000 (2 minutes).
- **Whether shape-drift fallback ever fired during manual testing:** N/A — no manual testing in this plan; plan 36-05 covers it. The branch is defensive only and pm-authority's `workers.run_regenerate` return shape is stable per Plan 36-01 research Q5.
- **Whether sonner's action-button API matched the pattern used in Plan 36-02's onFailed toast:** Plan 36-02 has NO precedent action toasts to grep. Used sonner's documented `{ action: { label, onClick } }` directly; `tsc -b` clean.
- **Bundle delta vs 36-02 baseline:** +6.95 kB raw (736.72 → 743.67 kB) / +1.81 kB gzip (221.54 → 223.35 kB).

## Plan 36-05 Verification Hints

Things Plan 36-05's human checkpoint should eyeball specifically:

1. **Click Regenerate on an eligible (non-capped) post.** The card should immediately get `ring-2 ring-blue-400 animate-pulse`, the spinner should appear next to the status pill, and all 4 action buttons should disable. The Regenerate button's icon should `animate-spin`.
2. **Wait for completion (~30-90s for a real Claude CLI run).** On success: the card content should swap to the new content optimistically (from `job.result.post`), the ring/spinner should clear, and there should be a brief 400ms emerald flash on the card background. CRITICALLY: there should be NO success toast.
3. **Trigger a 409 REGEN_CAPPED via devtools.** Hit a post where `regeneration_count >= 5` by removing the `disabled` attribute on the Regenerate button via DOM inspector, then click. Expected: toast "Regeneration cap reached for this post (5/5)", and the card does NOT enter the regenerating visual state.
4. **Trigger a failed regeneration.** Either kill pm-authority's Claude CLI subprocess mid-run or wait for a real failure path. Expected: toast "Regeneration failed: {message}" with a "Retry" button that re-fires the regen flow when clicked. The card reverts to its prior visual state.
5. **Verify cap tooltip on a 5/5 post.** Hover the disabled Regenerate button on a `regeneration_count >= 5` post — should show "Regeneration cap reached (5/5)" tooltip (Plan 36-02 pre-wired).
6. **Verify the polling stops on terminal.** Open Network tab during a regen; you should see polls every 1500ms; after the job reaches `succeeded` or `failed`, polls should stop.
7. **Page refresh mid-regen.** The visual regeneration state should NOT come back (CONTEXT §3 v1 acceptance — localStorage persistence deferred). SSE should still deliver the final state when the job completes.

## Next Phase Readiness

- **Plan 36-04 (Image drop + PII gate)** can now:
  - Thread `thumbnailOverlay` and `piiGateSlot` through the same render-prop pattern on `LinkedInQueuePage` — no overlap with the regen wiring.
  - Reuse the `patches` map for the `PENDING_PII_REVIEW` transition on upload and the transition back on confirm-pii.
  - Optionally use `useLinkedInJob` if any image-rendering work becomes async (currently upload-image is sync per Plan 36-01).

- **Plan 36-05 verification** will exercise the full SC#3 truth set live against a running pm-authority.

---

*Phase: 36-review-actions-write*
*Plan: 03 (Regenerate UX, Wave 3)*
*Completed: 2026-04-15*

## Self-Check: PASSED

Verified all 3 files exist on disk and all 3 task commits are present in git log:

- FOUND: `dashboard/src/hooks/useLinkedInJob.ts`
- FOUND: `dashboard/src/hooks/useLinkedInRegenerate.ts`
- FOUND: `dashboard/src/pages/LinkedInQueue.tsx`
- FOUND commit: `c0d1c54` (Task 1)
- FOUND commit: `bd88a88` (Task 2)
- FOUND commit: `9206d78` (Task 3)

Final `tsc -b` clean, final `vite build` clean (743.67 kB / 223.35 kB gzip).

---
phase: 37-lesson-mode-ux
plan: 02
subsystem: ui
tags: [react, react-router, zod, radix-ui, dashboard, linkedin, lesson-mode, sse, jobs]

# Dependency graph
requires:
  - phase: 37-lesson-mode-ux (Plan 37-01)
    provides: DashboardPostSchema.perspective/language/project_name/source_snippet, DashboardLessonCandidate with created_at, GenerationMetadata, StickyConfirmBar, stub bodies for LessonCandidateCard/LessonGenerationModal/LinkedInLessonSelection, route /linkedin/queue/posts/:id/lesson
  - phase: 36-review-actions-write (Plan 36-03)
    provides: useLinkedInJob polling hook (reused as-is), useLinkedInPostActions error envelope shape
  - phase: 34-fastify-proxy-layer (Plan 34-03)
    provides: POST /api/linkedin/posts/:id/pick-lesson (202 job_id), GET /api/linkedin/jobs/:id
provides:
  - "Full lesson-selection page (LinkedInLessonSelection.tsx) that fetches post, renders 4-card vertical stack with A/B/C/D letter tags, handles focus-then-confirm, locks page with modal during variant generation, auto-navigates to variant page on success"
  - "useLinkedInPickLesson hook — POST + job poll orchestration with 6-kind discriminated state machine (idle / submitting / polling / succeeded / failed / already_picked / validation_error / network)"
  - "LessonCandidateCard presentational component with letter tag, lesson_text, rationale, GenerationMetadata strip, focus-then-confirm UX + keyboard a11y"
  - "LessonGenerationModal — locked Radix Dialog with running/failed modes; close button + Escape + outside-click all suppressed per CONTEXT §Area 3 Scenario A"
affects: [37-03-variant-finalization, 37-04-queue-integration, 37-05-verification]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "POST + job-poll mutation hook: wrap useLinkedInJob with a local state machine that promotes terminal job states into a discriminated result type; mirrors useLinkedInRegenerate structure so future pick-* hooks look consistent"
    - "Locked Radix Dialog: onInteractOutside + onEscapeKeyDown prevented, showCloseButton={false}, onOpenChange={()=>{}} — the only escape hatch is the browser back button"
    - "Schema-safe page loader: apiFetch<unknown> → DashboardPostSchema.safeParse → separate error/loading/status-guard branches so every non-happy path is a single dedicated render"

key-files:
  created:
    - "dashboard/src/hooks/useLinkedInPickLesson.ts — 149 lines, committed 16da6f7 (Task 1)"
  modified:
    - "dashboard/src/components/linkedin/LessonCandidateCard.tsx — stub → 76 lines, committed 8f2fe15 (Task 2)"
    - "dashboard/src/components/linkedin/LessonGenerationModal.tsx — stub → 90 lines, committed 8f2fe15 (Task 2)"
    - "dashboard/src/pages/LinkedInLessonSelection.tsx — stub (21 lines) → 286 lines, committed 77c4942 (Task 3)"

key-decisions:
  - "All error kinds (failed/already_picked/validation_error/network) surface through the SAME LessonGenerationModal in 'failed' mode — single message slot keeps Phase 37 UX simple; planner-sanctioned per Task 3 action block"
  - "Modal is locked via THREE suppression points on Radix Dialog — onOpenChange no-op + onInteractOutside preventDefault + onEscapeKeyDown preventDefault + showCloseButton=false — belt-and-braces enforcement of CONTEXT §Area 3 Scenario A 'browser back is the only escape hatch'"
  - "Letter tags are purely position-based (candidates[0] → 'A', etc.) with no sort/reorder — honours CONTEXT §Specific-patterns 'letter tags are labels only, 4 candidates are peers'"
  - "Auto-navigate on success lives in a page-level useEffect depending on state.kind === 'succeeded' — navigation is a page concern, not a mutation-hook concern, so the hook stays pure"
  - "Task 2 components were already on disk from the pre-rate-limit attempt and matched the plan spec with three small quality improvements (whitespace-pre-wrap on text, focus-visible ring, aria-label on outer Card). Audited and committed as-is rather than redone"

patterns-established:
  - "POST + job-poll + terminal-state-promoter hook pattern (reusable for Plan 37-03 pick-variant, future pick-* mutations)"
  - "Locked-modal pattern for multi-second backend waits where the user must not wander off mid-flow"
  - "Schema-safe page loader with explicit status-guard branch (non-PENDING_LESSON_SELECTION status → friendly 'no longer waiting' card instead of a crash)"

requirements-completed: [LIN-11]

# Metrics
duration: ~25min (audit + Task 3 implementation; Tasks 1-2 completed pre-resume)
completed: 2026-04-15
---

# Phase 37 Plan 02: Lesson Selection Page Summary

**Full /linkedin/queue/posts/:id/lesson page with 4-card focus-then-confirm stack, pick-lesson mutation + job polling, locked variant-generation modal, and auto-navigate to /variant on success.**

## Performance

- **Duration:** ~25 min (this resume session); overall ~45 min including pre-rate-limit work
- **Completed:** 2026-04-15
- **Tasks:** 3 / 3
- **Files modified:** 4 (1 hook + 2 components + 1 page)

## Accomplishments

- **Task 3 (page) shipped.** `LinkedInLessonSelection.tsx` went from the Plan 37-01 stub (21 lines) to a full 286-line page that fetches the post, renders header + 4 cards + sticky confirm bar + locked modal, and auto-navigates on success.
- **Task 2 (components) audited + committed.** Both files were on disk from the pre-rate-limit attempt. Audit confirmed spec compliance plus three quality improvements landed (`whitespace-pre-wrap` on multi-line fields, `focus-visible` keyboard ring, `aria-label` hoisted to the outer Card). Committed as-is.
- **Task 1 (hook) was pre-committed (16da6f7) — verified.**
- **Dashboard typecheck + vite build both green.** Bundle: 751.80 kB → 761.25 kB raw (+9.45 kB), 225.59 → 227.91 kB gzip (+2.32 kB). Within envelope for 4 new files totalling ~600 lines.
- **Barrel file (`dashboard/src/components/linkedin/index.ts`) untouched** — verified via `git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts` showing empty output. Plan 37-01 remains the sole writer of the barrel.
- **Zero overlap with the parallel Plan 37-03 executor** — commits show a clean interleaving (16da6f7 / b682e90 / 8f2fe15 / 77c4942 / 40aa22b) with no file collisions.

## Task Commits

1. **Task 1: useLinkedInPickLesson hook** — `16da6f7` (feat) — *pre-committed before rate limit*
2. **Task 2: LessonCandidateCard + LessonGenerationModal** — `8f2fe15` (feat) — *audited from on-disk uncommitted work, committed as-is*
3. **Task 3: LinkedInLessonSelection page** — `77c4942` (feat) — *implemented + committed in resume session*

## Files Created / Modified

### `dashboard/src/hooks/useLinkedInPickLesson.ts` (new — 149 lines)

- Discriminated `PickLessonState` union with 8 kinds (idle / submitting / polling / succeeded / failed / already_picked / validation_error / network).
- `pickLesson(postId, candidateId)` POSTs `/api/linkedin/posts/:id/pick-lesson` with Bearer JWT, extracts `job_id` from 202, transitions to `polling`.
- Error envelope branching on status + `error.code`: 409/LESSON_ALREADY_PICKED → `already_picked`; 400/VALIDATION_ERROR → `validation_error`; network throw → `network`; anything else → `failed`.
- 401 handling matches `apiFetch`: clears JWT + redirects to `/login`.
- Nested `useLinkedInJob(jobId)` poll (pass `null` when not polling).
- `useEffect` promotes terminal job states → `succeeded` | `failed` on `state.kind === 'polling'`.

### `dashboard/src/components/linkedin/LessonCandidateCard.tsx` (76 lines, replaces stub)

- Full-width `Card` with `role="button"`, `tabIndex={0}`, `aria-pressed={focused}`, `aria-label="Lesson candidate X"`, Enter/Space keyboard handlers.
- Round letter badge (A/B/C/D) colour-flips on focus (`bg-blue-500 text-white` when focused, `bg-slate-100` otherwise).
- `whitespace-pre-wrap` on lesson_text and rationale preserves multi-line formatting from pm-authority.
- `focus-visible:ring-2 ring-blue-400` keyboard-accessible outline.
- Bottom strip = shared `GenerationMetadata` from Plan 37-01.

### `dashboard/src/components/linkedin/LessonGenerationModal.tsx` (90 lines, replaces stub)

- Radix `Dialog` locked three ways: `onOpenChange` no-op, `onInteractOutside` / `onEscapeKeyDown` both `preventDefault`, `showCloseButton={false}` on `DialogContent`.
- Two modes: `running` (spinner + "Generating variants…" explanatory copy) and `failed` (red AlertCircle icon + error message + "Back to queue" button).
- Copy explicitly references the browser back button as the only escape hatch, per CONTEXT §Area 3 Scenario A.

### `dashboard/src/pages/LinkedInLessonSelection.tsx` (286 lines, replaces stub)

- `useEffect` fetches `/api/linkedin/posts/:id` once on mount via `apiFetch<unknown>`, `DashboardPostSchema.safeParse` guards against schema drift, cancellation flag prevents setState after unmount.
- Four explicit render branches: `fetchError` → red card; `!post` → skeleton stack; `status !== 'PENDING_LESSON_SELECTION'` → amber "no longer waiting" card; `lesson_candidates.length === 0` → amber "no candidates" card.
- Happy path: `BackLink` + title + meta grid (`MetaItem` x4: project / perspective / language / generated) + optional collapsible `<details>` source snippet + vertical stack of `LessonCandidateCard` + `StickyConfirmBar` + `LessonGenerationModal`.
- `onConfirm` guards on `focusedId !== null && id && state.kind !== 'submitting'`, then `void pickLesson(id, focusedId)`.
- `modalOpen` union covers `polling` + all 4 error kinds; `modalStatus` is `'running'` only during `polling`, else `'failed'`; `modalError` pulls `state.message` on any error kind.
- Auto-navigate on `state.kind === 'succeeded'` via `useEffect([state.kind, id, navigate])` → `navigate('/linkedin/queue/posts/:id/variant')`.
- `onBackToQueue` (modal failed mode) calls `reset()` then `navigate('/linkedin/queue')`.
- Helper copy on `StickyConfirmBar` reads "Click a card above to select a lesson" → "Candidate A/B/C/D selected" based on focus.

## Decisions Made

1. **Audit path for pre-existing Task 2 files** — Both `LessonCandidateCard.tsx` and `LessonGenerationModal.tsx` were uncommitted on disk from the pre-rate-limit attempt. Read both, compared line-by-line to the plan spec, and confirmed they were acceptable with three small quality improvements. Committed as-is instead of redoing — the improvements (whitespace-pre-wrap, focus-visible ring, aria-label placement) are all uncontroversial a11y/UX polish and the core structure matches the plan exactly.
2. **All error kinds surface through the same "failed" modal view** — The plan's Task 3 action block explicitly sanctions collapsing `failed` / `already_picked` / `validation_error` / `network` into a single `modalStatus: 'failed'` with `state.message` as the body. Keeps the UX simple; retry is out of Phase 37 scope.
3. **Triple-lock on the modal** — `onOpenChange` no-op + `onInteractOutside` preventDefault + `onEscapeKeyDown` preventDefault + `showCloseButton={false}`. Belt-and-braces implementation of CONTEXT §Area 3 Scenario A "browser back button is the only escape hatch". Each individual suppression could be defeated; together they are airtight.
4. **Navigation lives in the page, not the hook** — `useLinkedInPickLesson` returns a state machine only; the page's `useEffect([state.kind, id, navigate])` owns the navigate call. Keeps the hook pure and reusable for any future consumer that wants different post-success behaviour.
5. **Letter tags from position-only mapping** — `LETTERS[idx] ?? 'A'` maps index→letter with no sort/reorder. Honours CONTEXT §Specific-patterns: "4 candidates are peers."

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes required; no architectural questions raised; no pre-existing bugs discovered in the scope of this plan.

The prior executor's Task 2 work landing on disk before the rate limit hit was not a deviation — the uncommitted files matched the plan spec. This resume session's job was to audit + commit them and then execute Task 3.

## Authentication Gates

None — all endpoints used (`GET /api/linkedin/posts/:id`, `POST /api/linkedin/posts/:id/pick-lesson`, `GET /api/linkedin/jobs/:id`) authenticate via the existing dashboard JWT pattern (`localStorage.getItem('jwt')` → Bearer). No new auth surface.

## Issues Encountered

- **Prior executor rate limit.** Task 1 was committed (`16da6f7`), Task 2 work landed on disk but was not committed, Task 3 was not started. Resolved by: reading the plan, auditing the on-disk files, committing them, then implementing Task 3. Zero rework of already-correct code.
- **Parallel 37-03 executor running concurrently.** Files `useLinkedInPickVariant.ts`, `VariantCard.tsx`, `VariantImageSlot.tsx`, `LinkedInVariantFinalization.tsx`, and `index.ts` were on the no-touch list. Used explicit per-file `git add` on every commit instead of `git add -A` to avoid collisions. Verified via `git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts` showing empty output.
- **Pre-existing dashboard bundle >500 kB chunk warning.** Unchanged from Phase 36 baseline, out of scope.

## Next Phase Readiness

- **Plan 37-03 (variant finalization)** is the parallel Wave-2 sibling and is running concurrently — commits `b682e90` and `40aa22b` are already on `main` from that executor. When 37-03 lands, the two halves of the UX (lesson selection → variant finalization) will chain end-to-end.
- **Plan 37-04 (queue integration)** wires the `PendingActionEntryButton` stub into `LinkedInPostCard.actionsSlot` so the queue list offers a "Pick lesson" button that routes into this page. Still unblocked; no blockers introduced.
- **Live verification deferred to Plan 37-05.** This plan has not been clicked through end-to-end against a real PENDING_LESSON_SELECTION post — tsc + vite build are clean, but live exercise requires either a fresh lesson-mode run from pm-authority or a seeded fixture, both of which are Phase-38 / 37-05 territory.
- **The pick-lesson → job-poll → auto-navigate pattern is ready for reuse.** Plan 37-03's `useLinkedInPickVariant` (already committed in `b682e90` by the parallel executor) follows the same structural pattern; any future pick-* mutation hooks in the lesson-mode pipeline can copy `useLinkedInPickLesson` as a template.

---

*Phase: 37-lesson-mode-ux*
*Plan: 02 (Lesson Selection Page, Wave 2)*
*Completed: 2026-04-15*

## Self-Check: PASSED

- All 4 dashboard files verified on disk (1 new hook + 2 modified components + 1 modified page)
- SUMMARY.md verified on disk
- Commits `16da6f7`, `8f2fe15`, `77c4942` all verified in `git log`
- `dashboard/src/components/linkedin/index.ts` confirmed UNTOUCHED via empty `git diff --stat HEAD`

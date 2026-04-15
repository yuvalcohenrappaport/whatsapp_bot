---
phase: 37-lesson-mode-ux
plan: 01
subsystem: api
tags: [pydantic, zod, react, react-router, dashboard, fastapi, fastify, pm-authority, linkedin, lesson-mode]

# Dependency graph
requires:
  - phase: 33-pm-authority-http-service
    provides: PostDTO, VariantDTO, LessonCandidateDTO, dto_mapper.build_post_dto, sequences/post_variants/lesson_candidates schema
  - phase: 34-fastify-proxy-layer
    provides: PostSchema, VariantSchema, LessonCandidateSchema, callUpstream, /api/linkedin proxy routes
  - phase: 35-linkedin-queue-read-side-ui
    provides: DashboardPostSchema, postStatus.ts LinkedIn* type mirror, LinkedInPostCard, LinkedInQueue page, useLinkedInQueueStream SSE hook
  - phase: 36-review-actions-write
    provides: LinkedInPostCard slot props, dashboard JWT bearer auth pattern, optimistic-patch layer in LinkedInQueueRoute
provides:
  - "pm-authority PostDTO.project_name + PostDTO.source_snippet (first 500 chars of sequences.context_json or null)"
  - "pm-authority VariantDTO.created_at + LessonCandidateDTO.created_at (sourced from existing post_variants/lesson_candidates created_at columns)"
  - "whatsapp-bot proxy Zod PostSchema/VariantSchema/LessonCandidateSchema mirrors of all 4 new fields"
  - "Dashboard DashboardPostSchema upgraded from z.array(z.any()) → strongly-typed DashboardVariantSchema + DashboardLessonCandidateSchema with project_name/source_snippet/perspective/language"
  - "Dashboard postStatus.ts LinkedInPost mirror gains project_name/source_snippet; LinkedInVariant/LinkedInLessonCandidate gain created_at"
  - "Shared GenerationMetadata presentational component (formatRelative inlined; renders 'Generated {relative} · Claude')"
  - "Shared StickyConfirmBar primitive (focus-then-confirm bottom bar with safe-area padding)"
  - "Two new React Router routes: /linkedin/queue/posts/:id/lesson and /linkedin/queue/posts/:id/variant"
  - "5 stub components landed for Plans 37-02/03/04 to replace (LessonCandidateCard, LessonGenerationModal, VariantCard, VariantImageSlot, PendingActionEntryButton)"
  - "Dashboard linkedin barrel (index.ts) is now Plan-37-01-only — Plans 37-02/03/04 never edit it"
affects: [37-02-lesson-selection, 37-03-variant-finalization, 37-04-queue-integration, 37-05-verification]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "Cross-repo schema additive evolution: extend Pydantic DTO → mirror in proxy Zod → mirror in dashboard Zod + dashboard type mirror, all in one landing"
    - "Barrel-file ownership single-writer: Wave-1 plan exports forward-declared modules + lands stub bodies so Wave-2/3 plans only edit one file each"
    - "Stub-page hand-off: Wave-1 lands page files at the final import paths (default exports), Wave-2 replaces only the page body — router never has to change again"
    - "formatRelative inlined into shared presentational component to keep file-disjoint from LinkedInPostCard (no imports from a Wave-3 file)"

key-files:
  created:
    - "dashboard/src/components/linkedin/GenerationMetadata.tsx — shared 'Generated {relative} · Claude' strip"
    - "dashboard/src/components/linkedin/StickyConfirmBar.tsx — shared focus-then-confirm bottom bar"
    - "dashboard/src/components/linkedin/LessonCandidateCard.tsx — Plan 37-02 stub"
    - "dashboard/src/components/linkedin/LessonGenerationModal.tsx — Plan 37-02 stub"
    - "dashboard/src/components/linkedin/VariantCard.tsx — Plan 37-03 stub"
    - "dashboard/src/components/linkedin/VariantImageSlot.tsx — Plan 37-03 stub (exports VariantImageMode union)"
    - "dashboard/src/components/linkedin/PendingActionEntryButton.tsx — Plan 37-04 stub"
    - "dashboard/src/pages/LinkedInLessonSelection.tsx — Plan 37-02 stub page"
    - "dashboard/src/pages/LinkedInVariantFinalization.tsx — Plan 37-03 stub page"
  modified:
    - "pm-authority/services/http/schemas.py — VariantDTO.created_at, LessonCandidateDTO.created_at, PostDTO.project_name, PostDTO.source_snippet"
    - "pm-authority/services/http/dto_mapper.py — sequences SELECT widened, snippet computation, variant/lesson row created_at"
    - "pm-authority/tests/test_http_reads.py — assertions for the 4 new fields + 2 new tests for source_snippet population (full-length + whitespace-only)"
    - "src/api/linkedin/schemas.ts — VariantSchema/LessonCandidateSchema/PostSchema field additions"
    - "src/api/linkedin/__tests__/reads.test.ts — fixturePost includes new fields, new Plan 37-01 describe block with 3 tests"
    - "src/api/linkedin/__tests__/writes.test.ts — fixturePost mirror update"
    - "src/api/linkedin/__tests__/stream.test.ts — makePost mirror update"
    - "dashboard/src/api/linkedinSchemas.ts — DashboardVariantSchema + DashboardLessonCandidateSchema, project_name/source_snippet/perspective/language on DashboardPostSchema"
    - "dashboard/src/components/linkedin/postStatus.ts — created_at on variant + lesson candidate, project_name + source_snippet on LinkedInPost"
    - "dashboard/src/components/linkedin/index.ts — Phase 37 barrel exports (Plan-37-01-only ownership)"
    - "dashboard/src/router.tsx — two new routes wired"

key-decisions:
  - "Stub-placeholder fallback path taken for the barrel re-exports (recommended path per plan). 5 stub component files landed under dashboard/src/components/linkedin/ so the linkedin barrel typechecks on its own without waiting for Wave-2 files"
  - "GenerationMetadata omits token_cost (no column exists in pm-authority anywhere) and hard-codes 'Claude' for model (pm-authority's generator is always Claude CLI per generation/generator.py). Documented in the component header comment so a future plan can extend it as soon as columns land"
  - "formatRelative inlined into GenerationMetadata.tsx (5 lines) instead of factoring out a shared src/lib/relative.ts — keeps the new component file-disjoint from LinkedInPostCard (Wave-3/4 territory)"
  - "DashboardPostSchema.perspective + .language added at this plan even though the existing dashboard hooks don't need them — the lesson page header (CONTEXT §Area 1) does, and pm-authority has been emitting them on PostDTO since Phase 33-02 so this is an additive read-side change"
  - "STUBS_NOTE: 5 stub component files exist purely so the barrel re-exports satisfy tsc isolatedModules. Each stub is a single 1-arg `_props: Record<string, unknown>` no-op return-null. Plans 37-02/03/04 REPLACE the stub body — they MUST NOT touch the index.ts barrel"

patterns-established:
  - "Barrel-file single-writer rule: Phase 37 barrel = Plan 37-01 only; Wave-2/3 plans replace stub bodies, never re-export"
  - "Cross-repo additive read-side change: Pydantic DTO + dto_mapper SQL widening + pytest assertions → proxy Zod mirror + vitest fixture update + new pin tests → dashboard Zod + type mirror — all in 4 atomic commits across 2 repos"
  - "Stub-page hand-off (router scaffolds in Wave 1, page bodies fill in Wave 2)"

requirements-completed: []  # Plan 37-01 is foundation only; LIN-11/12/13 flip when Plans 37-02/03/04 ship

# Metrics
duration: 50min
completed: 2026-04-15
---

# Phase 37 Plan 01: Foundation (Cross-Repo Schemas + Shared Primitives + Route Scaffold) Summary

**Cross-repo PostDTO additions (project_name, source_snippet, per-variant/per-candidate created_at) propagated through pm-authority Pydantic + whatsapp-bot proxy Zod + dashboard Zod, plus shared GenerationMetadata + StickyConfirmBar primitives and two stub-backed routes ready for Wave-2 parallel execution on file-disjoint paths.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-04-15T17:04Z
- **Completed:** 2026-04-15T17:14Z (per-task work) + summary/state writeup
- **Tasks:** 4 / 4
- **Files modified:** 19 (pm-authority: 3, whatsapp-bot: 16 — 4 src/api + 12 dashboard)

## Accomplishments

- **Wave-2 unblocked.** Plans 37-02 and 37-03 can run in parallel without touching the same file. Plan 37-02 fills `LessonCandidateCard.tsx` + `LessonGenerationModal.tsx` + `LinkedInLessonSelection.tsx`; Plan 37-03 fills `VariantCard.tsx` + `VariantImageSlot.tsx` + `LinkedInVariantFinalization.tsx`. Neither plan touches the linkedin barrel.
- **pm-authority HTTP suite: 68 → 70 tests passing** (+2 new source_snippet tests; existing 12 reads tests still green; full HTTP suite 70/70).
- **whatsapp-bot linkedin vitest suite: 95 → 98 tests passing** (+3 new Plan 37-01 fields tests in reads.test.ts; existing 92 still green; 3 helper-fixture updates required to satisfy new required PostSchema fields — Rule 3 blocking, see Deviations).
- **Dashboard tsc -b + vite build clean.** Bundle delta: 750.94 kB → 751.80 kB raw (+0.86 kB), 225.41 → 225.59 kB gzip (+0.18 kB) — well within envelope. The new shared primitives are tiny.
- **pm-authority restarted to pid 2025950** to serve the new DTO fields; whatsapp-bot restarted to pid 2026685 to serve the new Zod mirror; both verified live (`/v1/health` 200, `/api/linkedin/health` 401 as expected without JWT, `/health` 200).
- **Cross-repo Literal/contract sync** for the 4 new fields landed in 2 repos in 4 atomic commits with zero schema drift mid-deploy.

## Task Commits

Atomic per-task commits. Repo shown in parentheses.

1. **Task 1: pm-authority PostDTO/VariantDTO/LessonCandidateDTO additions + dto_mapper SQL + pytest** — `0f0474e` (feat, **pm-authority**)
2. **Task 2: whatsapp-bot Zod schema mirror + reads.test.ts new pins + 3 helper-fixture updates** — `796ea8a` (feat, whatsapp-bot)
3. **Task 3: Dashboard schemas + postStatus mirror + GenerationMetadata + StickyConfirmBar + 5 Wave-2/3/4 stubs + barrel** — `41777cd` (feat, whatsapp-bot)
4. **Task 4: Router routes + 2 stub page components** — `4ef1060` (feat, whatsapp-bot)

**pm-authority commits:** `0f0474e`
**whatsapp-bot commits:** `796ea8a`, `41777cd`, `4ef1060`

## Files Created / Modified

### pm-authority

- `services/http/schemas.py` — VariantDTO.created_at + LessonCandidateDTO.created_at (required `datetime`), PostDTO.project_name (required `str`), PostDTO.source_snippet (`Optional[str]`)
- `services/http/dto_mapper.py` — sequences SELECT widened to include `project_name, context_json`; source_snippet computed inline (first 500 chars or None on whitespace-only); `_variant_rows_to_dtos` and `_lesson_rows_to_dtos` SQL widened to also fetch `created_at`, parsed via existing `_parse_ts` helper with `datetime.now(timezone.utc)` fallback for legacy NULL rows
- `tests/test_http_reads.py` — `test_get_post_fat_dto_shape` extended with assertions for project_name, source_snippet, per-variant created_at, per-candidate created_at; 2 new tests `test_get_post_source_snippet_populated_when_context_json_present` (mutates fixture seq-a context_json to a >500-char string, asserts exact 500-char slice) and `test_get_post_source_snippet_none_for_whitespace_only_context` (whitespace-only → None)

### whatsapp-bot (repo root)

- `src/api/linkedin/schemas.ts` — VariantSchema/LessonCandidateSchema gain required `created_at: z.iso.datetime({ offset: true })`; PostSchema gains `project_name: z.string()` (required) + `source_snippet: z.string().nullable()`
- `src/api/linkedin/__tests__/reads.test.ts` — `fixturePost` includes new fields; new top-level describe block "PostSchema Plan 37-01 fields" with 3 tests: missing-project_name → throws, missing-created_at on variant + lesson → throws, end-to-end pass-through via `fastify.inject()` against a mocked upstream
- `src/api/linkedin/__tests__/writes.test.ts` — `fixturePost` helper updated to include new fields (Rule 3 blocking — pre-existing tests started failing 500 because their fixture posts no longer matched the strict PostSchema)
- `src/api/linkedin/__tests__/stream.test.ts` — `makePost` helper updated to include new fields (same Rule 3 cause)

### whatsapp-bot (dashboard)

- `dashboard/src/api/linkedinSchemas.ts` — Strongly-typed `DashboardVariantSchema` + `DashboardLessonCandidateSchema` (replace the old `z.array(z.any())`); `DashboardPostSchema` gains `perspective`, `language`, `project_name`, `source_snippet`; new exported types `DashboardVariant` + `DashboardLessonCandidate`
- `dashboard/src/components/linkedin/postStatus.ts` — `LinkedInVariant.created_at` + `LinkedInLessonCandidate.created_at` (string), `LinkedInPost.project_name` (string) + `LinkedInPost.source_snippet` (string | null) — perspective/language were already on the type pre-Phase-37
- `dashboard/src/components/linkedin/GenerationMetadata.tsx` — NEW shared component, inlined `formatRelative`, accepts `{ createdAt, className? }`, renders a single `<p>` with `text-xs text-muted-foreground` styling
- `dashboard/src/components/linkedin/StickyConfirmBar.tsx` — NEW shared primitive with iOS safe-area padding, `bg-background/95 backdrop-blur` glass effect, lg-size primary Button, slot for helper text on the left, accepts `{ label, disabled, onConfirm, helper?, className? }`
- `dashboard/src/components/linkedin/LessonCandidateCard.tsx` — Plan 37-02 stub (`return null`)
- `dashboard/src/components/linkedin/LessonGenerationModal.tsx` — Plan 37-02 stub (`return null`)
- `dashboard/src/components/linkedin/VariantCard.tsx` — Plan 37-03 stub (`return null`)
- `dashboard/src/components/linkedin/VariantImageSlot.tsx` — Plan 37-03 stub (`return null`); also exports `VariantImageMode = 'idle' | 'pending' | 'ready' | 'error'` type union
- `dashboard/src/components/linkedin/PendingActionEntryButton.tsx` — Plan 37-04 stub (`return null`)
- `dashboard/src/components/linkedin/index.ts` — Phase 37 exports appended (5 component re-exports + 3 type re-exports). This barrel is now Plan-37-01-only.
- `dashboard/src/pages/LinkedInLessonSelection.tsx` — NEW stub page, `useParams<{id: string}>()` + placeholder copy
- `dashboard/src/pages/LinkedInVariantFinalization.tsx` — NEW stub page, same shape
- `dashboard/src/router.tsx` — Two new routes appended after the existing `linkedin/queue` entry, two new lazy-free named imports

## Decisions Made

1. **Stub-placeholder fallback path taken for the barrel** (the plan offered both forward-declared-only and stub-files paths; planner explicitly recommended the stub path). 5 stub component files landed under `dashboard/src/components/linkedin/` so the linkedin barrel typechecks on its own without waiting for any Wave-2 file. Plans 37-02/03/04 only replace stub bodies — they never touch `index.ts`.
2. **GenerationMetadata omits token_cost and hard-codes 'Claude' for model** because no column exists for either today (research_facts §6 confirmed via grep). Documented in the component header so the moment pm-authority adds `model_used` or `total_tokens` columns, only this one component file changes and both pages pick it up.
3. **`formatRelative` inlined into `GenerationMetadata.tsx`** rather than factored out to a shared `src/lib/relative.ts`. The helper is 5 lines and inlining keeps this new file 100% disjoint from `LinkedInPostCard.tsx` (which is a Wave-3/4 file and would create a barrel-race risk if shared).
4. **DashboardPostSchema gained `perspective` + `language`** even though no existing hook reads them. CONTEXT §Area 1 / §Area 2 lock the lesson page header to surface project name + perspective + language + generation timestamp + source snippet, and pm-authority has been emitting these two on `PostDTO` since Phase 33-02, so this is a zero-risk additive read-side widening.
5. **Per-row `created_at` fallback to `datetime.now(timezone.utc)`** in `_variant_rows_to_dtos` / `_lesson_rows_to_dtos` for any pre-existing rows whose `created_at` text might fail `_parse_ts` (defensive — the column has a `NOT NULL DEFAULT (datetime('now'))` so this should never trigger on a healthy DB).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] writes.test.ts + stream.test.ts fixturePost helpers updated**
- **Found during:** Task 2 — first run of `npx vitest run src/api/linkedin/`
- **Issue:** Adding `project_name` (required) to `PostSchema` made every pre-existing `fixturePost()` payload in `writes.test.ts` (one helper with 12 callsites) and `makePost()` in `stream.test.ts` invalid against the strict schema. The proxy routes parse responses through `PostSchema` before relaying them, so `fastify.inject()` calls in 12 unrelated write tests started returning 500 INTERNAL_ERROR / "schema mismatch" instead of 200. Same root cause for `created_at` on variants/candidates (schema upgrade made the field required at parse time).
- **Fix:** Added `project_name: 'TestProject'` + `source_snippet: null` to both helper functions. No callsites needed updating because they all spread the helper output. Variants/lesson_candidates arrays in callsites are still `[]` so the new variant/candidate `created_at` requirement only matters when the test inlines a non-empty variant — Plan 37-01's new test does this explicitly with valid `created_at` values.
- **Files modified:** `src/api/linkedin/__tests__/writes.test.ts`, `src/api/linkedin/__tests__/stream.test.ts`
- **Verification:** Linkedin vitest 95 → 98 tests passing (3 new Plan 37-01 tests added).
- **Committed in:** `796ea8a` (Task 2 commit)

**2. [Rule 3 - Blocking] pm-authority HTTP service restart required for live integration test**
- **Found during:** Task 2 — `src/api/linkedin/__tests__/integration.test.ts` (Phase 34 live test) hit the running PM2 pm-authority at `127.0.0.1:8765` and got Zod parse failures because the running service was Plan 36 code without the new DTO fields.
- **Fix:** `npx pm2 restart pm-authority-http` → online in <2s → `/v1/health` 200. The new schemas.py loaded; `GET /v1/posts` now emits `project_name` + `source_snippet` + per-row `created_at` on every PostDTO; integration test 6/6 green.
- **Files modified:** None (runtime-only PM2 restart).
- **Verification:** Full linkedin vitest 98/98 passing including the 6 live integration tests.
- **Committed in:** N/A (runtime-only, documented in this Summary).

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking — fixture cascade + service restart for live test).
**Impact on plan:** Both auto-fixes were structurally inevitable consequences of the cross-repo schema additions. No scope creep. The fixture-helper cascade in writes.test.ts + stream.test.ts is the kind of fix that costs ~5 lines per file and was foreseen by the plan's "files_modified" list (the plan listed only `reads.test.ts` but the strict-schema impact is correctly localized to the helper functions, no other test logic changed).

## Authentication Gates

None. No auth surface was touched in this plan (all reads, no new endpoints).

## Issues Encountered

- **Pre-existing baseline noise.** `git status` on whatsapp-bot showed 4 failing tests in `src/commitments/__tests__/CommitmentDetectionService.test.ts` from Phase 25/26 work. These tests fail on the pre-Plan-37-01 HEAD as well; they import nothing from `src/api/linkedin/` and Phase 37 work does not touch them. Logged at `.planning/phases/37-lesson-mode-ux/deferred-items.md` per scope-boundary policy.
- **Full whatsapp-bot vitest suite: 117 / 121 passing** (4 pre-existing CommitmentDetectionService failures unchanged from baseline). Linkedin subsystem is 98/98 green.
- **Dashboard bundle warning** about >500 kB chunk size is unchanged from the Phase 36 baseline (pre-existing). Out of scope.

## Next Phase Readiness

- **Wave 2 (Plans 37-02 + 37-03) can run in parallel.** Both plans now have stable import paths to append to:
  - Plan 37-02 fills `LessonCandidateCard.tsx`, `LessonGenerationModal.tsx`, and `LinkedInLessonSelection.tsx`. It imports `GenerationMetadata`, `StickyConfirmBar`, `DashboardLessonCandidate`, and the new POST `/api/linkedin/posts/:id/pick-lesson` proxy hook (already exists from Phase 34-03).
  - Plan 37-03 fills `VariantCard.tsx`, `VariantImageSlot.tsx`, and `LinkedInVariantFinalization.tsx`. It imports `GenerationMetadata`, `StickyConfirmBar`, `DashboardVariant`, the `VariantImageMode` type union, and the existing POST `/api/linkedin/posts/:id/pick-variant` proxy hook.
- **Wave 3 (Plan 37-04 — queue integration)** is unblocked. `PendingActionEntryButton.tsx` stub exists and wraps into `LinkedInPostCard.actionsSlot` (pre-wired by Plan 36-01 Task 6). Plan 37-04 also adds the 2 new status strip mini-counters and the 4px left-edge accent stripe.
- **Per-variant fal.ai image architecture reality.** Per CONTEXT §Area 3, pm-authority generates ONE image per post on `pick-variant`, at the post level — not per variant. Plan 37-03 should render a single post-level image placeholder per variant card with identical pending UX; the visual illusion of "2 per-variant images side by side" is out of scope. Documented as a follow-up if the owner wants literal 2-image side-by-side after seeing the shipped UX.
- **Live runtime ready:** pm-authority restarted to pid 2025950 (serving new fields), whatsapp-bot restarted to pid 2026685 (serving new Zod mirror), dashboard built. Wave-2 implementing agents do NOT need to restart anything before they begin.

### Slot-to-Plan mapping for Phase 37

| Stub component                  | Consumer plan | What it will hold                                                                        |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `LessonCandidateCard.tsx`       | 37-02         | Letter-tagged (A/B/C/D) lesson card with focus-then-confirm + GenerationMetadata strip   |
| `LessonGenerationModal.tsx`     | 37-02         | Locked modal overlay during lesson→variant generation (CONTEXT §Area 3 Scenario A)        |
| `LinkedInLessonSelection.tsx`   | 37-02         | The full /lesson page with header + 4-card stack + StickyConfirmBar                       |
| `VariantCard.tsx`               | 37-03         | Side-by-side variant card with full post + collapsible image prompt + image slot          |
| `VariantImageSlot.tsx`          | 37-03         | idle / pending / ready / error states for the fal.ai image (CONTEXT §Area 3 Scenario B)   |
| `LinkedInVariantFinalization.tsx` | 37-03       | The full /variant page with header + 2-col grid + StickyConfirmBar                        |
| `PendingActionEntryButton.tsx`  | 37-04         | "Pick lesson" / "Pick variant" entry button rendered into the queue card's actionsSlot   |

---

*Phase: 37-lesson-mode-ux*
*Plan: 01 (Foundation, Wave 1)*
*Completed: 2026-04-15*

## Self-Check: PASSED

- All 9 dashboard files verified on disk (5 stubs + 2 shared primitives + 2 stub pages)
- SUMMARY.md + deferred-items.md verified on disk
- pm-authority commit `0f0474e` verified in git log
- whatsapp-bot commits `796ea8a`, `41777cd`, `4ef1060` verified in git log

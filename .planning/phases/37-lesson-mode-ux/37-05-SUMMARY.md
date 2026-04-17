---
phase: 37-lesson-mode-ux
plan: 05
subsystem: verification
tags: [pytest, vitest, tsc, vite, pm2, sse, fal-ai, live-verification, linkedin, lesson-mode]

# Dependency graph
requires:
  - phase: 37-lesson-mode-ux (Plans 37-01 through 37-04)
    provides: Full lesson-mode UX surface — cross-repo schemas, lesson selection page, variant finalization page, queue integration (pills + stripes + entry buttons + counters + arrival flash)
provides:
  - "Live-verified Phase 37 — all 3 success criteria observed in owner's browser session against real pm-authority state.db"
  - "STATE.md / ROADMAP.md / REQUIREMENTS.md flipped to Phase 37 COMPLETE with LIN-11/12/13 [x]"
affects: [38-new-lesson-run-form]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data seeding via status recycle: flip a REJECTED post back to PENDING_LESSON_SELECTION by clearing lesson_candidates.selected + deleting stale variants, producing a walkthrough-ready post without a fresh LLM generation run"
    - "Pre-existing ESM boot crash diagnosed as Phase 31 import gap (getPairedExamples + getAllFromMeMessages never landed in messages.ts); fixed with throwing stubs first, then replaced with real Drizzle queries by owner"

key-files:
  created:
    - ".planning/phases/37-lesson-mode-ux/37-05-SUMMARY.md"
  modified:
    - ".planning/STATE.md"
    - ".planning/ROADMAP.md"
    - ".planning/REQUIREMENTS.md"

key-decisions:
  - "Data seeding via REJECTED post recycle rather than a fresh generation run — avoids 10-60s LLM call and exercises the exact same UI paths"
  - "Owner replaced the throwing stubs for getPairedExamples + getAllFromMeMessages with real Drizzle query implementations (commit a417195) — proper fix landed before the walkthrough"
  - "Single fal.ai image per post (not per variant) — owner observed and accepted this during SC#3; no follow-up requested"

patterns-established: []

requirements-completed: [LIN-11, LIN-12, LIN-13]

# Metrics
duration: ~90min (spread across preflight, boot fix, data seeding, owner walkthrough, and doc updates)
completed: 2026-04-17
---

# Phase 37 Plan 05: Live Verification + Phase Close-out Summary

**All 3 Phase 37 success criteria observed live in the owner's browser against real pm-authority state (lesson selection 4-card pick, variant 2-col finalize, inline fal.ai image with 1500ms visual confirmation delay); LIN-11/12/13 flipped to [x]; Phase 37 formally complete.**

## Performance

- **Duration:** ~90 min (spread across automated preflight, ESM boot fix, data seeding, live walkthrough, doc updates)
- **Started:** 2026-04-16 (preflight + PM2 restart + boot fix)
- **Completed:** 2026-04-17 (owner walkthrough approved + doc close-out)
- **Tasks:** 4 / 4 (Task 1: test suites, Task 2: PM2 + seeding, Task 3: human checkpoint, Task 4: doc updates)
- **Files modified:** 4 (.planning docs only — no application code in this plan)

## Accomplishments

- **SC#1 (LIN-11) observed live:** Owner clicked "Pick lesson" on a PENDING_LESSON_SELECTION post, saw the 4-card vertical stack with letter tags A/B/C/D, focused a candidate, confirmed via StickyConfirmBar, watched the locked LessonGenerationModal while pm-authority generated 2 fresh variants, and observed auto-navigation to the variant page on success.
- **SC#2 (LIN-12) observed live:** Owner saw the 2-col variant grid with bilingual content (Hebrew dir=rtl + English dir=ltr), collapsible image prompts, focus-then-confirm UX, and confirmed variant selection via StickyConfirmBar.
- **SC#3 (LIN-13) observed live:** After confirming a variant, the VariantImageSlot flipped from idle to "Generating image..." with spinner + elapsed counter, fal.ai completed, the real image rendered inline on the focused variant card, stayed visible for ~1.5 seconds (the deliberate setTimeout delay from Plan 37-03), then the router auto-navigated back to /linkedin/queue. Owner confirmed image was clearly visible before nav-away.
- **Test suites green at walkthrough time:** pm-authority pytest 70/70, whatsapp-bot linkedin vitest 98/98, full whatsapp-bot vitest 117/121 (4 pre-existing CommitmentDetectionService failures), dashboard tsc -b linkedin-clean (4 pre-existing KeywordRuleFormDialog + Overview errors), vite build 772.17 kB raw / 229.80 kB gzip.

## Task Commits

Plan 37-05 has no per-task application-code commits (verification-only plan). Related in-session commits:

1. **Task 1 (test suites):** No commit — verification only.
2. **Task 2 (PM2 + seeding):**
   - `44bea1c` — fix(db): stub getPairedExamples + getAllFromMeMessages to unblock ESM boot (later superseded by `a417195`)
   - `a417195` — fix(db): implement getPairedExamples + getAllFromMeMessages (owner's proper fix with real Drizzle queries)
   - Data seeding: recycled REJECTED post `59c52507-d698-490d-989a-524c05f8a915` to PENDING_LESSON_SELECTION (4 lesson candidates with selected flags cleared, stale variants deleted)
3. **Task 3 (human checkpoint):** Owner typed "done" after completing the live walkthrough of all 3 SCs.
4. **Task 4 (doc updates):** This commit — docs(phase-37): complete phase execution.

## Files Created / Modified

- `.planning/phases/37-lesson-mode-ux/37-05-SUMMARY.md` — this file
- `.planning/STATE.md` — Phase 37 COMPLETE, next = Phase 38
- `.planning/ROADMAP.md` — Phase 37 checkbox [x], progress table 5/5 Complete
- `.planning/REQUIREMENTS.md` — LIN-11, LIN-12, LIN-13 traceability rows updated with live-verified evidence

## Decisions Made

1. **Data seeding via REJECTED post recycle.** Live pm-authority state.db had only PUBLISHED (3) and REJECTED (27) posts. Rather than running a fresh generation (10-60s LLM call), we recycled a REJECTED post with existing lesson_candidates back to PENDING_LESSON_SELECTION by clearing `lesson_candidates.selected` flags and deleting stale variants. This exercised the exact same UI paths as a fresh post.

2. **ESM boot crash fix approach.** Phase 31 commit `82e9fdda` added imports of `getPairedExamples` and `getAllFromMeMessages` in `gemini.ts`, but the query implementations never landed in `messages.ts`. Initial fix was throwing stubs (commit `44bea1c`); owner replaced with real Drizzle implementations (commit `a417195`). The callsites only fire for persona generation, not Phase 37 flows.

3. **Single fal.ai image per post accepted.** pm-authority generates one image per post at pick-variant time (not per-variant). The focused variant card shows the image; the ancillary card stays in idle state. Owner observed this during SC#3 and did not request a follow-up for literal 2-image side-by-side.

4. **DialogContent a11y warning deferred.** `Missing Description or aria-describedby` on LessonGenerationModal is a cosmetic a11y gap, not functional. Logged for future cleanup but not blocking phase completion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESM boot crash — missing getPairedExamples + getAllFromMeMessages exports**
- **Found during:** Task 2 (PM2 restart)
- **Issue:** `gemini.ts` imports 2 functions from `messages.ts` that were never implemented (Phase 31 gap). whatsapp-bot crash-looped on boot, port 3000 never bound.
- **Fix:** Added throwing stubs in `messages.ts` (commit `44bea1c`). Owner later replaced with real Drizzle implementations (commit `a417195`).
- **Files modified:** `src/db/queries/messages.ts`
- **Verification:** PM2 restart succeeded, `/api/linkedin/health` reachable.
- **Committed in:** `44bea1c` (stub), `a417195` (real implementation)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking — pre-existing Phase 31 import gap, not caused by Phase 37 work).
**Impact on plan:** Required 2 commits outside Phase 37's scope to unblock the live stack. Zero impact on Phase 37 application code.

## Authentication Gates

None. Dashboard JWT auth was already functional from Phase 35-04. No new auth surface introduced.

## Issues Encountered

- **Pre-existing whatsapp-bot crash loop.** The ESM boot crash from Phase 31's missing query exports had been silently cycling (restart count 422+) for weeks. PM2's fast restart loop occasionally let the bot serve requests between crashes, masking the issue. Proper fix (real Drizzle queries) landed as commit `a417195`.
- **Empty non-terminal post pool.** All 30 posts in state.db were either PUBLISHED or REJECTED. Required manual data seeding to produce walkthrough-ready posts in PENDING_LESSON_SELECTION state.
- **4 pre-existing CommitmentDetectionService vitest failures** (117/121 total, 98/98 linkedin subsystem). Phase 25/26 test drift, unrelated to Phase 37. Logged in deferred-items.md.
- **4 pre-existing dashboard tsc errors** in KeywordRuleFormDialog + Overview. LinkedIn subsystem typecheck is clean. Logged in deferred-items.md.

## Todos Captured During Verification

Three todo files committed separately (not part of phase close):
1. `2026-04-16-create-new-posts-from-dashboard.md` — future phase: manual post creation from dashboard
2. `2026-04-16-implement-missing-gemini-queries.md` — proper fix for Phase 31 stubs (owner already resolved via `a417195`)
3. `2026-04-17-language-option-on-variant-pick.md` — language selector on variant finalization page

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 38 (New Lesson Run Form) is unblocked.** The full lesson-mode review UX (pick lesson + pick variant + inline image) is live and verified. Phase 38 adds the dashboard form to START a lesson-mode run, replacing `SSH + generate.py --mode lesson`.
- **v1.7 milestone status:** 5/6 phases shipped (33+34+35+36+37). Phase 38 is the final phase.
- **Known tech debt:** 4 CommitmentDetectionService test failures (Phase 25/26), 4 dashboard tsc errors (KeywordRuleFormDialog + Overview), DialogContent a11y warning on LessonGenerationModal.

## Phase 37 Commit Map (all repos)

### pm-authority
| Hash | Plan | Description |
|------|------|-------------|
| `0f0474e` | 37-01 | PostDTO additions (project_name, source_snippet, per-variant/candidate created_at) |

### whatsapp-bot
| Hash | Plan | Description |
|------|------|-------------|
| `796ea8a` | 37-01 | Proxy Zod schema mirror for new PostDTO fields |
| `41777cd` | 37-01 | Dashboard schemas + GenerationMetadata + StickyConfirmBar + stubs + barrel |
| `4ef1060` | 37-01 | Router routes + stub pages |
| `16da6f7` | 37-02 | useLinkedInPickLesson hook |
| `8f2fe15` | 37-02 | LessonCandidateCard + LessonGenerationModal |
| `77c4942` | 37-02 | LinkedInLessonSelection page |
| `b682e90` | 37-03 | useLinkedInPickVariant hook |
| `40aa22b` | 37-03 | VariantCard + VariantImageSlot |
| `07d90f0` | 37-03 | LinkedInVariantFinalization page |
| `b957463` | 37-04 | postStatus accentClass + LinkedInPostCard props |
| `ea7bc30` | 37-04 | PendingActionEntryButton + useNewArrivalFlash |
| `5e3ece3` | 37-04 | StatusStrip counters + LinkedInQueue integration |
| `44bea1c` | 37-05 | Stub getPairedExamples + getAllFromMeMessages (ESM boot fix) |
| `a417195` | 37-05 | Real Drizzle query implementations (owner fix) |

### Success Criteria Verification

- [x] **SC#1 (LIN-11):** PENDING_LESSON_SELECTION post shows 4 candidate lessons with lesson text + rationale; clicking one advances the post into variant generation. Observed live 2026-04-17.
- [x] **SC#2 (LIN-12):** PENDING_VARIANT post shows 2 variants side-by-side with content + image prompt; clicking one finalizes it. Observed live 2026-04-17.
- [x] **SC#3 (LIN-13):** fal.ai image renders inline on the focused variant card (spinner -> real image -> 1.5s visible -> nav away). Observed live 2026-04-17.

### Architectural Assumptions Documented

1. **GenerationMetadata** renders "Generated {relative} . Claude" — omits model name and token_cost columns that do not exist in pm-authority's schema today.
2. **Per-variant fal.ai image** is actually a single post-level image shown on the focused variant card only. The ancillary variant card stays in idle state. Owner accepted this interpretation.
3. **SSE-driven image update** piggybacks on the existing `/api/linkedin/queue/stream` (3s poll + sha1 dedup + 15s heartbeat). No dedicated image-status endpoint was needed.

---

*Phase: 37-lesson-mode-ux*
*Plan: 05 (Live Verification + Phase Close-out)*
*Completed: 2026-04-17*

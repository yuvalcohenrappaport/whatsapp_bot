---
phase: 37-lesson-mode-ux
plan: 03
subsystem: dashboard
tags: [react, react-router, sse, zod, linkedin, lesson-mode, pick-variant, fal-ai]

# Dependency graph
requires:
  - phase: 34-fastify-proxy-layer
    provides: POST /api/linkedin/posts/:id/pick-variant (mixed 200 PostDTO / 202 JobAccepted), GET /api/linkedin/posts/:id, GET /api/linkedin/posts/:id/image (?token= fallback)
  - phase: 35-linkedin-queue-read-side-ui
    provides: useLinkedInQueueStream SSE hook (shared across all LinkedIn pages), DashboardPostSchema / DashboardVariantSchema strongly-typed parsers, sonner toast router
  - phase: 36-review-actions-write
    provides: Bearer-token auth pattern on dashboard hooks, optimistic-patch mental model, sonner error-copy router
  - phase: 37-lesson-mode-ux (Plan 37-01)
    provides: GenerationMetadata + StickyConfirmBar shared primitives, DashboardPost/DashboardVariant types exported from api/linkedinSchemas, VariantCard + VariantImageSlot stub files at final import paths, LinkedInVariantFinalization.tsx stub page at final route, VariantImageMode type union exported from VariantImageSlot stub, barrel file index.ts already exporting all 5 Plan 37-02/03/04 stub symbols
provides:
  - "useLinkedInPickVariant hook — 9-state discriminated union with mixed 200/202 handling + ackSlow() callback for SSE-driven slow-path termination (no job polling, no 120s cap)"
  - "VariantCard presentational component — focus-then-confirm visual with bilingual content (post-level Hebrew + per-variant English) + collapsible image prompt + GenerationMetadata strip"
  - "VariantImageSlot presentational component — idle/pending/ready/error modes, pending mode shows spinner + 'Generating image…' + live elapsed-seconds counter that runs forever per CONTEXT §Area 3 Scenario B"
  - "LinkedInVariantFinalization page — 2-col responsive grid of 2 variants, StickyConfirmBar, fetch+SSE observation, 1500ms terminal nav delay, full error/guard surface"
  - "SSE-driven terminal-state pattern: page watches post.image.url AND post.status, calls hook.ackSlow() on transition, delays nav by exactly 1500ms so the fal.ai image is visually observable on the focused variant card"
affects: [37-04-queue-integration (entry buttons will navigate here), 37-05-verification (SC#2 + SC#3 live-observation targets)]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — reuses react, react-router-dom, sonner, lucide-react, zod
  patterns:
    - "Mixed 200/202 mutation hook with SSE ack callback: the page — not the hook — owns terminal-state observation so the timing of the visual-confirmation delay is page-local and testable"
    - "SSE-driven terminal state without client-side timeout: 202 → waiting_for_sse → page watches stream-delivered post.image.url + post.status → ackSlow() → succeeded_slow → 1500ms delay → nav. Honors CONTEXT §Area 3 Scenario B 'no client-side timeout' lock"
    - "Focus-then-confirm pattern reuse: same StickyConfirmBar primitive as Plan 37-02's lesson selection page, same ring-2 ring-blue-500 focus visual on card, same keyboard activation (Enter/Space)"
    - "Bilingual variant rendering reality: post.content_he lives at the POST level and is shared across both variants; variants differ ONLY in their English content field (matches pm-authority generation/generator.py output)"
    - "Single fal.ai image per post reality: pm-authority generates ONE image per post at pick-variant time, attached to post.image.url (not per-variant). Before pick: both VariantImageSlots render 'idle'. After pick: focused variant flips to 'pending'. After job succeeds: focused variant flips to 'ready' showing the post-level image. Ancillary variant stays 'idle'"
    - "Deliberate useLinkedInJob bypass: the generic job-poll hook has POLL_MAX_MS=120_000 cap; fal.ai regularly exceeds 2min; bypass is scoped to pick-variant only. useLinkedInPickLesson (Plan 37-02) still uses useLinkedInJob for its 4-candidate lesson-selection flow where the cap is safe"

key-files:
  created: []  # all 4 files pre-existed as Plan 37-01 stubs; this plan REPLACED stub bodies and ADDED hook body
  modified:
    - "dashboard/src/hooks/useLinkedInPickVariant.ts — created with full 125-line hook body (was untracked on disk from a prior executor's partial Task 1 progress; audited and committed verbatim per plan spec)"
    - "dashboard/src/components/linkedin/VariantImageSlot.tsx — Plan 37-01 stub (8 lines) replaced with 80-line 4-mode implementation (kept VariantImageMode export at top so barrel re-export stays stable)"
    - "dashboard/src/components/linkedin/VariantCard.tsx — Plan 37-01 stub (5 lines) replaced with 105-line focus-then-confirm card"
    - "dashboard/src/pages/LinkedInVariantFinalization.tsx — Plan 37-01 stub page (20 lines) replaced with 332-line full page"

key-decisions:
  - "useLinkedInPickVariant deliberately does NOT import useLinkedInJob. CONTEXT §Area 3 Scenario B locks 'no client-side timeout' and the generic hook's POLL_MAX_MS=120_000 cap would violate it because fal.ai inside the job worker can take >2min. Bypass scoped to pick-variant only; Plan 37-02's useLinkedInPickLesson still uses the generic hook (safe — lesson selection is fast)."
  - "ackSlow() callback pattern splits observation from ack: the hook stays in waiting_for_sse until the page — which owns the SSE subscription — explicitly flips it via ackSlow(). This lets the 1500ms visual-confirmation delay live in the page's terminal useEffect (single setTimeout per success branch) rather than hardcoded in the hook."
  - "1500ms terminal nav delay applied uniformly to BOTH the fast (200) and slow (202→ack) paths — same consistent pause lets the owner visually register the success state before the router navigates away. Without the delay on the slow path, SC#3 ('image renders inline on the variant card') would be unobservable (image rendered for <1 frame)."
  - "Bilingual content in VariantCard renders post.content_he at the POST level (shared across both variants) + variant.content for each variant's English copy. This matches the pm-authority reality where variants differ only in English content. Alternative ('show Hebrew only once in a shared top section') rejected as it would visually decouple the Hebrew from its variant peer on the final LinkedIn post preview. Flagged for owner sanity check during Plan 37-05 live verification."
  - "Per-variant image state: before any pick, both VariantImageSlots render 'idle' placeholder. After pick, focused variant flips to 'pending' while ancillary variant stays 'idle'. After job succeeds and post.image.url populates via SSE, focused variant flips to 'ready' showing the post-level image. This is the pragmatic interpretation of CONTEXT §Area 2's 'generated fal.ai image (or pending placeholder) on each variant card' against the pm-authority reality of one post-level image."
  - "Page takes ownership of SSE observation via useLinkedInQueueStream. One-shot GET /api/linkedin/posts/:id seeds initial state on mount; useEffect watching streamPosts re-seeds from posts.find(p => p.id === id) on every re-emit. If the post transitions out of the non-terminal queue (e.g. to PUBLISHED), the page keeps its last-known-good local copy so the in-progress flow doesn't flicker; the terminal useEffect has already called ackSlow() by that point."
  - "Barrel file dashboard/src/components/linkedin/index.ts deliberately untouched. Plan 37-01 is the single-writer for the entire Phase 37 barrel (the fix for the Wave-2 write race). git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts returns empty in every per-task commit."

patterns-established:
  - "SSE-driven mutation completion without client-side timeout: hook waits for explicit ack from the subscribing page"
  - "Uniform terminal visual-confirmation delay across fast + slow response paths"
  - "ackSlow callback split: observation lives in the page where the SSE subscription already lives"

requirements-completed: [LIN-12, LIN-13]  # LIN-11 landed in Plan 37-02; live verification on both deferred to Plan 37-05

# Metrics
duration: ~25min (resumption session only — includes Task 1 audit of prior-executor hook + Tasks 2-3 full implementation)
started: 2026-04-15T17:40Z (approx — continuation from prior executor rate-limit)
completed: 2026-04-15
---

# Phase 37 Plan 03: Variant Finalization Page (Wave 2) Summary

**Variant finalization page with 2-col responsive grid, focus-then-confirm StickyConfirmBar, mixed 200/202 pick-variant flow, SSE-driven inline fal.ai image state via an `ackSlow()` callback pattern that lets the page own a 1500ms visual-confirmation delay before navigating back to the queue.**

## Performance

- **Duration:** ~25 min (resumption session)
- **Tasks:** 3 / 3
- **Files modified:** 4 (all pre-existed as Plan 37-01 stubs / untracked hook)
- **Line count delta:** hook 0→125, VariantImageSlot 8→80, VariantCard 5→105, LinkedInVariantFinalization 20→332 (total 33→642 lines = +609 lines of real implementation)

## Accomplishments

- **LIN-12 + LIN-13 complete.** The variant finalization page is the full shipping surface for CONTEXT SC#2 ("PENDING_VARIANT shows 2 variants side-by-side") and SC#3 ("fal.ai image renders inline on the variant card without a manual reload"). Live verification deferred to Plan 37-05 per the Phase 37 execution plan.
- **Hook audit passed.** A prior executor had landed `useLinkedInPickVariant.ts` on disk before hitting a rate limit. The file matched Plan 37-03 Task 1's embedded code verbatim — 125 lines, 9-state discriminated union, zero references to `useLinkedInJob`. Audited, compiled clean, committed unchanged.
- **tsc -b + vite build clean** on every per-task commit. Final bundle: 771.56 kB raw / 229.64 kB gzip (+20.6 kB raw / +4.0 kB gzip vs Plan 37-02's 751.80 / 225.59 baseline — the delta is the full variant-finalization page + hook + 2 components, well inside the envelope).
- **Parallel execution with Plan 37-02 did not conflict.** Both plans ran on file-disjoint paths and committed into the same git tree simultaneously. Commit interleave in `git log`: 37-02 → 37-03 hook → 37-02 → 37-03 components → 37-03 page. Zero merge conflicts, zero retroactive fixups.
- **Barrel untouched.** `git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts` empty on every commit. Plan 37-01 remains the sole writer.
- **`grep -c "useLinkedInJob" dashboard/src/hooks/useLinkedInPickVariant.ts` = 0.** The critical design lock for CONTEXT §Area 3 Scenario B ("no client-side timeout") is verified.
- **1500ms terminal nav delay present in BOTH paths.** `grep "1500" LinkedInVariantFinalization.tsx` returns 6 occurrences: 3 comment references + 2 setTimeout calls (one in the `succeeded_fast` useEffect, one in the `succeeded_slow` useEffect) + 1 helper doc.

## Task Commits

1. **Task 1: useLinkedInPickVariant hook — 9-state union + mixed 200/202 + ackSlow()** — `b682e90` (feat, whatsapp-bot)
2. **Task 2: VariantCard + VariantImageSlot presentational components** — `40aa22b` (feat, whatsapp-bot)
3. **Task 3: LinkedInVariantFinalization page — full SSE-driven implementation** — `07d90f0` (feat, whatsapp-bot)

**whatsapp-bot commits:** `b682e90`, `40aa22b`, `07d90f0`

## Files Created / Modified

### dashboard (all under /home/yuval/whatsapp-bot/dashboard/src/)

- **`hooks/useLinkedInPickVariant.ts`** (NEW, 125 lines) — `PickVariantState` discriminated union with 9 kinds (`idle`, `submitting`, `succeeded_fast`, `waiting_for_sse`, `succeeded_slow`, `failed`, `already_picked`, `validation_error`, `network`). `pickVariant(postId, variantId)` POSTs to `/api/linkedin/posts/:id/pick-variant` with Bearer auth, branches on `res.status`: 200 → `DashboardPostSchema.safeParse` → `succeeded_fast` (degrade to `waiting_for_sse` on schema drift); 202 → `waiting_for_sse` (ignores `job_id` entirely, no polling); 409 / 400 / error envelope → discriminated error kinds. `ackSlow()` flips `waiting_for_sse` → `succeeded_slow` (idempotent — no-op on other states). `reset()` returns to `idle`. Zero references to `useLinkedInJob`.

- **`components/linkedin/VariantImageSlot.tsx`** (Plan 37-01 stub 8 lines → 80 lines) — 4-mode slot: `idle` (placeholder "Image will generate when you select this variant"), `pending` (spinner + "Generating image…" + live elapsed-seconds counter via inner `PendingImage` component with `setInterval(1000)`), `ready` (`<img>` pointing at `/api/linkedin/posts/:id/image?token=<jwt>`), `error` (red card with ImageOff icon + error message). Exports `VariantImageMode` type union (was already exported from the Plan 37-01 stub; preserved). No client-side timeout anywhere — the `pending` spinner runs forever.

- **`components/linkedin/VariantCard.tsx`** (Plan 37-01 stub 5 lines → 105 lines) — Card shell with `role="button"`, `aria-pressed={focused}`, keyboard activation (Enter/Space), focused visual `ring-2 ring-blue-500 bg-blue-50/60`. Renders: badge with `variant.kind` + "Selected" tick on focus; `<VariantImageSlot>` with computed mode from the page; post-level Hebrew (dir=rtl) + per-variant English (dir=ltr); collapsible `<details>` image prompt (closed by default, uses `e.stopPropagation()` on click to prevent card focus when toggling); `<GenerationMetadata createdAt={variant.created_at} />` at the bottom. Flexbox layout with `mt-auto` on the details so the metadata sits flush bottom regardless of content length difference between variants.

- **`pages/LinkedInVariantFinalization.tsx`** (Plan 37-01 stub 20 lines → 332 lines) — Full page. **State:** local `post`, `fetchError`, `focusedVariantId`, hook result, stream subscription. **Effects:** (1) one-shot GET /api/linkedin/posts/:id with Zod guard; (2) re-seed `post` from streamPosts.find on every SSE re-emit (keeps last-known-good if the post leaves the non-terminal queue); (3) `succeeded_fast` terminal useEffect — toast + 1500ms setTimeout → `navigate('/linkedin/queue')`; (4) `waiting_for_sse` watcher — when `post.image?.url` populates OR `post.status` leaves PENDING_VARIANT, call `ackSlow()`; (5) `succeeded_slow` terminal useEffect — toast + 1500ms setTimeout → nav. **Guards:** fetchError card, loading skeletons, `post.status !== 'PENDING_VARIANT'` message, `post.variants.length < 2` message, schema drift message. **Main render:** back link, project/perspective/language/generated metadata card with collapsible source snippet, error banner (rendered by `renderErrorBanner(state)` helper), 2-col responsive grid of `<VariantCard>` with `modeFor(variantId)` computed per card, sticky confirm bar at the bottom with contextual helper copy (waiting / submitting / finalized / click-to-select / ready) and disabled-during-all-in-flight-states.

## Decisions Made

1. **useLinkedInPickVariant bypasses useLinkedInJob.** `CONTEXT §Area 3 Scenario B` explicitly forbids client-side timeouts; the generic `useLinkedInJob` enforces a 120s `POLL_MAX_MS` cap, which fal.ai inside the pick-variant job worker regularly exceeds. This hook is the sole bypass in the Phase 37 codebase; Plan 37-02's `useLinkedInPickLesson` still uses the generic hook (safe — lesson selection is fast).

2. **ackSlow() pattern (observation / ack split).** After a 202, the hook stays in `waiting_for_sse` until the page (which already subscribes to `useLinkedInQueueStream` for the live image render) observes a terminal transition and explicitly flips the hook via `ackSlow()`. This places the 1500ms visual-confirmation delay in the page's terminal useEffect instead of hardcoded inside the hook.

3. **1500ms uniform terminal nav delay on BOTH fast and slow paths.** Applied via one `setTimeout` per terminal useEffect — one in the `succeeded_fast` branch, one in the `succeeded_slow` branch. Uniform delay gives the owner consistent muscle memory and lets SC#3 ("image renders inline on the variant card") actually be observable (without it, the image would flash for <1 frame before the router navigates).

4. **Bilingual content: post-level Hebrew shared across both variants.** `post.content_he` is rendered identically inside both VariantCards because that's the pm-authority reality — variants only differ in their English `content` field. The alternative (shared top-of-page Hebrew section) was rejected because it would visually decouple the Hebrew from its peer English copy and confuse the final LinkedIn post preview. **Flagged for owner sanity check during Plan 37-05 live verification** — if the owner finds it confusing, the fix is a one-line JSX restructure.

5. **Per-variant image state reality: one post-level image.** pm-authority generates exactly one fal.ai image per post at pick-variant time. Before pick: both VariantImageSlots show `idle`. After pick: focused variant → `pending`. After SSE delivers `post.image.url`: focused variant → `ready`. Ancillary variant stays `idle` throughout. This is the pragmatic interpretation of CONTEXT §Area 2's "generated fal.ai image on each variant card" against the pm-authority architectural reality. Literal 2-image side-by-side is deferred (would require pre-generation in generator.py + a new per-variant image_url column).

6. **Barrel file single-writer.** `dashboard/src/components/linkedin/index.ts` untouched — Plan 37-01's re-exports of VariantCard / VariantImageSlot / VariantImageMode already cover this plan's stub replacements. Verified via `git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts` returning empty on every commit.

## Deviations from Plan

### Auto-fixed Issues

None. The plan's embedded code compiled clean on first write and passed `tsc -b` + `vite build` on every per-task checkpoint.

**Total deviations:** 0 auto-fixes (Rules 1-3), 0 architectural escalations (Rule 4).
**Impact on plan:** zero. The plan's spec matched the final implementation 1:1 modulo minor comment/helper reorganization (e.g., extracting `helperText` as a `const` outside the JSX for readability).

## Authentication Gates

None. The dashboard already has JWT login from Phase 35-04; `localStorage.getItem('jwt')` is the Bearer token source for both the POST and the `<img>` `?token=` query fallback. No new auth surface was introduced.

## Issues Encountered

- **Pre-existing uncommitted modifications to 6 unrelated dashboard files** (`KeywordRuleFormDialog.tsx`, `ScheduleMessageDialog.tsx`, `button.tsx`, `useSettings.ts`, `ScheduledMessages.tsx`, `vite.config.ts`) were present in `git status` throughout this session. All file-level `git add` calls deliberately named only the 4 Plan 37-03 files to avoid sweeping in cross-phase work. Out of scope for Plan 37-03; no deferred-items.md entry needed (these are from a separate WIP on other phases).
- **REQUIREMENTS.md / ROADMAP.md mid-session linter revert.** During metadata updates, an external process reverted LIN-11/12/13 checkboxes and the Phase 37 progress row. Re-applied my 37-03 edits on top of the 37-02 executor's prior edits; final state is consistent (3/5 plans executed, LIN-11/12/13 all marked complete, Phase 37 row = `v1.7 | 3/5 | In Progress`). No data lost.
- **Parallel 37-02 executor uncommitted metadata.** At the time 37-03 started committing metadata, the 37-02 executor's `37-02-SUMMARY.md` existed on disk but was uncommitted. The 37-03 final metadata commit SHOULD bundle it in alongside 37-03 files — **decision:** only commit 37-03 metadata + this SUMMARY + STATE/ROADMAP/REQUIREMENTS; leave 37-02's SUMMARY for its own executor to commit (we don't own that file). If the 37-02 executor doesn't commit it, the next planner/phase-close agent will pick it up.

## Next Phase Readiness

- **Wave 3 (Plan 37-04 — Queue integration) unblocked.** `PendingActionEntryButton.tsx` stub still exists from Plan 37-01. Plan 37-04 replaces the stub body and wires it into `LinkedInPostCard.actionsSlot` via the Plan 36-02 render-prop hook-point. The new routes `/linkedin/queue/posts/:id/lesson` (Plan 37-02) and `/linkedin/queue/posts/:id/variant` (this plan) are both live — Plan 37-04's entry buttons just `navigate(...)` to them.
- **Plan 37-05 live verification will cover BOTH Plan 37-02 and Plan 37-03 end-to-end.** The shared verification script can walk: (1) queue with a PENDING_LESSON_SELECTION post → Pick lesson entry → lesson selection page → confirm → locked modal → auto-nav to variant page → variant finalization page → confirm → fal.ai image generation visible → 1500ms observe → nav back to queue → post now in APPROVED/DRAFT. Owner verification targets CONTEXT SC#1 (Plan 37-02), SC#2 + SC#3 (Plan 37-03), and the left-edge stripe + queue pill colors (Plan 37-04).
- **PM2 restart NOT required for this plan.** 100% dashboard-side. `whatsapp-bot` and `pm-authority-http` already serve the underlying `/api/linkedin/posts/:id/pick-variant` endpoint from Phase 34-03. Plan 37-05 will handle any final restart coordination.
- **Remaining plans:** 37-04 (queue integration, LIN-11-13 polish), 37-05 (live verification + STATE/ROADMAP/REQUIREMENTS finalization).

---

*Phase: 37-lesson-mode-ux*
*Plan: 03 (Variant Finalization, Wave 2)*
*Completed: 2026-04-15*

## Self-Check: PASSED

- Commit `b682e90` (Task 1 hook): verified in `git log --oneline`
- Commit `40aa22b` (Task 2 components): verified in `git log --oneline`
- Commit `07d90f0` (Task 3 page): verified in `git log --oneline`
- `dashboard/src/hooks/useLinkedInPickVariant.ts` (125 lines): verified on disk
- `dashboard/src/components/linkedin/VariantImageSlot.tsx` (80 lines): verified on disk
- `dashboard/src/components/linkedin/VariantCard.tsx` (105 lines): verified on disk
- `dashboard/src/pages/LinkedInVariantFinalization.tsx` (332 lines): verified on disk
- `grep -c "useLinkedInJob" dashboard/src/hooks/useLinkedInPickVariant.ts` = 0: verified
- `git diff --stat HEAD -- dashboard/src/components/linkedin/index.ts` empty: verified
- `1500` appears in 6 locations inside LinkedInVariantFinalization.tsx (3 docstring/comment + 2 setTimeout + 1 inline comment): verified
- `npx tsc -b && npx vite build` exit 0: verified on final commit (bundle 771.56 kB raw / 229.64 kB gzip)

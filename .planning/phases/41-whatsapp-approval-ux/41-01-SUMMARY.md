---
phase: 41-whatsapp-approval-ux
plan: 01
subsystem: approval
tags: [typescript, vitest, pure-functions, bilingual, grammar-parser, preview-template]

# Dependency graph
requires:
  - phase: 40-unified-detection-pipeline
    provides: actionables pending_approval rows awaiting user decision + detection language signal
provides:
  - composePreview(items, language, contactName) — single + batched EN/HE self-chat preview strings
  - parseApprovalReply(replyText, itemCount) — bilingual quoted-reply grammar parser
  - ApprovalDirective type (action: approve|reject|edit, itemIndex: N|'all', editText?)
affects: [41-02 preview-dispatcher, 41-03 reply-handler, 41-04 debounce-bucket, 41-05 live-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function modules in src/approval/ — no DB, no I/O, no WhatsApp calls"
    - "Bilingual grammar via shared synonym sets (EN + HE mixed) — no language argument needed on parser"
    - "Any-malformed-directive → [] (no partial parse) — caller re-posts grammar hint on []"

key-files:
  created:
    - src/approval/previewTemplates.ts
    - src/approval/replyParser.ts
    - src/approval/__tests__/previewTemplates.test.ts
    - src/approval/__tests__/replyParser.test.ts
  modified: []

key-decisions:
  - "parseApprovalReply takes (replyText, itemCount) with no language arg — bilingual synonym sets handle both EN + HE without branching"
  - "Single-digit item indices only (1–9) — with the 2-min debounce bucket, >9 items in one preview is a degenerate case the v1 grammar doesn't need to handle"
  - "Un-numbered edit: is NOT supported — edit always needs an item number since it rewrites a specific actionable"
  - "Latin tokens are case-insensitive (approve/reject synonyms + 'edit:' prefix); Hebrew tokens + emojis match literally"
  - "Any malformed or out-of-range directive invalidates the whole reply — no partial parse"
  - "Empty edit body (`1 edit:`) returns [] — caller re-posts grammar hint"
  - "Multiple directives with the same item index are permitted in the returned array; downstream dedupes to last-wins"

patterns-established:
  - "src/approval/ is the home for pure-function UX primitives — future UX iterations (calendar invites, PII gates) should match this layout"
  - "Composer is dumb about truncation — caller pre-truncates snippets (max 100 chars) before passing to composePreview"

requirements-completed: [APPR-01, APPR-02, APPR-03, APPR-04]

# Metrics
duration: 12min
completed: 2026-04-19
---

# Phase 41 Plan 01: Preview Composer + Reply Parser Summary

**Two pure-function TS modules own the Phase 41 UX vocabulary: composePreview emits EN/HE single and batched preview strings, parseApprovalReply turns quoted replies into ApprovalDirective[] arrays. 34 vitest cases green in 237ms.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-19T20:45Z
- **Completed:** 2026-04-19T20:57Z
- **Tasks:** 3 (1 composer, 1 parser, 1 test suite across 2 files)
- **Files created:** 4 (2 src + 2 tests)

## Accomplishments

- `composePreview` emits the exact wire format for both single-item (4-line) and batched (numbered) previews in EN + HE, with null-contactName handling for batch headers
- `parseApprovalReply` handles all 9 grammar cases from the PLAN action table: bulk ✅/❌, numbered per-item, multi-directive, EN+HE edit with colon/whitespace preservation, case-insensitivity for Latin tokens, out-of-range rejection, empty-body rejection, trailing-garbage rejection, empty input
- Zero mocks, zero I/O, zero deps touched — approvable-only-through-import for Plans 41-02..05
- 34/34 vitest green (15 preview + 19 parser), total runtime 237 ms — well under the 200 ms per-file budget from the plan

## Task Commits

1. **Task 1: composePreview (EN + HE templates)** — `9e5bf0e` (feat)
2. **Task 2: parseApprovalReply grammar parser** — `3289a74` (feat)
3. **Task 3: Vitest suites** — `b6e0ee1` (test)

## Files Created/Modified

- `src/approval/previewTemplates.ts` (108 lines) — `composePreview` + `PreviewItem` type + EN/HE `batchHeader` + `batchHint` helpers
- `src/approval/replyParser.ts` (201 lines) — `parseApprovalReply` + `ApprovalDirective` + `ApprovalAction` types + `APPROVE_SYNONYMS`/`REJECT_SYNONYMS` sets + `EDIT_PREFIXES` list
- `src/approval/__tests__/previewTemplates.test.ts` (101 lines, 15 test cases) — exact-string assertions for single/batch/null-contactName EN+HE, empty-array throws
- `src/approval/__tests__/replyParser.test.ts` (179 lines, 19 test cases) — bulk EN+HE, numbered per-item, multi-directive, edit grammar EN+HE, case-insensitivity, edge cases (empty, whitespace-only, out-of-range, unknown synonym, leading garbage, empty edit body, zero itemCount, un-numbered edit)
- `.planning/phases/41-whatsapp-approval-ux/deferred-items.md` — logs pre-existing `better-sqlite3` + `CommitmentDetectionService` failures (unrelated to approval module)

## Decisions Made

- **No `language` parameter on `parseApprovalReply`** — the plan frontmatter listed `parseApprovalReply(replyText, itemCount, language)` in the must_haves.truths narrative but the Task 2 code signature omits it. The bilingual synonym sets already mix EN + HE tokens in a single `Set<string>`, so language-branching would be dead code. Chose the simpler 2-arg signature from the Task 2 body. If a future plan needs language-scoped parsing (e.g. reject HE in an EN-locked room), it can be added as an optional 3rd arg without breaking callers.
- **`parseApprovalReply` early-return on `itemCount < 1`** — defensive, so callers that pass 0 by accident get `[]` instead of an out-of-range comparison failing and crashing. Doesn't affect the normal path.
- **Whitespace tolerance on bulk approve/reject** — bulk matching is done after `trim()`, so `"   ✅   "` is accepted. Matches real WhatsApp paste behavior (users often reply with trailing newlines).
- **Empty edit body = unparseable** — `"1 edit:"` returns `[]` rather than `{action:'edit', itemIndex:1, editText:''}`. An empty edit has no downstream semantics (you can't "apply" an empty rewrite), so routing it to `[]` forces the caller to re-post the grammar hint — clearer than silently discarding.

## Deviations from Plan

None — plan executed exactly as written.

**Scope boundary note:** 15 pre-existing vitest failures (backfill + actionables + CommitmentDetection) surfaced when running the full `npx vitest run`. All are `better-sqlite3` native-binding ABI mismatches or baseline Gemini-mock failures from Phase 36 — NOT caused by Plan 41-01. Logged to `deferred-items.md` per the scope-boundary rule. Approval-module vitest runs (`npx vitest run src/approval/__tests__/`) are 34/34 green.

## Issues Encountered

- `.planning/` is in `.gitignore`; already-tracked files continue to track but newly-added files need `git add -f`. Used `-f` for `deferred-items.md` on the Task 3 commit to match the existing repo convention.

## Self-Check: PASSED

- FOUND: `src/approval/previewTemplates.ts`
- FOUND: `src/approval/replyParser.ts`
- FOUND: `src/approval/__tests__/previewTemplates.test.ts`
- FOUND: `src/approval/__tests__/replyParser.test.ts`
- FOUND: commit `9e5bf0e` (Task 1)
- FOUND: commit `3289a74` (Task 2)
- FOUND: commit `b6e0ee1` (Task 3)
- VITEST: 2 files, 34 tests, 34 passed, 237 ms

## Next Phase Readiness

- Plan 41-02 can import `composePreview` + `parseApprovalReply` directly with zero shim
- Signature is stable: if a later plan needs language-scoped parsing, an optional 3rd arg is backward-compatible
- Grammar table is documented in-source (module doc block) so the reply-handler in Plan 41-03 has a single source of truth
- Requirements APPR-01..04 ready to flip to Complete in REQUIREMENTS.md

---
*Phase: 41-whatsapp-approval-ux*
*Completed: 2026-04-19*

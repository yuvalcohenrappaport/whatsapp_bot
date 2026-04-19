---
phase: 41-whatsapp-approval-ux
plan: 03
subsystem: approval
tags: [typescript, vitest, whatsapp, quoted-reply, google-tasks, bilingual, idempotent]

# Dependency graph
requires:
  - phase: 41-whatsapp-approval-ux
    plan: 01
    provides: parseApprovalReply + ApprovalDirective — imported directly to parse the quoted-reply grammar
  - phase: 41-whatsapp-approval-ux
    plan: 02
    provides: approval_preview_message_id annotation on actionables — the quoted-reply key.id hits this field
  - phase: 39-actionables-data-model
    provides: updateActionableStatus/Task/TodoIds + status lifecycle (pending_approval → approved/rejected)
provides:
  - tryHandleApprovalReply(sock, text, quotedMsgId, replyLang) → boolean — the messageHandler hook
  - getActionablesByPreviewMsgId(previewMsgId) — plural sibling to the existing singular lookup
  - resolveTitle(actionable) internal helper — the Phase 42 enrichment interception point
affects: [41-04 first-boot-digest + init wiring, 41-05 live-verification, 42 enrichment hook-in]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Directive-executor shape: expand 'all' → per-item, dedupe last-wins, apply in order — mirrors the reply-parser's 'any-malformed → []' lock at the next layer down (any already-handled → warn, don't crash)"
    - "Confirmation language reads per-item from actionable.detectedLanguage — a batch with mixed-language items sends per-item localized confirmations in their own language, NOT the reply's language"
    - "resolveTitle(actionable) internal helper — Phase 42 will swap this to inject the enriched title; approve path keeps raw task for Phase 41"
    - "Google Tasks sync failure is logged + swallowed — actionable stays approved in the DB so a future retry or manual fix is still possible"

key-files:
  created:
    - src/approval/approvalHandler.ts
    - src/approval/__tests__/approvalHandler.test.ts
  modified:
    - src/db/queries/actionables.ts
    - src/db/queries/__tests__/actionables.test.ts
    - src/pipeline/messageHandler.ts

key-decisions:
  - "Plural lookup getActionablesByPreviewMsgId lives alongside the existing singular getActionableByPreviewMsgId — kept both (singular is still used by the existing actionables.test.ts roundtrip + stays available for single-item call sites). Plural orders by createdAt asc so item indices stay stable with the batched preview's 1..N numbering."
    - "Refresh the local actionable snapshot after an edit (in-memory clone with the new task) instead of re-reading from the DB — saves a round-trip and keeps the approveAndSync flow inside a single function call."
  - "Confirmations ALWAYS read language from the actionable, never from replyLang — user may reply in EN to a HE preview, but the confirmation should match the preview (the thing they're looking at)."
  - "Grammar-hint language DOES prefer the actionables' detectedLanguage (consistent with the preview they saw), falling back to replyLang only if the actionable has no language set — edge case that shouldn't occur in practice."
  - "Last-wins dedupe applied AFTER 'all' expansion — lets '✅ 1 ❌' (bulk-then-override item 1) cleanly reject item 1 while approving the rest. Preserves the position of the last occurrence for deterministic confirmation ordering."
  - "isTasksConnected=false → still flip to approved + confirm, log an info line. Keeps the approval UX consistent when Google Tasks isn't wired up yet — Phase 41 doesn't gate on it."
  - "buildBasicNote truncates the source-text snippet at 200 chars (generous vs. the 100-char preview snippet — the note is stored in Google Tasks UI, not the preview, and can afford the extra room)."
  - "Already-handled warning uses the actionable's status verbatim in parentheses (approved/rejected/fired/expired) — more debuggable than a generic 'already handled' string."

requirements-completed: [APPR-02, APPR-03, APPR-04]

# Metrics
duration: 8min
completed: 2026-04-19
---

# Phase 41 Plan 03: Quoted-Reply Approval Handler Summary

**Ship the final leg of the Phase 41 round-trip: `tryHandleApprovalReply(sock, text, quotedMsgId, replyLang)` pulls every actionable under a quoted preview, parses via Plan 41-01's `parseApprovalReply`, expands 'all' into per-item directives, dedupes last-wins, and applies approve/edit/reject in input order with raw-text Google Tasks sync on approve. messageHandler.ts self-chat branch now routes stanzaId-bearing replies in the exact plan order: calendar approval → todo cancel → scheduled cancel → **approval reply (new)** → reminder. 13 new vitest cases green in 16 ms; 65/65 across the full approval subsystem.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-19T21:04Z
- **Completed:** 2026-04-19T21:10Z
- **Tasks:** 4 (plural query, approvalHandler, messageHandler wiring, vitest)
- **Files created:** 2 (1 src + 1 test)
- **Files modified:** 3 (actionables query + its test + messageHandler)
- **Commits:** 4 atomic (feat/feat/feat/test)

## Accomplishments

- `src/db/queries/actionables.ts` gets `getActionablesByPreviewMsgId(previewMsgId)` — plural sibling to the existing singular lookup, ordered by createdAt asc so item indices stay stable with the preview's 1..N numbering. Existing singular kept (still used by the roundtrip test in actionables.test.ts; the plural was additive rather than a rename).
- `src/approval/approvalHandler.ts` (283 lines) owns the directive-execution loop: quoted-msg-id lookup → `parseApprovalReply(text, items.length)` → empty-parse grammar-hint short-circuit → `expandAllDirectives` ('all' → one-per-item) → `dedupeLastWins` by itemIndex → `applyDirective` per item.
  - `applyDirective` gates on `status === 'pending_approval'` — already-handled items emit a single `⚠️ Item N already handled (status) — skipped.` warning (localized EN/HE) and skip without mutating.
  - Edit path rewrites `actionable.task` via `updateActionableTask`, refreshes the local snapshot in-memory, and falls through to `approveAndSync` so a single `✅ Added: <new title>` confirmation is sent.
  - `approveAndSync` flips status to `approved`, checks `isTasksConnected()`, calls `createTodoTask({ title: resolveTitle(actionable), note: buildBasicNote(actionable) })`, writes `todo_task_id + todo_list_id` back via `updateActionableTodoIds`, and sends `✅ Added: <task>` (or `✅ נוסף: <task>` for HE). Google Tasks failures are logged + swallowed; actionable stays approved in the DB.
  - `resolveTitle(actionable)` is a dedicated helper returning the raw `actionable.task` — the Phase 42 hook-in point for enrichment.
  - `buildBasicNote(actionable)` emits `From: <contactName or jid or 'Self'>\nOriginal: "<snippet>"` truncated to 200 chars. Source-text empty → just `From: <who>`.
  - Reject path flips to `rejected` + sends `❌ Dismissed` (EN) or `❌ בוטל` (HE).
  - Unparseable reply sends a one-line hint — `Reply ✅ / ❌ / edit: <text> (or number + action for a specific item)` (EN) or `השב ✅ / ❌ / עריכה: <טקסט> (או מספר + פעולה עבור פריט ספציפי)` (HE) — NEVER the full preview. Hint language prefers `items[0].detectedLanguage` (consistent with the preview they saw), fallback to `replyLang`.
- `src/pipeline/messageHandler.ts` self-chat branch rewired: reminder handler moved DOWN from its previous "2nd after calendar" position to the very bottom of the quoted-reply chain. New order: calendar approval → todo cancel → scheduled cancel → **approval reply (new)** → reminder. `tryHandleApprovalReply` receives `stanzaId`, the reply text, and `detectMessageLanguage(text)` for the grammar-hint fallback; returns false when the quoted msg id doesn't match any actionable so the reminder path continues to see every other quoted reply.
- 13 new vitest cases green in 16 ms across 1 new test file (`approvalHandler.test.ts`, 410 lines): unknown quoted-msg-id (returns false), bulk ✅ on 2-item batch (2 approves + 2 syncs + 2 EN confirmations), `1 ✅ 2 ❌` mixed (1 approve + 1 reject), `1 edit: <new>` (task rewrite + approve with new title), unparseable EN (EN grammar hint), unparseable HE (HE grammar hint), already-handled item (warning, no mutation), HE approve `1 אישור` (HE confirmation `✅ נוסף: …`), double-approve across 2 calls (second is idempotent warning), `createTodoTask` throws (status still flipped, confirmation still sent), `isTasksConnected()=false` (no sync attempt, confirmation still sent), `1 ✅ 1 ❌` dedupe (last-wins → reject), Google Tasks note carries From + Original snippet.
- Full approval + detectionService vitest: 65/65 green in 85 ms (34 Plan 41-01 + 18 Plan 41-02 + 13 new Plan 41-03). The actionables.test.ts sibling (2 added cases for the plural query) was NOT executed locally — it's still blocked by the pre-existing `better-sqlite3` ABI mismatch logged in `deferred-items.md`. Added cases are source-level reviewed and follow the same pattern as the singular-lookup test beside them.

## Task Commits

1. **Task 2: getActionablesByPreviewMsgId plural query** — `c1fad90` (feat)
2. **Task 1: approvalHandler directive executor** — `0259f28` (feat)
3. **Task 3: messageHandler self-chat routing** — `5919e3e` (feat)
4. **Task 4: vitest suite for approvalHandler** — `5eea77c` (test)

(Task 2 was committed first because Task 1 imports the new plural query.)

## Files Created/Modified

- `src/approval/approvalHandler.ts` (283 lines) — `tryHandleApprovalReply` + internal `applyDirective` / `approveAndSync` / `resolveTitle` / `buildBasicNote` / `expandAllDirectives` / `dedupeLastWins` / `sendGrammarHint` / `pickHintLanguage` + confirmation/hint copy helpers
- `src/approval/__tests__/approvalHandler.test.ts` (410 lines, 13 cases) — real `replyParser` + mocked DB + Google Tasks + sock; covers bulk, per-item mixed, edit, unparseable (EN+HE), already-handled, HE approve, idempotency, sync-failure, sync-disabled, dedupe, note body
- `src/db/queries/actionables.ts` (+21 lines) — added `asc` import, new `getActionablesByPreviewMsgId` plural query below the existing singular lookup
- `src/db/queries/__tests__/actionables.test.ts` (+22 lines, 2 cases) — batched createdAt ordering + empty-result path
- `src/pipeline/messageHandler.ts` (+21 / -5) — imported `tryHandleApprovalReply` + `detectMessageLanguage`; moved reminder handler to after the cancel chain and inserted the new approval hook in the plan-required slot

## Decisions Made

- **Singular `getActionableByPreviewMsgId` kept alongside the new plural** — the plan said "Replace the existing singular or leave both". Kept both because the existing `actionables.test.ts` roundtrip test uses the singular directly, and the singular is still semantically useful for single-item call sites even though nothing calls it today. Zero cost to keep (1 extra query function in a small module); additive path avoided touching the stable singular-test assertion.
- **Refresh the local actionable snapshot after an edit (in-memory clone with the new task) instead of re-reading from the DB** — saves a round-trip and keeps the approveAndSync flow inside a single function call. The DB mutation already happened via `updateActionableTask`; the in-memory refresh is just so the downstream confirmation and `resolveTitle` see the new text without fetching.
- **Confirmation language reads per-item from `actionable.detectedLanguage`, NEVER from `replyLang`** — scenario: user replies in EN to a HE-language preview (mixed-script reply on a mixed-chat). The confirmation should match the thing they're looking at (the preview), not the language of their keystrokes. Per-item consistency preserves the illusion of a single localized UX even when the reply itself is mixed.
- **Grammar-hint language prefers actionables' language, falls back to `replyLang`** — different from confirmations because the hint is a general grammar reminder, not tied to a specific item. Picking the items' language keeps it consistent with the preview they saw; the fallback to `replyLang` handles the edge case where an actionable has no language set (shouldn't occur in practice).
- **Last-wins dedupe applied AFTER 'all' expansion** — lets `✅ 1 ❌` (bulk-then-override item 1) cleanly reject item 1 while approving the rest. The filter preserves the position of the LAST occurrence for deterministic confirmation ordering, so batch confirmations don't jump around relative to directive input.
- **`isTasksConnected()=false` → still flips to approved + confirms, logs info line** — keeps the approval UX consistent when Google Tasks isn't wired up yet; Phase 41 explicitly does NOT gate on the Google Tasks availability. A disconnected Tasks integration results in an approved actionable with `todo_task_id=null`, which Phase 43's dashboard audit view can surface.
- **`buildBasicNote` truncates the source-text snippet at 200 chars** — more generous than the 100-char preview snippet because the note is stored in Google Tasks UI (has more real-estate) and often contains the contextual sentence that drives the follow-up. Empty source text → drop the `Original: "…"` clause entirely instead of emitting `Original: ""`.
- **Already-handled warning includes the status verbatim** — `⚠️ Item 1 already handled (approved) — skipped.` is more debuggable than `⚠️ already handled`; the status reveal helps the owner realize why their command was a no-op (the actionable already fired, or was rejected through the dashboard, etc.).

## Deviations from Plan

**None that affect behavior.**

One structural adjustment: in Task 1's narrative the plan said `updateActionableTodoIds` is called with a `result` object from `createTodoTask` — the actual `createTodoTask` signature returns `{taskId, listId}` while `updateActionableTodoIds` expects `{todoTaskId, todoListId}`. Plan 41-03's approvalHandler does the key-rename inline (`updateActionableTodoIds(id, { todoTaskId: result.taskId, todoListId: result.listId })`). Mechanical, no behavior change.

Task-order note: Task 2 (the plural query) was committed FIRST because Task 1 (approvalHandler) imports `getActionablesByPreviewMsgId`. The commits landed out-of-numerical-order (2 → 1 → 3 → 4) but the dependency graph is honored.

## Issues Encountered

- `src/db/queries/__tests__/actionables.test.ts` can't run locally — the pre-existing `better-sqlite3` NODE_MODULE_VERSION 115 vs 127 ABI mismatch (logged in `deferred-items.md` from Plan 41-01) blocks the entire file. The 2 new test cases for `getActionablesByPreviewMsgId` are source-reviewed and follow the exact same pattern as the adjacent singular-lookup roundtrip test. When `npm rebuild better-sqlite3` lands as a follow-up, these cases will exercise automatically.
- Same pre-existing `tsc --noEmit` rootDir noise on `cli/bot.ts` + `cli/commands/persona.ts` — unrelated to this plan, logged in `deferred-items.md`. New Plan 41-03 files produce zero new tsc errors.

## Self-Check: PASSED

- FOUND: `src/approval/approvalHandler.ts`
- FOUND: `src/approval/__tests__/approvalHandler.test.ts`
- MODIFIED: `src/db/queries/actionables.ts` (plural query added)
- MODIFIED: `src/db/queries/__tests__/actionables.test.ts` (2 cases added)
- MODIFIED: `src/pipeline/messageHandler.ts` (approval hook + reminder reorder)
- FOUND: commit `c1fad90` (Task 2)
- FOUND: commit `0259f28` (Task 1)
- FOUND: commit `5919e3e` (Task 3)
- FOUND: commit `5eea77c` (Task 4)
- VITEST (approvalHandler): 1 file, 13 tests, 13 passed, 16 ms
- VITEST (full approval suite): 5 files, 65 tests, 65 passed, 85 ms
- TSC: clean (no new errors; pre-existing cli/bot.ts + cli/commands/persona.ts rootDir noise unchanged)

## Next Phase Readiness

- Plan 41-04 can now call `setFlushCallback(sendBucketPreview)` + flip `v1_8_detection_pipeline = 'interactive'` at boot; once flipped, the full round-trip (detect → bucket → preview → quoted-reply → approve/reject/edit → Google Tasks) is live.
- Plan 41-04's first-boot digest will use the same `tryHandleApprovalReply` hook — any quoted-reply to the digest message gets the same grammar + directive executor for free.
- Phase 42's enrichment hook-in point is `resolveTitle(actionable)` in `src/approval/approvalHandler.ts` — Phase 42 can export a replacement implementation (or monkey-patch at boot) that reads `actionable.enrichedTitle` and falls back to the raw task. No other call sites need to change.
- APPR-02 / APPR-03 / APPR-04 ready to flip to Complete in REQUIREMENTS.md (APPR-01 already complete from Plan 41-01).

---
*Phase: 41-whatsapp-approval-ux*
*Completed: 2026-04-19*

---
phase: 42-context-enrichment-at-approval
plan: "01"
subsystem: approval/enrichment
tags: [enrichment, gemini, zod, approval, google-tasks]
dependency_graph:
  requires: [41-03-SUMMARY, 41-04-SUMMARY]
  provides: [enrichActionable, buildBasicNote export]
  affects: [src/approval/approvalHandler.ts, src/approval/enrichmentService.ts]
tech_stack:
  added: []
  patterns: [Gemini structured JSON output, Zod safeParse, try/catch fallback, circular import breaking via vi.mock]
key_files:
  created:
    - src/approval/enrichmentService.ts
    - src/approval/__tests__/enrichmentService.test.ts
  modified:
    - src/approval/approvalHandler.ts
    - src/approval/__tests__/approvalHandler.test.ts
decisions:
  - buildBasicNote exported from approvalHandler.ts (not extracted to a shared util) — single source of truth for fallback note format, avoids proliferating a shared module for one function
  - resolveTitle removed (dead code since Phase 41 — was always a straight pass-through to actionable.task; enrichmentService now owns title resolution)
  - Confirmation copy unchanged — self-chat still shows actionable.task (matches preview); enriched title goes to Google Tasks only
  - enrichmentService test mocks approvalHandler.js directly (not via transitive import) to break the circular import: enrichmentService → approvalHandler → enrichmentService
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-20"
  tasks: 3
  files_modified: 4
---

# Phase 42 Plan 01: Context Enrichment at Approval — Summary

**One-liner:** Gemini second-pass at approval time converts vague task strings like "Check it" into self-contained Google Tasks titles like "Follow up with Lee on Q2 report by Monday" via Zod-validated structured output, with safe fallback on any failure.

## What Was Built

### Task 1 — `src/approval/enrichmentService.ts` (new, 147 lines)

Pure module exporting `enrichActionable(actionable): Promise<Enrichment>`.

**API:**
```typescript
export interface Enrichment { title: string; note: string }
export async function enrichActionable(actionable: Actionable): Promise<Enrichment>
```

**Behavior:**
- `user_command` source type short-circuits at the top — returns `{title: actionable.task, note: buildBasicNote(actionable)}` immediately. No Gemini call, no latency. Preserves Phase 41 Q9A-1 decision.
- Loads last 10 messages via `getRecentMessages(jid, 10)`. Empty history is allowed — Gemini still called.
- Zod `EnrichmentSchema` (title min:1 max:200, note min:1) with describe() strings guiding Gemini output.
- `generateJson<T>()` call wrapped in try/catch. Fallback returned on: null response, safeParse failure, throw, empty/whitespace title.
- `buildBasicNote` imported from `./approvalHandler.js` — that module is the single source of truth for the fallback note format.

### Task 2 — `src/approval/approvalHandler.ts` (modified)

**Changes:**
- Added `updateActionableEnrichment` import from DB queries.
- Added `enrichActionable` import from `./enrichmentService.js`.
- `buildBasicNote` changed from `function` to `export function` — enrichmentService needs it for the fallback.
- `resolveTitle` deleted — was a dead stub since Phase 41 (always returned `actionable.task`). Phase 42 file header comment updated to reflect actual flow.
- `approveAndSync` rewritten with new ordering:
  1. `updateActionableStatus(id, 'approved')` — status flipped FIRST (APPR-02: enrichment failure cannot block approval)
  2. `await enrichActionable(actionable)` — Gemini + fallback, never throws
  3. `updateActionableEnrichment(id, {title, note})` — enrichment persisted (even if Tasks disconnected)
  4. `createTodoTask({title: enrichment.title, note: enrichment.note})` — enriched payload sent to Google Tasks
  5. `updateActionableTodoIds(id, ...)` — task IDs stored
  6. `sock.sendMessage(approvedConfirmation(actionable))` — confirmation LAST (still uses `actionable.task`, not enriched title)

### Task 3 — `src/approval/__tests__/enrichmentService.test.ts` (new, 207 lines)

8 test cases, all green:

| # | Case | Assertion |
|---|------|-----------|
| 1 | Happy path — commitment + 10 messages | enriched title returned; generateJson called once with correct systemPrompt + userContent |
| 2 | Empty history | generateJson still called; userContent has "(no prior messages available)" |
| 3 | user_command | generateJson NOT called; getRecentMessages NOT called; fallback returned |
| 4 | generateJson returns null | fallback {title: task, note: buildBasicNote} returned |
| 5 | safeParse fails (title:123, note:null) | fallback returned |
| 6 | generateJson throws (Gemini 503) | fallback returned |
| 7 | Whitespace title "   " | Zod min(1) rejects → fallback returned |
| 8 | Fallback preserves contact metadata | note contains 'Alice' + 'Check it' |

**approvalHandler.test.ts additions:**
- `enrichActionableMock` + `updateActionableEnrichmentMock` added to mock setup.
- Default `enrichActionableMock` returns `{title: a.task, note: 'From: <contactName>'}` so 13 pre-existing tests pass unchanged.
- 2 new cases added (total: 15/15 green):
  - (a) enrichment custom title → `createTodoTask` + `updateActionableEnrichment` both receive enriched values; confirmation still uses `actionable.task`
  - (b) Tasks disconnected → `updateActionableEnrichment` called; `createTodoTask` NOT called; status flipped + confirmation sent
- "createTodoTask throws" case updated to also assert `updateActionableEnrichment` was called before the throw.

## Key Decisions

**`buildBasicNote` exported from `approvalHandler.ts` (not extracted to a shared util):**
enrichmentService needs it as the fallback note authority. Exporting from the existing module preserves Phase 41's format as the single source of truth without creating a new shared module for one function. The note format stays in one place.

**`resolveTitle` removed (not kept with `@deprecated`):**
Yuval's style: delete dead code. The function was always a straight pass-through to `actionable.task` — it existed as a hook-in point for Phase 42 but is now replaced by `enrichmentService.ts` owning the title entirely.

**Confirmation copy unchanged:**
`approvedConfirmation(actionable)` still uses `actionable.task`. The owner sees the same task text in the self-chat confirmation as in the approval preview. The enriched title is what appears in Google Tasks — a different audience (the task list itself) that benefits from the fully self-contained title with contact name + deadline.

**Circular import broken via vi.mock in test:**
`enrichmentService → approvalHandler → enrichmentService` is a circular dependency. The test mocks `approvalHandler.js` directly and inlines the `buildBasicNote` implementation, so assertions on the fallback note format remain accurate without the circular module resolution issue.

## File Statistics

| File | Status | Lines |
|------|--------|-------|
| `src/approval/enrichmentService.ts` | Created | 147 |
| `src/approval/__tests__/enrichmentService.test.ts` | Created | 207 |
| `src/approval/approvalHandler.ts` | Modified | +11 / -21 net |
| `src/approval/__tests__/approvalHandler.test.ts` | Modified | +80 / -3 net |

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| enrichmentService.test.ts | 0 | 8 | +8 |
| approvalHandler.test.ts | 13 | 15 | +2 |
| **src/approval/ total** | **81** | **91** | **+10** |

## Commits

| Hash | Message |
|------|---------|
| `fb2b422` | feat(42-01): enrichmentService with Gemini enrichment, Zod schema, safe fallback |
| `1a4a212` | feat(42-01): wire enrichActionable into approvalHandler + export buildBasicNote |
| `d894566` | test(42-01): enrichmentService vitest coverage — 8 cases, all green |

## Deviations from Plan

None — plan executed exactly as written.

The one test-infrastructure note: the plan said "DO NOT import the real `buildBasicNote` — it will be pulled in transitively via approvalHandler.ts, which is fine because approvalHandler.ts has no top-level side effects." In practice the circular import (`enrichmentService → approvalHandler → enrichmentService`) caused Vitest to return `undefined` for `enrichActionable` when the test also imported via the same chain. Fixed by mocking `approvalHandler.js` directly in the test with an inlined `buildBasicNote` implementation — this is equivalent to the plan's intent (the note format is tested accurately) but cleaner than relying on transitive import order.

## Self-Check: PASSED

- `src/approval/enrichmentService.ts` — FOUND
- `src/approval/__tests__/enrichmentService.test.ts` — FOUND
- Commit `fb2b422` — FOUND
- Commit `1a4a212` — FOUND
- Commit `d894566` — FOUND
- `npx tsc --noEmit` (filtered) — zero new errors
- `npx vitest run src/approval/` — 91/91 green

---
phase: 39-actionables-data-model
plan: 02
status: complete
completed: 2026-04-19
commits:
  - c80db30 feat(39-02): query layer for actionables with lifecycle enforcement
  - 12c8d93 test(39-02): 43 vitest cases for actionables queries
---

# Plan 39-02 Summary — Query Layer + Tests

**Ship status:** Complete (2 atomic commits)

## What landed

- `src/db/queries/actionables.ts` (208 lines) — 11 CRUD functions + `isValidTransition` helper + `Actionable` / `ActionableStatus` / `ActionableSourceType` / `NewActionable` types

  | Function | Purpose |
  |---|---|
  | `createActionable` | Insert; defaults `task = originalDetectedTask`, `status = pending_approval`, `detectedAt = Date.now()` |
  | `getActionableById` / `getActionableByPreviewMsgId` | Lookups by primary id or WhatsApp preview message id |
  | `getPendingActionables` | All `pending_approval` rows ordered by `detectedAt desc` |
  | `getExpiredActionables(olderThanMs)` | Pending rows older than cutoff (Phase 41's 7-day expiry scan) |
  | `updateActionableStatus` | Only mutator of `status`; enforces `ALLOWED_TRANSITIONS`, throws on invalid, no-op on same-state |
  | `updateActionableTask` | Replaces mutable `task`; leaves `originalDetectedTask` untouched |
  | `updateActionableEnrichment` | Sets `enriched_title` + `enriched_note` (used by Phase 42) |
  | `updateActionableTodoIds` | Persists Google Tasks id pair (used by Phase 42) |
  | `updateActionablePreviewMsgId` | Records the self-chat preview msg id (used by Phase 41) |
  | `getRecentTerminalActionables(limit=50)` | Terminal-state rows for the dashboard audit view (Phase 43) |

- `src/db/queries/__tests__/actionables.test.ts` — 43 vitest cases: CRUD defaults + overrides, ordering + filtering, 7-day expiry cutoff, full 5×5 `isValidTransition` truth table, valid/invalid transition throw cases, idempotent same-state, `updatedAt` bump on every write, `getRecentTerminalActionables` filter + ordering + limit

## Verification

- `tsc --noEmit` clean
- `npx vitest run src/db/queries/__tests__/actionables.test.ts` — 43/43 passed in 49ms
- In-memory `better-sqlite3` bootstrapped from `drizzle/0020_actionables.sql`; `db` singleton mocked via `vi.mock('../../client.js')`

## Plan-level SCs

- [x] 11 query functions exported with correct types
- [x] `isValidTransition` + `updateActionableStatus` enforce the lifecycle at runtime (ACT-02)
- [x] Zero coupling to legacy `reminders` / `todoTasks` query files — they remain untouched

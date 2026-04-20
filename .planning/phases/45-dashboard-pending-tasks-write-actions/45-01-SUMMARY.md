---
phase: 45-dashboard-pending-tasks-write-actions
plan: 01
subsystem: approval
tags: [approval, actionables, refactor, dashboard-substrate]
requires:
  - Phase 41 approvalHandler.tryHandleApprovalReply
  - Phase 42 enrichmentService.enrichActionable
  - src/db/queries/actionables ALLOWED_TRANSITIONS table
provides:
  - approvalHandler.approveActionable (exported primitive, sock + actionable)
  - approvalHandler.rejectActionable (exported primitive, sock + actionable)
  - approvalHandler.unrejectActionable (exported primitive, sock + actionable + graceMs)
  - approvalHandler.GraceExpiredError (typed error for expired undo window)
  - actionables.ALLOWED_TRANSITIONS extension (rejected → pending_approval)
affects:
  - src/approval/approvalHandler.ts (refactored internal applyDirective to delegate to new exports)
  - src/db/queries/actionables.ts (lifecycle extended for unreject)
tech-stack:
  added: []
  patterns:
    - Extract-to-export refactor with zero behavior drift
    - Typed error class for server-enforced grace window (GraceExpiredError)
    - Underscore-prefix unused-by-intent parameter (unrejectActionable._sock) for signature symmetry across primitives
key-files:
  created: []
  modified:
    - src/approval/approvalHandler.ts
    - src/db/queries/actionables.ts
    - src/approval/__tests__/approvalHandler.test.ts
    - src/db/queries/__tests__/actionables.test.ts
decisions:
  - Grace-window validation lives in approvalHandler.unrejectActionable (not in the DB layer) so it has cheap access to actionable.updatedAt without a second round-trip; DB layer only enforces lifecycle shape.
  - Unreject is silent on WhatsApp (no compensating self-chat message) per CONTEXT §Undo lock — trade-off to keep WhatsApp uncluttered; original ❌ Dismissed echo (if delivered) stays visible.
  - rejectedConfirmation stays file-private (no export needed); tests assert the rendered echo text byte-for-byte, not the helper.
  - Approve/reject primitives are the same code path for both WhatsApp quoted-reply AND the forthcoming Phase 45 HTTP write routes — zero duplicated logic, zero risk of cross-surface drift.
metrics:
  duration: "~2 minutes"
  completed: 2026-04-20
  tasks: 2
  files: 4
  commits: 3
---

# Phase 45 Plan 01: Export approve/reject/unreject primitives Summary

**One-liner:** Extracted the private `approveAndSync` into an exported `approveActionable(sock, actionable)` plus symmetric `rejectActionable` + new `unrejectActionable` (with `GraceExpiredError`), and extended `ALLOWED_TRANSITIONS` to permit `rejected → pending_approval` — foundation for Plan 45-02 HTTP write routes.

## Files Modified

| File | Insertions | Deletions |
|---|---:|---:|
| `src/approval/approvalHandler.ts` | +85 | -8 |
| `src/db/queries/actionables.ts` | +1 | -1 |
| `src/approval/__tests__/approvalHandler.test.ts` | +116 | -1 |
| `src/db/queries/__tests__/actionables.test.ts` | +19 | -0 |
| **Total** | **+221** | **-10** |

## Commits (3 atomic)

| Hash | Type | Message |
|---|---|---|
| `012de9b` | feat | `feat(45-01): allow rejected → pending_approval transition for undo grace window` |
| `45b91d6` | refactor | `refactor(45-01): extract approve/reject/unreject primitives from approvalHandler` |
| `f8a29cb` | test | `test(45-01): vitest for approveActionable + rejectActionable + unrejectActionable + unreject transition` |

## Test Results

| Suite | Expected | Actual |
|---|---|---|
| `src/approval/__tests__/approvalHandler.test.ts` | 19/19 (15 existing + 4 new) | **20/20** green (15 existing + 5 new — 1 extra: split reject into EN + HE cases for parity explicitness) |
| `src/db/queries/__tests__/actionables.test.ts` | prior + 2 new | **47/47** green (added `rejected → pending_approval` + `rejected → fired` cases, updated the isValidTransition truth-table expected function) |
| `npx vitest run src/approval` (subsystem sanity) | no regressions | **96/96** green across 8 test files |

## What Changed — Behavior-Level

### Before (Phase 44 end-state)

- `approveAndSync` was a module-private helper in approvalHandler.ts called only from `applyDirective`.
- The reject branch was inline inside `applyDirective` (updateActionableStatus + sendMessage side-by-side).
- `ALLOWED_TRANSITIONS.rejected = []` — no way to undo a reject; `updateActionableStatus('rejected' → 'pending_approval')` threw "invalid transition".
- Only the WhatsApp quoted-reply surface could approve or reject an actionable.

### After (Plan 45-01)

- `approveActionable(sock, actionable)` — exported. Same body as the old `approveAndSync`: status flip FIRST, then enrich, then Google Tasks push (gated on `isTasksConnected()`, swallows errors), then `✅ Added` / `✅ נוסף` echo.
- `rejectActionable(sock, actionable)` — exported. Flips status + sends `❌ Dismissed` / `❌ בוטל` echo.
- `unrejectActionable(sock, actionable, graceMs)` — new. Flips `rejected → pending_approval` IFF `Date.now() - actionable.updatedAt <= graceMs`. Throws `GraceExpiredError` otherwise. Silent on WhatsApp per CONTEXT §Undo lock.
- `GraceExpiredError` — named class with `.name === 'GraceExpiredError'` so route handlers can `err instanceof GraceExpiredError` check.
- `ALLOWED_TRANSITIONS.rejected = ['pending_approval']` — the bounded undo path.
- `applyDirective` now delegates — no inline duplicated logic:
  ```ts
  if (directive.action === 'approve' || directive.action === 'edit') {
    await approveActionable(sock, actionable);
    return;
  }
  if (directive.action === 'reject') {
    await rejectActionable(sock, actionable);
    return;
  }
  ```

## WhatsApp-Surface Behavior Drift Check

**Zero drift.** The `tryHandleApprovalReply` export signature is unchanged. All 15 pre-existing test cases still green. `applyDirective` does the same work in the same order — it just calls the new exports instead of inlining the body. The `✅ Added` / `❌ Dismissed` / `✅ נוסף` / `❌ בוטל` echoes are byte-identical.

grep confirms the delegation:

```
162:    await approveActionable(sock, actionable);
167:    await rejectActionable(sock, actionable);
188:export async function approveActionable(
240:export async function rejectActionable(
257:export class GraceExpiredError extends Error {
280:export async function unrejectActionable(
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Rebuilt `better-sqlite3` native module for test verification**

- **Found during:** Task 2 verification (running `npx vitest run src/db/queries/__tests__/actionables.test.ts`)
- **Issue:** `NODE_MODULE_VERSION 115` mismatch — the installed `better-sqlite3.node` was built against a different Node.js version (Node v22 on the server now requires 127). Blocked the entire `actionables.test.ts` suite from running, which in turn blocked verification of the transition change.
- **Confirmed pre-existing:** stashed my diff and re-ran — same error, so NOT caused by my changes. Matches the STATE.md note "better-sqlite3 ABI has historically blocked these tests from running locally in CI". The plan itself called this out and offered a skip-guard fallback.
- **Fix:** `npm rebuild better-sqlite3` → "rebuilt dependencies successfully" → 47/47 tests green.
- **Files modified:** none (no code change, only rebuilt the native binary).
- **Why not skip-guard:** Rebuilding was trivial (~30s) and gets us REAL coverage of the transition change instead of a skip-guarded no-op. The skip-guard route was planned as a fallback for "locally in CI" — not needed when the rebuild works.

### Intentional minor scope additions (within plan's spirit)

**Added a 5th approvalHandler test case (HE reject echo):** Plan asked for 4 new cases but also said "Mirror with a Hebrew row proving `❌ בוטל`". Split it into its own `it()` block for explicitness rather than bundling into the EN case — result is 5 new cases (20/20 total) instead of 4 (19/19). This matches the plan intent; the count is off-by-one only because I didn't share an expect in one `it()`.

**Added a 2nd new actionables query test case (`rejected → fired` still throws):** Plan asked for 2 cases (`rejected → pending_approval` success + `rejected → approved` throws — the latter already exists in the file). To add real coverage for the narrowness of the extension (only `pending_approval` is reachable from `rejected`), added `rejected → fired` as well. Plus the truth-table's `expected` function was updated to cover the new valid transition — that propagated through the `it.each(cases)` generator without adding a new `it()` block.

### `git add -f` note

`.planning/` is in `.gitignore`. This SUMMARY.md will require `git add -f` in the final metadata commit, per the STATE.md convention used by Plans 43-01..43-03 and 44-01..44-06.

## Hand-off Note for Plan 45-02

Plan 45-02 can now wire Fastify write handlers directly to these exports:

```ts
import {
  approveActionable,
  rejectActionable,
  unrejectActionable,
  GraceExpiredError,
} from '../approval/approvalHandler.js';
import { getState } from './state.js';
import { getActionableById } from '../db/queries/actionables.js';

// POST /api/actionables/:id/approve
const sock = getState().sock;
if (!sock) return reply.code(503).send({ error: 'sock_unavailable' });
const row = getActionableById(req.params.id);
if (!row) return reply.code(404).send({ error: 'not_found' });
if (row.status !== 'pending_approval') {
  return reply.code(409).send({ error: 'already_handled', status: row.status });
}
await approveActionable(sock, row);
return reply.code(200).send({ ok: true });
```

Mirror for `rejectActionable`. For Undo:

```ts
// POST /api/actionables/:id/unreject
try {
  await unrejectActionable(sock, row, 5_000);
  return reply.code(200).send({ ok: true });
} catch (err) {
  if (err instanceof GraceExpiredError) {
    return reply.code(410).send({ error: 'grace_expired' });
  }
  throw err; // unexpected → 500
}
```

All three primitives share the same `sock: WASocket` arg — pull it from `getState().sock` (src/api/state.ts). No global state leak, clean dependency injection.

## Self-Check: PASSED

- [x] `src/approval/approvalHandler.ts` modified (exports verified via grep: approveActionable, rejectActionable, unrejectActionable, GraceExpiredError all present)
- [x] `src/db/queries/actionables.ts` modified (`rejected: ['pending_approval']` present at line 25)
- [x] `src/approval/__tests__/approvalHandler.test.ts` modified (5 new cases added, 20/20 green)
- [x] `src/db/queries/__tests__/actionables.test.ts` modified (2 new cases added, 47/47 green)
- [x] Commit `012de9b` exists: `feat(45-01): allow rejected → pending_approval transition`
- [x] Commit `45b91d6` exists: `refactor(45-01): extract approve/reject/unreject primitives`
- [x] Commit `f8a29cb` exists: `test(45-01): vitest for approveActionable + rejectActionable + unrejectActionable + unreject transition`
- [x] `tryHandleApprovalReply` signature unchanged (grep confirms line 64 unchanged)
- [x] `applyDirective` delegates to new exports (grep confirms lines 162, 167)
- [x] Full approval suite green (96/96 across 8 files)

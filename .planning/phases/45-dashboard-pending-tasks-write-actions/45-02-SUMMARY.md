---
phase: 45-dashboard-pending-tasks-write-actions
plan: 02
subsystem: api
tags: [api, actionables, write-routes, dashboard, race-arbitration]
requires:
  - Plan 45-01 approvalHandler primitives (approveActionable, rejectActionable, unrejectActionable, GraceExpiredError)
  - src/api/state.ts getState().sock
  - Plan 43-01 actionablesRoutes plugin (receiving the 4 new handlers)
provides:
  - POST /api/actionables/:id/approve (200/401/404/409/503)
  - POST /api/actionables/:id/reject (200/401/404/409/503)
  - POST /api/actionables/:id/edit (200/400/401/404/409/503)
  - POST /api/actionables/:id/unreject (200/401/404/409/503 — 409 covers both already_handled and grace_expired)
  - UNREJECT_GRACE_MS = 10_000 constant
  - EDIT_TASK_MAX_LEN = 500 constant
  - alreadyHandledReply(reply, row) shared 409 envelope helper
affects:
  - src/api/routes/actionables.ts (4 new handlers + shared 409 helper + 2 constants)
  - src/api/__tests__/actionablesWriteActions.test.ts (new — 15 cases)
tech-stack:
  added: []
  patterns:
    - Status-guard + primitive-throw-catch as double-fence idempotency
    - Shared typed 409 envelope (error + currentStatus + actionable) for cross-surface race coordination
    - Mock-re-exports-class-symbol for `instanceof` checks in route handlers (GraceExpiredError)
    - Route-level config.js mock (avoids NODE_ENV=test Zod enum trap that bit actionables.test.ts)
key-files:
  created:
    - src/api/__tests__/actionablesWriteActions.test.ts
  modified:
    - src/api/routes/actionables.ts
decisions:
  - 409 envelope shape is {error, currentStatus, actionable} for already_handled and {error, graceMs, actionable} for grace_expired — both carry the row so the dashboard can patch its optimistic cache without a re-fetch.
  - /edit rewrites task FIRST then re-reads for approveActionable — mirrors approvalHandler.applyDirective lines 153-164 so one self-chat echo is sent with the edited title (not two).
  - sock is non-optional for /unreject even though unrejectActionable is silent — signature symmetry with other primitives AND ensures the bot is connected so a subsequent WhatsApp approval can fire.
  - No Zod schema layer — plugin convention is inline runtime checks (PATCH/:id and POST / already do this). Adding Zod would break consistency for 3-field bodies.
  - No manual SSE emit after writes — Plan 43-01's 3s hash-poll picks up status changes automatically (≤3s SC#3 tolerance per CONTEXT).
metrics:
  duration: "~6 minutes"
  completed: 2026-04-20
  tasks: 2
  files: 2
  commits: 2
---

# Phase 45 Plan 02: Dashboard Write-Action HTTP Routes Summary

**One-liner:** Shipped four JWT-gated POST routes (`/approve`, `/reject`, `/edit`, `/unreject`) that funnel dashboard-initiated mutations through Plan 45-01 primitives so the outcome — enrichment + Google Tasks sync + self-chat echo — is byte-identical to a WhatsApp quoted-reply, with server-arbitrated race handling via 409 `already_handled` and 409 `grace_expired` envelopes.

## Files Touched

| File | Insertions | Deletions | Status |
|---|---:|---:|---|
| `src/api/routes/actionables.ts` | +172 | -1 | modified |
| `src/api/__tests__/actionablesWriteActions.test.ts` | +453 | 0 | created |
| **Total** | **+625** | **-1** | |

## Commits (2 atomic)

| Hash | Type | Message |
|---|---|---|
| `eaf9358` | feat | `feat(45-02): POST /api/actionables/:id/approve|reject|edit|unreject write routes` |
| `b8fae0d` | test | `test(45-02): vitest for actionables write-action routes (15 cases)` |

## Test Results

| Suite | Expected | Actual |
|---|---|---|
| `src/api/__tests__/actionablesWriteActions.test.ts` (new, plan 45-02) | 15/15 | **15/15** green |
| `src/api/__tests__/actionables.test.ts` (plan 43-01) | 10/10, no regression | **10/10** green (NODE_ENV=development; see Deviations) |
| `src/api/__tests__/calendarMutations.test.ts` (plan 44-02) | 10/10, no regression | **20/20** green (file header says 10 but source has 20 cases — pre-existing, also ran clean) |
| **Combined run** (all three files, NODE_ENV=development) | no cross-contamination | **45/45** green |
| `tsc --noEmit` (non-CLI) | zero new errors | zero errors |

### Grep confirmations

```
src/api/routes/actionables.ts:
  362:    '/api/actionables/:id/approve',
  392:    '/api/actionables/:id/reject',
  420:    '/api/actionables/:id/edit',
  461:    '/api/actionables/:id/unreject',
  76:const UNREJECT_GRACE_MS = 10_000;
  77:const EDIT_TASK_MAX_LEN = 500;
  369:      const sock = getState().sock;
  399:      const sock = getState().sock;
  435:      const sock = getState().sock;
  468:      const sock = getState().sock;
  474:        await unrejectActionable(sock, row, UNREJECT_GRACE_MS);

src/api/__tests__/actionablesWriteActions.test.ts:
  server.inject count: 15
```

## What Changed — Behavior-Level

### Before (Plan 45-01 end-state)

- Dashboard had no HTTP surface for approve/reject/edit — only WhatsApp quoted-reply could mutate pending actionables.
- Plan 45-01 exported the primitives (approveActionable/rejectActionable/unrejectActionable/GraceExpiredError) but no HTTP caller existed.
- The Phase 43 `actionablesRoutes` plugin had only read routes + PATCH (edit fields) + POST (create approved) + DELETE (hard delete) — no status-transition routes.

### After (Plan 45-02)

Four new POST handlers on the same plugin, each following the same race-arbitration shape:

1. **Look up row** (`getActionableById`) → 404 if missing.
2. **Status guard** → 409 `already_handled` if source status wrong (`pending_approval` for approve/reject/edit, `rejected` for unreject).
3. **Sock guard** → 503 `bot_disconnected` if `getState().sock === null` (WhatsApp echo is non-optional per CONTEXT §Cross-surface parity).
4. **Call primitive** with the correct args; catch transition-throws → re-read row → surface as 409 `already_handled` if status drifted.
5. **Re-read fresh row** → return `{actionable: <fresh>}` with status 200.

### Edit's special shape

Mirrors `approvalHandler.applyDirective` lines 153-164:

```ts
updateActionableTask(id, rawTask);        // rewrite FIRST
const refreshed = getActionableById(id);  // re-read
await approveActionable(sock, refreshed); // ONE echo with edited title
```

One self-chat echo, not two. Matches WhatsApp `edit:` grammar where edit implies approve.

### Unreject's special shape

Catches `GraceExpiredError` from the primitive and surfaces a typed 409 envelope:

```json
{ "error": "grace_expired", "graceMs": 10000, "actionable": {...} }
```

Grace window = 10s (server-enforced). Client's 5s UI timer is advisory.

## Race Discipline — Verified in Tests

Test case #14 specifically asserts: when `approveActionable` throws mid-flight (a concurrent WhatsApp reply flipped the row between our pre-check and our call), we re-read the row, see the drifted status, and surface a 409 `already_handled` WITHOUT re-entering `approveActionable`. That guarantees:

- No double Google Tasks push.
- No double ✅ self-chat echo.
- No rollback — the end state (row approved, Tasks pushed by the WhatsApp path) is already correct.

Per the must_haves lock: "if the row is no longer pending_approval when the HTTP handler runs, the route returns 409 WITHOUT re-pushing to Google Tasks, WITHOUT re-sending a self-chat echo, WITHOUT rolling back." Confirmed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug/Environmental] NODE_ENV=test not recognized by src/config.ts Zod enum blocks actionables.test.ts from running by default**

- **Found during:** Task 2 verification step "zero regression in existing actionables.test.ts (10/10 from 43-01)".
- **Issue:** Running `npx vitest run src/api/__tests__/actionables.test.ts` produces `process.exit(1)` inside `src/config.ts:44` because `NODE_ENV=test` (Vitest default) is not in the Zod enum — valid values are `development` or `production`.
- **Scope check:** Reverted my routes file to `eaf9358~1` (pre-Task-1 code) and re-ran — same failure. Pre-existing, NOT caused by my changes. This is an `.env` / test-config issue that shipped with `dotenvx` or a recent config.ts tightening, affects the whole repo's vitest suite, not just actionables.test.ts.
- **Fix applied (to MY new suite):** I mock `src/config.js` at the top of `actionablesWriteActions.test.ts` so it never loads the real Zod-validated env. My suite runs clean with OR without NODE_ENV=development: **15/15 green unconditionally**.
- **Fix NOT applied (out of scope):** I did NOT modify `src/config.ts` Zod enum to allow `'test'` or modify `actionables.test.ts`/`calendarMutations.test.ts` to add their own config mock. That's a repo-wide cleanup that belongs in a separate chore, not a plan-45 task. Workaround: `NODE_ENV=development npx vitest run <path>` makes both pre-existing suites green (45/45 combined with my new suite).
- **Files modified:** none extra (the mock-config pattern is inside my new test file only, which is already staged/committed).
- **Why log-but-defer:** per SCOPE BOUNDARY — "only auto-fix issues DIRECTLY caused by the current task's changes. Pre-existing … failures in unrelated files are out of scope."
- **Logged to:** `deferred-items.md` below for a future cleanup sweep.

### No Zod schemas added

Plan explicitly asked NOT to. Confirmed — all 4 handlers use inline runtime checks matching the existing PATCH/:id and POST / pattern.

### No manual SSE emit added

Plan explicitly asked NOT to. Confirmed — the 3s hash-poll from Plan 43-01 carries status changes through.

### `git add -f` note

`.planning/` IS gitignored (`.gitignore:17` → `.planning/`). Both SUMMARY.md and deferred-items.md were added with `git add -f` in the final metadata commit, matching the Plan 43-01..45-01 convention. Modified files (STATE.md, ROADMAP.md, REQUIREMENTS.md) were already tracked, so no `-f` needed for those.

## Verification — acceptance bar

Phase-level live curl verification (deferred to Plan 45-04 per plan spec):

```bash
# With $JWT for a known pending row $ID
curl -sX POST http://localhost:3000/api/actionables/$ID/approve \
  -H "Authorization: Bearer $JWT"
# → 200 + {actionable: {...status:'approved', enrichedTitle:'...'}}
# Observe self-chat: ✅ Added: <task>

# Repeated:
curl -sX POST http://localhost:3000/api/actionables/$ID/approve \
  -H "Authorization: Bearer $JWT"
# → 409 {error:'already_handled', currentStatus:'approved', actionable:{...}}
```

Analogous for `/reject`, `/edit` (with `-d '{"task":"revised"}'`), and `/unreject`.

- No JWT → 401. Missing id → 404. Blank edit body → 400. Bot disconnected → 503.

## Hand-off Note for Plan 45-03

**HTTP verbs + URLs + status envelopes frozen:**

| Route | Success | 409 envelope |
|---|---|---|
| POST `/api/actionables/:id/approve` | 200 `{actionable}` | `{error:'already_handled', currentStatus, actionable}` |
| POST `/api/actionables/:id/reject` | 200 `{actionable}` | `{error:'already_handled', currentStatus, actionable}` |
| POST `/api/actionables/:id/edit` | 200 `{actionable}` (body: `{task:string}`) | `{error:'already_handled', currentStatus, actionable}` (400 on invalid body) |
| POST `/api/actionables/:id/unreject` | 200 `{actionable}` | `{error:'already_handled', currentStatus, actionable}` OR `{error:'grace_expired', graceMs:10_000, actionable}` |

**Client mutation hook recipe:**

```ts
// Optimistic: remove row from pendingActionables immediately on click.
// Pessimistic: if response is 409, DO NOT rollback (end state correct);
// instead surface "Already handled in WhatsApp" toast and let SSE
// (3s hash-poll) populate Recent from DB.
// 503: rollback + "Bot disconnected — try again" toast.
// Other 4xx/5xx: rollback + generic error toast.

async function approve(id: string) {
  const res = await fetch(`/api/actionables/${id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) return;
  if (res.status === 409) { toast('Already handled in WhatsApp'); return; }
  if (res.status === 503) { toast('Bot disconnected — retry'); rollback(); return; }
  toast('Server error — retry'); rollback();
}
```

**Undo grace window:** server-enforced 10s from the row's `updatedAt` (when reject flipped it). Client-side 5s countdown toast fits inside with 5s latency headroom.

**All 4 routes JWT-gated** — client MUST send `Authorization: Bearer <jwt>` (NOT `?token=`; that's only for SSE EventSource).

## Deferred Items

| # | Issue | Why deferred | Touched-by-this-plan? |
|---|---|---|---|
| 1 | `src/config.ts` Zod enum rejects `NODE_ENV=test`; Vitest default env crashes config-consuming test files (`actionables.test.ts`, plus any other test that doesn't mock config). Workaround: `NODE_ENV=development npx vitest run ...`. | Repo-wide test-infra cleanup, not a Plan-45 concern. | Worked around via config.js mock in my new suite only. |

## Self-Check: PASSED

- [x] `src/api/routes/actionables.ts` modified — 4 new POST routes grep-confirmed (8 occurrences of `/api/actionables/:id/(approve|reject|edit|unreject)` — 4 in header comments + 4 in route path strings).
- [x] `src/api/__tests__/actionablesWriteActions.test.ts` created — 15 `server.inject` calls confirmed.
- [x] `.planning/phases/45-dashboard-pending-tasks-write-actions/45-02-SUMMARY.md` written.
- [x] `.planning/phases/45-dashboard-pending-tasks-write-actions/deferred-items.md` logged (NODE_ENV=test Zod enum issue).
- [x] Commit `eaf9358` exists: `feat(45-02): POST /api/actionables/:id/approve|reject|edit|unreject write routes`.
- [x] Commit `b8fae0d` exists: `test(45-02): vitest for actionables write-action routes (15 cases)`.
- [x] New test suite runs 15/15 green standalone (no env flag needed — mocks config.js).
- [x] Regression suites (plan 43-01 actionables, plan 44-02 calendarMutations) run clean under `NODE_ENV=development` (pre-existing env trap, out of scope — logged to deferred-items.md).
- [x] Combined 3-suite run: **45/45 green**.
- [x] `tsc --noEmit` (non-CLI) — zero errors.
- [x] `getState().sock` imported and used in all 4 handlers.
- [x] `UNREJECT_GRACE_MS = 10_000` and `EDIT_TASK_MAX_LEN = 500` present as file-scope constants.
- [x] Plan 45-01 primitives called with expected signatures: `approveActionable(sock, row)`, `rejectActionable(sock, row)`, `unrejectActionable(sock, row, graceMs)`, `GraceExpiredError` instanceof check.

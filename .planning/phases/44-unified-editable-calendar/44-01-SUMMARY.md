---
phase: 44-unified-editable-calendar
plan: 01
subsystem: api
tags: [linkedin, pm-authority, fastapi, fastify, zod, pydantic, scheduling, proxy]

requires:
  - phase: 34-linkedin-proxy
    provides: callUpstream, mapUpstreamErrorToReply, writes.ts pattern, PostSchema
  - phase: 33-pm-authority-http
    provides: FastAPI app, mutations_fast.py router, APIError/ErrorCode, SchedulingManager

provides:
  - "POST /v1/posts/:id/reschedule — pm-authority FastAPI endpoint with slot snap + state guard"
  - "reschedule_post(post_id, target) — SchedulingManager helper that snaps and writes"
  - "RescheduleRequest — pydantic v2 model with scheduled_at: datetime"
  - "POST /api/linkedin/posts/:id/reschedule — whatsapp-bot JWT-gated Fastify proxy route (Route 11)"
  - "RescheduleRequestSchema — Zod object with scheduled_at: z.string().datetime({ offset: true })"

affects:
  - 44-03-unified-calendar-proxy
  - 44-05-calendar-ui

tech-stack:
  added: []
  patterns:
    - "Inline status guard (if current not in (...)) for one-off state checks not worth adding to state_guard.py ALLOWED_TRANSITIONS"
    - "SchedulingManager.reschedule_post: normalize aware→naive UTC before snap (mirrors get_next_available_slot convention)"
    - "Route 11 follows exact Route 3 (/edit) shape: validateBody → callUpstream → mapUpstreamErrorToReply"

key-files:
  created:
    - /home/yuval/pm-authority/tests/test_reschedule_endpoint.py
  modified:
    - /home/yuval/pm-authority/services/http/schemas.py
    - /home/yuval/pm-authority/services/http/routers/mutations_fast.py
    - /home/yuval/pm-authority/scheduler/manager.py
    - src/api/linkedin/schemas.ts
    - src/api/linkedin/routes/writes.ts
    - src/api/linkedin/__tests__/writes.test.ts

key-decisions:
  - "Inline status guard (if current not in APPROVED/PENDING_REVIEW) rather than adding reschedule to ALLOWED_TRANSITIONS — avoids schema migration of the transition table, consistent with plan guidance"
  - "FastAPI wraps 422 RequestValidationError into 400 VALIDATION_ERROR (existing pm-authority behavior) — test 5 asserts 400, not 422 as the plan narrative suggested"
  - "SchedulingManager patched per-test via monkeypatch on __init__ default — avoids writing to the global state.db in tests"
  - "Slot snap observed: Saturday 12:00 → Tuesday 03:30 UTC; Wednesday 09:00 → Thursday 03:30 UTC"

requirements-completed: [SC2]

duration: 25min
completed: 2026-04-20
---

# Phase 44 Plan 01: Reschedule Endpoint Summary

**End-to-end LinkedIn reschedule surface: FastAPI slot-snap endpoint on pm-authority + JWT-gated Fastify proxy on whatsapp-bot, enabling the calendar's drag-to-reschedule gesture for LinkedIn pills**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-20T13:05:00Z
- **Completed:** 2026-04-20T13:20:00Z
- **Tasks:** 2
- **Files modified:** 6 (+ 1 created)

## Accomplishments

- pm-authority gains POST /v1/posts/:id/reschedule: snaps any requested datetime forward to the next Tue/Wed/Thu 03:30 UTC slot using the existing `_calculate_next_valid_slot`, state-guards PUBLISHED/other statuses with 409 STATE_VIOLATION, 5/5 pytest green
- whatsapp-bot gains Route 11 POST /api/linkedin/posts/:id/reschedule: JWT-gated Fastify proxy that Zod-validates body before calling upstream, passes through 200/409/404 verbatim, 42/42 vitest green (4 new cases)
- pm-authority-http PM2 process restarted and confirmed online (pid 2567666)

## Task Commits

### pm-authority repo (3 commits)
1. `a2f8154` feat(http): add RescheduleRequest schema
2. `beb8ac3` feat(scheduler): add reschedule_post helper
3. `5fdc00c` feat(http): add POST /v1/posts/:id/reschedule endpoint + tests

### whatsapp-bot repo (2 commits)
1. `b862700` feat(linkedin-proxy): add RescheduleRequestSchema
2. `576fc19` feat(linkedin-proxy): add /api/linkedin/posts/:id/reschedule route + tests

## Files Created/Modified

### pm-authority
- `/home/yuval/pm-authority/services/http/schemas.py` (222 lines, +5) — RescheduleRequest pydantic v2 model next to EditRequest
- `/home/yuval/pm-authority/scheduler/manager.py` (83 lines, +21) — reschedule_post helper: normalize tzinfo → snap → UPDATE posts
- `/home/yuval/pm-authority/services/http/routers/mutations_fast.py` (160 lines, +26) — @router.post("/{post_id}/reschedule") endpoint
- `/home/yuval/pm-authority/tests/test_reschedule_endpoint.py` (236 lines, **created**) — 5 pytest cases

### whatsapp-bot
- `src/api/linkedin/schemas.ts` (287 lines, +9) — RescheduleRequestSchema with z.string().datetime({ offset: true })
- `src/api/linkedin/routes/writes.ts` (487 lines, +26) — Route 11 (reschedule proxy)
- `src/api/linkedin/__tests__/writes.test.ts` (1082 lines, +86) — 4 new vitest cases

## Decisions Made

1. **Inline status guard instead of extending ALLOWED_TRANSITIONS** — the plan explicitly called this out; adding "reschedule" to state_guard.py's transition table would require extending all callers and a separate migration. An inline `if current not in (...)` is consistent with how `confirm_pii` already works (checks before delegating to ReviewManager).

2. **Test 5 asserts 400, not 422** — pm-authority's main.py intercepts FastAPI's raw RequestValidationError and rewrites it to 400 VALIDATION_ERROR. The plan narrative said "422 (FastAPI's validation error shape)" but the live behavior and all existing tests use 400. Fixed assertion accordingly (Rule 1: bug in test spec).

3. **SchedulingManager db_path patching** — SchedulingManager defaults to "state.db" which would write to the live DB during tests. Monkeypatched `__init__` default to use the tmp sqlite DB.

## Slot Snap Algorithm (Observed)

Algorithm in `_calculate_next_valid_slot(start_dt)`:
1. `candidate = datetime.combine(start_dt.date(), time(3, 30))` — 03:30 UTC on start day
2. If `candidate <= start_dt`: add 1 day (time already passed today)
3. While `candidate.weekday() not in [1, 2, 3]` (Tue/Wed/Thu): add 1 day

Observed outputs:
- `2026-04-29T09:00:00` (Wednesday naive) → candidate `2026-04-29T03:30:00` ≤ 09:00 → +1 → `2026-04-30T03:30:00` (Thursday) ✓
- `2026-04-25T12:00:00` (Saturday naive) → candidate `2026-04-25T03:30:00` ≤ 12:00 → +1 (Sun) → +1 (Mon) → +1 → `2026-04-28T03:30:00` (Tuesday) ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 5 assertion corrected from 422 to 400**
- **Found during:** Task 1 (pm-authority tests), running pytest
- **Issue:** Plan said "assert 422 (FastAPI's validation error shape)" but pm-authority's main.py installs a RequestValidationError handler that rewrites all 422s to 400 VALIDATION_ERROR — the real behavior returns 400, not 422
- **Fix:** Changed test assertion to `r.status_code == 400` + added `r.json()["error"]["code"] == "VALIDATION_ERROR"` check
- **Files modified:** tests/test_reschedule_endpoint.py
- **Verification:** All 5 pytest cases pass
- **Committed in:** 5fdc00c

---

**Total deviations:** 1 auto-fixed (Rule 1 bug in test spec)
**Impact on plan:** Test assertion matched actual behavior. No scope changes. All verification criteria met.

## Issues Encountered

None - implementation compiled and passed tests on first attempt. Only deviation was the 422 vs 400 test assertion.

## User Setup Required

None — pm-authority-http restarted via PM2 (pid 2567666, online). No new env vars or external config required.

## Next Phase Readiness

- **Plan 44-03 (unified calendar proxy):** LinkedIn reschedule endpoint is live at `POST /api/linkedin/posts/:id/reschedule`. The unified calendar's write path for LinkedIn pills routes here with body `{scheduled_at: ISO8601}`.
- pm-authority endpoint verified live (pm2 status: online, fresh restart).
- The `.planning/` docs added via `git add -f .planning/phases/44-unified-editable-calendar/44-01-SUMMARY.md`.

---
*Phase: 44-unified-editable-calendar*
*Completed: 2026-04-20*

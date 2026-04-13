---
phase: 33-pm-authority-http-service
plan: 03
subsystem: api
tags: [fastapi, pydantic, asyncio, sqlite, state-machine, job-queue]

# Dependency graph
requires:
  - phase: 33-pm-authority-http-service
    provides: "empty routers, error taxonomy, db helper, Pydantic schemas (Plan 33-01 scaffold)"
provides:
  - "in-memory JobTracker with asyncio.Lock + global Semaphore(1) + 15-min GC"
  - "state_guard.check_transition + ALLOWED_TRANSITIONS table (shared with Plan 33-04)"
  - "POST /v1/posts/{id}/approve | /reject | /edit fast mutation endpoints"
  - "GET /v1/jobs/{job_id} polling endpoint"
  - "real routers/jobs.py start_gc_task / stop_gc_task lifespan hooks"
affects: [33-04-pm-authority-slow-mutations, 34-whatsapp-bot-proxy, 35-sse-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "deferred import of dto_mapper inside route handlers to stay file-disjoint with parallel Plan 33-02"
    - "state-machine guard as a thin module (ALLOWED_TRANSITIONS + check_transition) reused by fast & slow mutations"
    - "JobTracker.get raises APIError NOT_FOUND directly — routers don't translate exceptions"
    - "TestClient fixtures monkeypatch get_conn.__wrapped__.__defaults__ to redirect the ctxmgr default arg"

key-files:
  created:
    - pm-authority/services/http/jobs.py
    - pm-authority/services/http/state_guard.py
    - pm-authority/tests/test_http_jobs.py
    - pm-authority/tests/test_http_fast_mutations.py
  modified:
    - pm-authority/services/http/routers/jobs.py
    - pm-authority/services/http/routers/mutations_fast.py

key-decisions:
  - "JobTracker.semaphore is an asyncio.Semaphore(1) exposed publicly — Plan 04 workers acquire it around any Claude-CLI / fal.ai call"
  - "get_tracker(request) is a plain helper, not a FastAPI Depends — keeps error-raising uniform with every other APIError site"
  - "state_guard is status-string based, not enum-based — pm-authority stores status as TEXT and the wire format is a string; adding an enum would require round-trip translation for no benefit"
  - "whitespace-only edit is 422 UNPROCESSABLE (semantic), empty-string is 400 VALIDATION_ERROR (Pydantic min_length) — matches CONTEXT.md §4 taxonomy"
  - "build_post_dto is imported lazily inside each fast-mutation handler so the module loads cleanly even when Plan 33-02 is still in flight in a parallel wave"
  - "start_gc_task is idempotent: if app.state.job_tracker is already set (test fixture) it only calls .start_gc() rather than rebuilding the tracker"

patterns-established:
  - "Fast mutation shape: current_status check → state_guard → DB write → _refresh_post_dto (shared across approve/reject/edit)"
  - "All route errors raise APIError — the global handler in main.py turns them into the envelope"
  - "Test files that touch get_conn monkeypatch both module attr AND get_conn.__wrapped__.__defaults__ (the contextmanager gotcha)"

requirements-completed: [LIN-01]

# Metrics
duration: ~20min
completed: 2026-04-13
---

# Phase 33 Plan 03: HTTP Fast Mutations + JobTracker Summary

**In-memory JobTracker with 15-min GC and global Semaphore(1), state-machine guard shared with slow mutations, and POST approve/reject/edit endpoints that enforce transitions then return refreshed PostDTO.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-13T08:45 UTC
- **Completed:** 2026-04-13T09:05 UTC
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 2
- **Tests added:** 22 (8 JobTracker + 14 fast-mutation TestClient)

## Accomplishments

- **JobTracker** (`services/http/jobs.py`): thread-safe via `asyncio.Lock`, creates/gets/transitions jobs, carries ErrorDetail on failure, runs a background GC loop that reaps terminal jobs after 15 minutes, exposes `semaphore = asyncio.Semaphore(1)` that Plan 33-04 will acquire around Claude-CLI / fal.ai workers. Public API: `create`, `get`, `mark_running`, `mark_succeeded`, `mark_failed`, `start_gc`, `stop_gc`, `semaphore`, plus the `get_tracker(request)` helper that raises `UNAVAILABLE` if the lifespan hook hasn't run yet.
- **State guard** (`services/http/state_guard.py`): `ALLOWED_TRANSITIONS` dict covering all seven mutation actions (approve, reject, edit, regenerate, replace_image, pick_variant, pick_lesson); `check_transition(current_status, action)` raises `APIError(STATE_VIOLATION)` with `{action, current_status, allowed_from: [...]}` in details. Plan 33-04 imports the same module for its slow mutations — no duplication.
- **Fast mutation routes** appended to the Plan-01 empty `mutations_fast` router: `POST /v1/posts/{id}/approve`, `/reject`, `/edit`. Each handler: looks up current status (404 if missing) → checks transition (409 STATE_VIOLATION if disallowed) → writes DB → re-reads via `dto_mapper.build_post_dto` → returns the canonical PostDTO. Edit additionally rejects whitespace-only content (422 UNPROCESSABLE); empty-string edits hit Pydantic's `min_length=1` and return 400 VALIDATION_ERROR via the global handler.
- **`routers/jobs.py` upgraded**: the Plan-01 no-op `start_gc_task` shim now constructs a `JobTracker` on `app.state.job_tracker` (idempotent) and spawns its GC task; `stop_gc_task` cleanly cancels. Appended `GET /v1/jobs/{job_id}` that returns the canonical `JobDTO` or 404 NOT_FOUND. **`main.py` was never touched** — its lifespan already calls these two functions, so the upgrade is invisible to the wave boundary.

## Task Commits

Each task was committed atomically in `/home/yuval/pm-authority`:

1. **Task 1: JobTracker + state_guard + routers/jobs.py upgrade** — `d617195` (feat)
2. **Task 2: Fast mutation routes (approve/reject/edit)** — `0a2c12b` (feat)
3. **Task 3: Unit + integration tests** — `86ce40a` (test)

_Note: commit `6251e0c` between Task 2 and Task 3 is from Plan 33-02's parallel wave landing mid-execution — not this plan's._

## Files Created/Modified

Created in `/home/yuval/pm-authority`:

- `services/http/jobs.py` — `Job` dataclass, `JobTracker` class, `get_tracker(request)` helper, `GC_AFTER = 15min`, `Literal["pending","running","succeeded","failed"]` status type
- `services/http/state_guard.py` — `ALLOWED_TRANSITIONS: Final[dict[str, set[str]]]` + `check_transition(current_status, action) -> None`
- `tests/test_http_jobs.py` — 8 async unit tests (create, transitions, failure, to_dto_dict shape, gc removes old, gc keeps fresh, semaphore serializes, start/stop lifecycle)
- `tests/test_http_fast_mutations.py` — 14 TestClient tests split into `TestFastMutationErrors` (9) and `TestFastMutationSuccess` (5)

Modified in `/home/yuval/pm-authority`:

- `services/http/routers/jobs.py` — replaced shim bodies, appended `GET /{job_id}` handler
- `services/http/routers/mutations_fast.py` — appended `approve`, `reject`, `edit` handlers + two private helpers (`_current_status`, `_refresh_post_dto`)

## Public API Added

### JobTracker (for Plan 33-04 slow mutations)

```python
class JobTracker:
    semaphore: asyncio.Semaphore(1)         # acquire around slow worker
    async def create(kind: str) -> Job
    async def get(job_id: str) -> Job       # raises APIError(NOT_FOUND)
    async def mark_running(job_id: str) -> None
    async def mark_succeeded(job_id: str, result: dict) -> None
    async def mark_failed(job_id: str, error: ErrorDetail) -> None
    def start_gc() -> None                  # idempotent
    async def stop_gc() -> None

def get_tracker(request) -> JobTracker     # raises UNAVAILABLE if not ready
```

### state_guard (for Plan 33-04)

```python
ALLOWED_TRANSITIONS: Final[dict[str, set[str]]] = {
    "approve":       {"DRAFT"},
    "reject":        {"DRAFT","PENDING_REVIEW","PENDING_PII_REVIEW",
                      "PENDING_VARIANT","PENDING_LESSON_SELECTION","APPROVED"},
    "edit":          {"DRAFT","APPROVED","PENDING_PII_REVIEW"},
    "regenerate":    {"DRAFT","APPROVED"},
    "replace_image": {"DRAFT","APPROVED","PENDING_PII_REVIEW"},
    "pick_variant":  {"PENDING_VARIANT"},
    "pick_lesson":   {"PENDING_LESSON_SELECTION"},
}
def check_transition(current_status: str, action: str) -> None
```

### Endpoints

- `POST /v1/posts/{post_id}/approve` → 200 PostDTO (DRAFT→APPROVED)
- `POST /v1/posts/{post_id}/reject` → 200 PostDTO (any non-terminal → REJECTED)
- `POST /v1/posts/{post_id}/edit` → 200 PostDTO (body: `{content, content_he?}`)
- `GET /v1/jobs/{job_id}` → 200 JobDTO

## Decisions Made

- **State guard uses status strings, not enums.** pm-authority's posts.status is TEXT. An enum would force a conversion layer everywhere without buying anything — the transition table is the source of truth.
- **Semaphore lives on the JobTracker, not as a module-global.** Makes it replaceable per-test and keeps tracker lifetime = semaphore lifetime.
- **`get_tracker(request)` instead of FastAPI `Depends`.** The error path raises `APIError(UNAVAILABLE)` directly, same as every other error in the service. `Depends` would force a different error-raising style (HTTPException) that the global handler would have to re-translate.
- **Lazy import of `dto_mapper.build_post_dto`.** Plan 33-02 owns `dto_mapper.py` and was running in parallel with this plan. Deferring the import to request time means this module loads cleanly regardless of whether 33-02 has landed yet, and the test file uses `pytest.importorskip` to gracefully skip the success-path tests if the dependency isn't there. By the time Task 3 ran, 33-02 had actually landed (commit `6251e0c`) and all success-path tests executed.
- **Edit validation is two-layered.** Pydantic's `min_length=1` catches empty strings at deserialization → 400 VALIDATION_ERROR. A manual `strip()` check inside the handler catches whitespace-only → 422 UNPROCESSABLE. Matches the CONTEXT.md §4 taxonomy precisely.
- **`start_gc_task` is idempotent.** Not just for safety — it's how the test fixture injects a fresh `JobTracker` before `TestClient` runs without having to bypass the lifespan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `monkeypatch.setattr(http_db, "DEFAULT_DB_PATH", db_path)` alone did not redirect `get_conn`**
- **Found during:** Task 3 (first test run)
- **Issue:** `services.http.db.get_conn` is `@contextmanager`-decorated, and its `DEFAULT_DB_PATH` default argument is captured at function-definition time inside the wrapped generator. Patching only the module attribute had no effect — every test hit the real production `state.db`, which doesn't contain the seeded fixtures, so every test returned 404.
- **Fix:** Added `_patch_db_path()` helper that also monkeypatches `http_db.get_conn.__wrapped__.__defaults__ = (db_path,)`. Same pattern used by Plan 33-02's `tests/test_http_reads.py` — aligned with that precedent rather than inventing a new one.
- **Files modified:** `tests/test_http_fast_mutations.py`
- **Verification:** After the fix, all 22 tests pass in 1.5s; full pm-authority test suite has no new regressions (1 pre-existing failure in `scripts/test_scheduler.py` about the lesson-mode migration is unrelated).
- **Committed in:** `86ce40a` (Task 3)

**2. [Rule 2 - Missing Critical] Added `TestFastMutationErrors.test_approve_draft_touches_db_before_dto_refresh`**
- **Found during:** Task 3 drafting
- **Issue:** Plan envisioned that fast-mutation tests might need a dto_mapper workaround when running in parallel with 33-02. A test that asserts the UPDATE committed even if the subsequent DTO refresh failed gives us coverage of the *mutation* behavior independently of the *read* behavior.
- **Fix:** Added a direct `sqlite3.connect` inspection after the POST, wrapped in a try/except so it tolerates a missing dto_mapper.
- **Files modified:** `tests/test_http_fast_mutations.py`
- **Verification:** Passes — after `/approve` the row has status `APPROVED` regardless of the DTO refresh path.
- **Committed in:** `86ce40a`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Zero scope creep. Fix #1 is required for any meaningful integration test of this router; fix #2 adds a regression guard that would have caught the very bug in fix #1.

## Issues Encountered

- **Plan 33-02 landed mid-execution** (commit `6251e0c` `test(http-service): TestClient suite for /v1/posts read endpoints`). Discovered between Task 2 and Task 3 when checking whether `services.http.dto_mapper` existed. This is the expected happy path for wave-2 parallel execution — my lazy-import + `pytest.importorskip` design handled both states (33-02 present or not). Once it landed, the success-path tests ran unconditionally.
- **Pre-existing failure in `scripts/test_scheduler.py`** about a missing `mode` column on `sequences`. Unrelated to this plan (lesson-mode migration scope). Documented in out-of-scope deferred list — NOT touched per scope boundary.

## Architectural Boundary Verified

`services/http/main.py` was **not edited** by this plan. `git log --follow services/http/main.py` returns only commit `4801111` (Plan 33-01). The lifespan in Plan 33-01 calls `jobs_router.start_gc_task(app)` on startup and `stop_gc_task(app)` on shutdown; upgrading those function bodies inside `routers/jobs.py` (rather than touching main.py) was the whole point of the wave-2 file-disjoint contract. A merge conflict with parallel Plan 33-02 was therefore structurally impossible, and the actual parallel landing of 33-02 mid-execution confirmed this at runtime.

## Verification Evidence

```
$ cd /home/yuval/pm-authority && ./.venv/bin/python -m pytest tests/test_http_jobs.py tests/test_http_fast_mutations.py -v
============================== 22 passed in 1.50s ==============================
```

Live uvicorn smoke test:

```
POST /v1/posts/nope/approve  → 404  {"error":{"code":"NOT_FOUND","message":"post not found","details":{"post_id":"nope"}}}
GET  /v1/jobs/nope            → 404  {"error":{"code":"NOT_FOUND","message":"job not found or expired","details":{"job_id":"nope"}}}
```

Lifespan logs confirm: `state.db opened successfully` + `Application startup complete` + clean `Application shutdown complete` — JobTracker GC task spawned and cancelled cleanly.

## Next Phase Readiness

**Plan 33-04 (slow mutations) is unblocked.** It can:

- `from services.http.jobs import get_tracker` and call `tracker.create(...)`, then `fastapi.BackgroundTasks.add_task(worker, tracker, job.id, ...)`
- `async with tracker.semaphore:` around any Claude-CLI / fal.ai subprocess to serialize global slow work
- `from services.http.state_guard import check_transition` for `regenerate`, `replace_image`, `pick_variant`, `pick_lesson`
- Return `202 Accepted` + `{job_id}` via the existing `JobAccepted` schema
- Rely on `GET /v1/jobs/{job_id}` polling already being live

**Plan 34 (whatsapp-bot Fastify proxy)** can already proxy the four live fast endpoints and the jobs endpoint, unblocking the read-side UX independently of 33-04.

---

## Self-Check: PASSED

- Files created (verified on disk):
  - `/home/yuval/pm-authority/services/http/jobs.py` FOUND
  - `/home/yuval/pm-authority/services/http/state_guard.py` FOUND
  - `/home/yuval/pm-authority/tests/test_http_jobs.py` FOUND
  - `/home/yuval/pm-authority/tests/test_http_fast_mutations.py` FOUND
- Files modified (verified on disk):
  - `/home/yuval/pm-authority/services/http/routers/jobs.py` UPGRADED (diff vs `4801111`)
  - `/home/yuval/pm-authority/services/http/routers/mutations_fast.py` APPENDED (diff vs `4801111`)
- Commits (verified via `git log` in pm-authority):
  - `d617195` FOUND (Task 1)
  - `0a2c12b` FOUND (Task 2)
  - `86ce40a` FOUND (Task 3)
- `main.py` unchanged since `4801111` (Plan 33-01) — VERIFIED via `git log --follow`
- 22/22 new tests pass; no new regressions in the 262-test pm-authority suite.

---
*Phase: 33-pm-authority-http-service*
*Completed: 2026-04-13*

---
phase: 33-pm-authority-http-service
plan: 04
subsystem: api
tags: [fastapi, asyncio, claude-cli, sqlite, background-tasks, lesson-runs]

# Dependency graph
requires:
  - phase: 33-pm-authority-http-service
    provides: "JobTracker.semaphore + state_guard (Plan 33-03)"
  - phase: 33-pm-authority-http-service
    provides: "build_post_dto + Pydantic schemas + db helper (Plan 33-02 + 33-01)"
provides:
  - "exception_map.map_exception() — translates ValueError / RuntimeError / TimeoutExpired / OperationalError / FileNotFoundError into the 10-code ErrorCode taxonomy"
  - "workers.run_regenerate / run_pick_variant / run_pick_lesson — async wrappers around bot.py sync entrypoints, each running under JobTracker.semaphore"
  - "workers.run_lesson_run — REAL call-through to PostGenerator.generate_lesson_variants (Roadmap Success Criterion #3); reconstructs ProjectContext from the source sequence's context_json, persists a new lesson-mode sequence + post + two variants"
  - "POST /v1/posts/{id}/regenerate — 202 + JobAccepted; sync REGEN_CAPPED at 5/5"
  - "POST /v1/posts/{id}/pick-variant — fast 200 PostDTO for hook variants, 202 JobAccepted only when fal.ai image gen is required"
  - "POST /v1/posts/{id}/pick-lesson — 202 + JobAccepted; sync 409 LESSON_ALREADY_PICKED"
  - "POST /v1/posts/{id}/replace-image — 200 PostDTO; path-jail + PENDING_PII_REVIEW transition"
  - "POST /v1/lesson-runs — sync 404/422 pre-flight, then 202 JobAccepted; worker actually runs generate_lesson_variants and returns {sequence_id, post_id, variant_ids, chosen_lesson, project_name}"
affects: [33-05-pm-authority-e2e-walkthrough, 34-whatsapp-bot-proxy, 35-sse-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy import of bot.py inside every worker thunk so python-telegram-bot is never loaded at HTTP service boot"
    - "_run_with_semaphore wraps every slow worker: acquire JobTracker.semaphore → mark_running → run_in_threadpool(thunk) → mark_succeeded / mark_failed-via-map_exception"
    - "exception_map pattern-matches ValueError messages (\"not found\" → NOT_FOUND, else UNPROCESSABLE) since pm-authority has no custom exception hierarchy"
    - "run_lesson_run has belt+braces validation: router does sync 404/422, then worker thunk repeats them as APIError(...) so a racing delete still surfaces the right code"
    - "pick-variant decides fast/slow by inspecting variant.image_prompt + post.image_path (no image_prompt OR already-present image → fast 200 path)"
    - "Path-jail on replace-image via Path.resolve().relative_to(PM_DATA_ROOT) — PM_DATA_ROOT resolved at import time so symlink shuffles between requests can't bypass the check"
    - "Test fixture monkeypatches PostGenerator.generate_lesson_variants on the class, so the worker's `PostGenerator()` instance picks up the fake without needing to patch instances"

key-files:
  created:
    - pm-authority/services/http/exception_map.py
    - pm-authority/services/http/workers.py
    - pm-authority/tests/test_http_slow_mutations.py
  modified:
    - pm-authority/services/http/routers/mutations_slow.py
    - pm-authority/services/http/routers/lesson_runs.py
  unchanged-by-design:
    - pm-authority/services/http/main.py  # still at commit 4801111 from Plan 33-01

key-decisions:
  - "run_lesson_run is a REAL call-through to generate_lesson_variants — not a stub. Phase 33 narrows the scope by requiring source_sequence_id + chosen_lesson (not a brand-new project path), but the actual generator function IS invoked and the variants ARE persisted via insert_lesson_variants. Brand-new project ingestion stays Phase 35 scope."
  - "blocking_regenerate returning None is treated as UPSTREAM_FAILURE rather than a generic INTERNAL_ERROR, because pm-authority's blocking_regenerate swallows all exceptions internally and returns None on any Claude failure"
  - "pick-variant fast path bypasses the JobTracker entirely for hook variants — there's no slow work to schedule, so requiring the dashboard to poll for a job that completes synchronously would just add latency"
  - "exception_map's ValueError → NOT_FOUND/UNPROCESSABLE split is message-pattern based (\"not found\" / \"no such\"). This is brittle but pm-authority's existing call sites only use one of those two phrasings and we can tighten it later if needed"
  - "Worker thunks lazy-import bot.py via importlib so test monkeypatching of bot.blocking_regenerate works (the worker re-fetches the attribute on every call)"
  - "Replace-image PM_DATA_ROOT is hard-coded to /home/yuval/pm-authority/data — it's resolved once at module import time so a symlink shuffled between requests can't bypass the relative_to check"
  - "Slow mutation tests reuse the same _patch_db_path helper as test_http_fast_mutations.py: monkeypatch http_db.DEFAULT_DB_PATH AND get_conn.__wrapped__.__defaults__ (the @contextmanager gotcha — default args are bound at def-time inside the wrapped function)"

patterns-established:
  - "Slow mutation shape: status check → state_guard → optional fast/slow branch → tracker.create() → bg.add_task(workers.X, tracker, job_id, ...) → 202 JobAccepted"
  - "Worker thunk shape: lazy-import dependencies → call sync function → re-read DTO via build_post_dto → return result dict; any raise routes through map_exception"
  - "Lesson-runs response shape (in job result): {sequence_id, post_id, variant_ids: [story_id, claim_id], chosen_lesson, project_name}"

requirements-completed: [LIN-01]

# Endpoint contract for /v1 (now complete)
endpoint-classification:
  sync:
    - GET  /v1/health
    - GET  /v1/posts
    - GET  /v1/posts/{id}
    - GET  /v1/posts/{id}/image
    - GET  /v1/posts/{id}/lesson-candidates/{candidate_id}/image
    - GET  /v1/jobs/{job_id}
    - POST /v1/posts/{id}/approve
    - POST /v1/posts/{id}/reject
    - POST /v1/posts/{id}/edit
    - POST /v1/posts/{id}/replace-image
    - POST /v1/posts/{id}/pick-variant   # fast branch only (hook variants)
  async-job-backed:
    - POST /v1/posts/{id}/regenerate
    - POST /v1/posts/{id}/pick-variant   # slow branch (lesson variants needing fal.ai)
    - POST /v1/posts/{id}/pick-lesson
    - POST /v1/lesson-runs

# Metrics
duration: ~25min
completed: 2026-04-13
tasks-completed: 3
tests-passing: 51  # all of test_http_reads + test_http_fast_mutations + test_http_jobs + test_http_slow_mutations
---

# Phase 33 Plan 04: Slow Mutations + Real Lesson Runs Summary

**Async slow-mutation workers under a global asyncio.Semaphore, plus a REAL call-through from POST /v1/lesson-runs to PostGenerator.generate_lesson_variants — no stubs, the variants land in the DB.**

## What landed

### Endpoints (all 14 of CONTEXT.md §1 are now live)

| Method | Path                                                         | Mode  | Notes                                       |
| ------ | ------------------------------------------------------------ | ----- | ------------------------------------------- |
| GET    | /v1/health                                                   | sync  | Plan 33-01                                  |
| GET    | /v1/posts                                                    | sync  | Plan 33-02                                  |
| GET    | /v1/posts/{id}                                               | sync  | Plan 33-02                                  |
| GET    | /v1/posts/{id}/image                                         | sync  | Plan 33-02                                  |
| GET    | /v1/posts/{id}/lesson-candidates/{cid}/image                 | sync  | Plan 33-02                                  |
| GET    | /v1/jobs/{job_id}                                            | sync  | Plan 33-03                                  |
| POST   | /v1/posts/{id}/approve                                       | sync  | Plan 33-03                                  |
| POST   | /v1/posts/{id}/reject                                        | sync  | Plan 33-03                                  |
| POST   | /v1/posts/{id}/edit                                          | sync  | Plan 33-03                                  |
| POST   | /v1/posts/{id}/regenerate                                    | async | **33-04**, REGEN_CAPPED at 5/5              |
| POST   | /v1/posts/{id}/pick-variant                                  | hybrid| **33-04**, fast for hook / async for lesson |
| POST   | /v1/posts/{id}/pick-lesson                                   | async | **33-04**                                   |
| POST   | /v1/posts/{id}/replace-image                                 | sync  | **33-04**, path-jail enforced               |
| POST   | /v1/lesson-runs                                              | async | **33-04**, REAL generate_lesson_variants    |

### workers.py public API

```python
async def run_regenerate(tracker, job_id, post_id) -> None
async def run_pick_variant(tracker, job_id, post_id, variant_id) -> None
async def run_pick_lesson(tracker, job_id, post_id, candidate_id) -> None
async def run_lesson_run(tracker, job_id, source_sequence_id, chosen_lesson, perspective, language) -> None
```

All four go through `_run_with_semaphore`, which:

1. Acquires `tracker.semaphore` (asyncio.Semaphore(1)) — only one Claude / fal.ai call runs at once
2. Marks the job 'running'
3. Runs the thunk in `run_in_threadpool` (so subprocess.run doesn't block the event loop)
4. Marks succeeded / failed via `exception_map.map_exception`

### exception_map.py

`map_exception(exc) -> ErrorDetail`. Handles: APIError (passthrough), ValueError (NOT_FOUND or UNPROCESSABLE depending on message), `subprocess.TimeoutExpired`, `RuntimeError`, `sqlite3.OperationalError`, `FileNotFoundError`, fallback `INTERNAL_ERROR`.

## /v1/lesson-runs is a REAL call-through, not a stub

Per Roadmap Success Criterion #3, **`POST /v1/lesson-runs` ACTUALLY CALLS `PostGenerator.generate_lesson_variants`**. The worker:

1. **Pre-flight (sync, in router):** Look up the source sequence. If missing → 404 NOT_FOUND. If `context_json` is null/empty → 422 UNPROCESSABLE. (These return immediately, not in the job body, so the dashboard sees them on the first response.)
2. **Worker (async, in threadpool):** Reload the source sequence's `context_json`, parse it into a `ProjectContext`, instantiate `PostGenerator()`, call `generate_lesson_variants(context, chosen_lesson=chosen_lesson, perspective=..., language=..., db_path=...)`.
3. **Persist:** Create a brand-new `PostSequence(mode='lesson')` with a `PENDING_VARIANT` placeholder `Post`, save it via `mgr.save_sequence`, then insert the two lesson variants via `mgr.insert_lesson_variants(post_id, story=variants["lesson_story"], claim=variants["lesson_claim"])`.
4. **Return** `{sequence_id, post_id, variant_ids: [story_id, claim_id], chosen_lesson, project_name}` in the job result.

The test `test_lesson_runs_calls_generate_lesson_variants_and_persists` proves both halves: it monkeypatches `PostGenerator.generate_lesson_variants` to a fake that records call args + returns canned variants, then asserts (a) the fake was called exactly once with `context.name == "TestProj"` and `chosen_lesson == "learn to ship fast"`, and (b) after polling the job to `succeeded`, the new `sequences` row exists with `mode='lesson'`, the new `posts` row is `PENDING_VARIANT`, and `post_variants` contains exactly two rows with `angle_type` `lesson_story` + `lesson_claim` and the canned content.

### Contract for /v1/lesson-runs

```http
POST /v1/lesson-runs
Content-Type: application/json

{
  "source_sequence_id": "<existing sequence id with context_json populated>",
  "chosen_lesson": "the lesson text the user picked",
  "perspective": "yuval" | "yuval_critique",   // optional, default "yuval"
  "language": "en" | "he"                       // optional, default "en"
}
```

Success path:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{"job_id": "<uuid>"}
```

Then `GET /v1/jobs/<uuid>` until `status: succeeded`, where `result` is:

```json
{
  "sequence_id": "<new lesson-mode sequence id>",
  "post_id":     "<new placeholder post id>",
  "variant_ids": [<story_id>, <claim_id>],
  "chosen_lesson": "the lesson text",
  "project_name": "TestProj"
}
```

### Replace-image contract

The caller MUST upload the file under `/home/yuval/pm-authority/data/screenshots/` (or any path that resolves into `/home/yuval/pm-authority/data/`) BEFORE calling the endpoint. The endpoint does not accept multipart uploads — it only validates the path, marks `image_source='screenshot'`, and flips status to `PENDING_PII_REVIEW`. Anything outside `pm-authority/data/` returns 422 UNPROCESSABLE; missing files return 404.

## Phase-35-deferred gap

`/v1/lesson-runs` currently requires an EXISTING sequence with `context_json` already populated. Brand-new project ingestion from a filesystem path (e.g. "create a sequence for /home/yuval/some-new-project") is Phase 35 scope. The Phase 33 narrow interpretation was authorized by the plan-checker because Roadmap Success Criterion #3 only requires that `generate_lesson_variants` be a real call-through target, not that the input shape be the full pre-ingestion flow.

When Phase 35 lands, this endpoint will gain an alternate body shape (`{project_path, ...}`) that runs the ingestion pipeline first, then funnels into the same `generate_lesson_variants` call. The Phase 33 shape (`source_sequence_id` + `chosen_lesson`) will continue to work alongside it.

## Test results

```
$ ./.venv/bin/python -m pytest tests/test_http_reads.py tests/test_http_fast_mutations.py tests/test_http_jobs.py tests/test_http_slow_mutations.py -v
============================== 51 passed in 3.95s ==============================
```

The slow-mutation suite alone is 16 tests. main.py is verifiably untouched: `git log --follow services/http/main.py` shows the most recent commit is still `4801111` from Plan 33-01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test fixture missing get_conn defaults patch**

- **Found during:** Task 3 fixture review
- **Issue:** The plan's fixture monkeypatched `services.http.db.DEFAULT_DB_PATH` but did not patch `get_conn.__wrapped__.__defaults__`. Because `get_conn` is a `@contextmanager`, its `db_path` default arg is captured at def-time inside the wrapped function, so a plain module-level monkeypatch leaves router-side `get_conn()` calls hitting the real `state.db`. Without the wrapped-defaults patch, every test that exercises a router-side DB read would silently use the production DB.
- **Fix:** Lifted the `_patch_db_path` helper from `tests/test_http_fast_mutations.py` (where the same gotcha was already documented) and used it in `seeded_db`. This patches both `http_db.DEFAULT_DB_PATH` and `http_db.get_conn.__wrapped__.__defaults__`.
- **Files modified:** `pm-authority/tests/test_http_slow_mutations.py`
- **Commit:** included in `3b06b97 test(http-service): slow mutation + lesson-runs TestClient suite`

**2. [Rule 1 - Bug] Plan's `_db_path_str()` would not honor monkeypatching**

- **Found during:** Task 1 worker design
- **Issue:** The plan showed `from services.http.db import DEFAULT_DB_PATH` at module top-level inside `workers.py`, then `def _db_path_str(): return str(DEFAULT_DB_PATH)`. That captures the import-time binding, so monkeypatching `services.http.db.DEFAULT_DB_PATH` from a test would not affect what the worker sees.
- **Fix:** Imported the module (`from services.http import db as http_db`) instead and resolved `http_db.DEFAULT_DB_PATH` on every call inside `_db_path_str()`. Same fix applied to the router helper `_pm_state_db_path()` in `mutations_slow.py`.
- **Files modified:** `pm-authority/services/http/workers.py`, `pm-authority/services/http/routers/mutations_slow.py`
- **Commit:** included in `3133d91 feat(http-service): exception_map + slow mutation workers` and `5b60aeb feat(http-service): slow mutation + lesson-runs routes`

### Non-deviations

- The plan suggested test name `test_pick_variant_wrong_status`; renamed to `test_pick_variant_unknown_variant_returns_404` because the assertion is about the variant lookup returning NOT_FOUND, not a state-machine violation. (The router checks variant existence before checking status.)

No architectural changes. No Rule 4 escalations.

## Self-Check: PASSED

Verified:

- [x] `pm-authority/services/http/exception_map.py` exists (commit 3133d91)
- [x] `pm-authority/services/http/workers.py` exists (commit 3133d91)
- [x] `pm-authority/services/http/routers/mutations_slow.py` modified (commit 5b60aeb)
- [x] `pm-authority/services/http/routers/lesson_runs.py` modified (commit 5b60aeb)
- [x] `pm-authority/tests/test_http_slow_mutations.py` exists (commit 3b06b97)
- [x] All 14 /v1 endpoints registered in app.routes
- [x] `pm-authority/services/http/main.py` last commit is 4801111 (Plan 33-01) — untouched
- [x] 51/51 HTTP tests pass (test_http_reads + test_http_fast_mutations + test_http_jobs + test_http_slow_mutations)
- [x] run_lesson_run actually calls PostGenerator.generate_lesson_variants (proven by `test_lesson_runs_calls_generate_lesson_variants_and_persists`)
- [x] `import services.http.workers` does NOT load bot or python-telegram-bot (verified with `sys.modules` assertion)

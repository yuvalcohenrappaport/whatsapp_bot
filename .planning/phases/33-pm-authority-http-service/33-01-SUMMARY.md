---
phase: 33-pm-authority-http-service
plan: 01
subsystem: api
tags: [fastapi, uvicorn, pydantic-v2, sqlite, wal, pm2, python, cross-repo]

requires:
  - phase: (none — first plan of phase 33)
    provides: pm-authority ReviewManager, state.db schema, existing .venv (Python 3.14.3)
provides:
  - FastAPI app importable as services.http.main:app from /home/yuval/pm-authority
  - /v1/health endpoint (200 ok / 503 UNAVAILABLE during startup retry window)
  - 10-code ErrorCode enum + {error:{code,message,details}} wire envelope
  - Pydantic v2 DTOs (PostDTO, VariantDTO, LessonCandidateDTO, ImageInfoDTO, JobDTO) + request bodies (EditRequest, ReplaceImageRequest, PickVariantRequest, PickLessonRequest, StartLessonRunRequest)
  - state.db helper (open_db_with_retry 3x/5s, get_conn context manager, WAL + busy_timeout=5000 + foreign_keys)
  - Six pre-wired empty routers (posts, images, jobs, mutations_fast, mutations_slow, lesson_runs) mounted at /v1 so downstream plans never touch main.py
  - jobs.start_gc_task / stop_gc_task lifespan shim stable signature for Plan 33-03 to fill
  - PM2 ecosystem entry pm-authority-http on 127.0.0.1:8765 workers=1
  - pytest.ini with asyncio_mode=auto and pytest-asyncio installed
affects: [33-02, 33-03, 33-04, 33-05, 34-*, 35-*]

tech-stack:
  added: [fastapi>=0.115, uvicorn[standard]>=0.32, pydantic>=2.9, httpx>=0.27, pytest-asyncio>=0.23]
  patterns:
    - "Router-ownership boundary: main.py pre-mounts all six empty routers so waves 2-4 append route handlers to disjoint files"
    - "Global error envelope via @app.exception_handler — no FastAPI default 422 body leaks"
    - "Lifespan-scoped db_ready flag on app.state instead of module-level globals"
    - "Pydantic v2 Field(exclude=True) to hide internal-only fields (filesystem_path) from wire serialization"
    - "WAL + busy_timeout=5000 pragmas applied at every connection open, not just at startup"

key-files:
  created:
    - /home/yuval/pm-authority/services/__init__.py
    - /home/yuval/pm-authority/services/http/__init__.py
    - /home/yuval/pm-authority/services/http/main.py
    - /home/yuval/pm-authority/services/http/errors.py
    - /home/yuval/pm-authority/services/http/db.py
    - /home/yuval/pm-authority/services/http/schemas.py
    - /home/yuval/pm-authority/services/http/routers/__init__.py
    - /home/yuval/pm-authority/services/http/routers/health.py
    - /home/yuval/pm-authority/services/http/routers/posts.py
    - /home/yuval/pm-authority/services/http/routers/images.py
    - /home/yuval/pm-authority/services/http/routers/jobs.py
    - /home/yuval/pm-authority/services/http/routers/mutations_fast.py
    - /home/yuval/pm-authority/services/http/routers/mutations_slow.py
    - /home/yuval/pm-authority/services/http/routers/lesson_runs.py
    - /home/yuval/pm-authority/pytest.ini
    - /home/yuval/pm-authority/ecosystem.config.js
    - /home/yuval/pm-authority/README.md
  modified:
    - /home/yuval/pm-authority/requirements.txt

key-decisions:
  - "ImageInfoDTO.filesystem_path uses Field(exclude=True) — never appears in wire JSON; only the dto_mapper (producer) and image router (consumer) see it"
  - "ImageInfoDTO.pii_reviewed is a first-class wire field, derived from post.status != 'PENDING_PII_REVIEW' at DTO-mapping time"
  - "Post id is str (UUID), not int — matches real pm-authority schema"
  - "PostDTO.created_at sourced from owning sequences.created_at; updated_at always None in v1 because pm-authority posts table has no updated_at column"
  - "StartLessonRunRequest body = {source_sequence_id, chosen_lesson, perspective?, language?} — matches generate_lesson_variants signature, reuses existing sequence context_json (brand-new project ingestion deferred to Phase 35)"
  - "schemas.py imports ErrorDetail from errors.py at module top (no forward ref needed) since there's no circular dependency"
  - "Router-ownership boundary encoded in main.py comment: downstream plans MUST NOT edit main.py, only append to their router module"

patterns-established:
  - "Pattern: pre-wired router skeleton — main.py in Plan 33-01 owns all include_router() calls, waves 2-4 append handlers to individual router modules only"
  - "Pattern: lifespan-hook stable signatures — jobs.start_gc_task(app) is a shim in Plan 01 that Plan 33-03 replaces the body of without touching main.py"
  - "Pattern: error envelope is the ONLY JSON response shape on errors — validation, 404, 405, APIError, and bare Exception all route through _envelope()"
  - "Pattern: state.db pragmas (WAL + busy_timeout=5000 + foreign_keys) applied at every connection open via shared _apply_pragmas() helper"

requirements-completed: [LIN-01]

duration: 4min
completed: 2026-04-12
---

# Phase 33 Plan 01: pm-authority HTTP Sidecar Scaffold Summary

**FastAPI sidecar at 127.0.0.1:8765 with /v1/health, locked error envelope, six pre-wired empty routers, and state.db WAL retry — the router-ownership boundary lets waves 2-4 append handlers without ever touching main.py.**

## Performance

- **Duration:** ~4 min (228 seconds wall clock)
- **Started:** 2026-04-13T08:50:29Z
- **Completed:** 2026-04-13T08:54:17Z
- **Tasks:** 3 / 3 complete
- **Files created:** 17 (15 new source files + ecosystem.config.js + README.md)
- **Files modified:** 1 (requirements.txt)

## Accomplishments

- `uvicorn services.http.main:app --host 127.0.0.1 --port 8765 --workers 1` starts cleanly, opens state.db in WAL mode, and `GET /v1/health` returns `{"status":"ok","version":"0.1.0","db_ready":true}`
- All error paths return the `{error:{code,message,details}}` envelope — verified with 404 on `/v1/does-not-exist` returning `{"error":{"code":"NOT_FOUND",...}}`
- `ss -tlnp` confirms the service binds `127.0.0.1:8765` only — no non-loopback exposure
- Six empty routers (posts, images, jobs, mutations_fast, mutations_slow, lesson_runs) are pre-mounted at `/v1` so plans 33-02/03/04 only append route handlers to their respective router modules — main.py is frozen
- `jobs.start_gc_task(app)` / `stop_gc_task(app)` wired as lifespan hooks with stable signatures — Plan 33-03 will replace the bodies to instantiate a real JobTracker without editing main.py
- pytest collects 228 existing tests cleanly with pytest-asyncio installed; `pytest.ini` has `asyncio_mode = auto` ready for Plan 03's async JobTracker tests
- Zero changes to existing pm-authority modules (`review/`, `generation/`, `bot.py` untouched)

## Task Commits

Each task committed atomically on `/home/yuval/pm-authority` (main):

1. **Task 1: Add deps + pytest.ini + scaffold services.http package** — `072041b`
   `feat(http-service): add FastAPI deps and scaffold services.http package`
2. **Task 2: Build error contract, db helper, and Pydantic schemas** — `35e6c28`
   `feat(http-service): add error taxonomy, db helper, and Pydantic schemas`
3. **Task 3: FastAPI app + health router + six empty routers + PM2 entry + README** — `4801111`
   `feat(http-service): FastAPI app, health route, six pre-wired routers, PM2 entry`

**Plan metadata commit** (on `/home/yuval/whatsapp-bot`): see final commit after this summary is written.

## Pydantic models exposed (for downstream plan imports)

From `services.http.schemas`:
- `HealthResponse`
- `VariantDTO`, `LessonCandidateDTO`, `ImageInfoDTO`, `PostDTO`
- `EditRequest`, `ReplaceImageRequest`, `PickVariantRequest`, `PickLessonRequest`, `StartLessonRunRequest`
- `JobDTO`, `JobAccepted`

## ErrorCode enum (for downstream plan imports)

From `services.http.errors`:
- `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `STATE_VIOLATION` (409), `REGEN_CAPPED` (409), `LESSON_ALREADY_PICKED` (409), `VARIANT_ALREADY_PICKED` (409), `UNPROCESSABLE` (422), `INTERNAL_ERROR` (500), `UPSTREAM_FAILURE` (502), `UNAVAILABLE` (503)
- `ErrorDetail`, `ErrorEnvelope`, `APIError(code, message, details=None)`, `status_for(code) -> int`

## DB helpers (for downstream plan imports)

From `services.http.db`:
- `DEFAULT_DB_PATH: Path` (= `/home/yuval/pm-authority/state.db`)
- `open_db_with_retry(db_path=DEFAULT_DB_PATH, *, attempts=3, backoff_seconds=1.666) -> bool`
- `get_conn(db_path=DEFAULT_DB_PATH) -> Iterator[sqlite3.Connection]` (context manager, row_factory=Row, WAL + busy_timeout=5000 + foreign_keys applied)

## Architectural boundary — DO NOT EDIT main.py in Plans 33-02/03/04

`services/http/main.py` has a prominent comment block:

> IMPORTANT — ARCHITECTURAL BOUNDARY: Plans 33-02 / 33-03 / 33-04 MUST NOT edit this file. They only append route handlers to their respective router modules under services/http/routers/. The router objects themselves already exist and are already mounted here in Plan 33-01.

All six downstream routers are empty APIRouter() instances already included at `/v1`. Plans append `@router.get(...)` / `@router.post(...)` handlers to their own router file — no main.py edit is ever required. This is the architectural decision that makes waves 2-4 file-disjoint and parallel-safe.

## Files Created/Modified

Created under `/home/yuval/pm-authority/`:

- `services/__init__.py` — empty package marker
- `services/http/__init__.py` — empty package marker
- `services/http/main.py` — FastAPI app factory, lifespan (db retry + jobs GC shim), 4 global error handlers, 7 router includes
- `services/http/errors.py` — ErrorCode enum, status_for(), ErrorDetail, ErrorEnvelope, APIError
- `services/http/db.py` — open_db_with_retry, get_conn, _apply_pragmas
- `services/http/schemas.py` — all DTOs and request bodies (Pydantic v2)
- `services/http/routers/__init__.py` — empty package marker
- `services/http/routers/health.py` — GET /v1/health
- `services/http/routers/posts.py` — empty APIRouter(prefix='/posts')
- `services/http/routers/images.py` — empty APIRouter(prefix='/posts')
- `services/http/routers/jobs.py` — empty APIRouter(prefix='/jobs') + start_gc_task/stop_gc_task shim
- `services/http/routers/mutations_fast.py` — empty APIRouter(prefix='/posts')
- `services/http/routers/mutations_slow.py` — empty APIRouter(prefix='/posts')
- `services/http/routers/lesson_runs.py` — empty APIRouter(prefix='/lesson-runs')
- `pytest.ini` — `[pytest] asyncio_mode = auto`
- `ecosystem.config.js` — PM2 app `pm-authority-http`
- `README.md` — HTTP Sidecar section

Modified under `/home/yuval/pm-authority/`:

- `requirements.txt` — added `fastapi>=0.115`, `uvicorn[standard]>=0.32`, `pydantic>=2.9`, `httpx>=0.27`, `pytest-asyncio>=0.23` (existing lines preserved)

Installed into existing `/home/yuval/pm-authority/.venv` (Python 3.14.3):
`fastapi-0.135.3`, `uvicorn-0.44.0`, `pydantic-2.12.5`, `pytest-asyncio-1.3.0`, plus transitive deps (starlette, httptools, uvloop, watchfiles, pyyaml, click).

## Decisions Made

- **schemas.py imports ErrorDetail at the top** instead of the bottom forward-ref pattern the plan sketched. Reason: errors.py has zero back-reference to schemas.py, so there's no circular dependency risk and top-level imports are simpler / more idiomatic. `JobDTO.model_rebuild()` is still called defensively.
- **Uvicorn verification was done against an actual background process**, not just in-process TestClient, because the plan explicitly requires verifying the 127.0.0.1 loopback bind via `ss -tlnp`. The bind check confirmed our uvicorn is on `127.0.0.1:8765` (a pre-existing unrelated process occupying `0.0.0.0:18765` is noted but unrelated — different pid, different port).
- All other decisions followed the plan verbatim (error taxonomy, DB retry, router layout, PM2 config, README text).

## Deviations from Plan

None — plan executed exactly as written. Minor stylistic choice (top-level `ErrorDetail` import in schemas.py instead of bottom forward ref) is functionally equivalent and documented above.

## Issues Encountered

None. One observation: `ss -tlnp` surfaced an unrelated pre-existing listener on `0.0.0.0:18765` owned by a different process (pid 1656974, python). Our service is on the correct `127.0.0.1:8765` and the unrelated listener is noise, not a bind-security issue.

## User Setup Required

None — no external service configuration required for this plan. The PM2 ecosystem entry is defined but not registered with a running pm2 daemon; Plan 33-05 will handle `pm2 start ecosystem.config.js` as part of integration.

## Next Phase Readiness

- **Plan 33-02 unblocked:** reads (GET /posts, GET /posts/{id}, GET /posts/{id}/image, lesson-candidate image) append to `routers/posts.py` and `routers/images.py`
- **Plan 33-03 unblocked:** JobTracker + fast mutations append to `routers/jobs.py` and `routers/mutations_fast.py`; start_gc_task body gets filled in
- **Plan 33-04 unblocked:** slow mutations + lesson-runs append to `routers/mutations_slow.py` and `routers/lesson_runs.py`
- **Plan 33-05 ready:** PM2 ecosystem.config.js entry exists, README documents health URL — only needs integration testing + `pm2 start`

## Self-Check: PASSED

Verified the following after SUMMARY.md was drafted:

- File `/home/yuval/pm-authority/services/http/main.py` — FOUND
- File `/home/yuval/pm-authority/services/http/errors.py` — FOUND
- File `/home/yuval/pm-authority/services/http/db.py` — FOUND
- File `/home/yuval/pm-authority/services/http/schemas.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/health.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/posts.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/images.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/jobs.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/mutations_fast.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/mutations_slow.py` — FOUND
- File `/home/yuval/pm-authority/services/http/routers/lesson_runs.py` — FOUND
- File `/home/yuval/pm-authority/pytest.ini` — FOUND
- File `/home/yuval/pm-authority/ecosystem.config.js` — FOUND
- File `/home/yuval/pm-authority/README.md` — FOUND
- Commit `072041b` in pm-authority — FOUND
- Commit `35e6c28` in pm-authority — FOUND
- Commit `4801111` in pm-authority — FOUND

---
*Phase: 33-pm-authority-http-service*
*Completed: 2026-04-12*

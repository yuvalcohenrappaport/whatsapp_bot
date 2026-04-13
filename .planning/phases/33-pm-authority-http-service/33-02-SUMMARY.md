---
phase: 33-pm-authority-http-service
plan: 02
subsystem: api

tags: [fastapi, pydantic, sqlite, testclient, http-read-endpoints, pm-authority, dto-mapper, path-traversal-guard]

requires:
  - phase: 33-pm-authority-http-service
    provides: "Plan 33-01 scaffold — FastAPI app, Pydantic DTOs with filesystem_path as Field(exclude=True), empty pre-wired posts/images routers, structured error envelope, get_conn helper"

provides:
  - "GET /v1/posts list endpoint with multi-status filter (?status=A&status=B) + non-terminal default"
  - "GET /v1/posts/{post_id} fat DTO with embedded variants + lesson_candidates (always arrays, never null)"
  - "GET /v1/posts/{post_id}/image streaming endpoint with data-root path-traversal guard"
  - "GET /v1/posts/{post_id}/lesson-candidates/{candidate_id}/image streaming endpoint"
  - "services.http.dto_mapper.build_post_dto / list_post_dtos — SINGLE source of truth for SQLite → PostDTO mapping"
  - "NON_TERMINAL_STATUSES tuple reused by every downstream plan that needs the default list filter"
  - "Pydantic wire guarantee asserted by test: filesystem_path never serializes to JSON"
  - "Derived pii_reviewed field (post.status != 'PENDING_PII_REVIEW') as first-class wire field"

affects:
  - 33-03-job-tracker-fast-mutations   # fast mutations call build_post_dto to return refreshed post after approve/reject/edit
  - 33-04-slow-mutations-lesson-runs    # slow mutation job results reuse build_post_dto
  - 33-05-integration-test-pm2          # hits these read endpoints for cross-repo verification
  - 34-fastify-proxy                    # Zod schemas match this wire shape exactly
  - 35-linkedin-queue-ui                # dashboard reads from these endpoints

tech-stack:
  added: []
  patterns:
    - "dto_mapper as single source of truth for DTO assembly — every later plan that returns a PostDTO after a mutation imports build_post_dto rather than reimplementing the SQL"
    - "Path-jail security pattern: resolve raw filesystem path → relative_to(DATA_ROOT) → fail-soft to NOT_FOUND on any escape attempt (never 403 or 500, uniform shape for the dashboard)"
    - "Derived DTO fields computed at mapping time (pii_reviewed from status) rather than stored — keeps schema minimal"

key-files:
  created:
    - "pm-authority/services/http/dto_mapper.py — canonical PostDTO builder (231 lines)"
    - "pm-authority/tests/test_http_reads.py — 13 TestClient tests over seeded temp state.db (372 lines)"
  modified:
    - "pm-authority/services/http/routers/posts.py — appended list_posts + get_post handlers"
    - "pm-authority/services/http/routers/images.py — appended get_post_image + get_lesson_candidate_image handlers with path-traversal guard"

key-decisions:
  - "dto_mapper.py is the SINGLE source of truth for PostDTO assembly — later plans must import build_post_dto, never duplicate the mapping logic"
  - "filesystem_path is set on the Python ImageInfoDTO object so the image router can read it in-process, but Pydantic's Field(exclude=True) (set in Plan 33-01) guarantees it never serializes to the wire — enforced by explicit test assertions on DRAFT + PENDING_PII_REVIEW + image-less posts"
  - "pii_reviewed is DERIVED at mapping time (post.status != 'PENDING_PII_REVIEW'), not stored — anything past the PII review gate is considered reviewed"
  - "Superseded variants (post_variants.selected = -1) filtered out of the DTO variants array at mapping time, NOT at the DB query level (future plans may need to fetch them for audit)"
  - "Path-traversal guard resolves raw image_path, requires resolved path to live under /home/yuval/pm-authority/data/, and returns a UNIFORM 404 NOT_FOUND for every failure mode (invalid, escape, missing, non-file) so the dashboard error handling stays simple"
  - "Lesson-candidate image endpoint requires the candidate to be selected AND the post's image_path to be populated — mirrors pm-authority's current behavior where lesson images live on the post row, not the candidate row"
  - "TestClient fixture monkeypatches get_conn.__wrapped__.__defaults__ directly because @contextmanager captures the default db_path argument at function-definition time — patching only the module attribute would NOT redirect the default"

patterns-established:
  - "Append-to-prewired-router: Plans 02/03/04 only append route handlers to the router module they own; main.py is owned exclusively by Plan 33-01 and never touched again"
  - "Path-jail for filesystem-backed endpoints: resolve → relative_to → fail-soft 404"

requirements-completed: [LIN-01]

duration: ~25min
completed: 2026-04-13
---

# Phase 33 Plan 02: Read Endpoints + DTO Mapper Summary

**Read-side HTTP surface for the pm-authority sidecar: list/filter posts, fetch fat PostDTO with embedded variants + lesson_candidates, stream image binaries under a data-root jail — all driven by a single canonical dto_mapper that downstream mutation plans will reuse.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-13T08:40:00Z (approx)
- **Completed:** 2026-04-13T09:05:00Z
- **Tasks:** 3
- **Files created:** 2 (dto_mapper.py, test_http_reads.py)
- **Files modified:** 2 (routers/posts.py, routers/images.py — append-only)
- **Tests:** 13/13 passing (`./.venv/bin/pytest tests/test_http_reads.py -v`)

## Accomplishments

- `services/http/dto_mapper.py` built as the SINGLE source of truth for SQLite → PostDTO assembly; every later plan that returns a PostDTO after a mutation will import `build_post_dto` rather than reimplementing the query.
- Four read endpoints wired and verified against the real production state.db via a live uvicorn smoke test:
  - `GET /v1/posts` (with `?status=...` multi-filter, default excludes PUBLISHED/REJECTED)
  - `GET /v1/posts/{post_id}` (fat DTO)
  - `GET /v1/posts/{post_id}/image`
  - `GET /v1/posts/{post_id}/lesson-candidates/{candidate_id}/image`
- Path-traversal guard: any `image_path` that resolves outside `/home/yuval/pm-authority/data/` returns a uniform 404 NOT_FOUND — tested with `/etc/passwd`.
- `main.py` was NOT touched — Plan 33-01's pre-wired `app.include_router` calls automatically surface every handler appended to the individual router modules, preserving disjoint file ownership with the parallel 33-03 plan.
- 13-test pytest suite uses a seeded temp state.db with explicit assertions that `filesystem_path` never appears on the wire (on DRAFT, PENDING_PII_REVIEW, and image-less posts) and `pii_reviewed` is correctly derived from status.

## Task Commits

All commits in `/home/yuval/pm-authority/` (code repo):

1. **Task 1: Build dto_mapper.py** — `f561671` (feat)
2. **Task 2: Append GET handlers to posts.py + images.py** — `56b440d` (feat)
3. **Task 3: Pytest TestClient suite** — `6251e0c` (test)

Planning/state commit in `/home/yuval/whatsapp-bot/` (planning repo): _(created as final metadata commit below)_

## Files Created/Modified

### Created (in /home/yuval/pm-authority/)

- `services/http/dto_mapper.py` — `build_post_dto(conn, post_id)`, `list_post_dtos(conn, statuses)`, `NON_TERMINAL_STATUSES` tuple. Handles timestamp parsing with UTC coercion, superseded-variant filtering, position-in-sequence calculation, and derived `pii_reviewed` logic. Raises `APIError(NOT_FOUND)` for missing posts and `APIError(INTERNAL_ERROR)` for orphaned posts.
- `tests/test_http_reads.py` — 13 tests covering: default status filter, single-status filter, multi-status filter, fat DTO shape (variants + lessons + image), PENDING_PII_REVIEW → `pii_reviewed=False`, empty-arrays-not-null, NOT_FOUND envelope, image streaming success (binary + Content-Type), missing-file 404, path-traversal 404, unknown-post image 404, lesson-candidate-not-selected 404, unknown-path 404.

### Modified (append-only)

- `services/http/routers/posts.py` — appended `list_posts` and `get_post` handlers to the Plan-01 empty router.
- `services/http/routers/images.py` — appended `get_post_image` and `get_lesson_candidate_image` handlers plus the `_safe_image_response` helper that enforces the data-root jail.

## DTO Mapper Public API

```python
from services.http.dto_mapper import (
    build_post_dto,        # (conn, post_id: str) -> PostDTO
    list_post_dtos,        # (conn, statuses: list[str] | None) -> list[PostDTO]
    NON_TERMINAL_STATUSES, # tuple[str, ...] — default list filter
)
```

**How `pii_reviewed` is derived:** `post.status != "PENDING_PII_REVIEW"`. Only posts currently sitting in the PII review gate are considered un-reviewed; everything past it (DRAFT, APPROVED, PUBLISHED, etc.) is `True`. The field is computed at mapping time and lives on the wire as part of `ImageInfoDTO`.

**How `filesystem_path` is kept off the wire:** Plan 33-01 defined `ImageInfoDTO.filesystem_path: Optional[str] = Field(default=None, exclude=True)`. The dto_mapper populates it so the image router can read it in-process, but `model_dump()` / JSON serialization silently drops it. This plan asserts the guarantee with an explicit test on DRAFT, PENDING_PII_REVIEW, and image-less posts.

## Wire Shape Adaptations vs CONTEXT.md §2

Real pm-authority schema forced three deviations from the informative DTO sketch in CONTEXT.md — all already encoded in Plan 33-01's `schemas.py` and honored here:

| CONTEXT.md sketch | Reality | Handled by |
| --- | --- | --- |
| `id: int` | `id: str` (TEXT UUID) | `PostDTO.id: str`, all SQL uses `?` with str |
| `created_at` from posts | no such column — sourced from `sequences.created_at` | `build_post_dto` joins `sequences` |
| `updated_at` present | no such column | always `None` in v1 |

## Decisions Made

See `key-decisions` in the frontmatter. Most important:

1. **dto_mapper is the SOT.** Later mutation plans (33-03 fast, 33-04 slow) MUST `from services.http.dto_mapper import build_post_dto` to return the refreshed post — no duplicate SQL.
2. **Path-jail is fail-soft.** Every failure mode of the image router (missing, invalid, escape attempt, non-file) returns `404 NOT_FOUND` with the structured envelope — no 403, no 500. Keeps the dashboard error-handling path uniform.
3. **Lesson-candidate images live on the post row.** pm-authority's current behavior stores the rendered lesson image in `posts.image_path` once the selected variant is generated; the lesson-candidate-image endpoint 404s unless the candidate is `selected` AND the post has an `image_path`.

## Deviations from Plan

None. The plan executed exactly as written, with one micro-adjustment worth noting:

- **Test fixture monkeypatch workaround:** The plan's seeded_db fixture only monkeypatched `http_db.DEFAULT_DB_PATH`, but `get_conn` is a `@contextmanager` whose default argument is captured at function-definition time. I added a `_patch_db_path` helper that also rewrites `http_db.get_conn.__wrapped__.__defaults__` and `http_db.open_db_with_retry.__defaults__`. Without this, every test would have hit the production state.db. Not a deviation from plan intent — just a concrete fix required to make the plan's stated goal (isolated temp DB) actually work.

## Issues Encountered

- **Pre-existing unrelated test failure:** `scripts/test_scheduler.py::test_sequence_scheduling` fails with `sqlite3.OperationalError: table sequences has no column named mode`. This is a pre-existing bug in a scheduler test that builds its DB schema inline and never got updated for the v1.2 lesson-mode migration. Out of scope per deviation rules — logged here, not fixed.
- **Full test suite:** 248/249 pass. The 1 failure is the pre-existing unrelated scheduler test above. Zero regressions introduced by this plan.

## Cross-Repo Discipline

- **Code commits** (`f561671`, `56b440d`, `6251e0c`) all in `/home/yuval/pm-authority` on `main`. Used `feat(http-service): ...` / `test(http-service): ...` conventional commits, staged only task-related files (no `git add -A`).
- **Plan/state commits** in `/home/yuval/whatsapp-bot` on `main`. Used `docs(33-02): ...`.
- `main.py` was NOT edited — confirmed via `git log --all --oneline -- services/http/main.py` showing only the Plan 33-01 commit `4801111`.
- Parallel 33-03 plan committed `d617195` (JobTracker) and `0a2c12b` (fast mutations) between my Task 2 and Task 3 without conflict — disjoint file ownership held up.

## User Setup Required

None. All four endpoints work against the existing production state.db without configuration changes. The PM2 entry added in Plan 33-01 picks up the new routes on next reload.

## Next Phase Readiness

- **33-03 fast mutations:** ready. `build_post_dto` is available to return refreshed posts after approve/reject/edit.
- **33-04 slow mutations:** ready. Lesson-run job results can reuse `build_post_dto`.
- **33-05 integration test:** ready. All four read endpoints verified working against real state.db + seeded temp DB.
- **Phase 34 (Fastify proxy):** ready to write Zod schemas against the exact wire shape locked in by `schemas.py` + `test_http_reads.py`.

## Self-Check: PASSED

Verified:
- `/home/yuval/pm-authority/services/http/dto_mapper.py` FOUND
- `/home/yuval/pm-authority/services/http/routers/posts.py` FOUND (modified)
- `/home/yuval/pm-authority/services/http/routers/images.py` FOUND (modified)
- `/home/yuval/pm-authority/tests/test_http_reads.py` FOUND
- Commit `f561671` in pm-authority git log FOUND
- Commit `56b440d` in pm-authority git log FOUND
- Commit `6251e0c` in pm-authority git log FOUND
- `main.py` untouched since Plan 33-01 commit `4801111` VERIFIED
- 13/13 tests passing in `pytest tests/test_http_reads.py -v` VERIFIED
- Live uvicorn smoke test against production state.db returned real posts + correct 404 envelope VERIFIED

---
*Phase: 33-pm-authority-http-service*
*Plan: 02*
*Completed: 2026-04-13*

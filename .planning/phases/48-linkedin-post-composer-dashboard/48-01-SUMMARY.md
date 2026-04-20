---
phase: 48-linkedin-post-composer-dashboard
plan: 01
subsystem: pm-authority-http
tags: [fastapi, pydantic, sqlite, endpoint, composer]
requirements: [LIN-NEW-01]
dependency_graph:
  requires: []
  provides:
    - "POST /v1/posts endpoint (server-of-record for dashboard-composed posts)"
    - "CreatePostRequest Pydantic schema"
    - "sequences.mode='manual' convention (no schema change; value convention only)"
  affects:
    - "Plan 48-02 (whatsapp-bot Fastify proxy) — will call this endpoint"
    - "Plan 48-03 (dashboard composer UI) — terminal consumer via the proxy"
    - "services/http/main.py error envelope (sanitized Pydantic ctx so model_validator errors serialize cleanly)"
tech_stack:
  added: []
  patterns:
    - "Cross-field validation via @model_validator(mode='after') raising ValueError"
    - "Single-transaction sequences+posts insert; re-read via build_post_dto for canonical PostDTO response"
    - "Title persisted as sequences.context_json={'manual_title': ...} (no schema migration)"
key_files:
  created:
    - /home/yuval/pm-authority/tests/test_http_posts_create.py
  modified:
    - /home/yuval/pm-authority/services/http/schemas.py
    - /home/yuval/pm-authority/services/http/routers/posts.py
    - /home/yuval/pm-authority/services/http/main.py
decisions:
  - "Map title -> sequences.context_json={'manual_title': title} instead of adding a column, so source_snippet auto-surfaces it via the existing dto_mapper path"
  - "Validate language/content_he via model_validator(mode='after'); accept that FastAPI wraps ValueError into RequestValidationError -> 400 VALIDATION_ERROR (matches the existing _STATUS_MAP)"
  - "Sanitize exc.errors() ctx in main._handle_validation so model_validator ValueErrors (which Pydantic stores as raw objects in ctx) don't crash the JSON envelope"
metrics:
  duration_seconds: 206
  duration_human: "~3 min"
  tasks_completed: 2
  files_created: 2
  files_modified: 3
  tests_added: 9
  completed_at: "2026-04-20T23:48:39Z"
---

# Phase 48 Plan 01: Create Post Endpoint Summary

**One-liner:** Added `POST /v1/posts` to pm-authority FastAPI sidecar — creates a manual-mode sequence + PENDING_REVIEW post in one transaction, returns canonical PostDTO, with a Pydantic cross-field validator enforcing language/content_he coherence.

## What was built

1. **`CreatePostRequest` Pydantic model** (`services/http/schemas.py`)
   - Fields: `title (1..200)`, `content (min 1)`, `content_he (optional)`, `language Literal['en','he','he+en']`, `project_name (min 1)`, `perspective Literal['yuval','claude']=yuval`.
   - `@model_validator(mode="after")` enforces: `en` rejects non-empty `content_he`; `he` and `he+en` require non-empty `content_he`.

2. **`POST /v1/posts` handler** (`services/http/routers/posts.py`)
   - Path `""` under the `/posts` prefix → `/v1/posts`. Returns 201 + `PostDTO`.
   - Inserts one row into `sequences` (`mode='manual'`, `context_json='{"manual_title": <title>}'`) and one row into `posts` (`status='PENDING_REVIEW'`) inside a single `conn.commit()`, then re-reads via `build_post_dto` for the canonical response shape (matching every other read-side endpoint).
   - UUIDs generated with `uuid.uuid4()`; `created_at` is `datetime.now(timezone.utc).isoformat()`.

3. **pytest suite** (`tests/test_http_posts_create.py`, 296 lines)
   - 9 tests: happy paths for `en` / `he` / `he+en`; validation failures for missing title, empty content, `he` without `content_he`, unknown language; list visibility via `GET /v1/posts`; direct sqlite persistence check (mode='manual', context_json).
   - Fixture pattern mirrors `test_http_confirm_pii.py` (tmp sqlite file, monkeypatch `http_db.DEFAULT_DB_PATH`, real `TestClient(app)`).

## Truths (must_haves)

All five "must-haves truths" from the plan frontmatter verified:

- [x] `POST /v1/posts` with valid JSON body → 201 + PostDTO with `status='PENDING_REVIEW'` (`test_create_post_happy_en/he/bilingual`).
- [x] Freshly created post appears in next `GET /v1/posts` (`test_create_post_appears_in_list`).
- [x] Bad body (missing required fields, empty strings, unknown language, he without content_he) → 400 VALIDATION_ERROR envelope (`test_create_post_validation_*`).
- [x] Each call creates exactly one new sequence (`mode='manual'`) and one new post linked to it (`test_create_post_creates_manual_mode_sequence` asserts mode='manual' and context_json contents).
- [x] `pytest tests/test_http_posts_create.py -v` → 9/9 green; full suite (minus pre-existing `test_bot_screenshot.py` failure documented in `deferred-items.md`) → 288 passed, 0 regressions from the 279-passed baseline.

## Verification output

```
$ .venv/bin/python -m pytest tests/test_http_posts_create.py -v
...
9 passed in 1.02s

$ .venv/bin/python -m pytest tests/ --ignore=tests/test_bot_screenshot.py -k "not slow" -q
288 passed, 16 deselected, 3 warnings in 11.70s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pydantic `model_validator` ValueError crashed the main.py validation envelope**

- **Found during:** Task 2 (`test_create_post_validation_he_without_content_he` test run).
- **Issue:** When the CreatePostRequest `model_validator` raised `ValueError`, FastAPI wrapped it into a `RequestValidationError` with `ctx["error"]` holding the raw `ValueError` object. `services/http/main.py::_handle_validation` then passed `exc.errors()` straight into `_envelope`, which tried to JSON-dump the raw exception → `PydanticSerializationError: Unable to serialize unknown type: <class 'ValueError'>` → 500 instead of 400.
- **Fix:** Added `_sanitize_pydantic_errors(raw)` helper in `main.py` that walks each error's `ctx` dict and `str()`-converts values that aren't JSON-serializable. Plugged it into `_handle_validation`. Behaviorally transparent for existing validation paths (they had no unserializable ctx values) — only takes effect when model_validator ValueErrors appear.
- **Why in-scope:** CreatePostRequest is the first schema in the codebase to use `@model_validator(mode="after")` that raises `ValueError`, so this bug was latent and only surfaced now. Fixing it is required for Task 2's `test_create_post_validation_he_without_content_he` to pass with a 400 envelope instead of a 500.
- **Files modified:** `/home/yuval/pm-authority/services/http/main.py`
- **Commit:** `90e1831` (grouped with Task 2 — the fix and the test exercising it ship together).

### Plan text vs. actual behavior: validation status code

The plan's Task 2 text says "expect 422" for validation failures. The pm-authority error taxonomy maps `VALIDATION_ERROR` to HTTP 400 (see `services/http/errors.py::_STATUS_MAP`), and `main._handle_validation` rewrites every Pydantic validation error into that envelope. The tests therefore assert `status_code == 400` and `error.code == "VALIDATION_ERROR"`, which matches every other pm-authority validation test (`test_http_fast_mutations.py::test_*_validation`, `test_http_lesson_runs_generate.py`, `test_http_upload_image.py`). Documented in the test file's module docstring.

## Deferred Items

One pre-existing test failure logged in `.planning/phases/48-linkedin-post-composer-dashboard/deferred-items.md`:
- `tests/test_bot_screenshot.py::test_pii_ok_transitions_to_draft` — reproduced on `main` before any changes were applied, unrelated to this plan (touches the bot's screenshot/PII flow, not the HTTP sidecar). Out of scope.

## Commits

- `2db616c` — feat(48-01): add CreatePostRequest schema + POST /v1/posts route
- `90e1831` — test(48-01): add pytest suite for POST /v1/posts + sanitize validator ctx

Branch: `feat/48-01-create-post-endpoint` (not pushed — per user policy).

## Next

Plan 48-02 will add the whatsapp-bot Fastify proxy endpoint that fronts this; Plan 48-03 will wire the dashboard composer UI that POSTs through the proxy.

## Self-Check: PASSED

- Files: all 6 claimed paths exist (3 modified in pm-authority, 1 created in pm-authority, 2 created under whatsapp-bot/.planning).
- Commits: both `2db616c` and `90e1831` exist on `feat/48-01-create-post-endpoint`.
- Grep: `class CreatePostRequest`, `@router.post("", response_model=PostDTO, status_code=201)`, and the `CreatePostRequest` import all found.
- Tests: 9/9 new tests green; 288 total pass across the pm-authority suite (baseline 279 + 9 new; 0 regressions from in-scope changes).

# Deferred Items — Phase 48

Out-of-scope discoveries during plan execution; NOT fixed.

## Pre-existing failing test (as of 2026-04-20)

**File:** `tests/test_bot_screenshot.py::test_pii_ok_transitions_to_draft`

**Error:** `AssertionError: Expected 'update_post_status' to be called once. Called 0 times.`

**Found during:** Plan 48-01, Task 1 baseline pytest run.

**Verified pre-existing:** Reproduced on `main` HEAD `ed9a9bd` (before any plan changes applied), so this is not caused by the POST /v1/posts work.

**Scope:** Bot screenshot / PII OK flow — unrelated to the HTTP sidecar `POST /v1/posts` endpoint.

**Action:** Pytest suite was run with `--ignore=tests/test_bot_screenshot.py` for regression verification. Leave for a future bot-layer plan to resolve.

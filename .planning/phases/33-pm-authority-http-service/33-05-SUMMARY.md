---
phase: 33-pm-authority-http-service
plan: 05
subsystem: api
tags: [fastapi, pm2, integration-test, smoke-test, readme, pm-authority]

# Dependency graph
requires:
  - phase: 33-pm-authority-http-service
    provides: "Slow mutations + REAL /v1/lesson-runs worker (Plan 33-04)"
  - phase: 33-pm-authority-http-service
    provides: "JobTracker + state_guard + fast mutations (Plan 33-03)"
  - phase: 33-pm-authority-http-service
    provides: "Read endpoints + dto_mapper + image streaming (Plan 33-02)"
  - phase: 33-pm-authority-http-service
    provides: "Scaffold + PM2 ecosystem entry + /v1/health (Plan 33-01)"
provides:
  - "End-to-end TestClient walkthrough exercising every v1 endpoint in a single pytest run with real DB mutations"
  - "Bash smoke script (scripts/http_smoke.sh) that hits every endpoint against a live 127.0.0.1:8765 server and asserts loopback-only bind"
  - "README v1 Route Table, error envelope docs, security note, concurrency note — shippable Phase 33 contract"
  - "Live PM2-supervised pm-authority-http process (pid 1875924, 0 restarts) verified on the server with /v1/health returning {status:ok, db_ready:true}"
  - "Phase 33 closure — 52/52 HTTP tests green, all 14 v1 endpoints in production under PM2"
affects: [34-fastify-proxy-layer, 35-linkedin-queue-read-side-ui, 38-new-lesson-run-form]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "E2E walkthrough pattern: single fixture seeds one of each interesting post state, single TestClient test threads every endpoint sequentially so cross-plan regressions are caught in one file"
    - "Smoke script assumes live server (does not start/stop uvicorn) — caller is PM2 in production, manual uvicorn in dev"
    - "Socket-level bind assertion via `ss -tlnH | grep 8765` is the canonical loopback-only verification (not an HTTP-layer check)"
    - "PM2 ecosystem entry `pm-authority-http` coexists with `whatsapp-bot` on the same node instance — separate PM2 apps, shared pm2 daemon, independent restart counters"

key-files:
  created:
    - pm-authority/tests/test_http_end_to_end.py
    - pm-authority/scripts/http_smoke.sh
  modified:
    - pm-authority/README.md

key-decisions:
  - "Smoke script does NOT spawn uvicorn — it probes a running service. Keeps the script idempotent under PM2 and cheap to re-run during incident investigation."
  - "E2E test monkeypatches bot.py sync entrypoints (blocking_regenerate, handle_select_lesson_sync, post_variant_and_generate_image_sync) AND PostGenerator.generate_lesson_variants on the class so the entire walkthrough runs offline (no Claude CLI, no fal.ai). The lesson-runs assertion still proves generate_lesson_variants was called exactly once and that the new sequence + post + variants landed in the DB."
  - "README v1 Route Table is the shippable contract — Phase 34's Zod schemas should be derived from this table, not from reading router source"
  - "PM2 boot verification is treated as a checkpoint (not a code task) — the test that matters is: does the service come up fresh, answer /v1/health, and bind loopback-only on the real host? That can only be verified by running PM2, not by pytest."
  - "pm2 save was NOT required as part of this plan — operator decides whether to persist the process list for reboot-survival"

requirements-completed: [LIN-01]

# Metrics
duration: ~35min (across Tasks 1+2 code work + Task 3 human verification)
completed: 2026-04-13
---

# Phase 33 Plan 05: E2E Walkthrough + PM2 Live Verification Summary

**Full 14-endpoint TestClient walkthrough, loopback-asserting bash smoke script, complete README v1 contract, and live PM2-supervised pm-authority-http service on 127.0.0.1:8765 — sealing Phase 33.**

## Performance

- **Duration:** ~35 min (Task 1 + Task 2 code; Task 3 was a human-verify checkpoint — no code)
- **Started:** 2026-04-13
- **Completed:** 2026-04-13
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files created:** 2 (`tests/test_http_end_to_end.py`, `scripts/http_smoke.sh`)
- **Files modified:** 1 (`README.md`)

## Accomplishments

- **Task 1 — E2E walkthrough suite:** single-file TestClient test that seeds a rich DB (one post in each interesting state: DRAFT with image, PENDING_VARIANT with 2 variants, PENDING_LESSON_SELECTION with 1 candidate, DRAFT for regen). Walks GET /v1/health → GET /v1/posts (default + filtered) → GET /v1/posts/{id} → GET /v1/posts/{id}/image → POST /v1/posts/pa/edit → approve → reject → regenerate (202 + poll) → pick-lesson (202 + poll) → pick-variant (fast 200) → replace-image (200, transitions to PENDING_PII_REVIEW) → POST /v1/lesson-runs (202 + poll, REAL call-through via monkeypatched `PostGenerator.generate_lesson_variants` on the class, asserts DB mutation: new lesson-mode sequence + post + 2 variants) → 9 error-envelope 404 assertions on unknown post IDs. One file, one pytest run.
- **Task 2 — Smoke script + README:** `scripts/http_smoke.sh` hits all 14 endpoints via curl against a running 127.0.0.1:8765 server, prints PASS/FAIL per endpoint, asserts loopback-only bind via `ss -tlnp`, exits 0 on full green. README Phase 33 section rewritten with complete v1 Route Table (Method / Path / Response / Async? / Purpose), error envelope shape, 10-code error taxonomy, security boundary note, and concurrency model note.
- **Task 3 — PM2 boot + live /v1/health:** checkpoint verified by operator on the real host. PM2 process `pm-authority-http` online, pid 1875924, uptime 2m, restart count 0, memory 57.8mb. `curl -sS http://127.0.0.1:8765/v1/health` returns `{"status":"ok","version":"0.1.0","db_ready":true}`. Socket bound to `127.0.0.1:8765` only (no 0.0.0.0, no Tailscale interface) per `ss -tlnH`. The `whatsapp-bot` PM2 process was unaffected (3d uptime, 0 restarts from this work).

## Task Commits

1. **Task 1: End-to-end TestClient walkthrough** — `f5b2174` (test)
   - `pm-authority/tests/test_http_end_to_end.py`
   - 52/52 HTTP test suite green in one `pytest tests/test_http_*.py` invocation
2. **Task 2: Smoke script + README v1 route table** — `6d03883` (docs)
   - `pm-authority/scripts/http_smoke.sh` (chmod +x)
   - `pm-authority/README.md`
3. **Task 3: PM2 boot + live /v1/health checkpoint** — verified by operator, no git commit (checkpoint:human-verify; the deliverable is the running process, not code)

**Plan metadata commit:** see final `docs(33-05): seal phase 33` commit in whatsapp-bot covering SUMMARY + STATE + ROADMAP + REQUIREMENTS.

_Note: pm-authority commits land in `/home/yuval/pm-authority` (separate repo). Planning artifacts land in `/home/yuval/whatsapp-bot/.planning/`._

## Live Verification Record (Task 3)

**PM2 status row:**
```
id=1  name=pm-authority-http  mode=fork  pid=1875924  uptime=2m  restart=0  status=online  mem=57.8mb
```

**/v1/health response body:**
```json
{"status":"ok","version":"0.1.0","db_ready":true}
```

**Socket bind (`ss -tlnH | grep 8765`):**
```
LISTEN 0  2048  127.0.0.1:8765  0.0.0.0:*
```
Loopback only. No `0.0.0.0:8765`, no Tailscale interface IP. (A separate `0.0.0.0:18765` row on the same box belongs to an unrelated service and is NOT pm-authority-http — the port is 18765, not 8765.)

**PM2 coexistence check:** `whatsapp-bot` PM2 process untouched (3d uptime, 0 new restarts attributed to this work).

## must_haves Verification

All five truths from the plan frontmatter, checked off with evidence:

1. **"A single pytest run at pm-authority covers reads + fast + slow + jobs in one command, exit 0, no un-awaited-coroutine warnings"** — PASS. `./.venv/bin/python -m pytest tests/test_http_*.py` returns 52/52 passing (13 reads + 13 fast mutations + 9 jobs + 16 slow mutations + 1 e2e walkthrough), zero warnings.
2. **"PM2 can start pm-authority-http from ecosystem.config.js, /v1/health passes within 3 seconds, pm2 logs show no tracebacks"** — PASS. Checkpoint verified online within 2 seconds of `pm2 start`, health returned `{status:ok, db_ready:true}`, no tracebacks in logs.
3. **"scripts/http_smoke.sh exercises every endpoint against a live server on 127.0.0.1:8765 and prints pass/fail per endpoint"** — PASS. Script exists, is executable, hits all 14 endpoints plus the bind assertion, prints `PASS <label> (<code>)` or `FAIL <label> (got X, expected Y)`, exits on `[[ $FAIL -eq 0 ]]`.
4. **"README documents: port 8765 fixed, PM2 command, smoke script usage, v1 route table with expected HTTP statuses"** — PASS. README Phase 33 section has Quick start (uvicorn + PM2), complete v1 Route Table, error envelope, security note, concurrency note.
5. **"External-interface reachability test confirms 8765 is NOT bound on the machine's Tailscale/LAN address"** — PASS. `ss -tlnH` shows only `127.0.0.1:8765`. Smoke script also programmatically asserts this and fails if any non-127.0.0.1 bind is present.

## Files Created/Modified

- `pm-authority/tests/test_http_end_to_end.py` — single-file e2e walkthrough seeding + exercising every v1 endpoint with DB-level assertions
- `pm-authority/scripts/http_smoke.sh` — bash curl-based smoke test against running 127.0.0.1:8765 with loopback assertion
- `pm-authority/README.md` — Phase 33 section expanded with complete v1 Route Table, error envelope, security note, concurrency model
- `.planning/phases/33-pm-authority-http-service/33-05-SUMMARY.md` — this file
- `.planning/STATE.md` — Phase 33 marked complete
- `.planning/ROADMAP.md` — Phase 33 row marked 5/5 Complete
- `.planning/REQUIREMENTS.md` — LIN-01 marked Complete

## Decisions Made

- **Smoke script probes a live server, does not spawn one** — keeps it idempotent under PM2 supervision and cheap to re-run during incident investigation
- **E2E test fully offline** — monkeypatches bot.py sync entrypoints + `PostGenerator.generate_lesson_variants` on the class so no Claude CLI or fal.ai is ever invoked in CI, while still asserting the generator function was called exactly once and the new sequence + post + 2 variants landed in the DB
- **README Route Table is the shippable contract** — Phase 34 Zod schemas should derive from this table, not from reading router source
- **PM2 boot verification is a checkpoint, not a test** — the "does it come up fresh on the real host, bind loopback-only, and answer /v1/health" question is orthogonal to pytest and can only be answered by a human running PM2 on the server

## Deviations from Plan

None — plan executed exactly as written. Task 1 and Task 2 landed first try, Task 3 was verified by the operator on the first attempt with no fixes needed.

## Issues Encountered

None.

## User Setup Required

None — PM2 is already installed, `ecosystem.config.js` already includes the `pm-authority-http` entry from Plan 33-01, and the state.db path is hard-coded to the already-existing `/home/yuval/pm-authority/data/state.db`.

Optional follow-up for the operator: run `pm2 save` if the `pm-authority-http` process should survive a server reboot. This is a one-liner and is explicitly out of scope for Phase 33 (Plan decided it's an operator call, not a plan requirement).

## Phase 33 Closure

All 5 plans complete. Phase 33 delivers:
- `services/http/` package inside `/home/yuval/pm-authority/` with 14 live v1 endpoints (health + 5 reads + 3 fast mutations + 5 slow mutations + lesson-runs)
- Full 10-code error taxonomy with uniform JSON envelope
- JobTracker + state_guard + dto_mapper as the three canonical internal modules
- 52/52 HTTP TestClient tests passing
- Shell smoke script + README v1 contract
- PM2-supervised long-running process on 127.0.0.1:8765
- LIN-01 satisfied in full

## Next Phase Readiness

**Phase 34 (Fastify Proxy Layer) is unblocked.** Key handoffs:

1. **The v1 Route Table in `pm-authority/README.md` is the authoritative contract** — Phase 34's Zod schemas should mirror it 1:1 (Method, Path, Request body shape, Response body shape, async/sync distinction).
2. **POST /v1/lesson-runs** takes body `{source_sequence_id, chosen_lesson, perspective?, language?}` and returns `202 JobAccepted`. Job result shape is `{sequence_id, post_id, variant_ids: [story_id, claim_id], chosen_lesson, project_name}`. This is a REAL call-through to `PostGenerator.generate_lesson_variants` and persists a brand-new lesson-mode sequence + post + two variants. **Brand-new project ingestion** (creating sequences from filesystem project paths that haven't been ingested yet) is **Phase 38 scope**, not Phase 34.
3. **Mixed 200/202 on pick-variant** — the Fastify proxy must pass both status codes through. Fast path (no image gen) returns `200 PostDTO`, slow path (image gen required) returns `202 JobAccepted`.
4. **Job polling via GET /v1/jobs/{job_id}** — the tracker GCs job records 15 minutes after terminal. Proxy clients should treat a 404 on poll as "service restart, retry the mutation" rather than a hard failure.
5. **No auth headers to forward** — the FastAPI service binds 127.0.0.1 and trusts everything. Phase 34's proxy just needs to reach upstream at `http://127.0.0.1:8765`.
6. **Error envelope is uniform** — every non-2xx response (including unhandled 500s, thanks to the global exception handler installed in Plan 33-01) returns `{"error": {"code": "...", "message": "...", "details": {}}}`. The proxy can unwrap `.error.code` to pass through discriminated errors to the dashboard.

No blockers for Phase 34.

## Self-Check: PASSED

- File `.planning/phases/33-pm-authority-http-service/33-05-SUMMARY.md` created
- pm-authority commit `f5b2174` present (test: end-to-end TestClient walkthrough)
- pm-authority commit `6d03883` present (docs: smoke script + README v1 route table)
- Task 3 verification: PM2 online, /v1/health green, ss -tlnH loopback-only — all recorded above from operator report

---
*Phase: 33-pm-authority-http-service*
*Plan: 05*
*Completed: 2026-04-13*

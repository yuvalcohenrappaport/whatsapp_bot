# Phase 33 Context: pm-authority HTTP Service

**Created:** 2026-04-12
**Phase goal:** A long-running FastAPI sidecar inside pm-authority exposes read + mutate endpoints for post state, variants, and lesson candidates over 127.0.0.1, giving whatsapp-bot a stable HTTP contract to consume without ever importing Python code or touching state.db directly.

> Decisions below were made by Claude under "you decide, I trust you" — scope is locked to Phase 33. Anything outside it goes in **Deferred Ideas** at the bottom.

## 1. API Surface Shape

- **Style:** REST for reads, RPC-style action verbs for mutations. Almost every mutation (approve, reject, regenerate, pick-variant, pick-lesson, start-lesson-run) is an imperative, not a CRUD update, so pretending it's REST creates worse naming than just naming the action.
- **Base path:** `/v1` — version-prefixed from day one so future shape changes don't break the Fastify proxy. No additional "api" segment (the whatsapp-bot proxy adds its own `/api/linkedin/*`).
- **Read endpoints:**
  - `GET /v1/posts?status=<STATUS>` — list, filtered by status. Multi-status allowed via repeated param (`?status=DRAFT&status=PENDING_VARIANT`). No status filter = all non-terminal (everything except PUBLISHED/REJECTED). Array response.
  - `GET /v1/posts/{post_id}` — single post DTO (fat, see §2).
  - `GET /v1/health` — `{status:"ok", version:"..."}` for PM2 + proxy startup checks.
- **Mutation endpoints** (all `POST`, path-noun `/posts/{post_id}/<action>`):
  - `/approve`, `/reject`, `/edit` (body: `{content, content_he?}`), `/regenerate`, `/replace-image` (body: `{image_path}` — already-uploaded file), `/pick-variant` (body: `{variant_id}`), `/pick-lesson` (body: `{candidate_id}`).
  - `/v1/lesson-runs` — `POST` to start a new lesson-mode generation run (the `generate.py --mode lesson` replacement). Body: `{topic, language?, perspective?}` — whatever `generate_lesson_variants` takes.
- **No pagination in v1.** The pending queue is <20 items, published history <500 total. If needed later, add cursor pagination without breaking the array response (wrap in `{items, next_cursor}` behind a new query param).
- **Response envelope:** **No wrapper on success.** Endpoints return the object or array directly. `Content-Type: application/json` always. Errors use the structured shape in §3. Rationale: the Fastify proxy forwards JSON as-is; a `{data: ...}` wrapper just costs a line of unwrap code at every consumer.
- **HTTP verbs:** GET for reads, POST for every mutation (even idempotent ones like approve — consistency beats REST purity here). PATCH/PUT are not used.
- **No PATCH edits to posts.** Editing post content goes through `POST /posts/{id}/edit` so it stays parallel with other actions and the pm-authority ReviewManager call-through is uniform.

## 2. Post DTO Shape (The Fat Read)

- **Single "fat" DTO** — each post returned by `GET /v1/posts` or `GET /v1/posts/{id}` embeds everything the dashboard needs to render a review card in one call. No N+1 walks over localhost, and the TypeScript client stays simple.
- **Field naming:** `snake_case` throughout the wire format. Matches pm-authority's internal Python field names, avoids a translation layer, and Zod on the whatsapp-bot side handles it either way.
- **Timestamps:** ISO 8601 UTC strings (`"2026-04-12T14:23:00Z"`). Never epoch. `new Date(str)` in the dashboard just works. All timestamps assumed UTC at the wire — timezone display is a frontend concern.
- **Shape (informative — researcher confirms exact pm-authority field names):**
  ```json
  {
    "id": 1234,
    "sequence_id": 56,
    "position": 1,
    "status": "PENDING_VARIANT",
    "perspective": "yuval",
    "language": "en",
    "content": "...",
    "content_he": null,
    "image": {
      "source": "ai" | "screenshot" | null,
      "url": "/v1/posts/1234/image" | null,
      "pii_reviewed": false
    },
    "variants": [
      {"id": 1, "kind": "contrarian", "content": "...", "selected": false},
      {"id": 2, "kind": "story", "content": "...", "selected": false}
    ],
    "lesson_candidates": [
      {"id": 1, "topic": "...", "content": "...", "image_url": "/v1/posts/1234/lesson-candidates/1/image", "selected": false}
    ],
    "regeneration_count": 0,
    "regeneration_capped": false,
    "share_urn": null,
    "created_at": "2026-04-12T14:23:00Z",
    "updated_at": "2026-04-12T14:23:00Z",
    "published_at": null
  }
  ```
  Researcher should verify the actual pm-authority column names and map snake_case 1:1. Fields not applicable to a given post remain `null` rather than being omitted (stable shape helps Zod).
- **Images:** pm-authority stores filesystem paths. The dashboard is a separate process on a different repo — it **cannot** read those paths directly. Two sub-decisions:
  1. **Serve via endpoint, not base64.** FastAPI exposes `GET /v1/posts/{post_id}/image` (and `/lesson-candidates/{id}/image`) that reads the file from pm-authority's workdir and streams it. Content-Type inferred from file extension. Returns 404 if the file is missing. The DTO contains a relative URL (not the filesystem path) pointing at this endpoint.
  2. **Fastify proxy forwards the binary stream** under `/api/linkedin/posts/{id}/image`. Dashboard `<img src>` points at the proxy URL. No base64 bloat in the JSON DTO.
- **Variants + lesson candidates are always embedded** in the DTO, even for posts where they're irrelevant (empty arrays `[]`, never `null`). Lets the frontend render unconditionally.

## 3. Long-Running Mutation Handling

- **Problem:** `regenerate` invokes the Claude CLI (15–60s), `pick-lesson` and `start-lesson-run` trigger fal.ai image generation (30–90s each), `post_variant_and_generate_image_sync` can take well over a minute. A blocking HTTP request for 2 minutes is a bad UX and fragile (proxy timeouts, reconnects).
- **Decision: async job pattern with in-memory job tracker + polling.** No SSE in this phase — Phase 35 already owns SSE for read-side queue updates, and mixing concerns now complicates both.
  - **Fast mutations block normally** (synchronous response, <1s): `approve`, `reject`, `edit`, `pick-variant` (when it's a pure DB write with no image gen).
  - **Slow mutations return `202 Accepted` + `{job_id}`:** `regenerate`, `pick-lesson`, `replace-image` (when it involves rendering), `start-lesson-run`, and any variant-pick path that triggers image generation.
- **Job tracker:**
  - In-memory `dict[str, Job]` keyed by UUID, guarded by an `asyncio.Lock`.
  - Job shape: `{id, kind, status: pending|running|succeeded|failed, result?: <any>, error?: {code, message}, started_at, finished_at?}`.
  - Workers run via `fastapi.BackgroundTasks` + `run_in_threadpool` for the existing sync pm-authority functions (`post_variant_and_generate_image_sync`, `handle_select_lesson_sync`, etc.). Don't try to convert them to async.
  - **Not persisted.** Restart wipes jobs — acceptable. A slow mutation interrupted by a restart is a retry by the user. Single-user tool, low volume, keep it simple.
  - Jobs are garbage-collected after 15 minutes in terminal state to cap memory.
- **Poll endpoint:** `GET /v1/jobs/{job_id}` — returns the job record. Dashboard polls every 1500 ms. 404 on expired jobs (Fastify maps to a stable error the frontend can display).
- **Concurrency caps:** one global `asyncio.Semaphore(1)` around any job that shells out to Claude CLI or fal.ai — pm-authority's existing code isn't designed for concurrent runs, and a single-user dashboard won't feel a single-slot queue. Second slow mutation arrives while one is running → job goes into `pending`, starts as soon as the first finishes.
- **Error handling on slow jobs:** failures from pm-authority (regen cap, state-machine violation, fal.ai timeout) set `status=failed` with a structured `error` body (same shape as §3 below), never escape as uncaught exceptions.

## 4. Error Contract & State-Machine Surfacing

- **All errors are JSON**, never bare HTML or text, even for 500s. Responses always have `Content-Type: application/json`.
- **Error shape:**
  ```json
  {
    "error": {
      "code": "REGEN_CAPPED",
      "message": "Post has reached the 5-regeneration cap",
      "details": {"post_id": 1234, "count": 5, "cap": 5}
    }
  }
  ```
- **Code taxonomy** (maps to HTTP status — exhaustive list the Zod schemas on the proxy side will discriminate on):
  - `400 VALIDATION_ERROR` — Pydantic rejection, missing fields, bad enum.
  - `404 NOT_FOUND` — post/variant/job/image missing.
  - `409 STATE_VIOLATION` — action not valid for current post status (e.g., approving a rejected post).
  - `409 REGEN_CAPPED` — 5-regen limit hit.
  - `409 LESSON_ALREADY_PICKED` — lesson candidate already selected.
  - `409 VARIANT_ALREADY_PICKED` — variant already locked in.
  - `422 UNPROCESSABLE` — semantic validation beyond Pydantic (e.g., edit with empty content).
  - `500 INTERNAL_ERROR` — uncaught exception. Error message scrubbed; full traceback only to logs.
  - `502 UPSTREAM_FAILURE` — pm-authority internal (Claude CLI nonzero exit, fal.ai timeout, SQLite lock timeout).
  - `503 UNAVAILABLE` — service still starting up (state.db not yet opened).
- **Pm-authority exceptions → HTTP:** a thin mapping layer at the router boundary translates known pm-authority exception classes (`RegenCapError`, `StateMachineError`, etc. — researcher confirms actual names) into the taxonomy above. Unknown exceptions become `500 INTERNAL_ERROR`.
- **Validation:** Pydantic v2 models for every request body and response. Pydantic errors formatted into the `VALIDATION_ERROR` shape by a global exception handler — do not let FastAPI's default 422 shape leak through (the Fastify proxy would need custom handling for it).

## 5. Process Lifecycle & Supervision

- **Location inside pm-authority repo:** `pm-authority/services/http/` — new package.
  - `services/http/main.py` — `app = FastAPI(...)`, router includes, startup/shutdown hooks.
  - `services/http/routers/posts.py`, `routers/jobs.py`, `routers/images.py`, `routers/lesson_runs.py`.
  - `services/http/schemas.py` — Pydantic models for request/response DTOs.
  - `services/http/jobs.py` — in-memory job tracker.
  - `services/http/errors.py` — exception → HTTP mapping, global handlers.
  - `services/http/__init__.py` — empty.
  - Keeps HTTP concerns isolated from the existing `generate.py` / `review_manager.py` code; those stay unchanged.
- **Entrypoint:** `uvicorn services.http.main:app --host 127.0.0.1 --port 8765 --workers 1`.
  - `--workers 1` is mandatory — the in-memory job tracker has no cross-worker coordination.
  - `--host 127.0.0.1` is the security boundary. No `0.0.0.0`. No middleware auth check; if the bind is right, nothing off-box can reach it.
- **Port:** `8765` — fixed in v1, not env-configurable (simpler). Document the port in pm-authority README so the whatsapp-bot proxy matches. A single-point-of-truth constant lives in both repos; Phase 34 will pick it up on its side.
- **Python environment:** **reuse pm-authority's existing `.venv`.** Do not create a new venv, do not pin Python version again — pm-authority already has a working interpreter + dependency set. Add `fastapi`, `uvicorn[standard]`, `pydantic>=2` to `pm-authority/requirements.txt` (or whatever file pm-authority currently uses — researcher confirms).
- **Supervisor: PM2.** Reason: whatsapp-bot already runs on PM2 on the server, the user is familiar with the tooling, `pm2 logs pm-authority-http` matches the mental model. Add a new entry to pm-authority's `ecosystem.config.js` (create the file if it doesn't already exist):
  ```js
  {
    name: "pm-authority-http",
    cwd: "/home/yuval/pm-authority",
    script: "./.venv/bin/uvicorn",
    args: "services.http.main:app --host 127.0.0.1 --port 8765 --workers 1",
    interpreter: "none",
    env: { PYTHONPATH: "/home/yuval/pm-authority" },
    max_restarts: 10,
    restart_delay: 3000,
    watch: false
  }
  ```
- **Logs:** PM2 default (`~/.pm2/logs/pm-authority-http-out.log`, `~/.pm2/logs/pm-authority-http-error.log`). Uvicorn access log to stdout, app log via Python's `logging` at INFO. No custom rotation in v1 — PM2 handles it.
- **Startup ordering:** the service should tolerate state.db being locked briefly at startup (WAL contention with a concurrent pm-authority CLI run); retry DB-open 3× over 5s before failing. Returns `503 UNAVAILABLE` from `/v1/health` until state.db is successfully opened.
- **Concurrency vs existing processes:** SQLite WAL mode is already enabled. The HTTP service and the existing Telegram bot will both write to state.db, but mutations are gated by status transitions in ReviewManager — the state machine is the serializer, not a process lock. Researcher should confirm WAL is on in production and that `PRAGMA busy_timeout=5000` is set (or add it in the HTTP service's connection setup).
- **Shutdown:** graceful shutdown via uvicorn default (SIGTERM → finish in-flight requests, 5s grace). In-flight background jobs are abandoned — the dashboard sees them time out and retries. Acceptable.
- **Running user:** `yuval` (same as every other process on the box).

## Deferred Ideas

- SSE for read-side queue updates — belongs to Phase 35, not here.
- Persistent job tracker (DB-backed) — unnecessary for single-user tool; restart = retry.
- Pagination — not needed at current volume.
- OpenAPI codegen for Zod schemas — roadmap decision locked this out for v1.7.
- Bearer-token / JWT auth — roadmap decision: 127.0.0.1 bind IS the security boundary.
- Multi-worker uvicorn — requires cross-worker job coordination (Redis or similar), not worth it.
- Rate limiting — single-user tool on localhost.
- Metrics / Prometheus endpoint — PM2 monitor is enough for v1.
- Configurable port via env var — fixed `8765` for simplicity.
- Webhook callbacks from pm-authority to whatsapp-bot (push model) — inverse of the current direction, revisit only if polling proves inadequate.

---
*Context created: 2026-04-12. All gray areas decided by Claude under user's "trust you" delegation. Researcher validates pm-authority internals; planner breaks into plans.*

---
phase: 38-new-lesson-run-form
plan: 01
subsystem: api
tags: [fastapi, fastify, zod, pydantic, pm-authority, linkedin, lesson-mode, proxy]

# Dependency graph
requires:
  - phase: 33-pm-authority-http-service
    provides: lesson_runs router, workers._run_with_semaphore, JobTracker, schemas.py patterns
  - phase: 34-fastify-proxy-layer
    provides: callUpstream, mapUpstreamErrorToReply, validateBody, registerReadRoutes/registerWriteRoutes patterns
provides:
  - "pm-authority GET /v1/projects endpoint returning distinct project names from sequences"
  - "pm-authority POST /v1/lesson-runs/generate endpoint for Phase 1 lesson candidate generation"
  - "pm-authority GenerateLessonRunRequest Pydantic schema with topic_hint support"
  - "pm-authority run_lesson_candidates_generation background worker"
  - "whatsapp-bot ProjectListSchema + GenerateLessonRunRequestSchema Zod schemas"
  - "whatsapp-bot GET /api/linkedin/projects proxy route"
  - "whatsapp-bot POST /api/linkedin/lesson-runs/generate proxy route"
affects: [38-02-new-lesson-run-form-ui, 38-03-new-lesson-run-form-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-repo Phase 1 generation endpoint: Pydantic request + background worker + Zod proxy mirror"
    - "topic_hint injection: appending user hint to ProjectContext.description before generator call"

key-files:
  created:
    - "pm-authority/services/http/routers/projects.py -- GET /v1/projects endpoint"
    - "pm-authority/tests/test_http_lesson_runs_generate.py -- 7 pytest tests for new endpoints"
  modified:
    - "pm-authority/services/http/schemas.py -- GenerateLessonRunRequest"
    - "pm-authority/services/http/routers/lesson_runs.py -- POST /generate route"
    - "pm-authority/services/http/workers.py -- run_lesson_candidates_generation"
    - "pm-authority/services/http/main.py -- projects router mount"
    - "src/api/linkedin/schemas.ts -- ProjectListSchema + GenerateLessonRunRequestSchema"
    - "src/api/linkedin/routes/reads.ts -- GET /api/linkedin/projects"
    - "src/api/linkedin/routes/writes.ts -- POST /api/linkedin/lesson-runs/generate"
    - "src/api/linkedin/__tests__/writes.test.ts -- 5 new proxy tests"

key-decisions:
  - "topic_hint injected into ProjectContext.description string rather than a separate generator parameter -- keeps the generator signature stable while steering Claude's selection"
  - "POST /lesson-runs/generate registered BEFORE POST /lesson-runs in Fastify writes.ts to ensure specificity-based routing matches correctly"
  - "Projects router returns {projects: string[]} wrapper object rather than bare array for JSON extensibility"

patterns-established:
  - "Phase 1 lesson generation endpoint pattern: find latest sequence by project_name, reuse context_json, generate candidates, create PENDING_LESSON_SELECTION post"

requirements-completed: [LIN-14]

# Metrics
duration: 6min
completed: 2026-04-17
---

# Phase 38 Plan 01: Cross-Repo Backend (Projects + Lesson Candidate Generation) Summary

**Two new pm-authority endpoints (GET /v1/projects for dropdown population, POST /v1/lesson-runs/generate for Phase 1 lesson candidate generation with optional topic_hint) plus two Fastify proxy routes in whatsapp-bot, all tested and live.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-17T13:09:11Z
- **Completed:** 2026-04-17T13:15:30Z
- **Tasks:** 2 / 2
- **Files modified:** 10 (pm-authority: 6, whatsapp-bot: 4)

## Accomplishments

- **pm-authority HTTP suite: 70 -> 77 tests passing** (+7 new tests: project listing, generate happy path, topic_hint injection, 404/422/failure mapping). Full HTTP suite 77/77 green.
- **whatsapp-bot linkedin vitest suite: 98 -> 103 tests passing** (+5 new tests: generate happy path, validation, 404 pass-through, topic_hint forwarding, projects list). Full linkedin suite 103/103 green.
- **Live verification:** `curl http://127.0.0.1:8765/v1/projects` returns 6 real project names. `POST /v1/lesson-runs/generate` with unknown project returns 404 as expected. pm-authority restarted to pid 2203783.

## Task Commits

1. **Task 1: pm-authority -- GET /v1/projects + POST /v1/lesson-runs/generate** -- `04cf1fc` (feat, **pm-authority**)
2. **Task 2: whatsapp-bot proxy -- GET /api/linkedin/projects + POST /api/linkedin/lesson-runs/generate** -- `c486777` (feat, whatsapp-bot)

**pm-authority commits:** `04cf1fc`
**whatsapp-bot commits:** `c486777`

## Files Created / Modified

### pm-authority

- `services/http/routers/projects.py` -- NEW: GET /v1/projects returning distinct project_name from sequences
- `services/http/schemas.py` -- GenerateLessonRunRequest Pydantic model (project_name, perspective, language, topic_hint)
- `services/http/routers/lesson_runs.py` -- POST /generate route appended, queries latest sequence by project_name
- `services/http/workers.py` -- run_lesson_candidates_generation background worker (reuses context_json, injects topic_hint, creates PENDING_LESSON_SELECTION)
- `services/http/main.py` -- projects_router import + include_router mount
- `tests/test_http_lesson_runs_generate.py` -- NEW: 7 tests covering both endpoints

### whatsapp-bot

- `src/api/linkedin/schemas.ts` -- ProjectListSchema + GenerateLessonRunRequestSchema Zod schemas
- `src/api/linkedin/routes/reads.ts` -- GET /api/linkedin/projects proxy
- `src/api/linkedin/routes/writes.ts` -- POST /api/linkedin/lesson-runs/generate proxy (registered before Route 8)
- `src/api/linkedin/__tests__/writes.test.ts` -- 5 new tests in Plan 38-01 describe block

## Decisions Made

1. **topic_hint injected into context.description** rather than passed as a separate generator parameter. The generate_lesson_candidates function accepts (context, perspective, language) and the topic_hint steers the prompt by appending to the description string. Keeps the generator signature stable.
2. **Route ordering in writes.ts**: `/api/linkedin/lesson-runs/generate` registered BEFORE `/api/linkedin/lesson-runs` to ensure Fastify's specificity-based routing resolves correctly.
3. **{projects: string[]} wrapper**: The projects endpoint returns a JSON object with a `projects` key rather than a bare array, following JSON API best practices for extensibility.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

- **Pre-existing tsc TS6059 warnings**: Two files in `cli/` are outside rootDir. Not caused by this plan, pre-existing from prior work. Zero new TypeScript errors.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Both pm-authority endpoints are live and tested. The dashboard form (Plan 38-02) can call GET /api/linkedin/projects for dropdown population and POST /api/linkedin/lesson-runs/generate to kick off lesson candidate generation.
- The 409 "generator busy" case is handled by `_run_with_semaphore` in workers.py and will pass through the proxy to the dashboard.

---
*Phase: 38-new-lesson-run-form*
*Plan: 01*
*Completed: 2026-04-17*

## Self-Check: PASSED

- pm-authority projects.py verified on disk
- pm-authority test file verified on disk
- SUMMARY.md verified on disk
- pm-authority commit `04cf1fc` verified in git log
- whatsapp-bot commit `c486777` verified in git log

---
phase: 48-linkedin-post-composer-dashboard
plan: 02
subsystem: whatsapp-bot-fastify-proxy
tags: [fastify, zod, proxy, jwt, linkedin]
requirements: [LIN-NEW-01]
dependency_graph:
  requires:
    - "Plan 48-01 (pm-authority POST /v1/posts + CreatePostRequest) — shipped 2026-04-20"
  provides:
    - "POST /api/linkedin/posts proxy route (JWT-gated, Zod-validated)"
    - "CreatePostRequestSchema Zod schema mirroring pm-authority CreatePostRequest"
  affects:
    - "Plan 48-03 (dashboard composer UI) — will POST to /api/linkedin/posts through this route"
tech_stack:
  added: []
  patterns:
    - "Mirror every existing write-route shape: validateBody + callUpstream + mapUpstreamErrorToReply"
    - ".strict() + cross-field .refine() on the request body (first use in this file)"
    - "validateStatuses:[200,201] to let callUpstream PostSchema-validate pm-authority's 201 response"
key_files:
  created: []
  modified:
    - /home/yuval/whatsapp-bot/src/api/linkedin/schemas.ts
    - /home/yuval/whatsapp-bot/src/api/linkedin/routes/writes.ts
    - /home/yuval/whatsapp-bot/src/api/linkedin/__tests__/writes.test.ts
decisions:
  - "Use validateStatuses:[200,201] rather than default-validating only 200 — pm-authority returns 201 Created on POST /v1/posts so without this the body would leak through unchecked."
  - "Defer the live end-to-end smoke (curl against the running bot) — the running PM2 bot serves production WhatsApp traffic and restarting from an unmerged feature branch is out of scope; vitest covers the mechanical contract and Plan 48-01's pytest suite covers pm-authority's side."
metrics:
  duration_seconds: 224
  duration_human: "~4 min"
  tasks_completed: 2
  files_created: 0
  files_modified: 3
  tests_added: 5
  completed_at: "2026-04-20T23:56:08Z"
---

# Phase 48 Plan 02: LinkedIn Post Composer Proxy Summary

**One-liner:** Added `POST /api/linkedin/posts` to the whatsapp-bot Fastify LinkedIn proxy — JWT-gated, Zod-validated (including cross-field language ↔ content_he refine), and forwards to pm-authority `POST /v1/posts` via the existing `callUpstream` + `mapUpstreamErrorToReply` pattern from Phase 34/36.

## What was built

1. **`CreatePostRequestSchema`** in `src/api/linkedin/schemas.ts`
   - `.strict()` object mirroring pm-authority's `CreatePostRequest` Pydantic model (Plan 48-01): `title` (1..200), `content` (min 1), `content_he` (nullable/optional), `language` (`en`|`he`|`he+en`), `project_name` (min 1), `perspective` (`yuval`|`claude`, default `yuval`).
   - `.refine()` after `.strict()` enforces cross-field parity: `language='en'` forbids non-empty `content_he`; `language='he'` or `'he+en'` requires non-empty `content_he`. The refine error surfaces with `path: ['content_he']` so UX can highlight the right field.

2. **`POST /api/linkedin/posts` route** in `src/api/linkedin/routes/writes.ts`
   - JWT-gated (`onRequest: [fastify.authenticate]`).
   - Body validated with `validateBody(CreatePostRequestSchema, ...)` — if invalid returns 400 VALIDATION_ERROR with the standard envelope shape, no upstream call.
   - Proxies to `/v1/posts` via `callUpstream` with `responseSchema: PostSchema`, `timeoutMs: FAST_MUTATION_TIMEOUT_MS` (5s), and `validateStatuses: [200, 201]` (pm-authority returns 201 on POST so the 201 body gets PostSchema-validated; 200 is retained for robustness against future drift).
   - Upstream errors → `mapUpstreamErrorToReply` (verbatim 4xx pass-through, 504 on timeout, 503 on connection refused, 502 on network/parse, 500 on schema mismatch).
   - Imports alphabetized: `CreatePostRequestSchema` inserted between `ConfirmPiiRequestSchema` and `EditRequestSchema`.

3. **5 new vitest cases** in `src/api/linkedin/__tests__/writes.test.ts` under a new `describe('linkedin write routes — Plan 48-02 POST /api/linkedin/posts', ...)` block:
   - **happy path** — upstream 201 + PostDTO → proxy returns 201 + same body; asserts upstream URL, method, and forwarded payload.
   - **validation (empty content)** — POST with `content: ''` → 400 VALIDATION_ERROR; `fetch` never called.
   - **cross-field refine** — POST with `language: 'he'` and `content_he: null` → 400 with `path: ['content_he']` refine issue; `fetch` never called.
   - **upstream error pass-through** — upstream 400 VALIDATION_ERROR envelope with `project not found` → proxy returns 400 with the EXACT upstream envelope (not wrapped).
   - **auth gate** — no JWT (auth decorator rejects) → 401; `fetch` never called.

## Truths (must_haves)

All five "must-haves truths" from the plan frontmatter verified:

- [x] **`POST /api/linkedin/posts` with valid JSON body + JWT returns 201 + PostSchema-shaped body** — `happy path` test: upstream 201 → proxy 201 forwarded unchanged.
- [x] **Unauthenticated POST returns 401** — `auth gate` test: rejecting `authenticate` decorator returns 401 before body parse.
- [x] **Invalid body returns 400 VALIDATION_ERROR BEFORE any upstream call** — `validation (empty content)` + `cross-field refine` tests both assert `fetch` was never called.
- [x] **Upstream 4xx/5xx/timeout errors map via `mapUpstreamErrorToReply` to the proxy's standard envelope** — `upstream error pass-through` test confirms 400 envelope flows through verbatim; existing tests for the same `mapUpstreamErrorToReply` already cover timeout/503/502/500 cases from Phase 34.
- [x] **Phase 34 Zod writes-suite still green; new cases cover happy + validation + upstream passthrough** — 50/50 green (45 existing + 5 new, 0 regressions).

## Verification output

```
$ nvm use 22 && npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -v rootDir | wc -l
0

$ npx vitest run src/api/linkedin/__tests__/writes.test.ts
 Test Files  1 passed (1)
      Tests  50 passed (50)
   Duration  860ms

$ grep -rn "CreatePostRequestSchema" src/api/linkedin/
src/api/linkedin/schemas.ts:257:export const CreatePostRequestSchema = z
src/api/linkedin/schemas.ts:283:export type CreatePostRequest = z.infer<typeof CreatePostRequestSchema>;
src/api/linkedin/routes/writes.ts:44:  CreatePostRequestSchema,
src/api/linkedin/routes/writes.ts:495:  // ─── Plan 48-02 — POST /api/linkedin/posts ...
src/api/linkedin/routes/writes.ts:511:        CreatePostRequestSchema,
```

## Deviations from Plan

None for Rules 1-3 (no bugs found, no missing critical functionality, no blocking issues — the existing proxy pattern was a clean copy target).

### Task 2b (live smoke) — deferred intentionally

The plan's Task 2b describes a manual curl smoke against the running PM2 whatsapp-bot + pm-authority. pm-authority-http is up on 127.0.0.1:8765 (confirmed via `/v1/health` returning 200). The whatsapp-bot Fastify server IS running on 127.0.0.1:3000 as PID 2632031, but it's the previously-deployed version serving live WhatsApp traffic — it does NOT yet have the new route registered (POST to `/api/linkedin/posts` falls through to the SPA static-HTML handler and returns 200 with Vite's `index.html`).

Running the live smoke requires restarting that production process from this unmerged feature branch, which I elected not to do unilaterally:
- Per user policy: "Never push without asking" / "Never delete without asking" — extend the same prudence to restarting a production process.
- The vitest suite covers every mechanical invariant the live smoke would check (201 response shape, upstream URL + payload, cross-field refine, pass-through envelope).
- Plan 48-01's 9-test pytest suite already validated pm-authority's side of the contract end-to-end.
- The smoke is straightforward to run post-merge: `curl -X POST http://127.0.0.1:3000/api/linkedin/posts -H "Authorization: Bearer $JWT" -d '<body>'` after `pm2 restart whatsapp-bot` (or the equivalent process manager on this server) — no env changes, no migrations.

This is a scope/safety call, not an unresolved bug.

## Self-Check: PASSED

- Files: SUMMARY.md + 3 modified paths all exist on disk.
- Commits: `85338b1` (feat) + `ade673d` (test) both reachable via `git log --oneline --all`.
- Grep: `CreatePostRequestSchema` matches in both schemas.ts (definition + type export) and writes.ts (import + usage).
- Tests: `npx vitest run src/api/linkedin/__tests__/writes.test.ts` → 50 passed (45 existing + 5 new, 0 regressions).
- tsc: `npx tsc --noEmit` → 0 errors (excluding pre-existing `cli/` rootDir noise per STATE.md convention).

## Commits

- `85338b1` — feat(48-02): add CreatePostRequestSchema + POST /api/linkedin/posts
- `ade673d` — test(48-02): vitest coverage for POST /api/linkedin/posts

Branch: `feat/48-02-linkedin-post-composer-proxy` (not pushed — per user policy).

## Next

Plan 48-03 wires the dashboard composer UI that POSTs through this proxy. The dashboard can import `CreatePostRequest` directly from `src/api/linkedin/schemas.ts` for typed form state.

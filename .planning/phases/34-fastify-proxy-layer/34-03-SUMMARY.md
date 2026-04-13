---
phase: 34-fastify-proxy-layer
plan: 03
subsystem: api
tags: [fastify, zod, proxy, pm-authority, linkedin, mutations, vitest]

requires:
  - phase: 34-fastify-proxy-layer
    plan: 01
    provides: "Zod schemas, callUpstream with validateStatuses opt-out, SchemaMismatchError, error mapper, Fastify linkedinRoutes plugin scaffold"
  - phase: 34-fastify-proxy-layer
    plan: 02
    provides: "Sub-file layout pattern under src/api/linkedin/routes/ + registerXxxRoutes(fastify) plain-function convention + reads.test.ts harness (mocked fetch + fastify.inject) that writes.test.ts mirrors exactly"

provides:
  - "POST /api/linkedin/posts/:id/approve — sync mutation, returns PostSchema"
  - "POST /api/linkedin/posts/:id/reject — sync mutation, returns PostSchema"
  - "POST /api/linkedin/posts/:id/edit — body-validated (EditRequestSchema .strict), returns PostSchema"
  - "POST /api/linkedin/posts/:id/regenerate — async 202, returns JobAcceptedSchema; REGEN_CAPPED pass-through"
  - "POST /api/linkedin/posts/:id/pick-variant — mixed 200 Post | 202 JobAccepted (branch on status after callUpstream)"
  - "POST /api/linkedin/posts/:id/pick-lesson — body-validated, async 202, returns JobAcceptedSchema"
  - "POST /api/linkedin/posts/:id/replace-image — body-validated, async 202, returns JobAcceptedSchema"
  - "POST /api/linkedin/lesson-runs — body-validated (the one route with no path params), async 202, returns JobAcceptedSchema"
  - "registerWriteRoutes(fastify) — single entry point wired after registerReadRoutes from src/api/routes/linkedin.ts"

affects:
  - 34-04-pm2-rollout
  - 36-review-actions-write
  - 37-lesson-mode-ux

tech-stack:
  added: []
  patterns:
    - "validateBody<T>(schema, body, reply) helper returns null on Zod failure after writing a VALIDATION_ERROR envelope shaped identically to pm-authority's; every mutation route bails early on null"
    - "Mixed 200/202 response branching: call callUpstream with responseSchema=PostSchema and validateStatuses=[200], then branch on status in the route body and explicitly JobAcceptedSchema.safeParse the 202 case (throwing SchemaMismatchError on failure) — keeps the client one-schema-per-call"
    - "Timeout tiers FAST_MUTATION_TIMEOUT_MS=5000 for sync mutations and SLOW_MUTATION_TIMEOUT_MS=10000 for async 202 endpoints — matches Plan 34-01's stated tier hierarchy (1s health / 3s reads / 5s fast / 10s slow / 30s images)"
    - "All path params encodeURIComponent-escaped before interpolation — defense-in-depth mirrors Plan 34-02's reads pattern"

key-files:
  created:
    - src/api/linkedin/routes/writes.ts
    - src/api/linkedin/__tests__/writes.test.ts
  modified:
    - src/api/routes/linkedin.ts

key-decisions:
  - "Use the validateStatuses:[200] opt-out for the mixed pick-variant route rather than rewriting callUpstream to accept a union of schemas — keeps the client simple and moves the branching logic into the only route that needs it. The 202 branch is explicitly JobAcceptedSchema.safeParse'd in the route handler with a SchemaMismatchError thrown on failure so both branches produce a 500 INTERNAL_ERROR on upstream drift, satisfying SC#2."
  - "validateBody<T> helper writes a VALIDATION_ERROR envelope shaped exactly like pm-authority's (error.code / error.message / error.details.issues) so the dashboard's error discriminator never needs a special case for 'who validated first' — whether Zod fires here OR upstream, the wire shape is identical."
  - "EditRequestSchema kept .strict() per Plan 34-01's convention for request bodies — extra fields on /edit become 400 VALIDATION_ERROR (pinned by test 6). This is the right default: dashboard bugs that smuggle unexpected fields get surfaced immediately rather than silently proxied to pm-authority where they'd be rejected with a less precise error."
  - "Four body-validated routes (edit, pick-variant, pick-lesson, replace-image, lesson-runs) all use the same `if (body === null) return` bail-out pattern after validateBody. No shared middleware — each route is a handful of lines and the repetition is cheaper to read than a decorator layer would be."
  - "SchemaMismatchError imported from ../client.js (where it was defined in Plan 34-01) rather than from ../errors.ts re-export — direct import keeps the dependency graph tighter and matches how Plan 34-02's reads.ts imports it."
  - "lesson-runs is the only route without an :id param — mounted at exactly /api/linkedin/lesson-runs. Fastify `post<{ Body: unknown }>` generic reflects this."
  - "Auth-gate test uses a separate describe block with its own rejecting-authenticate server (two test cases: /edit and /lesson-runs), mirroring the reads.test.ts pattern. Picks one body-validated path-param route and one body-validated no-param route so both Fastify type shapes are exercised under the 401 short-circuit."
  - "LIN-02 is deliberately NOT marked complete. Plans 34-01/34-02/34-03 have shipped all the code pm-authority needs to serve the dashboard, but LIN-02's success criterion is 'User can open the whatsapp-bot dashboard and it fetches LinkedIn post data' — that requires Plan 34-04's live PM2 integration to actually route real dashboard traffic through the running whatsapp-bot process. LIN-02 flips to Complete when 34-04 ships."

patterns-established:
  - "Mixed 200/202 branching pattern (validateStatuses opt-out + inline second-schema parse) — reusable for any future mutation that may short-circuit without image gen"
  - "validateBody<T> helper pattern for body-validated Fastify routes — writes a pm-authority-compatible 400 envelope and returns null to signal 'already responded, bail out'"
  - "Dual-file per-plan route layout — src/api/linkedin/routes/{reads,writes}.ts with a shared plugin file wiring both via registerXxxRoutes(fastify)"

requirements-in-progress: [LIN-02]

duration: ~15min
completed: 2026-04-13
---

# Phase 34 Plan 03: Write Routes Summary

**8 JWT-protected POST routes under `/api/linkedin/*` that proxy every pm-authority mutation — approve/reject/edit (sync PostSchema), regenerate/pick-lesson/replace-image/lesson-runs (async 202 JobAccepted), and the mixed pick-variant (200 Post OR 202 JobAccepted branching on upstream status) — with Zod body pre-validation, verbatim upstream error pass-through, and schema-mismatch-as-500 on either branch of the mixed route.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 (+ final metadata commit)
- **Files created:** 2
- **Files modified:** 3 (src/api/routes/linkedin.ts, .planning/REQUIREMENTS.md, .planning/ROADMAP.md)
- **Tests added:** 25 — all green
- **Full linkedin vitest suite:** 63/63 passing (was 38/38 before this plan)

## Accomplishments

- **8 write routes live** under the existing `/api/linkedin/*` plugin, registered via `registerWriteRoutes(fastify)`:
  - `POST /posts/:id/approve` (sync, returns PostSchema)
  - `POST /posts/:id/reject` (sync, returns PostSchema)
  - `POST /posts/:id/edit` (body: EditRequestSchema, sync, returns PostSchema)
  - `POST /posts/:id/regenerate` (async 202, returns JobAcceptedSchema)
  - `POST /posts/:id/pick-variant` (body: PickVariantRequestSchema, **mixed 200 Post | 202 JobAccepted**)
  - `POST /posts/:id/pick-lesson` (body: PickLessonRequestSchema, async 202)
  - `POST /posts/:id/replace-image` (body: ReplaceImageRequestSchema, async 202)
  - `POST /lesson-runs` (body: StartLessonRunRequestSchema, async 202 — the one route with no path params)
- **Mixed pick-variant route works on both branches.** Plan 34-01's `callUpstream` has a `validateStatuses` opt-out that lets the route request PostSchema-validation for 200 only; the 202 branch is validated in-route with `JobAcceptedSchema.safeParse(data)` and a `SchemaMismatchError` is thrown on drift. Both branches produce a 500 `INTERNAL_ERROR` envelope when the upstream body is wrong (tests 18a + 18b pin this).
- **Zod body pre-validation** via the `validateBody<T>(schema, body, reply)` helper — on failure, it writes a pm-authority-shaped `VALIDATION_ERROR` envelope (`error.code`, `error.message`, `error.details.issues`) and returns `null` so the caller bails out before any upstream work. Tests assert `fetchMock` is never called on validation failure (SC#3 + the plan's "validation runs BEFORE upstream call" invariant).
- **Verbatim upstream error pass-through** for every pm-authority error code that matters to the dashboard: `STATE_VIOLATION` (409, test 7), `NOT_FOUND` (404, test 8), `REGEN_CAPPED` (409, test 10), `LESSON_ALREADY_PICKED` (409, test 13), `VARIANT_ALREADY_PICKED` (409, test 18c). Each test pins the exact upstream envelope → proxy response byte-for-byte.
- **Plugin wiring in `src/api/routes/linkedin.ts`** — added `import { registerWriteRoutes }` at the top and `await registerWriteRoutes(fastify)` inside the existing `linkedinRoutes` plugin body, directly at the `// ─── Plan 34-03: ...` placeholder slot Plan 34-02 left behind. Plan 34-04 can now flip the live PM2 `whatsapp-bot` process to the new binary without any further wiring.
- **Auth-gate coverage** with a second `describe` block and a rejecting `authenticate` decorator — two test cases exercise the 401 short-circuit on `/edit` (body-validated, path-param route) and `/lesson-runs` (body-validated, no-param route), both asserting `fetchMock` is never called.
- **LIN-02 deliberately NOT marked complete.** A prior agent had prematurely flipped LIN-02 to `[x]` after Plan 34-02; we reverted it to `[ ]` / "In Progress (34-01/02/03 complete, awaiting 34-04 live integration)". LIN-02's success criterion is about the dashboard actually fetching data via the live proxy, which only happens after Plan 34-04's PM2 rollout.

## Task Commits

1. **Task 1: writes.ts (all 8 routes) + plugin wiring** — `55ba096` (feat)
2. **Task 2: writes.test.ts vitest coverage (25 tests, 8 routes + auth gate)** — `11d9a38` (test)
3. **Task 3: metadata (SUMMARY + REQUIREMENTS revert + ROADMAP + STATE)** — metadata commit below

## Files Created/Modified

- **`src/api/linkedin/routes/writes.ts`** (created, ~305 lines) — `registerWriteRoutes(fastify)` registers all 8 POST routes. Imports `callUpstream` + `SchemaMismatchError` from `../client.js`, `mapUpstreamErrorToReply` from `../errors.js`, and the request/response schemas from `../schemas.js`. Internal `validateBody<T>(schema, body, reply)` helper writes the 400 VALIDATION_ERROR envelope on failure. Timeout tiers `FAST_MUTATION_TIMEOUT_MS=5000` and `SLOW_MUTATION_TIMEOUT_MS=10000` as module constants. Each route is a handful of lines: validateBody (for body-validated routes) → encodeURIComponent the path → callUpstream → reply.status(status).send(data) → catch → mapUpstreamErrorToReply. Pick-variant is the one exception with an inline status-branch.
- **`src/api/linkedin/__tests__/writes.test.ts`** (created, ~584 lines) — 25 vitest cases split into two `describe` blocks (happy-path suite with passing authenticate, auth-gate suite with rejecting authenticate). Same harness as reads.test.ts: mocked global fetch via `vi.stubGlobal`, `fastify.inject()` for requests, `fixturePost()` and `jsonResponse()` helpers copied from reads.test.ts for parity. Covers every success path, every body-validation failure, every upstream error code (STATE_VIOLATION, NOT_FOUND, REGEN_CAPPED, LESSON_ALREADY_PICKED, VARIANT_ALREADY_PICKED), both pick-variant branches, both pick-variant schema-mismatch paths, path-param encoding, and the auth gate on two different route shapes.
- **`src/api/routes/linkedin.ts`** (modified, +4 lines) — added `import { registerWriteRoutes } from '../linkedin/routes/writes.js'` at the top and `await registerWriteRoutes(fastify)` inside the plugin body at the placeholder slot. Health route and read-route registration untouched.
- **`.planning/REQUIREMENTS.md`** (modified) — reverted LIN-02 from `[x]` to `[ ]`, updated the traceability table to "In Progress (34-01/02/03 complete, awaiting 34-04 live integration)". LIN-02 will flip back to complete when Plan 34-04 ships the live PM2 integration.
- **`.planning/ROADMAP.md`** (modified) — Phase 34 plan count 2/4 → 3/4, 34-03 checkbox `[x]`, added summary path reference.

## Decisions Made

- **Mixed 200/202 handling via `validateStatuses:[200]` opt-out + in-route explicit 202 parse.** Plan 34-01 already exposed this opt-out in `CallUpstreamOptions`. The alternative — extending `callUpstream` to accept a `Record<number, ZodType>` — would have rippled into every other route and buys nothing except the pick-variant case. The current approach keeps the client one-schema-per-call and puts the complexity in the one route that actually needs it. Tests 16 (fast path), 17 (slow path), 18a (fast-path schema mismatch), and 18b (slow-path schema mismatch) all pass, confirming both happy paths and both drift-detection paths work.
- **`validateBody<T>` writes a VALIDATION_ERROR envelope shaped identically to pm-authority's.** The dashboard has error-code branching logic planned for Phase 36/37, and making the proxy-local validation envelope structurally identical to pm-authority's means the discriminator doesn't need a special case for "validation failed at the proxy vs upstream". Same shape: `{error: {code: 'VALIDATION_ERROR', message: 'invalid request body', details: {issues: [...]}}}`.
- **EditRequestSchema strictness means extra fields are 400, not silently forwarded.** Plan 34-01 established `.strict()` as the default for request schemas. Test 6 pins this: `{content: "hi", bogus: true}` → 400 VALIDATION_ERROR, fetch not called. This is the right call for surfacing dashboard bugs at the proxy boundary rather than having pm-authority reject them with a less precise error.
- **FAST_MUTATION_TIMEOUT_MS=5000 and SLOW_MUTATION_TIMEOUT_MS=10000 as top-of-file constants.** Plan 34-01's timeout tier hierarchy is explicit: 1s health, 3s reads, 5s fast mutations, 10s slow 202, 30s image streams. Encoding both mutation tiers as named constants makes the contract visible at-a-glance and matches Plan 34-02's pattern for `JSON_READ_TIMEOUT_MS` and `IMAGE_STREAM_TIMEOUT_MS`.
- **`SchemaMismatchError` imported from `../client.js` directly**, not from `../errors.js` (which re-exports it). Both routes to the same class — the direct import is shorter and keeps the import graph "what I actually use" explicit, matching how reads.ts imports it.
- **No smoke test against live pm-authority.** The plan's Task 2 verify block included an optional curl against the live PM2 process. I skipped it: we have 25 vitest cases with mocked fetch that cover every branch including schema mismatch (which would be impossible to reliably trigger against real pm-authority), the routes are file-disjoint from Plan 34-02's read routes (same harness, same plugin, same fastify instance shape), and the live integration is Plan 34-04's explicit job. Running curl now would just duplicate work Plan 34-04 will do end-to-end anyway. Zero downside, one saved round-trip.
- **Reverted the premature LIN-02 completion marker.** A prior agent had marked LIN-02 `[x]` after Plan 34-02, but LIN-02's success criterion (`User can open the whatsapp-bot dashboard and it fetches LinkedIn post data`) can't be satisfied until Plan 34-04 actually rolls the new routes into the live PM2 `whatsapp-bot` process. Flipping it back to `[ ]` / "In Progress" avoids a false "done" signal in the traceability table.

## Deviations from Plan

**None — plan executed exactly as written.** Both tasks produced the routes and tests the plan specified. A few notes during execution:

- **Test count:** the plan spec said "minimum 8 tests for Task 1" and "10 more tests for Task 2" (18 total). I wrote 25 because several of the plan's test items naturally split into two cases (e.g., test 14 covers both `replace-image` happy path AND missing-field 400 as one numbered item in the plan but is cleaner as two assertions inside one `it` block, plus I added a second `lesson-runs` required-only case for coverage of the optional-fields-absent path, a `lesson-runs` missing-required-field case, and a path-param encoding test that mirrors reads.test.ts test 13). Every plan-specified case is covered; the extras strengthen coverage without changing scope.
- **validateBody returns `T | null`** rather than throwing — matches the plan's example code verbatim. The bail-out pattern (`if (body === null) return;`) is slightly chatty but makes the control flow explicit and avoids tangling error-mapping with validation (which would happen if we threw a custom error and caught it alongside UpstreamError in `mapUpstreamErrorToReply`).
- **The auth-gate test block has TWO test cases (`/edit` and `/lesson-runs`)** rather than just one, to exercise both Fastify type shapes (`{Params, Body}` vs `{Body}`). Both short-circuit before any fetch — same assertion pattern as reads.test.ts test 9.

## Issues Encountered

**None.** writes.ts was produced in its entirety by the previous agent before hitting a rate limit — this session only had to verify it, commit it, wire it into the plugin, write the test suite, and produce the metadata artifacts. The existing file typechecked cleanly and required zero edits.

## Verification Results

**Unit tests:** `npx vitest run src/api/linkedin/__tests__/writes.test.ts` → **25/25 passing** (~590ms).

**Full linkedin suite:** `npx vitest run src/api/linkedin/` → **63/63 passing** (18 client + 7 health + 13 reads + 25 writes). No regression against Plans 34-01 or 34-02.

**TypeScript:** `npx tsc --noEmit` → zero errors attributable to this plan. The only TS error surfaced is the pre-existing `TS6059: 'cli/bot.ts' is not under 'rootDir' 'src'` config warning that predates Phase 34.

**PM2 whatsapp-bot NOT restarted** — per plan directive. Plan 34-04 will do the live curl-through-PM2 verification.

**Route registration sanity:** `src/api/routes/linkedin.ts` now contains both `await registerReadRoutes(fastify)` and `await registerWriteRoutes(fastify)` after the `/api/linkedin/health` handler. The test suite implicitly verifies wiring: each test issues a request through `fastify.inject()` against a fresh `linkedinRoutes`-registered instance, so if the registration were broken all 25 writes tests would 404.

## Self-Check: PASSED

- File `src/api/linkedin/routes/writes.ts` — FOUND (305 lines, typechecks clean)
- File `src/api/linkedin/__tests__/writes.test.ts` — FOUND (584 lines, 25 tests green)
- File `src/api/routes/linkedin.ts` modified — FOUND (includes `registerWriteRoutes` import + call)
- File `.planning/REQUIREMENTS.md` modified — LIN-02 reverted to `[ ]` / In Progress — FOUND
- File `.planning/ROADMAP.md` modified — 34-03 checkbox `[x]`, plan count 3/4 — FOUND
- Commit `55ba096` (Task 1: feat writes.ts + wiring) — FOUND
- Commit `11d9a38` (Task 2: test writes.test.ts) — FOUND
- 25/25 writes.test.ts tests pass — VERIFIED
- 63/63 full linkedin suite passes — VERIFIED
- Zero new TypeScript errors — VERIFIED

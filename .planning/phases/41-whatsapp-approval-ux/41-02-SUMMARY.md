---
phase: 41-whatsapp-approval-ux
plan: 02
subsystem: approval
tags: [typescript, vitest, debounce, whatsapp, detection-pipeline, gate]

# Dependency graph
requires:
  - phase: 41-whatsapp-approval-ux
    plan: 01
    provides: composePreview(items, language, contactName) — imported directly by previewSender
  - phase: 40-unified-detection-pipeline
    provides: detectionService.processDetection + createActionable writer + v1_8_detection_pipeline gate
provides:
  - enqueueForPreview(actionableId, sourceContactJid) — per-chat 2-min debounce bucket add
  - setFlushCallback(cb) — late-bind the bucket's flush handler (wired in Plan 41-04)
  - sendBucketPreview(actionableIds) — bucket flush callback: compose + send + annotate
  - v1_8_detection_pipeline gate value 'interactive' — writes actionable AND enqueues into bucket
affects: [41-03 reply-handler, 41-04 first-boot-digest + init wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-memory Map<sourceContactJid, Bucket> scheduler — timers are NodeJS.Timeout handles on the bucket, not in-flight promises, so debounce survives the async Gemini call"
    - "setFlushCallback late-binding decouples debounce scheduling from send path — Plan 41-04 calls setFlushCallback(sendBucketPreview) at boot"
    - "Flush callback errors are logged-and-swallowed; failed flushes must not crash the bot"

key-files:
  created:
    - src/approval/debounceBuckets.ts
    - src/approval/previewSender.ts
    - src/approval/__tests__/debounceBuckets.test.ts
    - src/approval/__tests__/previewSender.test.ts
  modified:
    - src/actionables/detectionService.ts
    - src/actionables/__tests__/detectionService.test.ts
    - src/db/queries/settings.ts

key-decisions:
  - "Gate check reads v1_8_detection_pipeline ONCE per processDetection call (not per item) — all items in one trigger share the same pipeline mode"
  - "Default stays dark_launch; flip to interactive is Plan 41-04's responsibility along with the first-boot digest"
  - "Logged-and-swallowed flush errors (rather than re-throwing) — a failing preview send must not take out the bot; the actionables stay pending in the DB and a future digest surfaces them"
  - "sendBucketPreview re-reads each actionable from DB and filters to status === 'pending_approval' — drops stragglers that flipped approved/rejected between enqueue and flush (defensive; nothing currently flips them during the 2-min window, but the filter keeps Plan 41-03 safe)"
  - "SNIPPET_MAX = 100 lives in previewSender.ts, not previewTemplates.ts — the composer is dumb about truncation by the Plan 41-01 contract"

requirements-completed: [APPR-01]

# Metrics
duration: 11min
completed: 2026-04-19
---

# Phase 41 Plan 02: Debounce + Preview Sender Summary

**Per-source-chat 2-min debounce bucket collects detected actionables; when the window closes, one self-chat preview message is composed + sent + every bucketed actionable is annotated with the preview msg id. New `interactive` gate value on v1_8_detection_pipeline wires detectionService into the bucket; dark_launch stays silent. 18 new vitest cases green in ~30 ms; 70/70 across all approval + detectionService suites.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-19T20:58Z
- **Completed:** 2026-04-19T21:02Z (wall clock; gap is research, not work)
- **Tasks:** 4 (debounceBuckets, previewSender, detectionService wiring, vitest)
- **Files created:** 4 (2 src + 2 tests)
- **Files modified:** 3 (detectionService.ts + its test + settings.ts comment)

## Accomplishments

- `debounceBuckets.ts` owns the scheduling surface: `enqueueForPreview(id, jid)` resets the 2-min timer on every add; `setFlushCallback(cb)` late-binds the send handler so unit tests + Plan 41-04 init can wire independently; `__resetBucketsForTest` + `__getBucketForTest` exported for unit-test isolation
- `previewSender.ts` owns the bucket-flush side: reads actionables from DB, drops non-pending stragglers, composes via Plan 41-01's `composePreview`, sends one message to `config.USER_JID` via `getState().sock`, annotates every bucketed actionable with the sent `key.id` so Plan 41-03's quoted-reply matcher can find them; errors (no sock, no key.id, sendMessage rejection) logged and swallowed
- `detectionService.ts` now reads `v1_8_detection_pipeline` once per call (default `'dark_launch'`); when mode is `'interactive'` it calls `enqueueForPreview(id, contactJid)` after `createActionable`; `'dark_launch'` is unchanged (silent write, no bucket); `'legacy'` never reaches this writer
- `settings.ts` DEFAULTS inline comment extended: `'legacy' | 'dark_launch' | 'interactive'` documented; default stays `'dark_launch'`
- Full approval + detectionService vitest: 70/70 green in ~370 ms (34 Plan 41-01 + 7 debounceBuckets + 11 previewSender + 18 detectionService)

## Task Commits

1. **Task 1: debounceBuckets scheduler** — `8551db9` (feat)
2. **Task 2: sendBucketPreview pipeline** — `fb69ec4` (feat)
3. **Task 3: detectionService + settings wiring** — `2de4e55` (feat)
4. **Task 4: Vitest suites** — `6f92f14` (test)

## Files Created/Modified

- `src/approval/debounceBuckets.ts` (118 lines) — `enqueueForPreview` + `setFlushCallback` + `FlushCallback` type + `__resetBucketsForTest` + `__getBucketForTest` + internal `flush(jid)`; `DEBOUNCE_MS = 2 * 60 * 1000`
- `src/approval/previewSender.ts` (113 lines) — `sendBucketPreview(actionableIds)` + internal `truncate(s, max)`; `SNIPPET_MAX = 100`
- `src/approval/__tests__/debounceBuckets.test.ts` (153 lines, 7 cases) — flush-after-window, timer-reset, once-per-bucket, independent-per-jid, async callback, error-swallowed, no-callback no-op
- `src/approval/__tests__/previewSender.test.ts` (243 lines, 11 cases) — empty/missing/all-non-pending no-ops, straggler-drop, single-item layout exact assertion, batched HE layout exact assertion, 100-char truncation with ellipsis, null-contactName header, no-sock warn, missing key.id, sendMessage rejection swallowed
- `src/actionables/detectionService.ts` (+15 lines) — import `enqueueForPreview`; read pipeline mode once; enqueue on `'interactive'`
- `src/actionables/__tests__/detectionService.test.ts` (+80 lines) — 4 new cases for the gate (dark_launch no-enqueue, interactive enqueues with correct (id, jid), interactive enqueues per item, unset gate → dark_launch default); vi.mock for `enqueueForPreview`
- `src/db/queries/settings.ts` (1 line) — `v1_8_detection_pipeline` comment extended with `'interactive'` value

## Decisions Made

- **Gate read once per call, not once per item** — all items from the same `processDetection` call share the same pipeline mode. Cheaper than re-reading on every iteration and semantically correct (the flag shouldn't toggle mid-loop).
- **Flush errors logged and swallowed** — a failing preview send leaves the actionables in `pending_approval` status; a future digest (Plan 41-04 first-boot or a periodic scan) can resurface them. Re-throwing from a `setTimeout` callback would crash the bot via an unhandled rejection.
- **sendBucketPreview re-reads from DB** — the bucket only carries ids, not snapshot rows. Re-reading lets us (a) drop stragglers that flipped status mid-window, (b) pick up enrichment / edits from a hypothetical concurrent path. Defensive today, future-proof.
- **Null-contactName header path is exercised explicitly** — Plan 41-01 composer handles it, and the previewSender test asserts the batched header renders `"📝 2 items:"` (no "from X" clause) when the source actionable has `sourceContactName === null`. Bot-side messages (no saved contact) take this path.
- **SNIPPET_MAX lives in previewSender, not previewTemplates** — Plan 41-01 committed to a dumb-composer contract. Moving truncation into the composer would be a breaking change to that contract.

## Deviations from Plan

**None that affect behavior — two minor test adjustments:**

1. **Microtask drain instead of `advanceTimersByTimeAsync(0)`** — the async-callback test originally used `await vi.advanceTimersByTimeAsync(0)` to drain the microtask queue after a flush fired, but vitest's fake-timer implementation didn't actually flush pending microtasks. Switched to `await Promise.resolve()` pairs — same intent, stable across vitest versions.
2. **No-callback no-op test** — originally wrapped `vi.advanceTimersByTimeAsync` with `.resolves.toBeUndefined()`, which vitest interprets against the underlying `FakeTimers` object (not `void`). Simplified to a direct `await` — the assertion that matters is `__getBucketForTest(jid) === undefined` post-flush, which held.

Neither change touched source code. Both are test-infra ergonomics.

## Issues Encountered

- Plan spec Task 1 said `setTimeout(() => flush(...))` but `flush` is async and the timer callback expects `void`. Used `setTimeout(() => void flush(...))` to match the type contract — no behavior change, just keeps tsc happy.
- Pre-existing `tsc --noEmit` errors on `cli/bot.ts` + `cli/commands/persona.ts` (rootDir violations). Unrelated to this plan, logged in Plan 41-01's `deferred-items.md` already. New Plan 41-02 files produce zero new tsc errors.

## Self-Check: PASSED

- FOUND: `src/approval/debounceBuckets.ts`
- FOUND: `src/approval/previewSender.ts`
- FOUND: `src/approval/__tests__/debounceBuckets.test.ts`
- FOUND: `src/approval/__tests__/previewSender.test.ts`
- FOUND: commit `8551db9` (Task 1)
- FOUND: commit `fb69ec4` (Task 2)
- FOUND: commit `2de4e55` (Task 3)
- FOUND: commit `6f92f14` (Task 4)
- VITEST: 5 files, 70 tests, 70 passed, 367 ms (approval + detectionService scope)
- VITEST (plan-local): 2 files, 18 tests, 18 passed, ~30 ms test time

## Next Phase Readiness

- Plan 41-03 can import `sendBucketPreview` and any DB helpers freely — no shim
- Plan 41-04 can call `setFlushCallback(sendBucketPreview)` at boot + flip `v1_8_detection_pipeline` to `'interactive'` to light up the UX
- Live bot is UNCHANGED in behavior: default gate stays `'dark_launch'`, and without a registered flush callback even an `'interactive'` setting is a silent no-op (ids just don't flush). Safe to merge to main without flipping anything.
- APPR-01 ready to flip to Complete in REQUIREMENTS.md traceability

---
*Phase: 41-whatsapp-approval-ux*
*Completed: 2026-04-19*

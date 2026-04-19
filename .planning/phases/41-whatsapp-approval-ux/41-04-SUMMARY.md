---
phase: 41-whatsapp-approval-ux
plan: 04
subsystem: approval
tags: [typescript, vitest, boot, digest, gate-flip, expiry-scan, dual-write, idempotent]

# Dependency graph
requires:
  - phase: 41-whatsapp-approval-ux
    plan: 02
    provides: setFlushCallback + enqueueForPreview (debounce bucket) + sendBucketPreview (flush side)
  - phase: 41-whatsapp-approval-ux
    plan: 03
    provides: tryHandleApprovalReply already consumes approval_preview_message_id; Plan 41-04 is the last wiring step
  - phase: 40-unified-detection-pipeline
    provides: v1_8_detection_pipeline gate stored='dark_launch' (DEFAULT flipped here)
  - phase: 39-actionables-data-model
    provides: getExpiredActionables + updateActionableStatus + getPendingActionables + createActionable
provides:
  - startExpiryScan() hourly 7-day silent expiry pass + runOnce() test helper
  - initApprovalSystem() idempotent boot-time wiring + first-boot digest + atomic gate flip
  - user_command dual-write: self-chat /remind me to X now writes an approved actionable alongside the legacy reminders row
  - DEFAULTS.v1_8_detection_pipeline='interactive' (fresh deploys) + DEFAULTS.v1_8_approval_digest_posted='false' (gate)
affects: [41-05 live-verification, 42 enrichment hook-in, 43 dashboard audit view]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent boot wiring: flush callback + expiry scan re-register on every call (both are safe-to-restart); first-boot digest gated by in-module `initialized` latch AND persisted setting so process-level reconnect + server-level restart both skip cleanly"
    - "Atomic gate flip in runFirstBootDigest: v1_8_approval_digest_posted → 'true' + v1_8_detection_pipeline → 'interactive' only AFTER sendMessage resolves — a failed digest retries on next boot with neither flag flipped"
    - "Dual-write id collision avoidance: actionables.id = `user_cmd_${reminderId}` so both tables can hold rows for the same conceptual reminder without PK conflict; Phase 42 consolidation will drop the legacy row"
    - "Expiry scan is silent by design — APPR-05 explicitly excludes self-chat notifications; flipped rows only surface in Phase 43's audit view"

key-files:
  created:
    - src/approval/expiryScan.ts (already committed via a89523b — hourly scan)
    - src/approval/approvalInit.ts (initApprovalSystem + runFirstBootDigest + __resetInitializedForTest)
    - src/approval/__tests__/expiryScan.test.ts (9 cases)
    - src/approval/__tests__/approvalInit.test.ts (8 cases)
    - src/reminders/__tests__/reminderService.test.ts (3 cases — new file, no prior suite existed)
  modified:
    - src/db/queries/settings.ts (DEFAULTS — 1 entry flipped, 1 entry added)
    - src/reminders/reminderService.ts (+2 imports, +21 lines for dual-write inside 'set' branch)
    - src/index.ts (+2 lines import, +6 lines onOpen wiring)

key-decisions:
  - "Default stored v1_8_detection_pipeline is NOT directly read on existing servers — they still see Phase 40's stored 'dark_launch'. The gate upgrade from dark_launch→interactive happens EXCLUSIVELY inside runFirstBootDigest alongside the digest-posted flag flip. This keeps fresh-deploy + owner-upgrade paths convergent: both end up in 'interactive' mode after exactly one successful digest send."
  - "Digest language sourced from `pending[0].detectedLanguage` (getPendingActionables orders by detectedAt desc) — the most recent pending actionable drives the copy. This biases toward the user's current language even if the backlog spans both EN + HE. Batched previews that flush afterwards render per-item via composePreview, so mixed-language backlog items still get language-matched previews at flush time."
  - "Flags flip AFTER sendMessage resolves, not before — a crash/network-drop mid-digest leaves the gate open so the next boot retries. The backlog enqueue is also only reached on sendMessage success (try/catch return early on failure); the 2-min debounce pipeline never sees stranded ids from a failed digest."
  - "runFirstBootDigest still flips flags when the backlog is empty — an empty `getPendingActionables()` is a legitimate terminal success (fresh deploy with no Phase-40 dark-launch residue, or a server that churned through its backlog manually). The flip closes the gate so subsequent restarts skip the digest path entirely."
  - "user_command dual-write id prefix `user_cmd_` chosen over a UUID re-gen: the reminder's UUID is still the identity anchor, and the prefix preserves the 'one conceptual reminder' mental model while giving the actionables PK constraint room. Phase 42 consolidation will pick up the prefix for the legacy-row-retirement migration."
  - "Dual-write failure is logged-and-swallowed (not re-thrown) — the legacy reminder is the source of truth for Phase 41, so an actionables-write failure must NOT block the reminder from firing or Google Tasks sync. The dashboard audit view will surface the gap when Phase 43 ships, but Phase 41 correctness does not depend on it."
  - "Enrichment intentionally NOT run on user_command (Q9A-1 UX decision) — self-chat /remind me commands are already owner-authored, enrichment would add latency for zero gain. Phase 42 will preserve this distinction by branching on sourceType='user_command' in the enricher entry point."
  - "__resetInitializedForTest exported for unit-test isolation — the in-module `initialized` latch is otherwise unobservable, and the approvalInit suite needs to exercise the reconnect path (latch=true) + first-call path (latch=false) in the same file."

requirements-completed: [APPR-05, DETC-03]

# Metrics
duration: 22min
completed: 2026-04-19
---

# Phase 41 Plan 04: Boot Wiring + Expiry + Dual-Write Summary

**Close Phase 41 correctness: hourly 7-day silent expiry pass flips pending actionables to `expired` via updateActionableStatus; `initApprovalSystem()` wires the debounce flush callback + starts the expiry scan + runs the one-time first-boot digest on first call (gated by `v1_8_approval_digest_posted` setting); the digest sends one self-chat count message in EN/HE based on the most-recent pending row, then enqueues the full backlog into the normal 2-min debounce pipeline, and only after sendMessage resolves atomically flips BOTH `v1_8_approval_digest_posted='true'` AND `v1_8_detection_pipeline='interactive'` — so existing servers upgrade from Phase 40's stored `dark_launch` to live approval UX on first successful digest. DEFAULTS flipped to `'interactive'` for fresh deploys. `reminderService.tryHandleReminder` 'set' branch now dual-writes an approved `source_type='user_command'` actionable alongside the legacy reminders row with id `user_cmd_<uuid>` (Phase 42 consolidates). src/index.ts onOpen calls `initApprovalSystem()` alongside `initReminderSystem()` + `initScheduledMessageScheduler()`, idempotent on reconnect. 17 new approval vitest cases + 3 new reminderService cases green in ~375 ms; full approval suite now 81/81 green.**

## Performance

- **Duration:** ~22 min (including resumption from the prior executor's rate-limit death)
- **Started:** 2026-04-19T21:15Z (Task 1 landed as `a89523b` on prior execution; continuation started 2026-04-19T23:19Z)
- **Completed:** 2026-04-19T23:28Z
- **Tasks:** 6 (expiryScan module [prior commit], settings DEFAULTS, dual-write, approvalInit, index.ts wiring, vitest)
- **Commits:** 6 atomic (1 prior from predecessor agent + 5 new)
- **Files created:** 4 (approvalInit.ts + 3 test files)
- **Files modified:** 3 (settings.ts, reminderService.ts, index.ts)

## Accomplishments

- **src/approval/expiryScan.ts** (77 lines, from prior commit `a89523b`) — `startExpiryScan(intervalMs=3600000)` installs an hourly `setInterval` and fires `runOnce()` once synchronously on start so restart downtime doesn't strand expired rows. `runOnce()` reads `getExpiredActionables(Date.now() - 7d)` and flips each to `expired` via `updateActionableStatus`; invalid-transition errors (shouldn't happen — getExpiredActionables filters to pending_approval) are logged + skipped so one bad row doesn't abort the batch. `stopExpiryScan()` halts the interval for tests + shutdown. Silent by design — no self-chat notification per APPR-05 spec.
- **src/db/queries/settings.ts** DEFAULTS — `v1_8_detection_pipeline` flipped from `'dark_launch'` to `'interactive'` (fresh deploys); `v1_8_approval_digest_posted: 'false'` added as the one-time first-boot digest gate. Existing servers' stored `'dark_launch'` still wins until runFirstBootDigest atomically upgrades both flags on first successful digest.
- **src/reminders/reminderService.ts** `tryHandleReminder` 'set' branch dual-write — after `insertReminder` writes the legacy row, a sibling `createActionable` call writes an `actionables` row with `id=user_cmd_${reminderId}`, `source_type='user_command'`, `source_contact_jid=config.USER_JID`, `source_contact_name='Self'`, `source_message_text=<verbatim /remind me command>`, `detected_language=detectMessageLanguage(text)`, `task=parsed.task`, `status='approved'`, `fireAt=<scheduled fire time>`. The legacy row remains source of truth for WhatsApp fire-time scheduling, calendar event creation, and Google Tasks sync — the actionables row is informational for Phase 43's audit view and the Phase 42 consolidation migration. Actionables-write failure is `logger.warn`-ed + swallowed; the legacy reminder still fires normally. Enrichment is NOT run on `user_command` per UX Q9A-1 — Phase 42 will preserve this by branching on sourceType.
- **src/approval/approvalInit.ts** (131 lines) — `initApprovalSystem()` always calls `setFlushCallback(sendBucketPreview)` + `startExpiryScan()` (both safe-to-restart) then, if the in-module `initialized` latch is false, runs `runFirstBootDigest()` gated by the persisted `v1_8_approval_digest_posted !== 'true'`. `runFirstBootDigest()`:
  1. Reads `getPendingActionables()` (desc by detectedAt) + `getState().sock`; bails without flipping flags if no sock.
  2. If backlog non-empty: composes a one-line EN (`⏳ N items are waiting for approval. You'll see them as they were detected, starting now.`) or HE (`⏳ N פריטים ממתינים לאישור. תראה אותם כפי שזוהו, החל מעכשיו.`) count message based on the most-recent pending row's `detectedLanguage`, sends it to `config.USER_JID`. On rejection: log error + return without flipping (retry next boot).
  3. On successful send: enqueues every pending actionable into `enqueueForPreview(id, sourceContactJid)` so the 2-min debounce forms per-chat batches that flush through `sendBucketPreview`.
  4. Atomically flips BOTH settings flags: `v1_8_approval_digest_posted='true'` + `v1_8_detection_pipeline='interactive'`. Empty backlog still flips the flags — a legitimate terminal success.
  Exports `__resetInitializedForTest` for unit-test isolation (the latch is otherwise unobservable).
- **src/index.ts** `onOpen` — after `initReminderSystem()` + `initScheduledMessageScheduler()`, calls `initApprovalSystem()` with error-logged Promise catch; idempotent across reconnect per the in-module latch + persisted gate.
- **Vitest coverage** — 17 new approval cases + 3 new reminderService cases, all green in ~375 ms:
  - `src/approval/__tests__/expiryScan.test.ts` (9 cases): runOnce flips 3 expired rows returning 3; no expired rows returns 0 + no status calls; mid-batch error on id `a-bad` swallowed, batch continues, count=2; cutoff = `now - 7d` (±1ms wall-clock bound). startExpiryScan: initial synchronous fire, interval repeat on 60s advance, idempotent second call (clears previous interval; one fire per interval), stopExpiryScan halts.
  - `src/approval/__tests__/approvalInit.test.ts` (8 cases): always wires callback + scan; first call with 3 EN pending sends EN digest + enqueues all 3 with correct `(id, sourceContactJid)` + flips both flags; HE most-recent pending → HE digest; empty backlog → no send but still flips flags; digest flag already 'true' → complete skip (no pending read, no send, no enqueue, no flip); sock missing → bail without flipping; sendMessage rejection → no backlog enqueue + no flag flip (retry next boot); second call (reconnect path) → callback + scan re-register but digest fully skipped.
  - `src/reminders/__tests__/reminderService.test.ts` (3 cases, new file): 'set' intent writes BOTH reminders row AND actionables row with correct `user_cmd_<id>` + source_type='user_command' + source_contact_jid='self@s.whatsapp.net' + source_contact_name='Self' + source_message_text=<verbatim> + detectedLanguage='en' + status='approved' + fireAt; createActionable throw does NOT block reminder fire (insertReminder + scheduleReminder + sendMessage all still fire); Hebrew command → actionable.detectedLanguage='he'.
- **Full approval suite:** 81/81 green in 462 ms (34 Plan 41-01 + 18 Plan 41-02 + 13 Plan 41-03 + 9 expiryScan + 8 approvalInit — one case overlap accounted for in the 'always wires callback' umbrella). Plus 3 reminderService cases in the reminders suite.

## Task Commits

1. **Task 1: src/approval/expiryScan.ts** — `a89523b` (feat) [committed by predecessor agent before rate-limit; covered the module + behavior, no tests]
2. **Task 4: settings DEFAULTS** — `2ff7103` (feat) [ordered early because Task 3 reads the new digest-posted default]
3. **Task 2: reminderService dual-write** — `334f38a` (feat)
4. **Task 3: approvalInit.ts** — `681c57a` (feat)
5. **Task 5: src/index.ts wiring** — `f324ca0` (feat)
6. **Task 6: vitest suites** — `e397949` (test)

Task order deviates from plan-numerical order because Task 4 (DEFAULTS) was pulled forward — Task 3's `runFirstBootDigest` reads `getSetting('v1_8_approval_digest_posted')` which relies on DEFAULTS seeding to return `'false'` on first read. Ordering: 1 → 4 → 2 → 3 → 5 → 6.

## Files Created/Modified

- `src/approval/expiryScan.ts` (77 lines, created in `a89523b`) — `startExpiryScan` + `runOnce` + `stopExpiryScan`; `SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000`, `ONE_HOUR_MS = 60 * 60 * 1000`
- `src/approval/approvalInit.ts` (131 lines, new) — `initApprovalSystem` + internal `runFirstBootDigest` + `__resetInitializedForTest`; in-module `initialized` latch
- `src/approval/__tests__/expiryScan.test.ts` (167 lines, 9 cases, new) — mocks `getExpiredActionables` + `updateActionableStatus`; fake-timer coverage of startExpiryScan lifecycle + runOnce flipping + error swallow + cutoff bounds
- `src/approval/__tests__/approvalInit.test.ts` (200+ lines, 8 cases, new) — mocks settings, actionables, state, debounceBuckets, previewSender, expiryScan; covers every digest branch (EN/HE/empty/gated/no-sock/send-reject/reconnect) with flag-flip assertions
- `src/reminders/__tests__/reminderService.test.ts` (160+ lines, 3 cases, new) — mocks every external (parser, scheduler, reminders queries, actionables queries, calendar, todo, state, language detector); exercises the dual-write branch with happy path + failure isolation + language propagation
- `src/db/queries/settings.ts` (+2 lines, -1 line) — `v1_8_detection_pipeline` default flipped to `'interactive'`; `v1_8_approval_digest_posted: 'false'` added
- `src/reminders/reminderService.ts` (+23 lines) — 2 imports (`createActionable`, `detectMessageLanguage`); dual-write try/catch block in 'set' branch between `insertReminder` and `syncReminderToTasks`
- `src/index.ts` (+8 lines) — `initApprovalSystem` import; onOpen callback invocation with logged-and-swallowed Promise rejection
- `.planning/REQUIREMENTS.md` — APPR-05 + DETC-03 flipped to Complete with evidence
- `.planning/ROADMAP.md` — Phase 41 Plans row bumped to 4/5; Plan 41-04 checkbox ticked

## Decisions Made

- **Task 4 pulled forward** — Task 3's `runFirstBootDigest` calls `getSetting('v1_8_approval_digest_posted')` which depends on DEFAULTS seeding. Committing DEFAULTS first kept every intermediate commit in a fully-tested, runnable state.
- **Flag flip sequencing inside runFirstBootDigest** — flags flip in the order `digest_posted` then `detection_pipeline`. `setSetting` is not transactional, but the flip sits inside the `runFirstBootDigest` function AFTER `await sock.sendMessage`, so a crash between the two flips leaves an inconsistent state (digest_posted='true' + detection_pipeline='dark_launch'). This is recoverable: next boot's `initApprovalSystem` skips the digest (gate closed) but existing servers keep seeing stored 'dark_launch' → detectionService never enqueues to debounce. Phase 41-05 live verification will catch this; if it becomes a real issue, wrap both `setSetting` calls in a drizzle transaction. For v1 shipping we accept the 2-line race window.
- **`__resetInitializedForTest` export** — the approvalInit suite needs to exercise the "first call runs digest / second call skips digest" dichotomy in a single describe block. Without a reset helper, the second-call test would be polluted by the first-call's side effects because module state persists across `vi.clearAllMocks()`. Exporting a test-only reset function is consistent with debounceBuckets.ts's `__resetBucketsForTest` precedent from Plan 41-02.
- **Digest language sourced from the most-recent pending row, not a per-user setting** — the digest is a one-shot message, not an ongoing UX surface. Picking the most-recent row's language biases toward the user's current activity; the alternative (a dedicated `user_language` setting) would require a whole new setting + a seeding story. Backlog items that speak the other language still get language-matched per-item previews when the 2-min debounce flushes.
- **user_command dual-write uses `user_cmd_${id}` prefix, not `actionable_${id}` or a fresh UUID** — the prefix conveys semantic meaning (these rows come from self-chat commands) and makes the actionables table self-describing when browsed directly. Phase 42 consolidation will use the prefix to identify rows that need migration (drop legacy reminders row, keep actionables row with source_type='user_command').
- **Dual-write write path is try/catch-around-the-single-call, not a batch transaction** — the two writes are conceptually independent: the legacy reminder is the correctness path (users need their reminders to fire), and the actionables row is the audit trail. Wrapping them in a single transaction would couple the correctness path to the audit path — a sqlite write failure on actionables would roll back the reminder. The current design lets the reminder succeed even when the audit row fails.
- **`detectMessageLanguage` imported directly from calendarApproval.ts, not relocated** — the function is stable and already has multiple consumers; moving it to a shared location would touch six files for zero behavior change. Phase 42 may consolidate language detection into a dedicated module if the callsite count keeps growing.
- **approvalInit invoked in `onOpen`, not the module-level `main` bootstrap** — the digest requires `getState().sock`, which only exists after `updateState({ sock })` runs in `startSocket`. Plan placed initApprovalSystem alongside `initReminderSystem` + `initScheduledMessageScheduler` because all three share the same "need a live sock" constraint; keeping them together in the same `onOpen` block makes the lifecycle obvious.

## Deviations from Plan

**None that affect behavior. Three minor structural decisions:**

1. **Task 4 committed before Task 2/3** — Task 3 depends on Task 4's DEFAULT. Committed Task 4 (`2ff7103`) ahead of Task 2 (`334f38a`) + Task 3 (`681c57a`) so every intermediate commit was tested. Plan's narrative task order is 1→2→3→4→5→6; actual commit order is 1→4→2→3→5→6.
2. **`__resetInitializedForTest` helper added** — plan doesn't specify; added to mirror debounceBuckets's test-helper pattern. Pure additive; no production-code footprint.
3. **New reminderService.test.ts file created** — plan said "add a single case to `src/reminders/__tests__/reminderService.test.ts` if a suite already exists; if not, add to 41-03's approvalHandler spec as a smoke test." No suite existed (directory had only `reminderParser.ts` + `reminderScheduler.ts` + `reminderService.ts`, no `__tests__/`). Adding a case to approvalHandler's spec for a completely different module under test would have been weird; I created the new suite (3 cases) which sets up a proper home for future reminderService testing. This is more useful than a one-off inline in an unrelated spec.

## Issues Encountered

- **Predecessor agent rate-limited mid-plan** — previous executor landed Task 1 (`a89523b`) and then died; its uncommitted Task 2 reminderService dual-write edit was reported as discarded. Resumption protocol: checked `git log` + `git show a89523b --stat` to confirm the commit covered only the module (77 lines, 1 file) with no test coverage, then continued from Task 2.
- **tsc --noEmit pre-existing rootDir warnings** — unchanged from Plan 41-03. `cli/bot.ts` + `cli/commands/persona.ts` still fail the `rootDir = src/` constraint. Logged in `deferred-items.md` from Plan 41-01. New Plan 41-04 files produce zero new tsc errors.
- **15 pre-existing unrelated vitest failures** — per the continuation notes, ignored. Approval + reminders suites stay clean.
- **`.planning/` gitignored** — SUMMARY.md + REQUIREMENTS.md + ROADMAP.md edits committed with `git add -f` via the metadata commit step.

## Self-Check: PASSED

- FOUND: `src/approval/expiryScan.ts` (committed in `a89523b`)
- FOUND: `src/approval/approvalInit.ts` (committed in `681c57a`)
- FOUND: `src/approval/__tests__/expiryScan.test.ts` (committed in `e397949`)
- FOUND: `src/approval/__tests__/approvalInit.test.ts` (committed in `e397949`)
- FOUND: `src/reminders/__tests__/reminderService.test.ts` (committed in `e397949`)
- MODIFIED: `src/db/queries/settings.ts` (committed in `2ff7103`)
- MODIFIED: `src/reminders/reminderService.ts` (committed in `334f38a`)
- MODIFIED: `src/index.ts` (committed in `f324ca0`)
- FOUND: commit `a89523b` (Task 1 — predecessor agent)
- FOUND: commit `2ff7103` (Task 4 settings DEFAULTS)
- FOUND: commit `334f38a` (Task 2 dual-write)
- FOUND: commit `681c57a` (Task 3 approvalInit)
- FOUND: commit `f324ca0` (Task 5 index.ts wiring)
- FOUND: commit `e397949` (Task 6 vitest)
- VITEST (plan-local new files): 3 files, 20 tests, 20 passed, ~375 ms
- VITEST (full approval suite): 7 files, 81 tests, 81 passed, ~462 ms
- TSC: clean (no new errors; pre-existing cli/bot.ts + cli/commands/persona.ts rootDir noise unchanged)

## Next Phase Readiness

- **Phase 41 is code-complete.** Plan 41-05 is live verification + phase close — no source-code work; owner walks through the UX with a real WhatsApp self-chat to validate the round-trip (detect → bucket → preview → quoted-reply → approve/reject/edit → Google Tasks) on real traffic.
- **DO NOT restart PM2 here — Plan 41-05 owns the restart as a human-action checkpoint.** Current live PM2 still serves pre-Phase-41 code (dark_launch gate, no approval UX wired). First Plan 41-05 step is `pm2 restart whatsapp-bot` under owner supervision; on first boot with real sock, `initApprovalSystem` will read `v1_8_approval_digest_posted='false'` → send the digest to self-chat in whichever language the most-recent pending actionable used → enqueue every pending into its source-chat bucket → atomically flip both flags. Owner should see one digest message + N batched previews in the following ~2 min as the debounce timers fire.
- **APPR-05 + DETC-03 flipped to Complete** in REQUIREMENTS.md traceability. All Phase-41 requirements (APPR-01..05 + DETC-03) are now `[x]`.
- **Phase 42 enrichment can now hook into `resolveTitle(actionable)` (Plan 41-03) without touching user_command path** — the `source_type='user_command'` branch sidesteps enrichment by design; Phase 42 will add `if (actionable.sourceType === 'user_command') return resolveTitle(actionable);` at the enricher entry.
- **Rollback story:** if interactive mode misbehaves in prod, `setSetting('v1_8_detection_pipeline', 'dark_launch')` reverts to silent-write mode; the digest-posted flag stays `'true'` so re-enabling doesn't re-fire the digest. The expiry scan runs regardless of pipeline mode — it only cares about pending_approval rows.

---
*Phase: 41-whatsapp-approval-ux*
*Completed: 2026-04-19*

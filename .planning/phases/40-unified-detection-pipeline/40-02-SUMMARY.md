---
phase: 40-unified-detection-pipeline
plan: 02
status: complete
completed: 2026-04-19
commits:
  - f8024e8 feat(40-02): detectionRouter — Phase 40 pipeline gate
  - 391a07c feat(40-02): swap processCommitment call sites to routeDetection
  - 1a98472 test(40-02): 6 vitest cases for routeDetection gate
---

# Plan 40-02 Summary — messageHandler Wiring + Gate

**Ship status:** Complete (3 atomic commits, 6/6 tests green)

## What landed

- `src/actionables/detectionRouter.ts` (**new**, extracted from messageHandler per plan-time decision) — `routeDetection(params)` dispatches to `processDetection` (default) or `processCommitment` (legacy) based on `getSetting('v1_8_detection_pipeline')`. Lives in its own file so unit tests can import it without loading messageHandler's heavy transitive deps (voice/client.ts + ElevenLabs SDK).
- `src/pipeline/messageHandler.ts` — both existing `processCommitment` call sites swapped to `routeDetection`; direct `processCommitment` import removed (legacy path still reachable via the gate).
- `src/actionables/__tests__/detectionRouter.test.ts` — 6 vitest cases covering both gate values + null default + unknown-value safety fallback + both rejection-swallow paths.

## Deviation from plan

The plan proposed putting `routeDetection` inside `messageHandler.ts` and exporting it for tests. At implementation time this blew up — the integration test couldn't import messageHandler without loading `voice/client.ts`, which instantiates `ElevenLabsClient` at module init and fails without `ELEVENLABS_API_KEY`. Fixed by extracting `routeDetection` into `src/actionables/detectionRouter.ts`. Functional behavior is unchanged; the plan's quality_gate and must_haves are still met.

## Verification

- `tsc --noEmit`: clean (the 4 pre-existing dashboard errors documented in `deferred-items.md` remain; unrelated)
- `npx vitest run src/actionables/__tests__/detectionRouter.test.ts`: **6/6 green in 32ms**
- `npx vitest run src/commitments/__tests__/`: 9/13 green — **4 failures are pre-existing CommitmentDetectionService tests documented in `deferred-items.md`**, unchanged by this plan
- End-to-end v1.8 test sweep (74 cases): 43 actionables queries + 11 backfill + 14 detection service + 6 router → all green

## Plan-level SCs

- [x] DETC-02: Single pipeline in the default production path; split commitmentPipeline call is retired
- [x] MIGR-02: The old commitmentPipeline.ts → {reminders, todoPipeline} writes are no longer reachable by default (gate = dark_launch)
- [x] Integration test proves both routing branches (dark_launch, null default, legacy, unknown fallback, rejection swallow × 2)
- [x] No deletions (CLAUDE.md policy honored)

## What lands in production on deploy

- First boot after deploy: `initDb()` from Phase 39 runs USER_JID fixup (one-time) + posts the post-migration count log. `v1_8_detection_pipeline` setting is seeded on first read (`dark_launch`).
- From that moment on, detections in private chats go through `processDetection` → write to `actionables` with status `pending_approval`.
- The self-chat WhatsApp surface is silent — no "Commitment detected" pings fire. Items accumulate until Phase 41 ships the approval UX.

## Rollback

Flip the gate via the settings API/CLI:

```typescript
setSetting('v1_8_detection_pipeline', 'legacy');
```

The legacy split commitment→{reminders, todoTasks} path resumes immediately. No restart needed — `getSetting` is read per-call.

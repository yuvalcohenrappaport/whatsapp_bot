---
phase: 40-unified-detection-pipeline
plan: 01
status: complete
completed: 2026-04-19
commits:
  - 835a390 feat(40-01): v1_8_detection_pipeline settings default = dark_launch
  - 6382cc0 feat(40-01): unified detection pipeline — writes pending_approval actionables
  - 73d83fe test(40-01): 14 vitest cases for detectionService
---

# Plan 40-01 Summary — Unified Detection Module

**Ship status:** Complete (3 atomic commits, 14/14 tests green)

## What landed

- `src/db/queries/settings.ts` — new DEFAULTS entry `v1_8_detection_pipeline: 'dark_launch'` (accepted: `legacy | dark_launch`)
- `src/actionables/detectionService.ts` — `processDetection(params)` exported: 4 guards (master switch, self-chat skip, incoming allowlist, blocklist, pre-filter, cooldown) mirrored byte-for-byte from `commitmentPipeline.processCommitment`, then Gemini extraction, then one `createActionable` call per extracted item with `status='pending_approval'`. **Zero** Google Tasks calls, **zero** self-chat messages.
- `src/actionables/__tests__/detectionService.test.ts` — 14 vitest cases covering every guard branch, happy-path multi-item extraction, language snapshot, Gemini error/empty, race-condition cooldown guard.

## Verification

- `tsc --noEmit`: clean
- `npx vitest run src/actionables/__tests__/detectionService.test.ts`: **14/14 green in 12ms**

## Plan-level SCs

- [x] DETC-01: `pending_approval` actionables written on detection; no Google Tasks API call
- [x] DETC-02: single pipeline covers commitment + task classifications (type persists into `sourceType`)
- [x] Guards preserved byte-for-byte (inline copy with `MIRRORED FROM commitmentPipeline.ts — keep in sync` comment; identical order a–g)
- [x] Dark-launch by design — no self-chat notifications originate from this module

## Notes

- Guards were inlined rather than exported from `commitmentPipeline.ts` — cleaner boundary, keeps the legacy module untouched so the rollback gate can run it unchanged.
- `__resetCooldownsForTest()` export is test-only; production code must not call it.

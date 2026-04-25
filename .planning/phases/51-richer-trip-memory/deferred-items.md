# Deferred Items — Phase 51 Richer Trip Memory

Items discovered during execution that are out of scope for any Phase 51 plan.
Do NOT fix these as part of 51-*; file follow-up tickets.

## Pre-existing failing tests (commitments / actionables detection)

- **Discovered during:** 51-01 Task 2 full-suite regression check
- **Failing files:**
  - `src/commitments/__tests__/CommitmentDetectionService.test.ts` (4 failures)
  - `src/actionables/__tests__/detectionService.test.ts` (2 failures)
- **Verified pre-existing:** stashing the 51-01 changes reproduces the same 6
  failures on `feat/v2.1-travel-agent-design` HEAD.
- **Scope:** Unrelated to trip memory. Likely stale mocks or fixture drift from
  an earlier phase.
- **Action:** None taken. Scoped to a separate cleanup pass.

## Pre-existing TypeScript rootDir error (CLI)

- **Discovered during:** 51-01 Task 1 (`npx tsc --noEmit`)
- **Error:** `TS6059: File '/home/yuval/whatsapp-bot/cli/bot.ts' is not under 'rootDir' '/home/yuval/whatsapp-bot/src'`
- **Files affected:** `cli/bot.ts`, `cli/commands/persona.ts`
- **Root cause:** `tsconfig.json` has `rootDir: "src"` but `include` also lists `cli/**/*`.
- **Scope:** Unrelated to Phase 51 schema work. Pre-exists on main.
- **Action:** None taken. Scoped to a future tooling cleanup.

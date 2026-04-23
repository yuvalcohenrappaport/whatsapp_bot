# Phase 47 — Deferred Items

Pre-existing issues found during Phase 47 execution that are out of scope (not caused by this phase's changes). Logged per the GSD scope-boundary rule.

## Plan 47-01

### Pre-existing TS6059 rootDir errors in `cli/**/*.ts`

- **Files:** `cli/bot.ts`, `cli/commands/persona.ts` (both untracked in git)
- **Error:** `TS6059: File is not under 'rootDir' '/home/yuval/whatsapp-bot/src'. 'rootDir' is expected to contain all source files.`
- **Cause:** `tsconfig.json` has `include: ['cli/**/*']` but `rootDir: './src'`. These untracked files existed on the branch tip before Plan 47-01 began.
- **Why deferred:** Unrelated to Phase 47 scope. Should be cleaned up in a separate chore commit that either adds `cli/` to `rootDir` or moves the files under `src/`.

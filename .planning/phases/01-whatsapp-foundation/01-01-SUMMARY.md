---
phase: 01-whatsapp-foundation
plan: 01
subsystem: infra
tags: [typescript, esm, drizzle, sqlite, pm2, pino, zod, baileys]

# Dependency graph
requires: []
provides:
  - TypeScript ESM project scaffold with all dependencies
  - Drizzle ORM schema with messages and contacts tables
  - SQLite database with WAL mode and auto-migration on startup
  - PM2 ecosystem config for process management
  - Zod-validated environment config
  - Pino structured logging
affects: [01-02, 01-03, 02-01, 02-02, 02-03]

# Tech tracking
tech-stack:
  added: ["@whiskeysockets/baileys@7.0.0-rc.9", "drizzle-orm@0.45.1", "better-sqlite3@12.6.2", "pino@10.3.1", "zod@4.3.6", "dotenv@17.3.1", "tsx@4.21.0", "typescript@5.9.3", "drizzle-kit@0.31.9", "pm2@5.x"]
  patterns: [ESM with .js import extensions, Zod env validation at startup, Drizzle migrate on init, pino-pretty in dev / JSON in prod]

key-files:
  created: [package.json, tsconfig.json, src/config.ts, src/db/schema.ts, src/db/client.ts, src/index.ts, drizzle.config.ts, ecosystem.config.cjs, .gitignore, .env.example]
  modified: []

key-decisions:
  - "Upgraded to Node.js 20 via nvm (system had Node 18 which Baileys rejects)"
  - "Used Drizzle array-style index syntax (new API in 0.45) instead of deprecated object style"
  - "PM2 installed globally via npm for process management"

patterns-established:
  - "ESM imports: all local .ts imports use .js extensions"
  - "Config: Zod safeParse at module load, process.exit(1) on invalid env"
  - "DB init: migrate() called synchronously in initDb() at startup"
  - "Logging: pino with pino-pretty transport in development, raw JSON in production"

requirements-completed: [OPS-01, OPS-02]

# Metrics
duration: 5min
completed: 2026-02-22
---

# Phase 1 Plan 1: Project Scaffold Summary

**TypeScript ESM project with Drizzle + SQLite schema (messages/contacts tables), PM2 process config, and Zod-validated environment setup**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-22T10:04:58Z
- **Completed:** 2026-02-22T10:10:36Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- TypeScript ESM project compiles and runs via tsx with zero errors
- SQLite database created at data/bot.db with messages and contacts tables, composite index on (contact_jid, timestamp)
- PM2 ecosystem config verified: process starts, runs, and logs correctly
- Environment variables validated at startup via Zod schema with clear error on misconfiguration
- Directory structure ready for Baileys connection and message pipeline (next plans)

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize TypeScript ESM project with all dependencies** - `4b298f4` (feat)
2. **Task 2: Create database schema, client, config, PM2 config, and entry point** - `a33bfd3` (feat)

## Files Created/Modified
- `package.json` - ESM project config with all prod and dev dependencies, npm scripts
- `tsconfig.json` - TypeScript config extending @tsconfig/node20, ESNext module, bundler resolution
- `.gitignore` - Excludes node_modules, dist, data, .env, logs, *.db
- `.env.example` - Template for NODE_ENV, LOG_LEVEL, AUTH_DIR, DB_PATH
- `src/config.ts` - Zod-validated environment config with typed exports
- `src/db/schema.ts` - Drizzle schema: messages table (dedup by id, composite index) and contacts table
- `src/db/client.ts` - Database client with WAL mode, drizzle instance, migrate() on startup
- `src/index.ts` - Entry point: loads config, initializes DB, logs startup via pino
- `drizzle.config.ts` - Drizzle Kit config for migration generation
- `ecosystem.config.cjs` - PM2 config: tsx interpreter, auto-restart, log paths

## Decisions Made
- **Node.js 20 via nvm:** System had Node 18.19.1 which Baileys v7 hard-rejects via engine check. Installed nvm and Node 20.20.0 as default. This is a permanent requirement for the project.
- **Drizzle array-style index API:** Used `(table) => [index(...)]` instead of deprecated `(table) => ({...})` object syntax, matching Drizzle 0.45 current API.
- **PM2 global install:** Installed PM2 globally via npm (under nvm Node 20) for system-wide process management.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Upgraded Node.js 18 to Node.js 20 via nvm**
- **Found during:** Task 1 (npm install)
- **Issue:** System Node.js 18.19.1 does not meet Baileys v7 engine requirement (>=20). npm install fails with hard error from Baileys engine-requirements.js check.
- **Fix:** Installed nvm, then installed Node.js 20.20.0 LTS, set as default alias.
- **Files modified:** ~/.nvm/ (user-level, not project files)
- **Verification:** `node --version` returns v20.20.0, all npm installs succeed
- **Committed in:** 4b298f4 (Task 1 commit)

**2. [Rule 3 - Blocking] Installed PM2 globally**
- **Found during:** Task 2 (PM2 verification)
- **Issue:** PM2 was not installed on the system. Required for ecosystem.config.cjs verification and future process management.
- **Fix:** Ran `npm install -g pm2` under Node 20 nvm environment.
- **Files modified:** None (global npm package)
- **Verification:** `pm2 start ecosystem.config.cjs` succeeds, process runs online
- **Committed in:** a33bfd3 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were prerequisites for task completion. No scope creep.

## Issues Encountered
None beyond the blocking issues documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Project scaffold complete with all dependencies installed and verified
- Database schema ready for message persistence (Plan 01-02 and 01-03)
- PM2 config ready for production process management
- Directory structure includes src/whatsapp/ and src/pipeline/ for next plans
- **Note:** Node.js 20 must be active (`nvm use 20`) when running any npm/tsx/pm2 commands. The nvm default alias is set to 20, so new shells will use it automatically.

## Self-Check: PASSED

All 10 created files verified present. Both task commits (4b298f4, a33bfd3) verified in git log.

---
*Phase: 01-whatsapp-foundation*
*Completed: 2026-02-22*

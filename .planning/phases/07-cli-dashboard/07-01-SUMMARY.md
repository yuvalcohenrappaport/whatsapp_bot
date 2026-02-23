---
phase: 07-cli-dashboard
plan: "01"
subsystem: cli
tags: [commander, ink, react, pm2, drizzle, tsx]

# Dependency graph
requires:
  - phase: 03-style-learning
    provides: DB schema with contacts, groups, drafts tables
provides:
  - Commander.js CLI entry point (cli/bot.ts) with shebang and parseAsync
  - Standalone Drizzle DB client (cli/db.ts) with WAL + busy_timeout
  - Reusable Ink Table component and formatDate helper (cli/ui/Table.tsx)
  - StatusView Ink component for PM2 + DB status display (cli/ui/StatusView.tsx)
  - bot status command with PM2 programmatic API integration
  - Shell alias for bot command in ~/.bashrc
affects: [07-02, 07-03]

# Tech tracking
tech-stack:
  added: [commander@14, ink@6, react@19, pm2 (local)]
  patterns: [Commander subcommand registration via addXCommand(program), standalone CLI DB client, Ink functional components with props]

key-files:
  created:
    - cli/bot.ts
    - cli/db.ts
    - cli/commands/status.ts
    - cli/ui/Table.tsx
    - cli/ui/StatusView.tsx
  modified:
    - package.json
    - tsconfig.json

key-decisions:
  - "Static Ink render (no useApp/exit hook) for status display -- component is pure functional, Ink exits naturally after single render"
  - "PM2 installed as local dependency for programmatic API -- global pm2 not importable from ESM modules"

patterns-established:
  - "CLI subcommand pattern: export addXCommand(program) function, register in cli/bot.ts"
  - "CLI DB client: cli/db.ts uses import.meta.url for __dirname, resolves DB path relative to project root"
  - "Ink component pattern: gather all data before render, pass as props to pure functional component"

requirements-completed: [CLI-01]

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 7 Plan 1: CLI Foundation Summary

**Commander.js 14 + Ink 6 CLI with standalone DB client, reusable Table component, and `bot status` showing PM2 state + DB counts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-23T12:22:10Z
- **Completed:** 2026-02-23T12:25:20Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Working `bot status` command displaying PM2 process state (online/stopped/errored), uptime, memory, active contact count, tracked group count, and pending draft count
- Standalone CLI DB client that works without GEMINI_API_KEY, JWT_SECRET, or DASHBOARD_PASSWORD in environment
- Reusable Ink Table component and formatDate helper for future CLI commands
- Shell alias `bot` configured in ~/.bashrc for use from any directory

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create CLI DB client and reusable Ink UI components** - `6c5b90b` (feat)
2. **Task 2: Create Commander.js entry point, status command with PM2, and shell alias** - `17d97f7` (feat)

## Files Created/Modified
- `cli/bot.ts` - Commander.js entry point with shebang, version, and status subcommand registration
- `cli/db.ts` - Standalone Drizzle DB client with WAL + busy_timeout, no src/config.ts import
- `cli/commands/status.ts` - Status command using PM2 programmatic API + DB count queries
- `cli/ui/Table.tsx` - Reusable Ink table component with header/rows/widths props and formatDate helper
- `cli/ui/StatusView.tsx` - Ink component rendering colored PM2 status, uptime, memory, and DB counts
- `package.json` - Added commander, ink, react, pm2, @types/react deps; added bin and cli script
- `tsconfig.json` - Added jsx: react-jsx and cli/**/* to include array

## Decisions Made
- Used static Ink render (no useApp/exit hook) for status display -- the component is pure functional with all data passed as props, so Ink exits naturally after a single render frame. This is simpler and more reliable than managing exit() via useEffect.
- Installed PM2 as a local dependency rather than trying to import from the global installation, since ESM module resolution cannot resolve globally-installed packages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed pm2 as local dependency**
- **Found during:** Task 2 (status command implementation)
- **Issue:** PM2 was only installed globally; the CLI needs `import pm2 from 'pm2'` which requires a local installation
- **Fix:** Ran `npm install pm2` to add as local dependency
- **Files modified:** package.json, package-lock.json
- **Verification:** `import pm2 from 'pm2'` resolves correctly, status command works
- **Committed in:** 17d97f7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for PM2 programmatic API access. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CLI foundation complete with Commander entry point and subcommand registration pattern
- Plans 07-02 and 07-03 can add their commands via addXCommand(program) in cli/bot.ts
- Reusable Table component and formatDate helper available for contact/group listing commands
- CLI DB client shared across all commands

## Self-Check: PASSED

All 5 created files verified on disk. Both task commits (6c5b90b, 17d97f7) verified in git log.

---
*Phase: 07-cli-dashboard*
*Completed: 2026-02-23*

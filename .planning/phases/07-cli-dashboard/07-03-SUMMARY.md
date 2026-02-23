---
phase: 07-cli-dashboard
plan: "03"
subsystem: cli
tags: [commander, ink, drizzle, drafts, calendar, member-emails]

# Dependency graph
requires:
  - phase: 07-cli-dashboard
    provides: Commander.js entry point, standalone DB client, reusable Table component
provides:
  - Draft list/approve/reject CLI commands with partial ID matching
  - Calendar member email management (add/remove/list) per group
  - All 6 CLI commands registered in entry point
affects: [08-calendar-reminders]

# Tech tracking
tech-stack:
  added: []
  patterns: [partial UUID matching via SQL LIKE, JSON array parse/serialize for memberEmails, renderToString for one-shot Ink output]

key-files:
  created:
    - cli/commands/drafts.ts
    - cli/commands/calendar.ts
  modified:
    - cli/bot.ts

key-decisions:
  - "CLI drafts approve marks status in DB only (no WhatsApp send) -- CLI has no access to WASocket, user uses web dashboard for direct sends"
  - "Partial ID matching for draft approve/reject via SQL LIKE -- major UX win for CLI, 8-char prefix suffices"
  - "JID normalization appends @g.us if no @ present -- consistent with WhatsApp JID format"

patterns-established:
  - "Partial UUID lookup: query with LIKE id% then check for exactly 1 match, error on 0 or >1"
  - "JSON array field management: parse on read, serialize on write, case-insensitive dedup"
  - "Commander nested subcommands: parent.addCommand(child) for multi-level command hierarchy"

requirements-completed: [CLI-04, CLI-05, CLI-07]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 7 Plan 3: Draft Management & Calendar Members Summary

**Draft review workflow (list/approve/reject with partial ID match) and calendar member email management (add/remove/list per group) via CLI**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T12:27:46Z
- **Completed:** 2026-02-23T12:32:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Working `bot drafts list` command showing pending drafts with contact name, message preview, draft body preview, and creation timestamp in formatted table
- `bot drafts approve` and `bot drafts reject` with partial UUID matching (8-char prefix works), clear messaging about DB-only approve
- Full calendar member email management: add (with case-insensitive dedup), remove, and list per group with JID normalization
- All 6 CLI commands (status, contacts, groups, import, drafts, calendar) registered and accessible from entry point

## Task Commits

Each task was committed atomically:

1. **Task 1: Draft list, approve, and reject commands** - `a673bda` (feat)
2. **Task 2: Calendar member email commands and wire into entry point** - `460616b` (feat)

## Files Created/Modified
- `cli/commands/drafts.ts` - Draft list with Table component, approve/reject with partial ID lookup via SQL LIKE
- `cli/commands/calendar.ts` - Calendar members list/add/remove with JID normalization and JSON array management
- `cli/bot.ts` - Added imports and registration for addDraftsCommand and addCalendarCommand

## Decisions Made
- CLI drafts approve only marks status as 'sent' in DB, does not send via WhatsApp. The CLI has no access to the WASocket (that lives in the bot process). Clear messaging explains this to the user and suggests the web dashboard for direct sends.
- Partial ID matching uses SQL LIKE with the user-provided prefix. If exactly 1 match, proceed. If 0, error. If >1, list ambiguous matches. This is a significant UX improvement over requiring full UUIDs.
- JID normalization automatically appends @g.us when the user provides a bare group ID number, matching the WhatsApp JID format convention.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All CLI commands for Phase 7 are complete (status, contacts, groups, import, drafts, calendar)
- Calendar member email management is ready for Phase 8 calendar reminder integration
- The memberEmails JSON array is correctly managed via CLI, matching the web dashboard's behavior

## Self-Check: PASSED

All 3 created/modified files verified on disk. Both task commits (a673bda, 460616b) verified in git log.

---
*Phase: 07-cli-dashboard*
*Completed: 2026-02-23*

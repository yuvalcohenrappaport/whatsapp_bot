---
phase: 26-microsoft-todo-sync
plan: 01
subsystem: auth, api
tags: [msal, microsoft-graph, oauth2, todo, sqlite, drizzle, fastify]

# Dependency graph
requires:
  - phase: 22-calendar-detection-refactor
    provides: OAuth2 pattern (personalCalendarService.ts), settings-based token persistence
  - phase: 25-commitment-detection
    provides: Self-chat notification pattern, pre-filter pipeline pattern
provides:
  - MSAL ConfidentialClientApplication with ICachePlugin for SQLite-backed token persistence
  - Graph API service for To Do list and task CRUD with retry logic
  - todoTasks DB table and CRUD queries
  - REST API for Microsoft OAuth flow, integrations status, task history
affects: [26-02-todo-pipeline, 26-03-dashboard-tasks]

# Tech tracking
tech-stack:
  added: ["@azure/msal-node"]
  patterns: [ICachePlugin SQLite persistence, Graph API fetch with retry, conditional MSAL init]

key-files:
  created:
    - src/todo/todoAuthService.ts
    - src/todo/todoService.ts
    - src/db/queries/todoTasks.ts
    - src/api/routes/integrations.ts
    - src/api/routes/tasks.ts
    - drizzle/0017_todo_tasks.sql
  modified:
    - src/config.ts
    - src/db/schema.ts
    - src/api/server.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "MSAL token cache persisted to SQLite settings table via ICachePlugin (not file-based)"
  - "Graph API called via native fetch (not @microsoft/microsoft-graph-client SDK)"
  - "MSAL client conditionally initialized only when all 3 MS env vars are set"
  - "isMicrosoftConnected is async (MSAL cache access requires async)"

patterns-established:
  - "ICachePlugin: beforeCacheAccess deserializes from settings, afterCacheAccess serializes if changed"
  - "Conditional service init: null client when env vars missing, graceful degradation throughout"
  - "withRetry exponential backoff for external API calls (1s, 2s, 4s, max 10s)"

requirements-completed: [TODO-01, TODO-04, TODO-05]

# Metrics
duration: 4min
completed: 2026-03-16
---

# Phase 26 Plan 01: Microsoft To Do Backend Summary

**MSAL OAuth2 auth service with ICachePlugin SQLite persistence, Graph API task CRUD with retry, todoTasks DB schema, and REST API endpoints for integrations and task history**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T16:17:16Z
- **Completed:** 2026-03-16T16:21:05Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Complete MSAL OAuth2 infrastructure with conditional init (graceful degradation when unconfigured)
- Graph API service for To Do list management and task CRUD with exponential backoff retry
- todoTasks table with status tracking, notification message ID for cancel matching, and indexes
- Six REST endpoints: OAuth flow (status, auth URL, callback, disconnect, health) plus task history (list, stats)

## Task Commits

Each task was committed atomically:

1. **Task 1: MSAL auth service, Graph API service, config, and DB schema** - `5411c30` (feat)
2. **Task 2: API routes for integrations and tasks** - `77419bf` (feat)

## Files Created/Modified
- `src/config.ts` - Added MS_CLIENT_ID, MS_CLIENT_SECRET, MS_OAUTH_REDIRECT_URI optional env vars
- `src/db/schema.ts` - Added todoTasks table definition with status and notification indexes
- `src/db/queries/todoTasks.ts` - CRUD operations: insert, get by notification, update status, paginate, count
- `src/todo/todoAuthService.ts` - MSAL ConfidentialClientApplication, ICachePlugin, OAuth lifecycle functions
- `src/todo/todoService.ts` - Graph API findOrCreateTaskList, createTodoTask, deleteTodoTask with retry
- `src/api/routes/integrations.ts` - Microsoft OAuth and connection management endpoints
- `src/api/routes/tasks.ts` - Task history and stats endpoints for dashboard
- `src/api/server.ts` - Registered integrationsRoutes and taskRoutes
- `drizzle/0017_todo_tasks.sql` - SQLite migration for todo_tasks table
- `drizzle/meta/_journal.json` - Added migration entries for 0016 and 0017

## Decisions Made
- Used async `isMicrosoftConnected()` because MSAL cache access (getAllAccounts) requires async -- differs from Google OAuth sync pattern
- Graph API called via native fetch instead of @microsoft/microsoft-graph-client SDK (avoids 1.25MB dependency for 3-4 REST calls)
- MSAL token cache stored in settings table as serialized blob via ICachePlugin (consistent with existing settings pattern, simpler than file-based)
- Module-level `connectedCache` boolean avoids repeated MSAL cache reads, refreshed on auth/disconnect
- Added missing 0016_commitment_source journal entry alongside 0017 (Rule 3 - blocking: journal was missing 0016 entry)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing 0016 journal entry**
- **Found during:** Task 1 (DB migration)
- **Issue:** drizzle/0016_commitment_source.sql existed on disk but had no entry in _journal.json
- **Fix:** Added both idx 16 and idx 17 entries to _journal.json
- **Files modified:** drizzle/meta/_journal.json
- **Committed in:** 5411c30 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary for migration journal consistency. No scope creep.

## Issues Encountered
- Pre-existing TS6059 error (cli/bot.ts not under rootDir) -- unrelated to this plan, ignored

## User Setup Required

External services require manual configuration. The plan frontmatter documents Azure AD app registration steps:
- Create app registration in Azure Portal with "Personal Microsoft accounts only" support
- Add redirect URI: `http://{API_HOST}:{API_PORT}/api/auth/microsoft/callback`
- Add API permissions: Tasks.ReadWrite, User.Read, offline_access (Microsoft Graph, Delegated)
- Set environment variables: MS_CLIENT_ID, MS_CLIENT_SECRET, MS_OAUTH_REDIRECT_URI

## Next Phase Readiness
- OAuth infrastructure ready for dashboard integrations page (Plan 26-03)
- todoService ready for pipeline integration (Plan 26-02)
- todoTasks table ready for task detection and tracking (Plan 26-02)

---
*Phase: 26-microsoft-todo-sync*
*Completed: 2026-03-16*

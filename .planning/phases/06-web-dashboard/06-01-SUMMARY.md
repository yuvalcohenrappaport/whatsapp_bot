---
phase: 06-web-dashboard
plan: "01"
subsystem: api
tags: [fastify, jwt, sse, sqlite, drizzle, rest-api, cors]

# Dependency graph
requires:
  - phase: 03-style-learning
    provides: "Drizzle DB schema (messages, contacts, drafts), query functions, config.ts env validation"
provides:
  - "Fastify REST API server co-located in bot process"
  - "JWT auth plugin with authenticate decorator"
  - "CRUD endpoints for contacts, drafts, groups, status"
  - "SSE endpoint for live connection status and QR updates"
  - "Shared in-process bot state module (connection, QR, sock)"
  - "groups table in SQLite with migration"
  - "Static file serving for React dashboard build"
affects: [06-02-PLAN, 06-03-PLAN, 06-04-PLAN]

# Tech tracking
tech-stack:
  added: [fastify, "@fastify/static", "@fastify/jwt", "@fastify/cors", fastify-plugin, "@sinclair/typebox"]
  patterns: [shared-in-process-state, sse-connection-status, jwt-query-param-for-eventsource, fastify-plugin-registration-order, spa-fallback-not-found-handler]

key-files:
  created:
    - src/api/state.ts
    - src/api/server.ts
    - src/api/plugins/jwt.ts
    - src/api/plugins/cors.ts
    - src/api/plugins/static.ts
    - src/api/routes/auth.ts
    - src/api/routes/contacts.ts
    - src/api/routes/drafts.ts
    - src/api/routes/groups.ts
    - src/api/routes/status.ts
    - src/db/queries/groups.ts
    - drizzle/0003_fat_thor_girl.sql
  modified:
    - src/db/schema.ts
    - src/db/client.ts
    - src/config.ts
    - src/index.ts
    - package.json

key-decisions:
  - "JWT secret from config.ts env validation, not hardcoded"
  - "SSE uses ?token= query param for auth since EventSource cannot send headers"
  - "Static plugin skips registration gracefully if dashboard/dist does not exist yet"
  - "Contacts DELETE is soft-delete (sets mode to off) to preserve message history"
  - "Draft approve calls sock.sendMessage directly via shared state, returns 503 if bot disconnected"

patterns-established:
  - "Fastify plugin order: cors -> jwt -> auth routes -> protected routes -> static (last)"
  - "Shared in-process state with subscribe/unsubscribe pattern for SSE push"
  - "All API routes prefixed with /api/ and guarded by fastify.authenticate except /api/auth/login"
  - "Groups stored as WhatsApp JID primary key with JSON text for member emails"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 6 Plan 1: API Backend Summary

**Fastify REST API with JWT auth, CRUD endpoints for contacts/drafts/groups, SSE live status, and shared bot state module**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T10:15:54Z
- **Completed:** 2026-02-23T10:20:05Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments
- Groups table added to SQLite schema with full Drizzle migration and CRUD query functions
- Complete Fastify REST API with 13 endpoints across 5 route files, all protected by JWT auth
- Shared in-process bot state module bridging Baileys connection events to SSE push for live dashboard updates
- Static file plugin with SPA fallback ready to serve React dashboard build (graceful skip when build not present)

## Task Commits

Each task was committed atomically:

1. **Task 1: DB schema + groups queries + config + bot state module** - `8c13bbc` (feat)
2. **Task 2: Fastify server with all plugins and routes** - `dfce334` (feat)

## Files Created/Modified
- `src/db/schema.ts` - Added groups table definition
- `src/db/client.ts` - Added busy_timeout = 5000 pragma
- `src/db/queries/groups.ts` - CRUD functions for groups (getGroups, getGroup, createGroup, updateGroup, deleteGroup)
- `src/config.ts` - Added JWT_SECRET, DASHBOARD_PASSWORD, API_PORT to Zod env schema
- `src/api/state.ts` - Shared in-process bot state (updateState, subscribe, getState, ConnectionStatus)
- `src/api/server.ts` - Fastify factory with ordered plugin/route registration
- `src/api/plugins/jwt.ts` - JWT auth plugin with authenticate decorator
- `src/api/plugins/cors.ts` - CORS plugin for Vite dev server
- `src/api/plugins/static.ts` - Static file serving with SPA fallback, ENOENT guard
- `src/api/routes/auth.ts` - POST /api/auth/login with 30-day JWT
- `src/api/routes/contacts.ts` - GET/POST/PATCH/DELETE /api/contacts with latest message joins
- `src/api/routes/drafts.ts` - GET /api/drafts with joins, PATCH approve via sock.sendMessage, DELETE reject
- `src/api/routes/groups.ts` - Full CRUD for groups
- `src/api/routes/status.ts` - GET /api/status + SSE /api/status/stream with ?token= auth
- `src/index.ts` - Wired createServer() into main(), updateState() into all connection callbacks
- `package.json` - Added fastify, @fastify/static, @fastify/jwt, @fastify/cors, fastify-plugin, @sinclair/typebox
- `drizzle/0003_fat_thor_girl.sql` - Migration to create groups table

## Decisions Made
- JWT secret sourced from config.ts Zod-validated env rather than hardcoded default -- ensures it fails fast on missing config
- SSE endpoint uses ?token= query param for JWT since EventSource API cannot send custom headers
- Static plugin checks for dashboard/dist existence at boot and skips gracefully with a warning if not found
- Contacts DELETE does soft-delete (sets mode='off') rather than row deletion to preserve message history references
- Draft approve endpoint accesses the active WASocket via shared state and returns 503 if bot is not connected

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

The following environment variables must be added to `.env` before the bot can start:

- **JWT_SECRET** - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **DASHBOARD_PASSWORD** - Choose a password for the dashboard login page
- **API_PORT** - Port for the Fastify server (default: 3000, must be open in any firewall)

## Next Phase Readiness
- All REST API endpoints are ready for the React dashboard (plan 06-02) to consume
- SSE endpoint ready for live connection status hook
- Static file serving will activate once dashboard/dist is built in plan 06-02
- Groups API is ready for the groups management UI in plan 06-03/04

## Self-Check: PASSED

All 12 created files verified present on disk. Both task commits (8c13bbc, dfce334) verified in git log.

---
*Phase: 06-web-dashboard*
*Completed: 2026-02-23*

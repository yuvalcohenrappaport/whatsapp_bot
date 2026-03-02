---
phase: 16-voice-settings-management
plan: 01
subsystem: ui
tags: [react, vite, dashboard, cli, commander, drizzle, sqlite, switch-toggle]

# Dependency graph
requires:
  - phase: 12-voice-infrastructure
    provides: voiceReplyEnabled column on contacts table, DB schema with voiceReplyEnabled
  - phase: 14-voice-message-pipeline
    provides: messageHandler reads voiceReplyEnabled from DB per message
provides:
  - PATCH /api/contacts/:jid accepts voiceReplyEnabled boolean and persists it
  - Dashboard ContactPanel Switch toggle for per-contact voice reply control
  - CLI contacts configure --voice / --no-voice flags
affects: [phase-17, voice-pipeline, messageHandler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Immediate-save-on-change pattern: Switch toggle fires PATCH immediately, no save button"
    - "Commander.js --no-* boolean inverse: --voice sets true, --no-voice sets false, absent = undefined"

key-files:
  created: []
  modified:
    - src/api/routes/contacts.ts
    - cli/commands/contacts.ts
    - dashboard/src/hooks/useContacts.ts
    - dashboard/src/components/contacts/ContactPanel.tsx

key-decisions:
  - "No new imports or query functions needed — inline drizzle update pattern handles voiceReplyEnabled just like mode/relationship/customInstructions"
  - "Switch toggle uses immediate-save-on-change pattern matching mode selector, consistent UX"
  - "Commander.js --no-* natively produces opts.voice = false when --no-voice passed, undefined when neither flag used"

patterns-established:
  - "immediate-save-on-change: UI controls fire PATCH on interaction, show toast on success"
  - "boolean CLI flags: Commander --flag / --no-flag produces true/false/undefined in opts"

requirements-completed: [CONF-01, MGMT-01, MGMT-02]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 16 Plan 01: Voice Settings Management Summary

**voiceReplyEnabled wired to dashboard Switch toggle and CLI --voice/--no-voice flags, persisting via PATCH API to existing DB column**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T13:06:06Z
- **Completed:** 2026-03-02T13:09:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- PATCH /api/contacts/:jid now accepts and persists voiceReplyEnabled boolean alongside existing fields
- Dashboard ContactPanel shows a "Voice replies" Switch toggle below Custom Instructions, fires immediately-saving PATCH on toggle with success toast
- CLI contacts configure command accepts --voice (enable) and --no-voice (disable) flags, prints voiceReplyEnabled=true/false in changed output
- Dashboard rebuilt (Vite, 551kB bundle) and bot restarted via pm2 — changes live

## Task Commits

Each task was committed atomically:

1. **Task 1: Add voiceReplyEnabled to API route and CLI configure command** - `5dfb236` (feat)
2. **Task 2: Add voice toggle to dashboard ContactPanel and rebuild** - `fc350b6` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/api/routes/contacts.ts` - PATCH body type and update logic extended with voiceReplyEnabled
- `cli/commands/contacts.ts` - --voice/--no-voice options, voice?: boolean in opts type, voiceReplyEnabled update block, updated "no options" hint
- `dashboard/src/hooks/useContacts.ts` - voiceReplyEnabled: boolean added to Contact interface; useUpdateContact mutationFn Pick type extended
- `dashboard/src/components/contacts/ContactPanel.tsx` - Switch import, voiceReplyEnabled state, handleVoiceToggle function, Switch toggle JSX section

## Decisions Made

- No new query functions or imports needed in API or CLI — inline drizzle update pattern consistent with existing fields
- Switch uses immediate-save-on-change matching mode selector pattern — no save button, consistent UX
- Commander.js --no-* boolean inverse handles opts.voice = undefined when neither flag passed, enabling safe conditional update

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript `rootDir` error for `cli/bot.ts` and `cli/commands/persona.ts` (files not under `src/`) was present before this plan and is out of scope. No new errors introduced by this plan's changes — verified by grep filtering known pre-existing error lines.

## User Setup Required

None - no external service configuration required. Toggle is immediately usable after deploy.

## Next Phase Readiness

- Phase 16 plan 01 complete — all three requirements (CONF-01, MGMT-01, MGMT-02) satisfied
- voiceReplyEnabled is now manageable from both dashboard and CLI without SSH access
- Pipeline in messageHandler.ts already reads voiceReplyEnabled from DB on each message — changes take effect immediately without bot restart
- Phase 16 is the final phase of v1.3

---
*Phase: 16-voice-settings-management*
*Completed: 2026-03-02*

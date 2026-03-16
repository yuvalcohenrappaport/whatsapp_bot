# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 26 - Microsoft To Do Sync

## Current Position

Phase: 26 of 26 (Microsoft To Do Sync)
Plan: 2 of 3
Status: Executing Phase 26
Last activity: 2026-03-16 — Plan 26-01 executed (MSAL auth service, Graph API service, DB schema, API routes)

Progress: [███████░░░] 73% (v1.5)

## Performance Metrics

**Velocity:**
- Total plans completed: 56 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 11)
- v1.4 shipped in 1 day (12 plans, 5 phases)
- v1.3 shipped in 1 day (9 plans, 5 phases)

**Cumulative (all milestones):**
- 5 milestones shipped (v1.0, v1.1, v1.2, v1.3, v1.4)
- 23 phases complete, 51 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.5]: CalendarDetectionService refactor before new features (enables code reuse)
- [v1.5]: Private chat events proposed via self-chat, not in-conversation (avoids confusing contacts)
- [v1.5]: Microsoft To Do last (external OAuth, purely additive, graceful degradation)
- [v1.5/P22]: Personal calendar uses separate Google account with OAuth2 (not GCP service account)
- [v1.5/P22]: All groups monitored for personal events, not just travel-active groups
- [v1.5/P22]: Both calendars get events when travel + personal overlap
- [v1.5/P22]: No TTL on pending events — stay until approved/rejected
- [v1.5/P22]: OAuth refresh token stored in settings table (same pattern as other config)
- [v1.5/P22]: Auth callback route unauthenticated (Google redirect, not dashboard)
- [v1.5/P22]: vitest for unit testing (native ESM TypeScript, no config overhead)
- [v1.5/P23]: Enhanced pre-filter combines digit check AND date keyword regex to minimize false Gemini calls
- [v1.5/P23]: Group personal calendar detection fires before travelBotActive guard for universal coverage
- [v1.5/P23]: Calendar approval check runs FIRST in handleOwnerCommand (before snooze/resume/draft)
- [v1.5/P23]: Unrecognized replies to calendar notifications show help text
- [v1.5/P23]: Dedup updates re-send notification so user sees latest event details
- [v1.5/P23]: Overview grid expanded to 4 columns for events stat card (violet theme)
- [v1.5/P24]: Overview grid expanded to 5 columns for reminders stat card (amber theme)
- [v1.5/P24]: Dashboard cancel triggers both cancelScheduledReminder and updateReminderStatus
- [v1.5/P24]: Lazy sock access in fireReminder (getState().sock at fire time, not schedule time)
- [v1.5/P24]: Smart routing: <24h WhatsApp, 24-72h calendar, >72h both
- [v1.5/P24]: Reminder handler after calendar approval, before snooze in handleOwnerCommand
- [v1.5/P24]: Keyword pre-filter (REMINDER_KEYWORDS_RE) before Gemini parsing
- [v1.5/P24]: initReminderSystem moved to onOpen callback (needs sock for recovery messages)
- [v1.5/P24]: Single-reminder optimization: skip Gemini call when only one pending
- [v1.5/P24]: Calendar events not deleted on cancel (v1 simplification, user deletes manually)
- [v1.5/P24]: Disambiguation uses module-level Map state, cleared on non-digit input
- [v1.5/P25]: Hebrew regex uses non-word-boundary patterns (JS \b fails with Unicode)
- [v1.5/P25]: Medium + high confidence included for commitments (calendar is high-only)
- [v1.5/P25]: Exported fireReminder from reminderService.ts for reuse (minimal change, avoids duplication)
- [v1.5/P25]: Cooldown set BEFORE async Gemini call to prevent race conditions
- [v1.5/P26]: MSAL token cache persisted to SQLite settings table via ICachePlugin (not file-based)
- [v1.5/P26]: Graph API called via native fetch (not @microsoft/microsoft-graph-client SDK)
- [v1.5/P26]: MSAL client conditionally initialized only when all 3 MS env vars are set
- [v1.5/P26]: isMicrosoftConnected is async (MSAL cache access requires async)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- CommitmentDetector prompt needs tuning for mixed Hebrew/English (Phase 25)
- Microsoft To Do requires Azure AD app registration (user setup required before OAuth flow works)

## Session Continuity

Last session: 2026-03-16
Stopped at: Completed 26-01-PLAN.md
Resume with: Continue Phase 26 — Plan 26-02 next (Gemini schema extension, To Do pipeline, cancel handler)

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** Phase 23 - Universal Calendar Detection

## Current Position

Phase: 23 of 26 (Universal Calendar Detection)
Plan: 1 of 3 (in progress)
Status: Plan 23-01 complete
Last activity: 2026-03-16 — Plan 23-01 executed (detection pipeline, dedup, schema, all-day events)

Progress: [███░░░░░░░] 30% (v1.5)

## Performance Metrics

**Velocity:**
- Total plans completed: 48 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 12, v1.5: 3)
- v1.4 shipped in 1 day (12 plans, 5 phases)
- v1.3 shipped in 1 day (9 plans, 5 phases)

**Cumulative (all milestones):**
- 5 milestones shipped (v1.0, v1.1, v1.2, v1.3, v1.4)
- 21 phases complete, 47 plans complete

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

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- CommitmentDetector prompt needs tuning for mixed Hebrew/English (Phase 25)
- Microsoft To Do requires Azure AD app registration and personal account authority URL verification (Phase 26)
- Token cache strategy for MSAL (file vs SQLite) to be decided during Phase 26

## Session Continuity

Last session: 2026-03-16
Stopped at: Completed 23-01-PLAN.md
Resume with: `/gsd:execute-phase 23` (plan 02 next)

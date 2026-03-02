---
phase: 19-itinerary-builder
plan: "02"
subsystem: calendar-pipeline
tags: [suggestion-tracker, ttl, confirm-reject, deduplication, hebrew, calendar]
dependency_graph:
  requires: [19-01]
  provides: [19-03]
  affects: [groupMessagePipeline, suggestionTracker, pendingSuggestions, calendarService]
tech_stack:
  added: []
  patterns: [module-level-map, settimeout-ttl, deduplication, suggest-then-confirm]
key_files:
  created:
    - src/groups/suggestionTracker.ts
  modified: []
decisions:
  - "Rejection is silent (no acknowledgment message sent on ❌) per locked decision"
  - "Suggestion text always in Hebrew regardless of group language per locked decision"
  - "Calendar API failure leaves suggestion alive for retry (not deleted on error)"
  - "DB row found without in-memory Map entry gets a placeholder timer that is cleared immediately on confirm/reject"
metrics:
  duration: "2m 2s"
  completed: "2026-03-02"
  tasks: 1
  files: 1
---

# Phase 19 Plan 02: suggestionTracker Module Summary

**One-liner:** Central suggest-then-confirm lifecycle module with Hebrew TTL suggestions, ✅/❌ reply routing, deduplication, and startup DB restore with adjusted timers.

## What Was Built

The `suggestionTracker.ts` module — the core of the Phase 19 itinerary builder flow. One task completed:

**suggestionTracker.ts** — A self-contained module exporting 3 functions for pipeline integration. Follows the same patterns as `tripContextManager.ts` (module-level Map, setTimeout for timers, pino logger).

Key components:
- **Module-level state:** `pendingSuggestions: Map<string, PendingSuggestion>` holds all active suggestions with timer handles.
- **`buildSuggestionText`:** Formats the Hebrew suggestion message: `📅 להוסיף 'title' ב-date? השב ✅ או ❌`
- **`isDuplicate`:** Deduplication by groupJid + title + eventDate within a 1-hour window.
- **`startTtlTimer`:** 30-minute timeout that silently removes suggestion from Map and DB.
- **`buildEventDescription`:** Builds enriched event description from suggestion fields (description, url, senderName).
- **`confirmSuggestion` (private):** Creates Google Calendar event with location, inserts calendarEvent record, sends confirmation via `buildConfirmationText`, stores `confirmationMsgId` via `updateCalendarEventConfirmation` (enables reply-to-delete compatibility). On API failure: sends Hebrew error and leaves suggestion alive for retry.
- **`createSuggestion` (export):** Dedup check → send Hebrew suggestion message → store in Map + DB with TTL timer.
- **`handleConfirmReject` (export):** Looks up suggestion by quotedMessageId (Map then DB fallback) → routes ✅ to `confirmSuggestion` → routes ❌ to silent discard (no message sent).
- **`restorePendingSuggestions` (export):** At startup, deletes already-expired DB rows, loads unexpired rows, creates adjusted TTL timers, rehydrates Map.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | 38c803d | feat(19-02): create suggestionTracker module with full suggestion lifecycle |

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

- **Silent rejection:** Per locked decision, ❌ reply results in silent discard — no acknowledgment message sent to group.
- **Hebrew-only suggestion text:** `buildSuggestionText` always formats in Hebrew regardless of group language. Confirmation text still uses `detectGroupLanguage`/`buildConfirmationText` for language-aware output.
- **Calendar API failure resilience:** If `createCalendarEvent` returns null on ✅ confirmation, suggestion is kept alive in Map/DB so the user can retry. Hebrew error message sent.
- **DB fallback for orphaned rows:** If `handleConfirmReject` finds a DB row but no Map entry (e.g. called before `restorePendingSuggestions` or after server restart without restore), a minimal `PendingSuggestion` is reconstructed from the DB row. The placeholder timer is immediately cleared by confirm/reject before it fires.

## Self-Check: PASSED

All files verified present. Task commit 38c803d verified in git log.

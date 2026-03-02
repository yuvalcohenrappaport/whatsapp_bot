# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.
**Current focus:** v1.4 Travel Agent — Phase 19: Itinerary Builder (in progress)

## Current Position

Phase: 19 of 21 (Itinerary Builder)
Plan: 3 of 3 in current phase
Status: Plan 19-03 Complete — Phase 19 Complete
Last activity: 2026-03-02 — Plan 19-03 complete (pipeline integration: handleConfirmReject wired, createSuggestion replaces direct calendar-add, restorePendingSuggestions at startup)

Progress: [█████░░░░░] 57% (v1.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 41 (v1.0: 9, v1.1: 13, v1.2: 4, v1.3: 9, v1.4: 6)
- v1.3 shipped in 1 day (9 plans, 5 phases)
- v1.2 shipped in 1 day (4 plans, 2 phases)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 17-01 | Travel search audit | 5min | 3 | 3 |
| 17-02 | Calendar extraction audit | 4min | 3 | 3 |
| 18-01 | Trip memory DB schema and FTS5 | 2min | 2 | 5 |
| 18-02 | Trip context accumulator | 3min | 2 | 2 |
| 18-03 | History search recall handler | 1min | 2 | 2 |
| 19-01 | Itinerary builder foundation | 3min | 3 | 6 |
| 19-02 | suggestionTracker module | 2min | 1 | 1 |
| 19-03 | Pipeline integration | 2m 23s | 2 | 1 |

**Cumulative (all milestones):**
- 4 milestones shipped
- 17 phases complete, 41 plans complete

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key decisions for v1.4:
- All new pipeline steps added inside existing `groupMessageCallback` in `groupMessagePipeline.ts` — never call `setGroupMessageCallback()` from a new module (silently overwrites)
- tripContexts (one row per group, upsert) vs tripDecisions (append-only typed decisions) — boundary established in Phase 18-01
- No new npm packages for Phases 17-19; zero new packages confirmed for Phases 17-20
- FTS5 migration is hand-written (0010), separate from Drizzle-generated (0009) — never run db:generate after 0010 (Drizzle will emit DROP TABLE for the virtual table) (18-01)
- Zod v4: use `z.toJSONSchema()` natively — installed `zod-to-json-schema` silently broken with Zod v4, never use it
- Gemini Maps Grounding: swap `googleSearch` tool for `googleMaps` in travelSearch.ts; keep `googleSearch` fallback path
- WhatsApp interactive buttons are Business API-only — use numbered text lists and quoted-reply confirmations instead
- Pre-filter non-travel messages in JavaScript before Gemini call — prevents cost explosion ($1-3/month with filter vs $15-40/month without)
- Proactive messages: 2-hour per-group cooldown, max 3/day/group, 90% confidence threshold, 3-8s randomized delay
- Grounding metadata URLs: cross-reference by title similarity, then fill empty URLs with unused chunks (17-01)
- Follow-up framing: augment both recentContext AND messageText for dual-path coverage (17-01)
- Pipeline guard reorder: handleReplyToDelete runs before fromMe guard so owner can delete calendar events (17-02)
- Minimal NaN date patch in dateExtractor.ts since Phase 19 rewrites the extraction flow (17-02)
- Pre-filter (hasTravelSignal) executes before debounce buffer add — non-travel messages never allocate buffer state (18-02)
- Low-confidence classifier decisions are dropped at persistence time; only high/medium inserted to tripDecisions (18-02)
- Trip debounce buffer is a module-level Map in tripContextManager.ts, completely isolated from calendar debounce in groupMessagePipeline.ts (18-02)
- history_search dispatch placed after vague check, before web search block — recall questions skip searchTravel entirely (18-03)
- handleHistorySearch uses generateText (not generateJson) since the output is conversational, not structured data (18-03)
- pendingSuggestions migration 0011 hand-written (never run db:generate after 0010 FTS5 migration) (19-01)
- Exported calendarIdCache, getCalendarIdFromLink, buildConfirmationText from groupMessagePipeline for suggestionTracker to import without duplication (19-01)
- Rejection is silent (no acknowledgment message on ❌) per locked decision (19-02)
- Suggestion text always Hebrew; confirmation text uses detectGroupLanguage/buildConfirmationText for language-aware output (19-02)
- Calendar API failure on ✅ leaves suggestion alive for retry — sends Hebrew error, does not delete (19-02)
- handleConfirmReject runs before handleReplyToDelete in the pipeline — both run before fromMe guard so owner can confirm/reject/delete (19-03)
- Direct createCalendarEvent path in processGroupMessages fully replaced by createSuggestion — Phase 19 suggest-then-confirm flow complete (19-03)

### Pending Todos

(None)

### Blockers/Concerns

- Baileys v7.0.0-rc.9 is a release candidate — monitor stability
- Platform.MACOS patch required via patch-package
- Phase 18 classifier is now live in pipeline — prompt may need tuning after real-world testing for mixed Hebrew/English accuracy
- Phase 21 proactive trigger has highest WhatsApp ban risk — must validate Phase 18 confidence calibration first

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 19-03-PLAN.md (pipeline integration: handleConfirmReject wired, createSuggestion replaces direct calendar-add, Phase 19 complete)
Resume with: /gsd:execute-phase 20 (Phase 20: Enriched Search — plan 01)
Resume file: .planning/phases/19-itinerary-builder/19-03-SUMMARY.md

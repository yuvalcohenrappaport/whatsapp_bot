---
phase: 19-itinerary-builder
verified: 2026-03-02T18:00:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 19: Itinerary Builder Verification Report

**Phase Goal:** The bot suggests calendar additions for detected activities before adding them, enriches calendar events with location and links, and routes group member replies to confirm or reject each suggestion
**Verified:** 2026-03-02
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

The four Success Criteria from ROADMAP.md and the must_haves truths across all three plans were verified against the actual codebase.

#### From ROADMAP.md Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message with a trip activity and date triggers a bot suggestion message instead of a silent calendar add | VERIFIED | `processGroupMessages` (line 233-249) calls `createSuggestion(...)` — no `createCalendarEvent` call remains in that file |
| 2 | Replying ✅ creates a Google Calendar event; replying ❌ dismisses it silently | VERIFIED | `handleConfirmReject` (lines 307-375 of suggestionTracker.ts) routes ✅ to `confirmSuggestion` (which calls `createCalendarEvent`) and ❌ to silent discard with no message sent |
| 3 | Created event contains location and description when source message includes that information | VERIFIED | `confirmSuggestion` passes `location: suggestion.location ?? undefined` and `buildEventDescription(suggestion)` to `createCalendarEvent`; `calendarService.ts` passes `location` through to the Google Calendar API requestBody |
| 4 | A suggestion expires after 30 minutes with no response — no calendar event is created | VERIFIED | `startTtlTimer` fires after `SUGGESTION_TTL_MS = 30 * 60 * 1000`; callback only calls `deletePendingSuggestion` — no calendar event created on expiry |

#### From 19-01-PLAN.md must_haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | pendingSuggestions table exists in SQLite after migration 0011 runs | VERIFIED | `drizzle/0011_pending_suggestions.sql` contains CREATE TABLE + 3 indexes; no DROP TABLE present |
| 2 | dateExtractor returns ExtractedDate with optional location, description, url fields | VERIFIED | `ExtractedDate` interface (lines 10-17 of dateExtractor.ts) includes `location?`, `description?`, `url?`; mapping at line 136 includes all three |
| 3 | createCalendarEvent accepts an optional location parameter and passes it to Google Calendar API | VERIFIED | `calendarService.ts` line 146: `location?: string;` in params type; line 161: `location: params.location` in requestBody |
| 4 | buildConfirmationText, detectGroupLanguage, getCalendarIdFromLink, calendarIdCache are importable from groupMessagePipeline | VERIFIED | All four are exported (lines 44, 55, 84, 106 of groupMessagePipeline.ts) |

#### From 19-02-PLAN.md must_haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A suggestion can be created with TTL timer and persisted to DB | VERIFIED | `createSuggestion` calls `startTtlTimer` then `insertPendingSuggestion` |
| 2 | A suggestion can be confirmed (creates calendar event + confirmation message) | VERIFIED | `confirmSuggestion` calls `createCalendarEvent`, `insertCalendarEvent`, sends confirmation via `buildConfirmationText`, calls `updateCalendarEventConfirmation` |
| 3 | A suggestion can be rejected (silent removal from Map + DB) | VERIFIED | ❌ path: `clearTimeout`, `pendingSuggestions.delete`, `deletePendingSuggestion` — no `sendMessage` call |
| 4 | An expired suggestion is silently removed after 30 minutes | VERIFIED | `startTtlTimer` callback: `pendingSuggestions.delete(id)` + `deletePendingSuggestion(id)` — no message sent |
| 5 | Pending suggestions are restored from DB on startup with adjusted remaining TTL | VERIFIED | `restorePendingSuggestions`: calls `deleteExpiredPendingSuggestions`, then `getUnexpiredPendingSuggestions`, then for each row computes `remainingMs = row.expiresAt - now` and calls `startTtlTimer(row.id, remainingMs)` |
| 6 | Duplicate suggestions for the same event are skipped | VERIFIED | `isDuplicate` checks Map for matching `groupJid + title + eventDate` within 1-hour window before proceeding |

#### From 19-03-PLAN.md must_haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message with a date triggers a suggestion message instead of a silent calendar add | VERIFIED | (same as SC#1 above) `createSuggestion` called; no `createCalendarEvent` in `processGroupMessages` |
| 2 | Replying ✅ to the suggestion creates a Google Calendar event with enriched fields | VERIFIED | (same as SC#2, SC#3 above) |
| 3 | Replying ❌ to the suggestion silently dismisses it | VERIFIED | (same as SC#2 above) |
| 4 | handleConfirmReject runs before handleReplyToDelete in the pipeline | VERIFIED | Pipeline callback lines 354-362: `handleConfirmReject` at line 358, `handleReplyToDelete` at line 362 |
| 5 | handleConfirmReject runs before the fromMe guard (owner can confirm/reject) | VERIFIED | `fromMe` guard at line 366; `handleConfirmReject` at line 358 — correct ordering confirmed |
| 6 | Pending suggestions are restored on startup via restorePendingSuggestions in initGroupPipeline | VERIFIED | `initGroupPipeline` line 385: `restorePendingSuggestions()` called after `setGroupMessageCallback` block closes at line 383 |
| 7 | Reply-to-delete still works on confirmed event confirmation messages | VERIFIED | `confirmSuggestion` calls `updateCalendarEventConfirmation(eventRecordId, sentMsgId)` — stores confirmationMsgId in DB; `handleReplyToDelete` still wired and uses `getCalendarEventByConfirmationMsgId` unchanged |

**Score:** 13/13 truths verified (4 ROADMAP Success Criteria + 9 plan-level truths with no overlap; deduplicating overlapping truths gives 13 distinct verifiable behaviors)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/schema.ts` | pendingSuggestions Drizzle table definition | VERIFIED | Lines 173-198: full table definition with all 14 columns and 3 indexes |
| `drizzle/0011_pending_suggestions.sql` | Hand-written migration for pending_suggestions table | VERIFIED | CREATE TABLE + 3 CREATE INDEX; no DROP TABLE |
| `src/db/queries/pendingSuggestions.ts` | CRUD queries for pending suggestions | VERIFIED | 52 lines; exports all 5 required functions; real DB queries (not stubs) |
| `src/groups/dateExtractor.ts` | Extended Zod schema with location/description/url and Zod v4 migration | VERIFIED | 152 lines; imports `z` from `'zod'`; uses `z.toJSONSchema()`; schema includes 3 optional enrichment fields |
| `src/calendar/calendarService.ts` | createCalendarEvent with optional location param | VERIFIED | Lines 141-194; `location?: string` in params; `location: params.location` in requestBody |
| `src/groups/suggestionTracker.ts` | Central module for pending suggestion lifecycle | VERIFIED | 419 lines (min_lines 120 satisfied); exports `createSuggestion`, `handleConfirmReject`, `restorePendingSuggestions` |
| `src/groups/groupMessagePipeline.ts` | Fully integrated suggest-then-confirm pipeline | VERIFIED | Imports and calls all three exports from suggestionTracker; `handleConfirmReject` wired in callback; `restorePendingSuggestions` in initGroupPipeline |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/db/queries/pendingSuggestions.ts` | `src/db/schema.ts` | `import { pendingSuggestions } from '../schema.js'` | WIRED | Line 3 import; used in all 5 query functions |
| `drizzle/0011_pending_suggestions.sql` | `src/db/schema.ts` | SQL matches Drizzle schema definition | WIRED | All 14 columns and 3 index names match exactly |
| `src/groups/suggestionTracker.ts` | `src/db/queries/pendingSuggestions.ts` | import DB queries | WIRED | Lines 11-16; all 5 functions imported and called |
| `src/groups/suggestionTracker.ts` | `src/calendar/calendarService.ts` | import createCalendarEvent | WIRED | Line 5 import; called in `confirmSuggestion` line 128 |
| `src/groups/suggestionTracker.ts` | `src/groups/groupMessagePipeline.ts` | import buildConfirmationText, detectGroupLanguage | WIRED | Lines 18-20 import; `detectGroupLanguage` called line 180, `buildConfirmationText` called line 181 |
| `src/groups/suggestionTracker.ts` | `src/db/queries/calendarEvents.ts` | import insertCalendarEvent, updateCalendarEventConfirmation | WIRED | Lines 7-9 import; `insertCalendarEvent` called line 158, `updateCalendarEventConfirmation` called line 192 |
| `src/groups/groupMessagePipeline.ts` | `src/groups/suggestionTracker.ts` | import createSuggestion, handleConfirmReject, restorePendingSuggestions | WIRED | Line 20 import; `createSuggestion` called line 235, `handleConfirmReject` called line 358, `restorePendingSuggestions` called line 385 |
| `processGroupMessages` | `createSuggestion` | replaces direct createCalendarEvent call | WIRED | Lines 233-249: `createSuggestion` loop with no `createCalendarEvent` call remaining |
| `initGroupPipeline` | `restorePendingSuggestions` | called at startup after setGroupMessageCallback | WIRED | Line 385: `restorePendingSuggestions()` called after closing `);` of setGroupMessageCallback on line 383 |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ITIN-01 | 19-02, 19-03 | Date extraction suggests adding to calendar before auto-adding (suggest-then-confirm via reply) | SATISFIED | `createSuggestion` replaces direct `createCalendarEvent` in `processGroupMessages`; `handleConfirmReject` routes replies |
| ITIN-02 | 19-01, 19-03 | Calendar events include location, description, and relevant links (not just title + date) | SATISFIED | `dateExtractor.ts` extracts location/description/url; `confirmSuggestion` passes them to `createCalendarEvent` and `buildEventDescription` |
| ITIN-03 | 19-02, 19-03 | User can confirm (✅) or reject (❌) a suggestion by replying to the bot's message | SATISFIED | `handleConfirmReject` checks trimmed body for ✅/❌; ✅ routes to `confirmSuggestion`, ❌ silently discards |

All three requirements are mapped to plans and implementation evidence was found for each.

---

## TypeScript Compilation

`npx tsc --noEmit` output: one error — `cli/bot.ts` is not under `rootDir` `src/`. This is a **pre-existing, unrelated issue** with the tsconfig configuration for the CLI module. It does not affect any Phase 19 code. All Phase 19 source files in `src/` compile cleanly.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/groups/suggestionTracker.ts` | 352 | `timer: setTimeout(() => {}, 0)` | Info | Intentional design: placeholder timer reconstructed from DB row, immediately cleared on confirm/reject. Comment at line 337 explains the pattern. Not a stub. |

No blockers or warnings found.

---

## Human Verification Required

### 1. Hebrew Suggestion Message Format in Live Group

**Test:** Send a WhatsApp message to a monitored group containing a date, e.g. "נפגש ב-10 באפריל ב-19:00 בביסטרו ירושלים"
**Expected:** Bot sends a reply like "📅 להוסיף 'Dinner at Bistro Jerusalem' ב-10 באפריל, 19:00, Bistro Jerusalem? השב ✅ או ❌"
**Why human:** Message formatting, Hebrew date locale rendering, and AI extraction quality cannot be verified without running the bot and sending an actual WhatsApp message.

### 2. ✅ Confirmation Flow End-to-End

**Test:** Reply ✅ to the bot's suggestion message
**Expected:** Bot creates a Google Calendar event with the title, date, location, and description; then sends a confirmation message with a calendar link; the confirmation message is reply-to-deletable
**Why human:** Requires a live Google Calendar API connection and actual WhatsApp message exchange.

### 3. ❌ Rejection Silent Discard

**Test:** Reply ❌ to the bot's suggestion message
**Expected:** No bot response, no calendar event created; suggestion disappears from the pending list
**Why human:** Silence is not verifiable programmatically — must confirm no message was sent.

### 4. 30-Minute TTL Expiry

**Test:** Send a message with a date, wait 30 minutes without responding, then reply ✅
**Expected:** Bot does not create a calendar event; suggestion is no longer in the DB
**Why human:** Requires waiting the full TTL period.

### 5. Startup Restore of Pending Suggestions

**Test:** Trigger a suggestion, restart the bot (`pm2 restart`), then reply ✅ to the old suggestion message
**Expected:** Bot confirms the suggestion and creates the calendar event
**Why human:** Requires actual process restart and WhatsApp reply.

---

## Gaps Summary

No gaps found. All must-haves are verified at all three levels (exists, substantive, wired).

---

_Verified: 2026-03-02T18:00:00Z_
_Verifier: Claude (gsd-verifier)_

# Phase 17: Pipeline Audit - Research

**Researched:** 2026-03-02
**Domain:** WhatsApp group message pipeline -- travel search and calendar date extraction
**Confidence:** HIGH (primary source: direct code reading of the production codebase)

## Summary

This research audits the existing group message pipeline by tracing every code path from incoming WhatsApp group message through to travel search output and calendar event creation/deletion. The codebase is well-structured with clear separation of concerns, error handling at every async boundary, and no TODO/FIXME/HACK comments anywhere in `src/`. The pipeline was built in Phases 8-9 and has not been heavily tested since shipping.

The two main subsystems (travel search and calendar extraction) are independent and share only the `groupMessagePipeline.ts` dispatch layer. Travel search runs immediately on @mention; calendar extraction is debounced. Both subsystems are architecturally sound but have several potential issues that need live verification, most notably: (1) URL quality from Gemini grounded search is AI-generated and may not point to correct destination pages, (2) the reply-chain follow-up for travel search depends on an in-memory Map that resets on restart, and (3) the `fromMe` handling has a subtle asymmetry where the bot's own messages skip the pipeline's `fromMe` guard but travel @mentions from the owner (who IS `fromMe`) flow through correctly.

**Primary recommendation:** Create a test script that sends synthetic messages to a test group via the bot's own socket, covering all 4 success criteria, then verify results visually on a phone.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Test environment: dedicated test group + test script + phone verification
- Fix depth: minimal patch if future phases rewrite code, proper fix if code stays
- Large bugs: surface and ask per case
- Error paths: happy path must work; errors just need graceful fail
- Follow-up trigger: quoted reply only
- Follow-up types: refinements, pivots, more results -- all should work via quoted reply
- Calendar delete: verify whatever's currently built
- Plans are independent (travel search and calendar)

### Claude's Discretion
(None specified -- all decisions locked in CONTEXT.md)

### Deferred Ideas (OUT OF SCOPE)
(None captured -- discussion stayed within phase scope)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUDIT-01 | Travel search returns correct results with working URLs and follow-up reply chains | Full travel pipeline traced: travelHandler.ts dispatches to travelParser.ts (Gemini intent parsing), travelSearch.ts (grounded search + fallback), travelFormatter.ts. Reply chain uses in-memory Map keyed by bot message ID. Potential issues identified in URL quality and follow-up context injection. |
| AUDIT-02 | Calendar date extraction correctly identifies dates, creates events, and handles reply-to-delete | Full calendar pipeline traced: dateExtractor.ts (Gemini structured output with high-confidence filter), calendarService.ts (Google Calendar API), groupMessagePipeline.ts (reply-to-delete via confirmation message ID lookup). Delete triggers are "delete", "מחק", or cross emoji. DB schema and queries verified correct. |
</phase_requirements>

## Task 1: Group Message Pipeline Map

### Entry Point

All messages enter via `messageHandler.ts:processMessage()`. Group messages (JID ending `@g.us`) are routed through a callback registered by `initGroupPipeline()` in `groupMessagePipeline.ts`.

### Pipeline Callback Flow (in order)

```
incoming group message
  |
  v
messageHandler.ts:processMessage()
  |-- extracts: text, remoteJid, fromMe, timestamp
  |-- checks: is group JID? is tracked + active group?
  |-- extracts: quotedMessageId (from extendedTextMessage.contextInfo.stanzaId)
  |-- extracts: mentionedJids (from extendedTextMessage.contextInfo.mentionedJid)
  |
  |-- if fromMe: invokes groupMessageCallback but does NOT persist to groupMessages table
  |-- if !fromMe: persists to groupMessages table, THEN invokes groupMessageCallback
  |
  v
groupMessagePipeline callback (registered in initGroupPipeline)
  |
  |-- Step 1: handleTravelMention(groupJid, msg, quotedMessageId, mentionedJids)
  |     Returns true if handled (terminal) --> stops pipeline
  |
  |-- if msg.fromMe: return (skip steps 2-4 for bot's own messages)
  |
  |-- Step 2: handleKeywordRules(groupJid, msg)
  |     Non-terminal: always continues to next steps
  |
  |-- Step 3: handleReplyToDelete(groupJid, msg, quotedMessageId)
  |     Returns true if handled (terminal) --> stops pipeline
  |
  |-- Step 4: addToDebounce(groupJid, msg) --> 10s debounce --> processGroupMessages()
  |     Batch calendar date extraction
```

### Key Observations

1. **Travel @mention runs first and is terminal.** If the bot is mentioned, no other processing happens.
2. **fromMe messages only go through travel handler.** The `if (msg.fromMe) return;` guard at line 411 means the bot owner's messages (which are `fromMe: true` since the bot runs on the owner's account) skip keyword rules, reply-to-delete, AND calendar date extraction. This is intentional to avoid bot self-triggering, but means:
   - The owner's date-containing messages are NOT extracted for calendar events
   - The owner cannot trigger reply-to-delete
3. **fromMe messages DO pass through travel handler.** The owner can @mention the bot for travel search. This is correct and intentional (line 264-273 in messageHandler.ts).
4. **quotedMessageId extraction** uses `extendedTextMessage.contextInfo.stanzaId`. This is the standard Baileys v7 approach. However, if a message is a plain `conversation` (not `extendedTextMessage`), then `quotedMessageId` will be `null` even if the user somehow quoted a message. In practice, WhatsApp always wraps quoted replies as `extendedTextMessage`, so this is fine.
5. **mentionedJids extraction** also from `extendedTextMessage.contextInfo.mentionedJid`. Same caveat: plain `conversation` messages won't have mentions. But WhatsApp wraps @mentions as `extendedTextMessage` too.

### Debounce Behavior

The debounce buffer collects messages per group for 10 seconds. Each new message resets the timer. After 10s of silence, the batch is processed for date extraction. This means:
- A rapid burst of messages is processed together (efficient)
- There is always a 10s delay before calendar events are created
- If messages keep coming, the buffer can grow indefinitely (no max size)

**Potential issue:** No cap on buffer size. In a very active group, messages could accumulate for a long time if there is never a 10s gap. In practice, this is unlikely to cause problems because groups rarely have truly continuous messages with no pause.

### @Mention Detection (travelHandler.ts:isBotMentioned)

```typescript
function isBotMentioned(body, mentionedJids, botJid) {
  // 1. Native @mention: match on numeric prefix (handles @s.whatsapp.net vs @lid)
  const botNumericPrefix = botJid.split('@')[0];
  const jidMatches = mentionedJids.some(jid => jid.split('@')[0] === botNumericPrefix);
  if (jidMatches) return true;

  // 2. Text fallback: "@bot" or "בוט" in message body
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes('@bot') || lowerBody.includes('בוט')) return true;

  return false;
}
```

**Potential issue:** The text fallback `'בוט'` will match any message containing that word, even without an @mention. This could cause false positives in Hebrew groups where someone mentions "בוט" in passing. Low risk for audit since travel detection requires the message to also be travel-related (Gemini filters non-travel), but worth noting.

**Potential issue:** The numeric prefix matching handles the LID format mismatch (comment says "Baileys v7 RC pitfall"). This is correct -- Baileys v7 RC uses different JID formats (`@s.whatsapp.net` vs `@lid`). The numeric prefix comparison is the right approach.

## Task 2: Travel Search Code Audit

### travelParser.ts -- Intent Parsing

- Uses `generateJson` (Gemini structured output with Zod schema + JSON schema)
- Schema: `TravelIntentSchema` with fields: isTravelRelated, isVague, clarificationQuestion, queryType, searchQuery, destination, dates, budget, preferences
- System prompt includes `recentGroupContext` for context-aware parsing
- Returns `null` on any error -- never crashes pipeline

**No issues found.** Clean error handling, Zod validation, typed output.

### travelSearch.ts -- Search Execution

- **Primary:** `geminiGroundedSearch()` -- uses `@google/genai` v1.42.0 with `tools: [{ googleSearch: {} }]`
- **Fallback:** `knowledgeFallback()` -- uses generic `generateText` (no grounding tools, just AI knowledge)
- Returns `{ results: SearchResult[], isFallback: boolean }`

**Critical finding -- URL quality concern:**

The grounded search asks Gemini to "Find exactly 3 results" and return a JSON array with `title, url, snippet, price`. The URLs come from Gemini's interpretation of grounded search results, NOT directly from the search grounding metadata. Specifically:

```typescript
const response = await ai.models.generateContent({
  model: config.GEMINI_MODEL,
  contents: [{ role: 'user', parts: [{ text: '...' }] }],
  config: { tools: [{ googleSearch: {} }] },
});
```

The code reads `response.text` and parses it as JSON. It does NOT read `response.candidates[0].groundingMetadata.groundingChunks` which contain the actual URLs from Google Search. This means:

1. **URLs are AI-generated text**, not extracted from grounding metadata
2. Gemini may hallucinate URLs or provide malformed/outdated URLs
3. URLs may not resolve (404) or may point to generic homepages rather than specific destination pages
4. The `response.text` approach is fragile -- requires JSON parsing with fallback regex extraction

**This is the most likely source of URL quality issues** and directly impacts Success Criterion 1.

**Fallback behavior:** Knowledge fallback returns empty URLs (`url: ''`), so fallback results display without links. The formatter handles this gracefully (line 57-59 in travelFormatter.ts).

**JSON parsing resilience:** The code handles three cases:
1. Clean JSON array
2. JSON wrapped in markdown code fences (stripped)
3. Prose with embedded JSON array (regex extraction)

This is reasonable defensive coding.

### travelFormatter.ts -- Result Formatting

- Formats results as numbered cards with title, price, snippet, URL
- Handles both grounded (with URLs) and fallback (without URLs) results
- Language-aware (Hebrew/English)
- Includes a `formatHelpText` for non-travel @mentions

**No issues found.** Clean formatting, handles edge cases.

### travelHandler.ts -- Handler/Dispatch

The handler manages:
1. **Bot mention detection** (native @mention or text fallback)
2. **Reply chain follow-up detection** (quoted reply to a previous travel result)
3. **Rate limiting** (30s cooldown per group)
4. **"Searching..." indicator** (immediate user feedback)
5. **Recent context gathering** (last 2 hours, 20 messages from DB)
6. **Intent parsing** via travelParser
7. **Search execution** via travelSearch
8. **Result storage** for reply chain follow-ups

**Reply chain mechanism:**

```typescript
export const travelResultMessages = new Map<string, { query, results, groupJid }>();
const TRAVEL_RESULT_MAP_MAX = 500;
```

- In-memory Map keyed by bot's sent message ID
- Stores original query and formatted results text
- Capped at 500 entries (FIFO eviction)
- **Resets on restart** -- documented as intentional ("follow-up replies fall through to clarification naturally")

**Follow-up context injection:**

When a reply to a travel result is detected, the handler prepends the original query and results to the `recentContext`:

```typescript
if (priorContext) {
  recentContext =
    `Previous search query: ${priorContext.query}\n` +
    `Previous results:\n${priorContext.results}\n\n` +
    `User follow-up: ${msg.body}\n\n` + recentContext;
}
```

This context is passed to `parseTravelIntent()`, which instructs Gemini to "Consider the recent group context." The follow-up is then parsed as a new travel intent and searched fresh.

**Potential issue:** Follow-ups go through full intent parsing. If Gemini parses "show cheaper" as `isVague: true` or `isTravelRelated: false`, the follow-up will show a clarification question or help text instead of refining the search. The system prompt tells Gemini to consider context, but it does not explicitly tell it "this is a follow-up to a previous search."

**Potential issue:** The reply chain only works for direct replies to the bot's result message. If someone replies to the "Searching..." message instead of the results message, it will NOT be detected as a follow-up. This is correct behavior per context decisions (quoted reply only).

**Rate limiting:** 30s cooldown per group. A rate-limited message sends a "please wait" text and returns `true` (terminal). This means rate-limited messages are NOT passed to the calendar pipeline. This is correct -- the user should retry.

**State after vague intent:** When `isVague === true`, the bot sends a clarification question but does NOT store the message ID for follow-up. This means replying to the clarification question will NOT trigger a follow-up search. The user must send a new @mention with more details. This is acceptable behavior.

## Task 3: Calendar Extraction Code Audit

### dateExtractor.ts -- Date Parsing

- Uses `generateJson` (Gemini structured output with Zod schema)
- Schema: array of `{ title, date (ISO 8601), confidence ('high'|'medium'|'low') }`
- Pre-filter: `hasNumberPreFilter()` checks for any digit character
- Only returns high-confidence results
- System prompt includes current ISO date and timezone (Asia/Jerusalem)

**Potential issue:** The pre-filter checks for ANY digit. Messages like "I have 2 kids" pass the filter and hit Gemini. This is by design (comment: "We do NOT use chrono-node because it doesn't support Hebrew"). Cost-effective because Gemini returns empty for non-date messages. Only high-confidence dates are used, so false positive extraction is low.

**Potential issue:** The `date` field is an ISO 8601 string. The code does `new Date(d.date)`. If Gemini returns an invalid date string, `new Date()` produces `Invalid Date` rather than throwing. This would create a calendar event with an invalid date. The Zod schema validates it's a string but does not validate it's a valid date.

**Potential issue:** The system prompt says "Asia/Jerusalem timezone" but Gemini returns ISO 8601 strings like `2026-04-15T09:00:00`. If the string lacks a timezone offset, `new Date()` parses it as UTC, which is 2-3 hours off from Israel time. The calendar event creation then passes `toISOString()` (always UTC) with `timeZone: 'Asia/Jerusalem'`, which should handle the conversion. But if Gemini returns a timezone-naive string, the date could be off.

### calendarService.ts -- Google Calendar API

- Uses `googleapis` v171 with service account JWT auth
- Lazy initialization (first call triggers auth)
- `createCalendarEvent()`: 1-hour default duration, `Asia/Jerusalem` timezone
- `deleteCalendarEvent()`: simple delete by calendarId + eventId
- `createGroupCalendar()`: creates calendar and returns embed link
- `shareCalendar()`: shares with member emails (reader access)

**No issues found.** Clean implementation, proper error handling, null returns on failure.

### groupMessagePipeline.ts -- Calendar Pipeline

The `processGroupMessages()` function processes the debounced batch:

1. For each message: pre-filter (digits), then extractDates via Gemini
2. Ensure group has a calendar (lazy creation, cached in memory)
3. Create calendar event for each extracted date
4. Send confirmation message with calendar link
5. Store confirmation message ID for reply-to-delete lookup

**Confirmation message format:**
- Hebrew: `קלטתי! הוספתי {title} ב{dateStr} ללוח השנה\n{calendarLink}`
- English: `Got it! Added {title} on {dateStr} to the calendar\n{calendarLink}`
- Date format: `en-IL` locale with weekday, month, day, hour, minute in `Asia/Jerusalem` timezone

### Reply-to-Delete Mechanism

```typescript
function isDeleteTrigger(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed === 'delete' || trimmed === 'מחק' || body.trim() === '❌';
}
```

**Delete triggers:** "delete", "מחק", or the cross emoji (case-insensitive, trimmed).

**Flow:**
1. Check if message has `quotedMessageId`
2. Look up `calendarEvents` table by `confirmationMsgId === quotedMessageId`
3. If found and body is a delete trigger:
   - Delete from Google Calendar API
   - Delete record from DB
   - Send confirmation: "Deleted: {title}" / "נמחק: {title}"

**Potential issue:** The `fromMe` guard in the pipeline callback (line 411) blocks reply-to-delete for the bot owner's messages. If the owner replies "delete" to a confirmation message, it goes through `handleTravelMention` first (which returns false since it is not a travel @mention or reply to a travel result), then hits the `if (msg.fromMe) return;` guard and NEVER reaches `handleReplyToDelete`. **This means the owner cannot delete calendar events via reply-to-delete.**

**However:** Non-owner group members CAN delete events. Their messages are not `fromMe`, so they flow through the full pipeline.

**Severity:** Medium. The owner is the most likely person to want to delete events. But this is also the person who has direct access to the bot and Google Calendar, so there are workarounds.

### DB Schema for Calendar Events

```sql
calendar_events:
  id TEXT PRIMARY KEY          -- UUID
  group_jid TEXT NOT NULL
  message_id TEXT NOT NULL     -- triggering message
  calendar_id TEXT NOT NULL    -- Google Calendar ID
  calendar_event_id TEXT NOT NULL  -- Google event ID
  confirmation_msg_id TEXT     -- bot's WhatsApp confirmation message ID (nullable)
  title TEXT NOT NULL
  event_date INTEGER NOT NULL  -- Unix ms
  created_at INTEGER NOT NULL

  INDEX: idx_calendar_events_confirmation ON (confirmation_msg_id)
  INDEX: idx_calendar_events_group ON (group_jid)
```

**No issues found.** Schema is correct, indexed on the fields used for lookups.

## Task 4: Potential Bugs Identified

### Bug 1: URL Quality -- AI-Generated URLs (HIGH PRIORITY)

**Location:** `travelSearch.ts:geminiGroundedSearch()`
**What:** URLs in search results are extracted from Gemini's text response, not from grounding metadata
**Risk:** URLs may be hallucinated, broken (404), or point to wrong pages
**Impact:** Directly affects Success Criterion 1
**Fix approach:** Either extract URLs from `response.candidates[0].groundingMetadata.groundingChunks` (proper fix), or add URL validation post-search (minimal patch)
**Future overlap:** Phase 20 will swap `googleSearch` for `googleMaps` tool in travelSearch.ts AND update result formatting. **The entire travelSearch.ts will be rewritten in Phase 20.**
**Recommendation:** Minimal patch -- try extracting from grounding metadata first, fall back to text-parsed URLs.

### Bug 2: Owner Cannot Reply-to-Delete (MEDIUM PRIORITY)

**Location:** `groupMessagePipeline.ts` line 411 -- `if (msg.fromMe) return;`
**What:** The `fromMe` guard blocks the owner from reaching the reply-to-delete handler
**Risk:** Owner's "delete"/"מחק"/"❌" replies to confirmation messages are silently ignored
**Impact:** Affects Success Criterion 4 if testing from the owner's phone
**Fix approach:** Move the `fromMe` guard to AFTER `handleReplyToDelete`, or add a specific `fromMe` check inside `handleReplyToDelete`
**Future overlap:** Phase 19 modifies the pipeline to add suggest-then-confirm flow, which will change this area. But the `fromMe` guard logic will likely persist.
**Recommendation:** Proper fix -- reorder the guards so reply-to-delete runs before the fromMe check. Small, surgical change.

### Bug 3: Follow-Up Context May Confuse Intent Parser (LOW PRIORITY)

**Location:** `travelHandler.ts` lines 179-186
**What:** Follow-up context is prepended to `recentContext` but the intent parser is not explicitly told "this is a follow-up"
**Risk:** Gemini may parse "show cheaper" as `isTravelRelated: false` or `isVague: true`
**Impact:** Affects Success Criterion 2 -- follow-ups might return help text instead of refined results
**Fix approach:** Add explicit follow-up framing in the system prompt or user content when `priorContext` exists
**Future overlap:** Phase 18 adds `history_search` queryType to travelParser -- the parser will be modified. But the follow-up framing fix would be in travelHandler, not travelParser.
**Recommendation:** Minimal patch -- add a sentence to the user content like "This is a follow-up to a previous search. The user is refining/continuing their search." when `priorContext` is set.

### Bug 4: Invalid Date from Gemini (LOW PRIORITY)

**Location:** `dateExtractor.ts` line 100-103
**What:** `new Date(d.date)` may produce `Invalid Date` if Gemini returns a malformed ISO string
**Risk:** Calendar event creation with `Invalid Date` would either fail at Google Calendar API (graceful) or create a broken event
**Impact:** Low -- Gemini structured output with schema enforcement rarely produces invalid dates
**Fix approach:** Add `isNaN(date.getTime())` check after `new Date()`
**Future overlap:** Phase 19 modifies dateExtractor.ts for suggest-then-confirm flow.
**Recommendation:** Minimal patch -- add a one-line validation.

### Bug 5: Timezone Ambiguity in Date Extraction (LOW PRIORITY)

**Location:** `dateExtractor.ts` + `calendarService.ts:createCalendarEvent()`
**What:** Gemini may return timezone-naive ISO strings. `new Date('2026-04-15T09:00:00')` parses as UTC. The calendar API receives `toISOString()` (UTC) with `timeZone: 'Asia/Jerusalem'`, which should correctly interpret it.
**Risk:** The Google Calendar API `start.dateTime` with `timeZone` should override the UTC interpretation. But if the ISO string already has a `Z` suffix, the timeZone hint is ignored and the event is created at UTC time.
**Impact:** Events could be 2-3 hours off
**Fix approach:** Ensure the date string passed to Calendar API does NOT have a `Z` suffix, or append the Israel timezone offset
**Future overlap:** Phase 19 modifies this area.
**Recommendation:** Verify during testing. If events are off by 2-3 hours, apply minimal fix.

### Non-Bug Observations

- **No TODO/FIXME/HACK comments** anywhere in `src/`
- **No dead code paths** detected -- all functions are imported and used
- **No race conditions** -- travel handler is synchronous per message (not batched), calendar extraction is batched but processes sequentially within a batch
- **Error handling is thorough** -- every async boundary has try/catch, errors are logged, pipeline continues
- **In-memory state** (travelResultMessages, calendarIdCache, debounceBuffers) all reset on restart. This is documented and acceptable.

## Task 5: Future Phase Overlap Map

### Modules Touched by Phases 18-21

| Module | Phase 18 | Phase 19 | Phase 20 | Phase 21 | Fix Depth |
|--------|----------|----------|----------|----------|-----------|
| `travelParser.ts` | Yes (adds `history_search` queryType) | No | No | No | Minimal patch |
| `travelSearch.ts` | No | No | Yes (swaps googleSearch for googleMaps) | No | **Minimal patch** |
| `travelHandler.ts` | Yes (dispatch for history_search) | No | No | No | Minimal patch |
| `travelFormatter.ts` | No | No | Yes (5/3 counts, rating/hours) | No | Proper fix (not rewritten, extended) |
| `dateExtractor.ts` | No | Yes (suggest-then-confirm, enriched schema) | No | No | Minimal patch |
| `calendarService.ts` | No | Yes (enriched event fields) | No | No | Proper fix (API layer stays) |
| `groupMessagePipeline.ts` | Yes (step [3.5] context accumulator) | Yes (suggest-then-confirm flow) | No | No | **Reorder fix for fromMe is safe** |
| `keywordHandler.ts` | No | No | No | No | Not in audit scope |
| `messageHandler.ts` | No | No | No | No | No changes needed |

### Fix Depth Recommendations

Based on the overlap:

1. **Bug 1 (URL quality):** travelSearch.ts will be **fully rewritten** in Phase 20. Apply **minimal patch** -- extract from grounding metadata if available, keep current text parsing as fallback.
2. **Bug 2 (fromMe guard):** groupMessagePipeline.ts will be modified in Phases 18-19, but the `fromMe` guard logic is structural and will likely persist. Apply **proper fix** (reorder guards).
3. **Bug 3 (follow-up context):** travelHandler.ts will be modified in Phase 18. Apply **minimal patch** (add framing text).
4. **Bug 4 (invalid date):** dateExtractor.ts will be modified in Phase 19. Apply **minimal patch** (one-line validation).
5. **Bug 5 (timezone):** Verify during testing first. If needed, apply **minimal patch**.

## Task 6: Existing Tests

### Test Files Found

- `scripts/test-voice.ts` -- Voice service integration test (TTS + STT round-trip). Not relevant to this phase.
- `scripts/enable-voice-test.mjs` -- DB utility script for enabling voice on a test contact. Not relevant.

### No Travel or Calendar Tests Exist

There are **no existing test files** for:
- Travel search
- Calendar date extraction
- Reply-to-delete
- Reply chain follow-ups
- Group message pipeline

The `package.json` test script is a placeholder: `"test": "echo \"Error: no test specified\" && exit 1"`

### Test Infrastructure Available

- The bot uses `tsx` for running TypeScript directly
- Scripts directory exists at `/home/yuval/whatsapp-bot/scripts/`
- The voice test script (`test-voice.ts`) provides a pattern for writing test scripts that import bot modules directly
- The bot's socket is available via `getState().sock` for sending messages programmatically

### Test Script Approach (for planner)

A test script should:
1. Import the bot's socket from `getState()`
2. Send synthetic WhatsApp messages to a test group
3. Listen for bot responses (subscribe to message events or poll DB)
4. Assert response content matches expectations
5. For URL testing: HTTP HEAD request to verify URLs resolve

The script cannot easily mock Gemini -- it needs live API calls. This means tests are integration tests, not unit tests.

## Architecture Patterns

### Pipeline Dispatch Pattern

The group message pipeline uses a **sequential filter chain** pattern:
1. Each handler returns `true` (terminal, handled) or `false` (pass to next)
2. Terminal handlers stop the chain
3. Non-terminal handlers (keywordHandler) run but always continue

This is the correct pattern for the audit -- any fixes should preserve this dispatch order.

### In-Memory Caching Pattern

Several components use in-memory Maps with restart-safe degradation:
- `travelResultMessages` (500 cap, FIFO eviction)
- `calendarIdCache` (no cap, grows with groups)
- `debounceBuffers` (per-group, auto-cleanup after debounce fires)
- `lastRequestTime` (per-group rate limit)

All are intentionally ephemeral and degrade gracefully to "not found" behavior.

### Error Boundary Pattern

Every async function in the pipeline wraps its body in try/catch and returns a safe default (null, empty array, false) on error. This means the pipeline never crashes -- it just skips the failed step. Errors are logged at appropriate levels (warn for expected failures, error for unexpected).

## Sources

### Primary (HIGH confidence)
- Direct code reading of all files in `src/groups/`, `src/calendar/`, `src/pipeline/`, `src/ai/`
- DB schema from `src/db/schema.ts`
- DB queries from `src/db/queries/calendarEvents.ts`, `src/db/queries/groupMessages.ts`
- Package.json for dependency versions
- ROADMAP.md for future phase plans

### Secondary (MEDIUM confidence)
- `@google/genai` grounding metadata structure -- based on training data knowledge of the Gemini API. The claim that `response.candidates[0].groundingMetadata.groundingChunks` contains URLs should be verified during implementation.

## Metadata

**Confidence breakdown:**
- Pipeline flow mapping: HIGH -- direct code reading, every line traced
- Bug identification: HIGH -- identified through code path analysis
- URL quality concern: MEDIUM -- hypothesis based on how grounded search works, needs live verification
- Timezone concern: LOW -- theoretical; may not manifest in practice
- Future phase overlap: HIGH -- based on ROADMAP.md plan descriptions

**Research date:** 2026-03-02
**Valid until:** 2026-03-16 (code is stable, no active development between phases)

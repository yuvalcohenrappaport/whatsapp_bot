# Phase 19: Itinerary Builder - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

The bot suggests calendar additions for detected activities before adding them, enriches calendar events with location and links, and routes group member replies to confirm or reject each suggestion. This fully replaces the current silent calendar-add behavior in dateExtractor.ts.

</domain>

<decisions>
## Implementation Decisions

### Suggestion message format
- Always in Hebrew (all target groups are Hebrew-speaking)
- One suggestion per detected event (multiple events in one message produce multiple suggestion messages)
- Minimal detail: title + date + time (if available) + location (if detected, appended)
- Example: "📅 הוסיף 'ארוחת ערב באיסרוטל' ב-15 באפריל, אילת? השב ✅ או ❌"
- No rich previews or verbose formatting — keep group chat clean

### Confirmation and rejection UX
- Anyone in the group can confirm (✅) or reject (❌) — trip planning is collaborative
- Detection method: quoted-reply to the bot's suggestion message with ✅ or ❌ (consistent with existing reply-to-delete pattern)
- Silent rejection: bot removes suggestion from tracking, no acknowledgment message sent
- Confirmation triggers calendar event creation and sends the standard confirmation message (same format as current auto-add confirmations)

### Expiry and persistence
- 30-minute TTL per suggestion — silent expiry (no notification to group)
- DB persistence: pending suggestions saved to a table, restored on bot restart with remaining TTL
- No concurrency limit on pending suggestions per group

### Replacing existing calendar flow
- Phase 19 fully replaces dateExtractor's silent-add with suggest-then-confirm for all cases
- Reply-to-delete still works on confirmed events (confirmation message uses the same format, so existing handleReplyToDelete works automatically)
- The existing dateExtractor Zod schema is extended with optional location/description/url fields — not replaced

### Claude's Discretion
- Exact DB table schema for pending suggestions (columns, indexes)
- How to handle edge cases: duplicate suggestions for the same event, rapid-fire messages
- TTL timer implementation details (setInterval vs per-suggestion setTimeout)
- Error handling for Google Calendar API failures during confirmation

</decisions>

<specifics>
## Specific Ideas

- Confirmation message reuses existing format so reply-to-delete works without changes
- Quoted-reply pattern is already established in the codebase (reply-to-delete in travelHandler) — follow the same detection approach
- The suggestionTracker should be a module-level Map like tripContextManager's debounce buffer — same pattern, proven in production

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-itinerary-builder*
*Context gathered: 2026-03-02*

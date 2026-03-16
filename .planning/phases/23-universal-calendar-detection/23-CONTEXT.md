# Phase 23: Universal Calendar Detection - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire CalendarDetectionService (from Phase 22) into both private and group message pipelines. Detect date/event mentions in any chat, propose events via self-chat with suggest-then-confirm flow, and create confirmed events in the user's personal Google Calendar. Dashboard shows pending events for management.

</domain>

<decisions>
## Implementation Decisions

### Detection scope
- **Context-aware detection** — catch explicit dates ("March 20th at 3pm"), relative references ("tomorrow at 3"), and contextual mentions ("let's meet for coffee next week")
- Vague dates without specific time → create **all-day events** (user can edit in Google Calendar)
- Detect from **all contacts** in private chats (not just whitelisted)
- Detect from **both incoming and outgoing** messages (own messages included)
- All groups monitored (locked from Phase 22)

### Approval flow
- Approve/reject via **text command replies** in self-chat — reply "approve" or "reject" to the proposal message
- **Reply to edit** supported — user can reply with modified details like "approve but change to 4pm"
- Multiple events in one message → **separate notifications** (one per event, approve/reject individually)
- Notification language **matches source chat** language (Hebrew for Hebrew chats, English for English)
- Full context in notification: sender name, chat source, original message quote (locked from Phase 22)

### Dashboard UI
- **Both**: overview section showing pending events count + dedicated "Events" page
- Dedicated events page has **tabs**: Pending / Approved / Rejected
- Event cards show **minimal info**: title, date/time, source chat — approve/reject buttons
- Google Calendar OAuth connection status → **Settings page** (not events page)

### Dedup strategy
- **Deduplicate similar events** within same chat — if "dinner Friday" then "see you Friday at 7pm" in same conversation, update the existing proposal with more details
- Dedup window: **until event date** (as long as the event hasn't happened yet, new mentions update rather than duplicate)
- Forwarded messages: **one event only** — detect forwards and skip duplicate (use message content hash or Baileys forward metadata)
- Personal and travel calendar systems are **independent** — no cross-referencing in notifications

### Claude's Discretion
- Exact dedup matching algorithm (title similarity, date proximity, same chat)
- Pre-filter optimization for private chats (cost control)
- Exact notification message formatting
- How to detect message language for notification language matching
- Dashboard overview section design (card, badge count, etc.)

</decisions>

<specifics>
## Specific Ideas

- "Reply to edit" means the user can approve with modifications in one step, e.g., "approve but 4pm instead of 3pm" — Gemini can parse the edit intent
- Dedup should be smart enough that "dinner Friday" and "Friday dinner at 7pm" are recognized as the same event
- The events page tabs (Pending/Approved/Rejected) follow the same pattern as the existing drafts page

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-universal-calendar-detection*
*Context gathered: 2026-03-16*

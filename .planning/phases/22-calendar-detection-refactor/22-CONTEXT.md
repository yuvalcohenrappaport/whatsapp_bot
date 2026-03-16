# Phase 22: Calendar Detection Refactor - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract date extraction logic from `groupMessagePipeline.ts` into a shared `CalendarDetectionService` class callable from both private and group message pipelines. Pure refactor — group pipeline behavior must remain identical. This phase also establishes the foundation for a **new personal Google Calendar connection** (OAuth2 on user's own Google account, separate from the GCP service account used for travel groups).

</domain>

<decisions>
## Implementation Decisions

### Extraction scope
- Class-based `CalendarDetectionService` (matches existing service patterns in codebase)
- Pre-filter (JS date/number pattern check) is part of the shared service — consistent cost control across all pipelines
- Claude decides the right boundary between shared service and pipeline-specific logic (detection-only vs full pipeline)

### Personal calendar (NEW — critical architecture decision)
- Personal assistant calendar is a **separate Google account** from the existing GCP service account
- Uses **OAuth2** (user's personal Google account), not the existing GCP service account
- **All groups** are monitored for personal events (not just travel-active groups)
- **Only travel-active groups** continue using the existing travel bot calendar (GCP service account)
- If both systems detect the same event (e.g., travel date in a travel group), it goes to **both calendars**
- OAuth authorization happens via the **web dashboard** (button to initiate Google OAuth flow)

### Notification flow
- All personal assistant confirmations go to **self-chat** (never post in groups or private chats)
- Self-chat notifications include **full context**: sender name, chat source, original message quote
- Format: "From: [Contact] ([private/Group Name]) — '[original message]'"
- Pending events have **no TTL** — stay until explicitly approved or rejected
- Dashboard also shows pending events for review/management (self-chat + dashboard both)

### Validation
- Unit tests for the extracted CalendarDetectionService
- Manual verification that group calendar still works identically after refactor

### Claude's Discretion
- Exact boundary between shared service logic and pipeline-specific code
- Loading skeleton / error state handling in dashboard
- Exact self-chat message formatting

</decisions>

<specifics>
## Specific Ideas

- The personal calendar feature is conceptually separate from the travel bot calendar — two different Google accounts, two different auth methods
- "All groups monitored for personal events" means the detection service runs on every group message, not just travel-active groups
- Dashboard OAuth flow for personal Google account should be similar to the planned Microsoft To Do OAuth flow (Phase 26)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-calendar-detection-refactor*
*Context gathered: 2026-03-16*

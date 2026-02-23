# Phase 6: Web Dashboard - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Fastify REST API and React SPA for managing contacts, drafts, groups, and bot status in the browser. Accessed from Mac via Tailscale. Single user (yuval). Covers DASH-01 through DASH-06.

</domain>

<decisions>
## Implementation Decisions

### Dashboard layout
- Overview page is the landing page — shows pending drafts count, active contacts count, tracked groups count
- No recent activity timeline on overview (keep it clean)
- Fixed sidebar navigation with pages: Overview, Contacts, Drafts, Groups
- Spacious layout — large cards, breathing room, not cramped
- Always dark mode (no toggle, no system preference)

### Draft approval flow
- Drafts page shows a list with preview: contact name, their message snippet, bot's draft reply, actions on the right
- Inline editing — click the draft text to edit in place, then approve
- After approve: toast notification "Sent!" + draft removed from list
- No keyboard shortcuts — mouse/click only
- No chat-style thread view — just the flat list with previews

### Contact & group management
- Contacts page uses card layout — each contact is a card (name, mode, last message, status)
- Add contact by picking from recent chats (contacts the bot has received messages from)
- Click a contact card to open a side panel on the right for configuration (mode, custom instructions, relationship context)
- Groups page follows the same card + side panel style as contacts
- Group side panel includes group-specific fields: member emails, reminder day, calendar link

### Status & connection
- Connection status badge in the top bar — always visible on every page
- On disconnect: red banner across the top ("Bot disconnected — Reconnecting...") with QR re-auth button if session expired
- QR re-auth: click button opens a modal with live QR code, scan from phone, modal auto-closes on success

### Claude's Discretion
- Exact card design, spacing, and typography
- Sidebar width and page transition animations
- Empty states for each page (no contacts yet, no drafts, no groups)
- Error handling and loading states
- Toast notification styling and duration
- API authentication approach (JWT, session, etc.)
- Exact overview page card/widget layout

</decisions>

<specifics>
## Specific Ideas

No specific references — open to standard approaches with shadcn/ui dark theme.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-web-dashboard*
*Context gathered: 2026-02-23*

---
status: complete
phase: 06-web-dashboard
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md]
started: 2026-02-23T12:40:00Z
updated: 2026-02-23T13:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Dashboard loads with app shell
expected: Dark theme, fixed sidebar with 4 nav items (Overview, Contacts, Drafts, Groups), top bar with connection badge, Overview as landing page
result: pass

### 2. Overview stat cards
expected: Overview page shows 3 large stat cards — Pending Drafts, Active Contacts, Tracked Groups — with real numbers from the API (not NaN or placeholders). Pending Drafts card has highlighted border if count > 0.
result: pass

### 3. Contacts card grid
expected: Navigate to Contacts page. Each whitelisted contact shows as a card with: contact name, mode badge (off=muted, draft=blue, auto=green), last message snippet, and relative timestamp. If no contacts exist, an empty state message appears.
result: pass

### 4. Contact configuration panel
expected: Click any contact card. A Sheet panel slides in from the right showing: contact name as title, three mode buttons (Off/Draft/Auto) with the active one highlighted, Relationship text field, Custom Instructions textarea, and a "Set to Off" remove button at the bottom.
result: pass

### 5. Contact mode change saves immediately
expected: In the contact panel, click a different mode button (e.g., switch from Draft to Auto). The mode badge on the card updates immediately without page refresh. No explicit save button needed.
result: pass

### 6. Add contact from recent chats
expected: Click "Add Contact" button on Contacts page. A dialog opens with phone number input and recent chats picker. Clicking one adds it to the whitelist and it appears as a new card.
result: pass

### 7. Drafts page with inline edit
expected: Navigate to Drafts page. Each pending draft shows as a row with: contact name, the inbound message that triggered it, and the AI-generated draft text. Clicking the draft text makes it editable inline (textarea expands). Empty state with checkmark if no pending drafts.
result: pass

### 8. Draft approve and reject
expected: On a pending draft, click Approve — a "Sent!" toast appears and the draft is removed from the list. On another draft, click Reject — it disappears from the list with no send.
result: pass

### 9. Groups page and configuration
expected: Navigate to Groups page. Click "Add Group" to open a dialog with JID and name inputs. After adding, a group card appears. Click the card to open a Sheet panel with: name input, active toggle switch, reminder day selector, calendar link field, and member emails list with add/remove.
result: pass

### 10. Connection status and QR re-auth
expected: Top bar shows a colored connection badge reflecting bot state (connected=green, disconnected=red). When disconnected, a red banner appears below the top bar with a "Re-auth" button. When the bot reconnects, the badge returns to green.
result: pass

## Summary

total: 10
passed: 10
issues: 0
pending: 0
skipped: 0

## Gaps

[none]

## Bugs Fixed During UAT

1. **Missing login page** — No auth gate existed; added Login.tsx, AuthGuard, and 401 redirect
2. **Draft inboundMessage type mismatch** — API returns object `{body, timestamp}` but frontend type was `string`; fixed type and render
3. **Missing `.run()` on query builders** — `updateContactMode`, `markDraftSent`, `markDraftRejected` returned builders without executing; added `.run()`
4. **DELETE 400 Bad Request** — `apiFetch` sent `Content-Type: application/json` on bodyless DELETE requests; Fastify rejects empty JSON; fixed to only set header when body exists
5. **Re-add off contacts** — `alreadyContact` flag included mode='off' contacts; fixed to only flag active contacts

## Enhancements Added During UAT

1. **Phone number input** — Add contacts by phone number in the Add Contact dialog
2. **Recent chats always show 10** — Changed from excluding existing contacts to showing last 10 with "Added" badge on existing ones

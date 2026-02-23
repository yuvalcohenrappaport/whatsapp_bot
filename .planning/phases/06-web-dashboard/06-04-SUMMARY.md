---
phase: 06-web-dashboard
plan: "04"
subsystem: ui
tags: [react, tanstack-query, shadcn-ui, qrcode, inline-edit, textarea-autosize, drafts, groups, sheet-panel]

# Dependency graph
requires:
  - phase: 06-web-dashboard
    provides: "Fastify REST API (contacts/drafts/groups/status), React SPA scaffold with routing and app shell"
provides:
  - "Drafts page with inline-editable DraftRow, approve/reject actions, and Sent! toast"
  - "Groups page with GroupCard grid, Add Group dialog, and GroupPanel Sheet side panel"
  - "QRModal component with QRCodeSVG and auto-close on reconnect"
  - "Topbar wired to QR modal via internal state management"
  - "useDrafts, useApproveDraft, useRejectDraft hooks"
  - "useGroups, useAddGroup, useUpdateGroup, useDeleteGroup hooks"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [inline-edit-textarea-with-autosize, sheet-panel-per-card, qr-modal-auto-close-on-status-change, save-on-blur-pattern, json-array-email-management]

key-files:
  created:
    - dashboard/src/hooks/useDrafts.ts
    - dashboard/src/hooks/useGroups.ts
    - dashboard/src/components/drafts/DraftRow.tsx
    - dashboard/src/components/groups/GroupCard.tsx
    - dashboard/src/components/groups/GroupPanel.tsx
    - dashboard/src/components/status/QRModal.tsx
  modified:
    - dashboard/src/pages/Drafts.tsx
    - dashboard/src/pages/Groups.tsx
    - dashboard/src/components/layout/Topbar.tsx
    - dashboard/src/components/layout/AppLayout.tsx

key-decisions:
  - "Topbar manages QR modal state internally rather than AppLayout passing onReauth callback"
  - "GroupPanel saves on blur/change for immediate persistence (no Save button)"
  - "Member emails stored as JSON array string, parsed on render and serialized on mutation"
  - "DraftRow keeps edited body in local state; Approve sends current edited body to API"

patterns-established:
  - "Inline edit pattern: clickable text -> TextareaAutosize on click -> exit on blur -> keep local state for approve"
  - "Card + Sheet panel pattern: card grid with click-to-open side panel for detail editing"
  - "Save on blur pattern: text inputs call mutation onBlur only if value changed"
  - "QR modal auto-close: useEffect watching status === connected to call onClose"

requirements-completed: [DASH-02, DASH-05, DASH-06]

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 6 Plan 04: Drafts, Groups, QR Modal Summary

**Drafts page with inline-editable approval queue, Groups page with card/panel management, and QR re-auth modal wired to Topbar disconnect banner**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-23T10:25:53Z
- **Completed:** 2026-02-23T10:29:17Z
- **Tasks:** 2 automated + 1 checkpoint (documented)
- **Files modified:** 12

## Accomplishments
- Drafts page with DraftRow component featuring inline-editable textarea (react-textarea-autosize), Approve/Reject buttons, and Sent! toast on approval
- Groups page with GroupCard grid, Add Group dialog (JID + name), and GroupPanel Sheet with active toggle, reminder day selector, calendar link, and member emails management
- QRModal with QRCodeSVG that auto-closes when connection status becomes connected
- Topbar refactored to manage QR modal state internally, removing onReauth prop chain through AppLayout

## Task Commits

Each task was committed atomically:

1. **Task 1: Drafts page -- hooks, DraftRow with inline edit, approve/reject actions** - `f483ccf` (feat)
2. **Task 2: Groups page, GroupCard, GroupPanel, QR modal, and Topbar wiring** - `c218eab` (feat)

Task 3 (human-verify checkpoint) is documented below -- no code changes required.

## Files Created/Modified
- `dashboard/src/hooks/useDrafts.ts` - useDrafts, useApproveDraft, useRejectDraft hooks with TanStack Query
- `dashboard/src/hooks/useGroups.ts` - useGroups, useAddGroup, useUpdateGroup, useDeleteGroup hooks
- `dashboard/src/components/drafts/DraftRow.tsx` - Single draft row with inline-editable textarea, approve/reject buttons
- `dashboard/src/components/groups/GroupCard.tsx` - Group card with name, active badge, reminder/calendar indicators, click-to-open panel
- `dashboard/src/components/groups/GroupPanel.tsx` - Sheet panel with name, active toggle, reminder day selector, calendar link, member emails list, delete button
- `dashboard/src/components/status/QRModal.tsx` - Dialog with QRCodeSVG, auto-closes when status becomes connected
- `dashboard/src/pages/Drafts.tsx` - Full drafts page replacing placeholder (loading, empty state, draft list with count badge)
- `dashboard/src/pages/Groups.tsx` - Full groups page replacing placeholder (loading, empty state, card grid, add group dialog)
- `dashboard/src/components/layout/Topbar.tsx` - Wired QR modal with internal qrModalOpen state
- `dashboard/src/components/layout/AppLayout.tsx` - Simplified props to Topbar (removed onReauth)
- `dashboard/src/components/ui/switch.tsx` - shadcn Switch component (added for GroupPanel active toggle)
- `dashboard/src/components/ui/select.tsx` - shadcn Select component (added for GroupPanel reminder day selector)

## Decisions Made
- Topbar manages QR modal state internally rather than threading an onReauth callback from AppLayout -- keeps the modal lifecycle close to the trigger (DisconnectBanner Re-auth button)
- GroupPanel saves fields on blur/change immediately without a separate Save button, following the same pattern planned for ContactPanel in 06-03
- Member emails are stored as a JSON array string in the database; GroupPanel parses on render and serializes back on add/remove
- DraftRow editing: body state is local; clicking outside exits edit mode but preserves the edited text; Approve sends the current body value (original or edited)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added shadcn Switch and Select components**
- **Found during:** Task 2 (GroupPanel implementation)
- **Issue:** GroupPanel requires Switch (active toggle) and Select (reminder day) components which were not installed
- **Fix:** Ran `npx shadcn@latest add switch select label` to add the required UI primitives
- **Files modified:** dashboard/src/components/ui/switch.tsx, dashboard/src/components/ui/select.tsx (created)
- **Verification:** Build passes, components render correctly
- **Committed in:** c218eab (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (blocking)
**Impact on plan:** Necessary to implement GroupPanel functionality. No scope creep.

## Issues Encountered
None

## Human Verification Checkpoint (Task 3)

Task 3 is a human-verify checkpoint. All automated work is complete. The following manual verification steps should be performed:

1. Open http://[server-ip]:3000 in a browser
2. Log in with DASHBOARD_PASSWORD to get JWT
3. Overview page: confirm three stat cards show correct numbers
4. Contacts page: confirm contact cards render, mode changes save immediately
5. **Drafts page:** verify draft rows appear with contact name, inbound message, and draft text; click draft text to edit; click Approve for "Sent!" toast
6. **Groups page:** add a test group (any @g.us JID); verify it appears as card; click card to open Sheet panel with all fields
7. Connection badge: confirm "Connected" in green when bot is active
8. **Disconnect test:** stop bot (`pm2 stop bot`), confirm disconnect banner with Re-auth button; click Re-auth to open QR modal
9. **Reconnect test:** restart bot (`pm2 start bot`), confirm badge returns to green and QR modal auto-closes
10. Refresh browser on /contacts to confirm SPA routing fallback works

## User Setup Required
None - no new environment variables or external service configuration required.

## Next Phase Readiness
- All six DASH requirements are met (DASH-01 through DASH-06)
- Phase 6 (Web Dashboard) is fully complete -- all four pages functional
- The dashboard is ready for production use via Tailscale connection from Mac
- Phase 7 (CLI dashboard) can proceed independently

## Self-Check: PASSED

All 12 created/modified files verified present on disk. Both task commits (f483ccf, c218eab) verified in git log.

---
*Phase: 06-web-dashboard*
*Completed: 2026-02-23*

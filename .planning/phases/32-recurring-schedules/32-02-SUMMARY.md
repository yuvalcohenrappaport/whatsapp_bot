---
phase: 32-recurring-schedules
plan: 02
subsystem: dashboard
tags: [recurring, cronstrue, cadence-ui, repeat-dropdown]
dependency_graph:
  requires: [32-01]
  provides: [repeat-dropdown, cronstrue-preview, cadence-badge]
  affects: [ScheduleMessageDialog, ScheduledMessageCard, useScheduledMessages]
tech_stack:
  added: [cronstrue]
  patterns: [Intl.DateTimeFormat client-side cron build, cronstrue human-readable preview]
key_files:
  created: []
  modified:
    - dashboard/src/hooks/useScheduledMessages.ts
    - dashboard/src/components/scheduled-messages/ScheduleMessageDialog.tsx
    - dashboard/src/components/scheduled-messages/ScheduledMessageCard.tsx
decisions:
  - Client-side buildCronExpression mirrors backend logic for preview only (not stored)
  - getCadenceFromCron shared as inline helper in both dialog and card (no shared module needed for 2 usages)
metrics:
  duration: 131s
  completed: 2026-03-30
---

# Phase 32 Plan 02: Recurring Schedule Dashboard UI Summary

Repeat dropdown with cronstrue live preview in schedule dialog, cadence badge on message cards, and cadence field wired through create/edit hooks to the API.

## What Was Done

### Task 1: Install cronstrue, update types/hooks, add Repeat dropdown with preview, and cadence badge

- Installed `cronstrue` in dashboard/
- Added `cronExpression: string | null` to `ScheduledMessage` interface
- Added `cadence` field to `CreateScheduledMessageInput` and `EditScheduledMessageInput`
- Updated `useEditScheduledMessage` to destructure and send cadence in PATCH body
- Added `buildCronExpression(cadence, scheduledAtMs)` helper using Intl.DateTimeFormat for IST-aware cron generation (client-side preview only)
- Added `getCadenceFromCron(cronExpression)` helper to derive cadence from stored cron string
- Added `cadence` state to ScheduleMessageDialog, initialized from cronExpression in edit mode
- Added Repeat dropdown (None/Daily/Weekly/Monthly) between date picker and type selector
- Added live cronstrue preview below dropdown (e.g., "Every day at 09:00")
- Updated handleSubmit to send cadence on create (undefined if none) and edit (null to clear)
- Added `getCadenceFromCron` to ScheduledMessageCard for cadence badge display
- Updated type badge to show "Text . Daily" / "Voice . Weekly" / "AI . Monthly" for recurring messages

**Commit:** bcf1542

### Task 2: Verify recurring schedule UI end-to-end (checkpoint -- skipped)

This was a human-verify checkpoint. Skipped per instructions -- user should verify manually:

1. Start the dashboard: `cd /home/yuval/whatsapp-bot/dashboard && npm run dev`
2. Open Schedule Message dialog and select a future time
3. Change Repeat dropdown from "None" to "Daily" -- confirm cronstrue preview appears
4. Change to "Weekly" / "Monthly" -- confirm preview updates
5. Schedule a recurring message and confirm cadence badge shows on card
6. Edit a recurring message -- confirm cadence is pre-selected
7. Cancel a recurring message -- confirm it shows as cancelled
8. Run `cd /home/yuval/whatsapp-bot/dashboard && npm run build` to confirm clean build

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Client-side buildCronExpression mirrors backend** -- The dialog needs to generate a cron string for cronstrue preview. This duplicates the backend's buildCronExpression but is necessary since the preview happens before any API call.

2. **getCadenceFromCron as inline helpers** -- Both ScheduleMessageDialog and ScheduledMessageCard need getCadenceFromCron. With only 2 usages and slightly different return types (typed union vs display string), inline helpers are simpler than a shared module.

## Verification Results

- `npx tsc --noEmit` passes with zero errors
- cronstrue import and preview rendering confirmed in ScheduleMessageDialog
- cadence in types and mutations confirmed in useScheduledMessages
- getCadenceFromCron and cadenceLabel confirmed in ScheduledMessageCard

## Self-Check: PASSED

All files exist, commit bcf1542 verified.

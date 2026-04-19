---
phase: 40-unified-detection-pipeline
plan: 03
status: complete
completed: 2026-04-19
commits:
  - 3e09de3 chore(deps): protobufjs override (owner, pre-merge)
  - (merge commit — feat/v1.8-task-approval into main, --no-ff)
---

# Plan 40-03 Summary — Live Verification

**Ship status:** Complete (owner-driven; no planning-directory commits from this plan beyond the tracking updates in phase close)

## What happened

- Owner committed a pre-merge chore (`3e09de3 chore(deps): protobufjs override`) then merged `feat/v1.8-task-approval` into `main` with `--no-ff`.
- PM2 restarted `whatsapp-bot` (pid 2404227 → 2439675, restart count 436 → 437).
- Boot log surfaced the expected Phase-39 initDb output — `Post-migration table counts` line with non-zero `user_jid_fixed` count from the first-boot UPDATE, zero errors.
- Drizzle migrations 0020 + 0021 applied cleanly on the live DB.

## Post-restart live state (verified)

| Metric | Value | Expectation |
|---|---|---|
| `actionables` table | 360 rows | created + backfilled ✓ |
| `actionables` by status | 8 approved / 308 fired / 14 pending_approval / 30 rejected | matches mapping table ✓ |
| `actionables` by source_type | 33 commitment / 19 task / 308 user_command | matches mapping table ✓ |
| USER_JID_PLACEHOLDER rows | 0 | fixup ran on first boot ✓ |
| Google Tasks ids preserved | 130 rows | grandfather policy worked ✓ |
| `v1_8_detection_pipeline` setting | `dark_launch` | seeded via DEFAULTS on first read ✓ |

## Dark-launch behavior proof (unprompted, first 2 min after restart)

- `actionables.pending_approval` rose from 12 → **14** (+2 real-traffic detections)
- `actionables.source_type='commitment'` rose from 31 → **33** (+2 new dark-launched commitments)
- Legacy `reminders(source='commitment')` count: **31 → 31** (zero new legacy writes)
- Legacy `todo_tasks` count: **19 → 19** (zero new legacy writes)

End-to-end proof that detections in private chats are now writing exclusively to `actionables` and the legacy split paths are frozen.

## Owner verification

- No self-chat WhatsApp notifications fired for the 2 unprompted detections (silent dark launch confirmed)
- Google Tasks "WhatsApp Tasks" list received zero new entries (auto-push is off)
- Owner signed off: "approved"

## Plan-level SCs — all met

- [x] PM2 restarted cleanly with new code
- [x] Startup log shows Post-migration table counts with correct values
- [x] Synthetic / real-traffic detection writes `pending_approval` actionables row
- [x] Zero new writes to `todo_tasks` or `reminders(source='commitment')`
- [x] Zero new Google Tasks entries
- [x] Owner sign-off received

## Follow-ups for later phases

- **Phase 41** must handle the 14 `pending_approval` actionables already sitting in the table when the approval UX lands — the one-time digest from 40-CONTEXT.md will surface this count on first post-Phase-41 boot, then flush items through the batched-preview flow.
- The `dark_launch` setting flip remains a rollback lever via `setSetting('v1_8_detection_pipeline', 'legacy')` — no restart needed (getSetting is read per-call).
- Pre-existing 4 `CommitmentDetectionService` test failures remain deferred per `deferred-items.md` — unchanged by this phase.

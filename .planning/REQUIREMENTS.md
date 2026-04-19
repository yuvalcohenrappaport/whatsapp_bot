# Requirements: WhatsApp Bot

**Defined:** 2026-03-30 (v1.6) · updated 2026-04-19 (v1.8)
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.8 Requirements

Requirements for the **Task Approval & Context Enrichment** milestone. Turn commitment/task detection into a *draft → approve → sync* workflow with LLM-enriched, self-contained Google Tasks titles that use prior conversation context and the other contact's name.

### Data Model

- [x] **ACT-01**: A unified `actionables` table stores every detected or user-requested actionable item with fields for source (commitment/task/user-command), source contact, source message id + text, detected task, detected_at, status, enriched title, enriched note, Google Tasks ids, and the approval preview message id
- [x] **ACT-02**: Actionable status follows the lifecycle `pending_approval → approved → fired` (with `rejected` and `expired` terminal states), and the transitions are idempotent against duplicate WhatsApp replies

### Detection Pipeline

- [x] **DETC-01**: Commitment/task detection in private chats writes a single `actionable` row with status `pending_approval` and stops auto-pushing to Google Tasks
- [x] **DETC-02**: One detection pipeline covers both commitment-type (with time / involving others) and task-type (solo, no time) items — the parallel `commitments` → `todo` split is retired
- [x] **DETC-03**: Self-chat direct reminder commands (`remind me to X at Y`) create an actionable with status `approved` and bypass the approval gate entirely

### Approval UX (WhatsApp)

- [x] **APPR-01**: Bot sends a per-detection self-chat preview message containing proposed task, contact name, source snippet, and detection timestamp, formatted in the message's detected language (Hebrew or English)
- [x] **APPR-02**: User can approve a pending actionable by WhatsApp quoted-reply with ✅ (synonyms: `approve`, `✓`, `ok`)
- [x] **APPR-03**: User can reject a pending actionable by WhatsApp quoted-reply with ❌ (synonyms: `reject`, `no`, `✗`)
- [x] **APPR-04**: User can edit the proposed task before approving by WhatsApp quoted-reply with `edit: <new task text>` — the edited text replaces the detected task and then runs enrichment as if approved
- [x] **APPR-05**: Pending actionables older than 7 days auto-expire to `expired` state and are removed from the preview backlog

### Context Enrichment (at approval)

- [ ] **ENRI-01**: On approval, a Gemini call uses the most recent ~10 messages from the source chat to produce an enriched, self-contained Google Tasks title
- [ ] **ENRI-02**: The enriched title resolves pronouns and vague references, includes the contact's name, and includes a concrete deadline when a time was detected
- [ ] **ENRI-03**: The Google Tasks note records contact name, source chat snippet, and original trigger message text so the task is auditable from the Google Tasks UI alone
- [ ] **ENRI-04**: Enrichment failures (Gemini error, empty response, validation fail) fall back to the originally detected task + basic note and never block approval

### Dashboard

- [ ] **DASH-ACT-01**: Dashboard page lists all `pending_approval` actionables with contact, proposed task, source snippet, detected_at, and language — read-only view for auditing detection quality
- [ ] **DASH-ACT-02**: Dashboard surfaces recent `approved`, `rejected`, and `expired` actionables (last N) for audit trail, showing enriched title alongside the original detection

### Migration

- [x] **MIGR-01**: A Drizzle migration creates the `actionables` table and backfills in-flight pending rows from `reminders (source=commitment)` and `todoTasks` into the new model without losing existing Google Tasks ids
- [x] **MIGR-02**: Detection code paths split across `commitments/` → `reminders/` and `commitments/` → `todo/` are retired in favor of one unified detection-to-actionable pipeline; already-synced Google Tasks entries are left alone

## Previous Milestones

### v1.7 Requirements (Complete)

- [x] **LIN-01**: User can start a long-running pm-authority HTTP service exposing read + mutate endpoints for post state, variants, and lesson candidates over localhost (127.0.0.1 only, no auth — local binding is the security boundary)
- [x] **LIN-02**: User can open the whatsapp-bot dashboard and it fetches LinkedIn post data via Fastify proxy routes forwarding to the pm-authority HTTP service, with typed Zod schemas and error pass-through
- [x] **LIN-03**: User can view a `/linkedin/queue` dashboard page listing all posts in `DRAFT`, `PENDING_VARIANT`, `PENDING_LESSON_SELECTION`, or `PENDING_PII_REVIEW` with status badge, content preview, and image thumbnail
- [x] **LIN-04**: User can see a status strip on the queue page showing next publish slot (Tue/Wed/Thu 06:30 IDT), pending count, approved count, and last published post preview
- [x] **LIN-05**: User can view a recent-published history tab listing the last N published posts with published_at, LinkedIn permalink, content preview, and basic metrics when available
- [x] **LIN-06**: User sees the queue auto-refresh via SSE on post state changes without manual page reload
- [x] **LIN-07**: User can approve or reject any post from the dashboard via per-post action buttons
- [x] **LIN-08**: User can edit a post's content inline in the dashboard (Hebrew and English sides separately for bilingual posts)
- [x] **LIN-09**: User can regenerate any post with a live status indicator while Claude CLI runs, respecting the existing 5-regeneration cap
- [x] **LIN-10**: User can replace a post's image by uploading a new file via drag-and-drop; the upload passes through the existing `PENDING_PII_REVIEW` gate
- [x] **LIN-11**: User can pick one of 4 candidate lessons for a `PENDING_LESSON_SELECTION` post via a dashboard card list showing lesson text + rationale
- [x] **LIN-12**: User can pick one of 2 full-post variants for a `PENDING_VARIANT` post via a side-by-side dashboard view showing content + image prompt
- [x] **LIN-13**: User can see the generated fal.ai image inline on the variant card once image generation completes (replaces the current "file path only" state)
- [x] **LIN-14**: User can start a new lesson-mode generation run from a dashboard form with project-picker dropdown, perspective, and language fields (replaces the SSH + `generate.py --mode lesson` CLI workflow)

### v1.6 Requirements (Complete)

- [x] **SCHED-01**: User can create a scheduled message with a recipient, content, and future date/time from the dashboard
- [x] **SCHED-02**: Scheduled messages persist in the database and survive bot restarts
- [x] **SCHED-03**: Scheduler uses two-tier pattern (setTimeout for near-term, periodic DB scan for distant)
- [x] **SCHED-04**: Reconnect dedup guard prevents double-fire after Baileys reconnection
- [x] **SCHED-05**: User can set recurring schedules (daily, weekly, monthly) stored as cron expressions for DST safety
- [x] **TYPE-01**: User can schedule a plain text message for delivery at a specified time
- [x] **TYPE-02**: User can schedule a voice note message generated via ElevenLabs TTS at fire time
- [x] **TYPE-03**: User can schedule an AI-generated message where Gemini generates content from a prompt at fire time using contact style context
- [x] **SAFE-01**: Bot sends a self-chat notification before each scheduled send with a cancel option
- [x] **SAFE-02**: Cancel state is persisted in the database (survives PM2 reloads)
- [x] **SAFE-03**: Failed sends are tracked with status and retried automatically
- [x] **DASH-01**: Dashboard page lists all scheduled messages with status indicators
- [x] **DASH-02**: Dashboard form to create scheduled messages with recipient picker, content input, date/time picker, and recurrence options
- [x] **DASH-03**: User can edit a pending scheduled message from the dashboard
- [x] **DASH-04**: User can cancel/delete a scheduled message from the dashboard
- [x] **DASH-05**: Live cron expression preview via cronstrue shows human-readable schedule description

### v1.5 Requirements (Complete)

- [x] **CAL-01**: Bot detects date/event mentions in private chat messages using Gemini with JS pre-filter
- [x] **CAL-02**: Bot detects date/event mentions in group chat messages (extends existing extraction to all groups)
- [x] **CAL-03**: Detected events are proposed via self-chat with suggest-then-confirm flow
- [x] **CAL-04**: Confirmed events are created in Google Calendar with title, date/time, and source context
- [x] **CAL-05**: CalendarDetectionService extracted as shared module for both private and group pipelines
- [x] **CAL-06**: Duplicate event detection prevents double-creation from forwarded messages
- [x] **REM-01**: User can request reminders via WhatsApp command ("remind me to X at Y")
- [x] **REM-02**: Bot detects commitments in private chats ("I'll send it tomorrow") and suggests follow-up reminders
- [x] **REM-03**: Quick reminders delivered as WhatsApp messages to owner's self-chat
- [x] **REM-04**: Time-specific reminders created as Google Calendar events with notifications
- [x] **REM-05**: Reminders persisted in SQLite with restart recovery and startup catch-up
- [x] **REM-06**: Reminder scheduling uses setTimeout for <24h and periodic DB scan for distant reminders
- [x] **TODO-01**: OAuth2 authorization code flow for Microsoft Graph API via dashboard
- [x] **TODO-02**: Bot auto-detects actionable tasks in private chat messages with pre-filter
- [x] **TODO-03**: Detected tasks proposed via self-chat with suggest-then-confirm flow
- [x] **TODO-04**: Confirmed tasks created in Microsoft To Do via Graph API
- [x] **TODO-05**: Refresh token persisted and auto-renewed with expiry monitoring

## Future Requirements

### Advanced Scheduling

- **ASCHED-01**: Natural language scheduling via WhatsApp ("send happy birthday to Mom at midnight")
- **ASCHED-02**: Template messages with variable interpolation at fire time
- **ASCHED-03**: Batch scheduling (multiple recipients, same message)

### LinkedIn Integration — Deferred

- **LIN-15** (future): Sequence-mode (4-post narrative arc) generation from the dashboard
- **LIN-16** (future): LinkedIn analytics charts/graphs (impressions over time, top hooks ranking)
- **LIN-17** (future): OpenAPI codegen pipeline to keep Python API schemas in sync with TypeScript client types
- **LIN-18** (future): Mobile-optimized responsive layout for the LinkedIn queue page
- **LIN-19** (future): Bearer-token auth on the pm-authority HTTP service (if ever exposed beyond 127.0.0.1)

### Dashboard Integration

- **DASH-06**: Dashboard controls for calendar detection sensitivity per contact/group
- **ADV-01**: Two-way To Do sync (changes in To Do reflected in bot)
- **ADV-03**: Multi-language commitment detection tuning (Hebrew/English/mixed)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Group chat commitment detection | v1.8 keeps detection private-chat only — group pipelines have their own calendar/travel flows; adding group commitments multiplies false-positive surface |
| Telegram-style notifications for actionables | WhatsApp self-chat is the owner's primary surface; adding Telegram doubles the notification code path |
| Recurring actionables (daily/weekly tasks) | v1.6 scheduler handles recurring outgoing messages; recurring personal tasks are a separate concern — defer |
| Editing an approved actionable's deadline via WhatsApp | Dashboard-only for v1.8 — editing deadlines via quoted-reply adds disambiguation complexity |
| Two-way sync from Google Tasks back to the bot | One-way push only; checking a task off in Google doesn't update bot state |
| Per-contact approval-gate bypass (whitelist contacts to auto-approve) | Explicitly requires a uniform gate for all detected items in v1.8; self-chat direct commands are the only bypass |
| Bearer token / JWT auth on pm-authority service | Binding to 127.0.0.1 is the security boundary; adds complexity without security gain for a single-owner localhost service |
| OpenAPI codegen across Python ↔ TypeScript | Manual Zod schemas + keep-in-sync discipline; codegen pipeline is overhead for 14 endpoints |
| Sequence-mode (4-post) generation from dashboard | Lesson mode only via UI; sequence mode stays CLI-only. Can be added later as LIN-15. |
| Mobile / small-screen optimization | Desktop-first, same as existing dashboard (Tailscale SSH from laptop) |
| Multi-user auth / RBAC | Single-owner tool — no multi-tenant use case |
| Post editing after PUBLISHED | Read-only after LinkedIn publish. No way to patch a posted tweet. |
| Removing or superseding the Telegram bot | Telegram bot stays as fallback review UX — dashboard is strictly additive |
| LinkedIn analytics charts / graphs | Basic numeric metric display only, no chart library. Deferred to LIN-16. |
| Natural language scheduling via WhatsApp | Dashboard-only for v1.6; WhatsApp commands add complexity |
| Bulk broadcast to multiple recipients | Triggers WhatsApp bans |
| Auto-retry persistent job queue (e.g., BullMQ) | Overkill for single-user bot; simple DB retry is sufficient |
| Scheduled media/image messages | Text and voice only; Baileys media handling is fragile |
| Contact-initiated scheduling | Owner-only in v1.6; contacts requesting timed replies adds scope |
| react-js-cron component | Requires Ant Design peer dep, incompatible with shadcn/Tailwind stack |

## Traceability

### v1.8 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACT-01 | Phase 39 | Complete (2026-04-19 — actionables Drizzle table + migration 0020 applied + 54 vitest cases green; smoke-tested against live DB copy with 356 legacy rows) |
| ACT-02 | Phase 39 | Complete (2026-04-19 — lifecycle enforced at runtime via `isValidTransition` + `updateActionableStatus` throwing on invalid transitions) |
| MIGR-01 | Phase 39 | Complete (2026-04-19 — backfill migration 0021 maps 12 source×status combinations, preserves Google Tasks ids on 128 rows, idempotent) |
| DETC-01 | Phase 40 | Complete (2026-04-19 — dark-launch deployed, 2 unprompted detections wrote to `actionables` with status=pending_approval and zero legacy writes in the same window) |
| DETC-02 | Phase 40 | Complete (2026-04-19 — single `detectionService.processDetection` pipeline covers both commitment + task classifications; `processCommitment` only reachable via legacy gate) |
| MIGR-02 | Phase 40 | Complete (2026-04-19 — `commitmentPipeline.ts` + `todoPipeline.ts` files retained on disk per CLAUDE.md; unreachable from default pipeline; rollback is one setting flip) |
| APPR-01 | Phase 41 | Complete |
| APPR-02 | Phase 41 | Complete |
| APPR-03 | Phase 41 | Complete |
| APPR-04 | Phase 41 | Complete |
| APPR-05 | Phase 41 | Complete (2026-04-19 — startExpiryScan fires hourly, flips pending>7d to expired silently via updateActionableStatus, idempotent across restarts) |
| DETC-03 | Phase 41 | Complete (2026-04-19 — reminderService.tryHandleReminder 'set' branch dual-writes approved user_command actionable alongside legacy reminders row) |
| ENRI-01 | Phase 42 | Pending |
| ENRI-02 | Phase 42 | Pending |
| ENRI-03 | Phase 42 | Pending |
| ENRI-04 | Phase 42 | Pending |
| DASH-ACT-01 | Phase 43 | Pending |
| DASH-ACT-02 | Phase 43 | Pending |

**v1.8 Coverage:**
- v1.8 requirements: 18 total
- Mapped to phases: 18 (Phases 39-43)
- Unmapped: 0 ✓

### v1.7 Traceability (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIN-01 | Phase 33 | Complete (2026-04-13 — 52/52 HTTP tests passing, service live on PM2 at 127.0.0.1:8765) |
| LIN-02 | Phase 34 | Complete (2026-04-13 — 63 unit vitest + 6 live integration tests green; live pm-authority verified via fastify.inject against 127.0.0.1:8765) |
| LIN-03 | Phase 35 | Complete (2026-04-13 — live-verified in browser with PM2 dashboard) |
| LIN-04 | Phase 35 | Complete (2026-04-13 — live-verified in browser with PM2 dashboard) |
| LIN-05 | Phase 35 | Complete |
| LIN-06 | Phase 35 | Complete |
| LIN-07 | Phase 36 | Complete (2026-04-15 — live-verified in browser walkthrough against PM2 stack; see 36-05-SUMMARY.md SC#1) |
| LIN-08 | Phase 36 | Complete (2026-04-15 — live-verified in browser walkthrough, bilingual edit persists; see 36-05-SUMMARY.md SC#2) |
| LIN-09 | Phase 36 | Complete (2026-04-15 — live-verified after in-session fix `fcb619b` (JobAcceptedSchema drift); see 36-05-SUMMARY.md SC#3) |
| LIN-10 | Phase 36 | Complete (2026-04-15 — live-verified after in-session fix `ac9b47f` (image route `?token=` fallback); see 36-05-SUMMARY.md SC#4) |
| LIN-11 | Phase 37 | Complete (2026-04-17 — live-verified in owner's browser walkthrough; SC#1 observed: 4-card lesson pick + locked modal + auto-nav to variant page; see 37-05-SUMMARY.md) |
| LIN-12 | Phase 37 | Complete (2026-04-17 — live-verified in owner's browser walkthrough; SC#2 observed: 2-col variant grid + focus-then-confirm + finalize; see 37-05-SUMMARY.md) |
| LIN-13 | Phase 37 | Complete (2026-04-17 — live-verified in owner's browser walkthrough; SC#3 observed: fal.ai image rendered inline on focused variant card with 1.5s visible delay before nav; see 37-05-SUMMARY.md) |
| LIN-14 | Phase 38 | Complete (2026-04-17 -- live-verified in owner's browser walkthrough; form submits, post appears in queue, validation inline, localStorage persists; Hebrew variant waived as upstream bug; see 38-03-SUMMARY.md) |

**v1.7 Coverage:**
- v1.7 requirements: 14 total
- Mapped to phases: 14 (Phases 33-38)
- Unmapped: 0

### v1.6 Traceability (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHED-01 | Phase 30 | Complete |
| SCHED-02 | Phase 27 | Complete |
| SCHED-03 | Phase 28 | Complete |
| SCHED-04 | Phase 28 | Complete |
| SCHED-05 | Phase 32 | Complete |
| TYPE-01 | Phase 28 | Complete |
| TYPE-02 | Phase 31 | Complete |
| TYPE-03 | Phase 31 | Complete |
| SAFE-01 | Phase 29 | Complete |
| SAFE-02 | Phase 29 | Complete |
| SAFE-03 | Phase 29 | Complete |
| DASH-01 | Phase 30 | Complete |
| DASH-02 | Phase 30 | Complete |
| DASH-03 | Phase 30 | Complete |
| DASH-04 | Phase 30 | Complete |
| DASH-05 | Phase 30 | Complete |

---
*Requirements defined: 2026-03-30 (v1.6)*
*Last updated: 2026-04-19 — v1.8 Task Approval & Context Enrichment requirements added (18 items across ACT / DETC / APPR / ENRI / DASH-ACT / MIGR categories)*

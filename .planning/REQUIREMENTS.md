# Requirements: WhatsApp Bot

**Defined:** 2026-03-30 (v1.6) · updated 2026-04-20 (v1.9 + v2.0 seed)
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v2.0 Requirements

Requirements for the **Dashboard UX Polish** milestone. Lift the dashboard's UX quality across surfaces, starting with a phone-first mobile pass — Calendar as showcase + global mobile primitives + daily-driver polish. Inverts the v1.x "Mobile / small-screen optimization" out-of-scope row (the dashboard is now used from a phone via Tailscale, not just laptop).

### Mobile UI Polish

- [x] **MOBILE-01**: Global mobile primitives shipped — 44px-floor tap targets on shadcn `<Button>`, ≥16px input font (`text-base md:text-sm`) on `<Input>` + `<Textarea>` to suppress iOS Safari focus auto-zoom, safe-area insets (`env(safe-area-inset-*)`) on `AppLayout`, new `<StickyActionBar>` primitive, new `useViewport()` hook returning `{isMobile, isTablet, isDesktop}` (extends rather than replaces existing `useIsMobile()` in `use-mobile.ts`)
- [x] **MOBILE-02**: Calendar phone view router — on `<768px`, default to `DayView` with horizontal swipe prev/next (60px threshold, <30px vertical drift, handwritten `useHorizontalSwipe` — no gesture library); 3-Day scrollable; new `MonthDotsView` (read-only 7-col dot grid, tap-day → DayView) replaces `MonthView`; `WeekView` is desktop-only and never reachable from the phone view toggle
- [x] **MOBILE-03**: Calendar components responsive on phone — `CalendarHeader` collapses to a single compact row with a 3-segment view-toggle pill; `CalendarPill` ≥28px min-height with no hover tooltip; `DayView` single-column with a floating `+ New` FAB (safe-area-inset-aware); `DayOverflowPopover`, `CreateItemPopover`, `InlineTitleEdit` all switch from Radix Popover to Radix Dialog in bottom-sheet mode below 768px
- [x] **MOBILE-04**: Long-press → `<PillActionSheet>` replaces touch drag-and-drop on phone (desktop drag preserved via `draggable={!isMobile}` gate); `useLongPress` hook fires on ≥500ms hold with <8px movement, ignores mouse pointers; PillActionSheet exposes Reschedule / Edit title / Delete / Cancel; Reschedule uses native `<input type="datetime-local">` interpreted as IST (canonical bot timezone) and dispatches the existing `useCalendarMutations.reschedule()` — no new mutation, no new error handling, no new date-picker library; haptic via `navigator.vibrate(10)` when available
- [x] **MOBILE-05**: Daily-driver pages mobile audit — `Overview` 2-col metric grid collapses to 1-col on phone with text scaling at <375px to prevent value-text wrap; `PendingTasks` card action row (Approve/Edit/Reject) safely sized for 320px width with full-width inline-edit textarea; `Drafts` primary actions (Send all / Regenerate where applicable) wrapped in `<StickyActionBar>` so they stay reachable while scrolling
- [x] **MOBILE-06**: Live walkthrough on a real phone passes against the live PM2 bot via Tailscale URL — 26-check protocol covering swipe nav, dot-month tap-to-day, long-press → PillActionSheet → reschedule with **IST correctness verified by direct sqlite query against the rescheduled item**, iOS zoom-on-focus test on Safari, safe-area-inset verification on a notched device, orientation rotation, and 320px-width regression check on Overview / PendingTasks _(Plan 50-06 — 26/26 PASS on real iPhone via Tailscale to PM2 bot; see 50-06-SUMMARY.md walkthrough log)_

## v1.9 Requirements

Requirements for the **Dashboard Expansion** milestone. Bring the whole dashboard to parity with the editable calendar shipped in Phase 44 — surface write actions on the pending-tasks view, pull external Google sources (Tasks lists + Calendar events) into the unified calendar with per-source colors and sidebar filters, and let the owner compose LinkedIn posts directly from the dashboard.

### Dashboard Approvals

- [x] **DASH-APP-01**: Pending-tasks dashboard page (`/pending-tasks`) exposes Approve + Reject + Edit buttons per row, calling a JWT-gated mutation API and triggering the same `approveAndSync` / rejection flow used by the WhatsApp quoted-reply path (Phase 41's `approvalHandler`) _(primitives 45-01, HTTP routes 45-02, UI buttons 45-03 — live verification lands in 45-04)_
- [x] **DASH-APP-02**: Approve from dashboard runs Phase 42 Gemini enrichment before pushing to Google Tasks (identical behavior to WhatsApp approve), with safe fallback on enrichment failure _(primitives 45-01 carry Phase 42 enrichment, HTTP route 45-02, UI wiring 45-03 — live verification lands in 45-04)_
- [x] **DASH-APP-03**: Edit action opens an inline or dialog editor — saves replace the detected task text, then fall through to Approve. SSE updates every open dashboard session within ~3 s. _(HTTP /edit route 45-02 falls through to approveActionable; inline card-morph Edit UI + Save & Approve 45-03; SSE unchanged from Plan 43-02 3s hash-poll)_

### Google Tasks Full Sync

- [x] **GTASKS-01**: Backend exposes `GET /api/google-tasks/lists` returning every list the owner has access to, and `GET /api/google-tasks/items?from=<ms>&to=<ms>` returning CalendarItems with `source: 'gtasks'` and `sourceFields: { listId, listName }` spanning all lists
- [x] **GTASKS-02**: The unified `/api/calendar/items` aggregator + SSE include gtasks; per-source partial-failure tolerance covers gtasks (other sources still render if the Google Tasks API is down)
- [x] **GTASKS-03**: Dashboard renders gtasks as a new CalendarPill variant with a color assigned per list (stable hash → palette, with a dashboard setting page deferred to a later milestone)
- [x] **GTASKS-04**: Calendar page has a sidebar filter panel listing every gtasks list with a checkbox + color swatch; toggles persist to localStorage; hidden lists are excluded from the grid
- [x] **GTASKS-05**: A Google Tasks row already mirrored into `actionables` (via `todoTaskId`) renders from the `actionables` row only — gtasks de-dup prefers the richer bot-owned row

### Google Calendar Full Sync

- [x] **GCAL-01**: Backend exposes `GET /api/google-calendar/calendars` returning every calendar the owner has access to, and `GET /api/google-calendar/events?from=<ms>&to=<ms>` returning CalendarItems with `source: 'gcal'` and `sourceFields: { calendarId, calendarName, colorId }` spanning every owned/writable calendar
- [x] **GCAL-02**: Recurring events are expanded via `events.list(singleEvents: true)`; all-day events set `isAllDay: true`; `end` is mapped to millis (event end exclusive → inclusive delta if needed)
- [ ] **GCAL-03**: The unified aggregator + SSE include gcal with per-source partial-failure tolerance
- [x] **GCAL-04**: Calendar page's sidebar filter extends to gcal calendars (same checkbox + swatch + localStorage pattern as gtasks)
- [x] **GCAL-05**: A gcal event whose Google id matches an existing `personal_pending_events.calendar_event_id` is dropped from the gcal payload — the bot-owned row wins (editable, richer metadata)
- [x] **GCAL-06**: gcal pills are read-only in the dashboard calendar — no drag, no inline edit, no delete (writing back to Google Calendar is out of scope for this milestone)

### LinkedIn Post Composer (Dashboard)

- [x] **LIN-NEW-01**: Dashboard `/linkedin` queue page exposes a "New Post" action that opens a composer with title/content/language/project fields, POSTs to pm-authority's `/v1/posts` endpoint via the existing proxy pattern (JWT-gated, sync-mutation), and returns the created post to the queue in status `PENDING_REVIEW`

### Deploy & Verification

- [ ] **VER-01**: Both PM2 services (whatsapp-bot + pm-authority-http) redeploy with v1.9 code; dashboard bundle ships; owner walks through every new requirement against live data; ROADMAP + REQUIREMENTS + STATE + MILESTONES reflect v1.9 closure

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

- [x] **ENRI-01**: On approval, a Gemini call uses the most recent ~10 messages from the source chat to produce an enriched, self-contained Google Tasks title
- [x] **ENRI-02**: The enriched title resolves pronouns and vague references, includes the contact's name, and includes a concrete deadline when a time was detected
- [x] **ENRI-03**: The Google Tasks note records contact name, source chat snippet, and original trigger message text so the task is auditable from the Google Tasks UI alone
- [x] **ENRI-04**: Enrichment failures (Gemini error, empty response, validation fail) fall back to the originally detected task + basic note and never block approval

### Dashboard

- [x] **DASH-ACT-01**: Dashboard page lists all `pending_approval` actionables with contact, proposed task, source snippet, detected_at, and language — read-only view for auditing detection quality
- [x] **DASH-ACT-02**: Dashboard surfaces recent `approved`, `rejected`, and `expired` actionables (last N) for audit trail, showing enriched title alongside the original detection

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
- **LIN-18** (future): Mobile-optimized responsive layout for the LinkedIn queue page (`LinkedInLessonSelection`, `LinkedInVariantFinalization`, `LinkedInQueue` — Phase 50 explicitly defers these to a future v2.0 polish phase)
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
| Mobile / small-screen optimization (v1.x stance) | Desktop-first through v1.9. **Inverted by v2.0 milestone — see MOBILE-01..06.** |
| Tablet-specific layouts (769–1024px) | Phase 50 keeps tablet at desktop layout; revisit if it becomes a friction point |
| Reduced-motion or haptic-preference UI | Phase 50 has no preference UI — `navigator.vibrate(10)` silently no-ops if API missing |
| LinkedIn queue mobile pass | Phase 50 explicitly defers `LinkedInLessonSelection`, `LinkedInVariantFinalization`, `LinkedInQueue` to a future v2.0 polish phase (LIN-18) |
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

### v2.0 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MOBILE-01 | Phase 50 | Complete (2026-04-20 — useViewport hook + StickyActionBar + Button 44px tap-target floor + Input/Textarea text-base iOS zoom kill + AppLayout safe-area insets; all live-verified on iPhone via Tailscale; commits 6eb8b53..1d2674d; see 50-06-SUMMARY.md MOBILE-01) |
| MOBILE-02 | Phase 50 | Complete (2026-04-20 — Day default on phone + horizontal swipe prev/next (60px/30px-drift) + vertical-scroll preservation + 3-Day scrollable + MonthDotsView dot grid (7-col) + tap-day→DayView; WeekView never mounts on phone; live-verified; commits cdc2179..44c3dda; see 50-06-SUMMARY.md MOBILE-02) |
| MOBILE-03 | Phase 50 | Complete (2026-04-20 — CalendarHeader compact row + CalendarPill 28px min + DayView +New FAB + DayOverflowPopover/CreateItemPopover/InlineTitleEdit as bottom sheets; live-verified; commits 087f2c1..0dce2b9; see 50-06-SUMMARY.md MOBILE-03) |
| MOBILE-04 | Phase 50 | Complete (2026-04-20 — useLongPress 500ms/8px + PillActionSheet (Reschedule/Edit/Delete/Cancel) + datetime-local IST reschedule + haptic; touch drag dead; desktop drag intact; **CONTEXT risk #4 IST correctness verified by sqlite query against actionables.due_at**; commits 1f7f912..6a1769e; see 50-06-SUMMARY.md MOBILE-04) |
| MOBILE-05 | Phase 50 | Complete (2026-04-20 — Overview 1-col metric grid at phone width + PendingTasks grid-cols-3 action row 320px-safe + Drafts Clear-all in StickyActionBar; live-verified; commits bcfe195..6533427; see 50-06-SUMMARY.md MOBILE-05) |
| MOBILE-06 | Phase 50 | Complete (2026-04-20 — 26/26 walkthrough checks PASS on real iPhone via Tailscale to PM2 bot; StatusStrip hotfix commit 71a9b37 applied mid-walkthrough + re-verified; full commit chain 6eb8b53..71a9b37; see 50-06-SUMMARY.md walkthrough log) |

**v2.0 Coverage:**
- v2.0 requirements: 6 total
- Mapped to phases: 6 (Phase 50)
- Unmapped: 0 ✓

### v1.9 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DASH-APP-01 | Phase 45 | Complete (2026-04-20 — /pending-tasks page renders Approve/Reject/Edit per pending row live on http://100.124.47.99:3000/pending-tasks; four JWT-gated POST routes at /api/actionables/:id/{approve|reject|edit|unreject} served by PM2 whatsapp-bot (bundle index-BWm4-BDb.js); SC#1 observed live by owner in 45-04 walkthrough; see 45-04-SUMMARY.md) |
| DASH-APP-02 | Phase 45 | Complete (2026-04-20 — dashboard Approve invokes approveActionable (exported from Plan 45-01), which runs Phase 42 Gemini enrichment + Google Tasks push with the safe fallback inherited from Phase 42; SC#2 observed live — enriched Recent row + self-chat ✅ echo + Google Tasks entry within 3s; SC#5 concurrent WhatsApp race observed live — exactly one Tasks entry + one echo, losing surface got `Already handled in WhatsApp` toast without rollback; see 45-04-SUMMARY.md) |
| DASH-APP-03 | Phase 45 | Complete (2026-04-20 — POST /edit rewrites task text via updateActionableTask, then falls through to approveActionable so one ✅ echo fires with the edited title matching the WhatsApp `edit:` grammar; SC#4 observed live — Hebrew RTL card-morph + Cmd+Enter save + enriched-from-edited-text Recent row within 3s; SC#3 reject+undo within 5s verified live (silent unreject), grace-closed post-10s shows 'Undo window closed' toast; SSE via Plan 43-02 3s hash-poll unchanged; see 45-04-SUMMARY.md) |
| GTASKS-01 | Phase 46 | Complete (Plan 46-01, 2026-04-21 — /api/google-tasks/lists + /items JWT-gated routes in src/api/routes/googleTasks.ts; todoService.getAllTaskLists + getTaskItemsInWindow with per-list Promise.allSettled error isolation; server-side dedup against approved actionables via getApprovedActionableTodoTaskIds; 10/10 vitest green; commits d7217ae + a8794de) |
| GTASKS-02 | Phase 46 | Complete (Plan 46-02, 2026-04-21 — unified /api/calendar/items aggregator 5th allSettled slot invoking fetchGtasksCalendarItems; sources.gtasks added to CalendarEnvelope; hashCalendarEnvelope covers gtasks status bits; partial failure isolated; 23/23 vitest green; commit 9cb40a6) |
| GTASKS-03 | Phase 46 | Complete (Plan 46-03, 2026-04-21 — dashboard CalendarPill SOURCE_STRIPE/BG/ICON maps include gtasks sky fallback + ListTodo icon; per-list color from hashListColor(listId) server-side → sourceFields.color → useCalendarFilter.resolveItemColor with per-list colorOverride layer; 47-03 shipped component infrastructure, 46-03 wired the missing useCalendarStream gtasks slice + schema tightening; commit 34bf971) |
| GTASKS-04 | Phase 46 | Complete (Plan 46-03, 2026-04-21 — CalendarFilterPanel renders Google Tasks section with per-list toggle row + color swatch + item count + gear override (shipped 47-03); useCalendarFilter.filteredItems excludes hidden lists; prefs persist to localStorage key 'calFilterPrefs_v1'; new lists default visible; mobile CalendarFilterPanelSheet opens from CalendarHeader SlidersHorizontal button; commit 34bf971) |
| GTASKS-05 | Phase 46 | Complete (Plan 46-01 server-side dedup via getApprovedActionableTodoTaskIds + Set.has intersection in fetchGtasksCalendarItems; wired into aggregator via Plan 46-02; commits a8794de + 9cb40a6) |
| GCAL-01 | Phase 47 | Complete (Plan 47-01, 2026-04-20) |
| GCAL-02 | Phase 47 | Complete (Plan 47-01, 2026-04-20) |
| GCAL-03 | Phase 47 | Complete (Plan 47-02, 2026-04-21 — aggregator 4th slot + sources.gcal) |
| GCAL-04 | Phase 47 | Complete (Plan 47-03, 2026-04-21 — dashboard CalendarFilterPanel gcal section + useCalendarStream gcal slice + CalendarPill gcal visuals) |
| GCAL-05 | Phase 47 | Complete (Plan 47-01, 2026-04-20) |
| GCAL-06 | Phase 47 | Complete (Plan 47-03, 2026-04-21 — gcal pills read-only: draggable gated on isReadOnly, onDelete suppressed, InlineTitleEdit suppressed, PillActionSheet shows 'Open in Google Calendar' anchor only) |
| LIN-NEW-01 | Phase 48 | In Progress (Plans 48-01 pm-authority + 48-02 proxy shipped 2026-04-20; awaits Plan 48-03 dashboard UI) |
| VER-01 | Phase 49 | Not started |

**v1.9 Coverage:**
- v1.9 requirements: 16 total
- Mapped to phases: 16 (Phases 45-49)
- Unmapped: 0 ✓

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
| ENRI-01 | Phase 42 | Complete (2026-04-20 — enrichmentService.ts calls generateJson with last 10 messages + Zod EnrichmentSchema; 8 vitest cases green; user_command skip confirmed live via NULL enriched_title rows) |
| ENRI-02 | Phase 42 | Complete (2026-04-20 — EnrichmentSchema describe() strings require contact name + deadline in title; Zod min:1/max:200 enforced; approvalHandler wires enriched title to createTodoTask) |
| ENRI-03 | Phase 42 | Complete (2026-04-20 — EnrichmentSchema note field requires contact name + snippet + trigger text; buildBasicNote fallback preserves same fields; approvalHandler passes enrichment.note to createTodoTask) |
| ENRI-04 | Phase 42 | Complete (2026-04-20 — 4 fallback cases tested: null response, safeParse fail, throw, whitespace title; status flipped before enrichActionable called so failure cannot block approval; approvalHandler case (b) confirms flow with Tasks disconnected) |
| DASH-ACT-01 | Phase 43 | Complete (2026-04-20 — /pending-tasks page renders every pending_approval row as a card with contact, task headline, line-clamp-6 source snippet, absolute IST `detectedAt`, per-row RTL/LTR via `detectedLanguage`; useActionablesStream + 5s polling fallback) |
| DASH-ACT-02 | Phase 43 | Complete (2026-04-20 — Recent section renders 50 most-recent terminal rows with enriched title as headline, `Originally: <originalDetectedTask>` secondary when enrichment rewrote it, color-coded approved/rejected/expired badges, filter chips All/Approved/Rejected/Expired, enriched-note preview, Google Tasks link when todoTaskId set) |

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
*Last updated: 2026-04-20 — v2.0 Dashboard UX Polish requirements seeded (6 items: MOBILE-01..06 covering global mobile primitives, calendar mobile strategy, daily-driver page polish, live phone walkthrough)*

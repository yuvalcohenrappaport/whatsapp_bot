# Requirements: WhatsApp Bot

**Defined:** 2026-03-30 (v1.6) · updated 2026-04-12 (v1.7)
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.7 Requirements

Requirements for the LinkedIn Bot Dashboard Integration milestone. Each maps to roadmap phases. Owning repo: whatsapp-bot (dashboard + proxy routes). Cross-repo side work: a new FastAPI sidecar service in ~/pm-authority.

### API & Proxy

- [ ] **LIN-01**: User can start a long-running pm-authority HTTP service exposing read + mutate endpoints for post state, variants, and lesson candidates over localhost (127.0.0.1 only, no auth — local binding is the security boundary)
- [ ] **LIN-02**: User can open the whatsapp-bot dashboard and it fetches LinkedIn post data via Fastify proxy routes forwarding to the pm-authority HTTP service, with typed Zod schemas and error pass-through

### Queue & Status (Read)

- [ ] **LIN-03**: User can view a `/linkedin/queue` dashboard page listing all posts in `DRAFT`, `PENDING_VARIANT`, `PENDING_LESSON_SELECTION`, or `PENDING_PII_REVIEW` with status badge, content preview, and image thumbnail
- [ ] **LIN-04**: User can see a status strip on the queue page showing next publish slot (Tue/Wed/Thu 06:30 IDT), pending count, approved count, and last published post preview
- [ ] **LIN-05**: User can view a recent-published history tab listing the last N published posts with published_at, LinkedIn permalink, content preview, and basic metrics when available
- [ ] **LIN-06**: User sees the queue auto-refresh via SSE on post state changes without manual page reload

### Review Actions (Write)

- [ ] **LIN-07**: User can approve or reject any post from the dashboard via per-post action buttons
- [ ] **LIN-08**: User can edit a post's content inline in the dashboard (Hebrew and English sides separately for bilingual posts)
- [ ] **LIN-09**: User can regenerate any post with a live status indicator while Claude CLI runs, respecting the existing 5-regeneration cap
- [ ] **LIN-10**: User can replace a post's image by uploading a new file via drag-and-drop; the upload passes through the existing `PENDING_PII_REVIEW` gate

### Lesson Mode UX

- [ ] **LIN-11**: User can pick one of 4 candidate lessons for a `PENDING_LESSON_SELECTION` post via a dashboard card list showing lesson text + rationale
- [ ] **LIN-12**: User can pick one of 2 full-post variants for a `PENDING_VARIANT` post via a side-by-side dashboard view showing content + image prompt
- [ ] **LIN-13**: User can see the generated fal.ai image inline on the variant card once image generation completes (replaces the current "file path only" state)
- [ ] **LIN-14**: User can start a new lesson-mode generation run from a dashboard form with project-picker dropdown, perspective, and language fields (replaces the SSH + `generate.py --mode lesson` CLI workflow)

## Previous Milestones

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

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIN-01 | Phase 33 | In Progress (33-01 done: scaffold + /v1/health; 33-02 done: read endpoints + image streaming; 33-03 done: JobTracker + state_guard + fast mutations + /v1/jobs; 33-04 done: slow mutations + REAL /v1/lesson-runs call-through; 33-05 e2e walkthrough remaining) |
| LIN-02 | Phase 34 | Pending |
| LIN-03 | Phase 35 | Pending |
| LIN-04 | Phase 35 | Pending |
| LIN-05 | Phase 35 | Pending |
| LIN-06 | Phase 35 | Pending |
| LIN-07 | Phase 36 | Pending |
| LIN-08 | Phase 36 | Pending |
| LIN-09 | Phase 36 | Pending |
| LIN-10 | Phase 36 | Pending |
| LIN-11 | Phase 37 | Pending |
| LIN-12 | Phase 37 | Pending |
| LIN-13 | Phase 37 | Pending |
| LIN-14 | Phase 38 | Pending |

**Coverage:**
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
*Last updated: 2026-04-12 — v1.7 requirements mapped to Phases 33-38*

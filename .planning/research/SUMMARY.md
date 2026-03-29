# Project Research Summary

**Project:** WhatsApp Bot — Scheduled Message Delivery Milestone
**Domain:** Scheduled recurring messaging with voice/AI generation added to existing WhatsApp bot
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

This milestone adds a scheduled message delivery system to an existing production WhatsApp bot. The bot already has a two-tier scheduler (setTimeout + hourly DB scan) for reminders, an ElevenLabs TTS voice pipeline, a Gemini AI pipeline, self-chat approval flows, and a React dashboard — all of which are directly reusable here. The recommended approach is to mirror the existing `reminderScheduler.ts` pattern in a new `src/scheduled/` module, add a `scheduledMessages` DB table, expose CRUD routes, and add a dashboard page. Net new dependencies are exactly two: `cronstrue` (human-readable cron display) and `p-queue` promoted from transitive to direct (TTS concurrency control). The DB schema is the root blocker — every other component depends on it.

The key risks are all in the scheduler's failure modes, not in feature complexity. Double-fire on reconnect, recurring schedule corruption after a mid-fire crash, cancel window races, and Baileys stale-socket silent drops are the four patterns most likely to cause subtle production bugs. All are preventable with patterns the codebase already uses: dedup guards in the activeTimers Map, `db.transaction()` for atomic status transitions, DB-persisted cancel state (not in-memory), and `Promise.race` timeouts on every external API call.

The feature scope is well-bounded. P1 is one-time text scheduling with a cancel window and dashboard CRUD. P2 adds voice content type, AI prompt content type, and simple recurrence — all bolt-on additions that do not change the core fire path. Anti-features to avoid permanently: complex RRULE recurrence, bulk broadcast, message templates with variable substitution, and any persistent job queue library (the existing two-tier scheduler is already proven and sufficient).

---

## Key Findings

### Recommended Stack

The stack requires minimal additions. Only two dependencies are new: `cronstrue` for translating cron expressions to human-readable text in the dashboard, and `p-queue` promoted from a transitive dependency to a direct one for serializing ElevenLabs TTS calls. Everything else — `node-cron`, Drizzle/SQLite, Fastify, React + shadcn/ui, TanStack Query, Gemini, ElevenLabs — is already installed and directly usable. All `node-cron` v4 APIs needed (`validate()`, `getNextRun()`, timezone support) were runtime-verified in the project's `node_modules`.

**New or promoted dependencies:**
- `cronstrue` ^2.26.0 — cron-to-English translation in dashboard — zero-dep, ESM native, Hebrew locale, standard choice
- `p-queue` ^9.1.0 — serialize TTS calls to respect ElevenLabs concurrency cap — already in node_modules as transitive dep; promotes to direct for version pinning

**Existing stack extended (not replaced):**
- `node-cron` 4.2.1 — recurring cron job execution using `validate()` + `getNextRun()` + timezone option
- Drizzle/SQLite — new `scheduled_messages` table following existing schema conventions
- Gemini (`generateText`) — AI message generation at fire time, reusing `buildSystemPrompt`
- ElevenLabs TTS — voice message generation at fire time via existing `textToSpeech()`
- Fastify 5 — new `/api/scheduled-messages` CRUD routes registered the same way as reminders
- React 19 + shadcn/ui — new `ScheduledMessages.tsx` page mirroring `Reminders.tsx`

**What to explicitly avoid:** `bull`/`bullmq` (needs Redis), `agenda` (needs MongoDB), `react-js-cron` (needs Ant Design), `luxon` (overkill — node-cron handles timezone), `cron-parser` (redundant with node-cron v4's built-in `getNextRun()`).

### Expected Features

**Must have (table stakes — P1):**
- `scheduledMessages` DB table with status, nextRunAt, cronExpression, notificationMsgId columns
- One-time text message scheduling to a contact or group
- Extend existing hourly scan to cover `scheduledMessages` (thin wrapper over `reminderScheduler.ts`)
- Pre-send self-chat notification with 5-minute cancel window (owner replies to abort)
- Dashboard page: list, create, edit, cancel — mirroring existing Reminders page
- Status lifecycle: `pending` → `sent` / `cancelled` / `failed`

**Should have (differentiators — P2):**
- Voice message content type — existing ElevenLabs pipeline, generate at fire time
- AI prompt content type — owner writes prompt; Gemini generates content at fire time
- Simple recurrence (daily / weekly / monthly) — insert-next-row on fire, not a complex engine
- Configurable cancel window per message (default 5 min; range 0–300s)
- `sentAt` timestamp for delivery audit

**Defer (v2+):**
- Recurrence end date / max occurrences — only if owner actually uses recurrence heavily
- Message preview in pre-send notification for AI content — useful but post-MVP
- Complex RRULE recurrence — permanently out of scope (iCal boundary cases are a rabbit hole)
- Bulk broadcast — permanently out of scope (WhatsApp ban risk)

### Architecture Approach

The architecture is a clean addition to an established layered structure. A new `src/scheduled/` directory (mirroring `src/reminders/`) contains the scheduler and service. Three small modifications to existing files wire everything in: `src/index.ts` calls `initScheduledMessageSystem()` on connect, `messageHandler.ts` adds one `tryHandleScheduledMessageApproval` call to the self-chat chain, and `server.ts` registers the new routes. One new AI function (`generateScheduledContent`) is added to `gemini.ts` — it reuses the existing `buildSystemPrompt` but takes a prompt hint instead of chat history, because outbound scheduled messages have no inbound reply context.

**Major components:**
1. `src/db/schema.ts` (modified) + `src/db/queries/scheduledMessages.ts` (new) — data layer; root blocker for all other work
2. `src/scheduled/scheduledMessageScheduler.ts` (new) — timer management: `activeTimers` Map for one-off/interval, `activeCrons` Map for cron-expression recurring, hourly scan, startup bootstrap
3. `src/scheduled/scheduledMessageService.ts` (new) — fire logic, approval notification, recovery, `tryHandleScheduledMessageApproval` export
4. `src/api/routes/scheduledMessages.ts` (new) — CRUD + manual-fire endpoints; registered in `server.ts`
5. `dashboard/src/pages/ScheduledMessages.tsx` (new) — list view + create form; backed by React Query hook

**Build order is strictly sequential:** schema → DB queries → scheduler → AI function → service → wire into index/messageHandler → API routes → dashboard.

### Critical Pitfalls

1. **Double-fire on reconnect** — `initScheduledMessageSystem()` is called on every Baileys reconnect. Without a dedup guard, timers are registered twice and the message fires twice. Prevention: replicate the `activeTimers.has(id)` guard from `reminderScheduler.ts` exactly; re-read `status` from DB before arming any timer.

2. **Recurring schedule lost after mid-fire crash** — if the process dies between writing `status='fired'` and writing the new `nextFireAt`, the recurring schedule is silently dead. Prevention: wrap both writes in a single `db.transaction()`; store `cronExpression` as a string from day one so recovery can recompute `nextFireAt`.

3. **Cancel window race** — the timer fires and the owner's "CANCEL" reply arrive in the same event loop window; the send wins because it was queued first. Prevention: write `cancelRequestedAt` to the DB (not an in-memory flag) when CANCEL arrives; timer callback reads this field synchronously before calling `sendMessage`. PM2 reloads wipe in-memory state — always use the DB.

4. **Baileys stale socket silently drops sends** — RC9 returns a non-null `sock` that is actually dead. `sendMessage` hangs or returns silently with `status='fired'` written. Prevention: wrap every scheduled `sock.sendMessage()` in `Promise.race([..., rejectAfter(15_000)])`; write `status='send_failed'` on timeout; retry up to 3 times via hourly scan; alert owner after 3 failures.

5. **AI/TTS timeout blocks fire callback** — Gemini 2.5-flash has a documented socket-stall bug; ElevenLabs has no built-in timeout. A stuck `await` permanently freezes that callback. Prevention: wrap every Gemini and ElevenLabs call in `Promise.race([..., rejectAfter(30_000)])`; fall back to text-only on TTS timeout.

6. **DST shift corrupts `nextFireAt`** — adding a fixed ms interval drifts by ±1 hour on Israel's clock-change days (last Friday of March, last Sunday of October). Prevention: store recurrence as a cron string, never as an interval ms; compute `nextFireAt` via `node-cron.schedule(...).getNextRun()` with `timezone: 'Asia/Jerusalem'`.

---

## Implications for Roadmap

Based on research, the build order is dictated by hard dependencies: schema first, then queries, then scheduler, then service, then API, then dashboard. Within P2 (voice, AI, recurrence), voice and AI are parallel to each other; recurrence is last.

### Phase 1: DB Foundation
**Rationale:** Every other component depends on the table existing. Schema mistakes propagate everywhere — getting this right first prevents later migrations. The DST pitfall (pitfall 6) must also be addressed here by storing `cronExpression` as a string, not an interval.
**Delivers:** `scheduled_messages` table with all required columns and indexes; `src/db/queries/scheduledMessages.ts` with all query functions; Drizzle migration SQL.
**Addresses:** Status lifecycle, nextRunAt, cronExpression, notificationMsgId columns that all P1 and P2 features depend on.
**Avoids:** DST drift (store cron string, not interval ms from the start); recurring schedule corruption (columns support transaction-safe atomic updates).

### Phase 2: Core Scheduler + Text Scheduling (P1)
**Rationale:** First working end-to-end path: create a one-time text scheduled message, have it fire correctly, handle reconnect dedup, survive a crash and recover. This is the load-bearing beam everything else sits on.
**Delivers:** `scheduledMessageScheduler.ts` with activeTimers + activeCrons + hourly scan + startup bootstrap; one-time text send working end-to-end; `initScheduledMessageSystem()` wired into `src/index.ts`; reconnect dedup guard; crash recovery.
**Addresses features:** One-time text scheduling, status lifecycle, hourly scan extension.
**Avoids:** Double-fire on reconnect (pitfall 1); Baileys stale sock (pitfall 4 — add `Promise.race` timeout wrapper here).

### Phase 3: Cancel Window + Self-Chat Approval (P1)
**Rationale:** The cancel window is a P1 safety requirement for a bot that impersonates the owner. It must use DB-persisted state (not in-memory) to survive PM2 reloads. Wire `tryHandleScheduledMessageApproval` into `messageHandler.ts` here.
**Delivers:** Pre-send self-chat notification; DB-persisted `cancelRequestedAt` cancel state; `tryHandleScheduledMessageApproval` in self-chat handler chain; configurable cancel window defaulting to 5 min.
**Addresses features:** Pre-send self-chat notification with cancel window, owner cancel flow.
**Avoids:** Cancel window race (pitfall 3 — DB state, not in-memory Map).

### Phase 4: API Routes + Dashboard (P1)
**Rationale:** Once the backend fires correctly and the cancel window works, expose the full CRUD surface. Build list view first (simpler), then create form.
**Delivers:** `src/api/routes/scheduledMessages.ts` with CRUD + manual-fire; `ScheduledMessages.tsx` page with list and create form; React Query hook; contact picker reusing existing contacts API.
**Uses stack:** `cronstrue` for live cron preview in create form; Fastify JWT middleware on all endpoints; TanStack Query for data fetching.
**Addresses features:** Dashboard list/create/edit/cancel, cronstrue human-readable schedule display.

### Phase 5: Voice + AI Content Types (P2)
**Rationale:** Voice and AI are parallel additions — both bolt onto the same fire path without changing the scheduler or the cancel window. Requires `p-queue` for TTS concurrency and `generateScheduledContent` for AI content. Do these together since both involve fire-time generation with timeout guards.
**Delivers:** Voice message content type (ElevenLabs at fire time via `p-queue`); AI prompt content type (`generateScheduledContent` added to gemini.ts); `Promise.race` timeout wrappers on both pipelines.
**Addresses features:** Voice scheduling, AI prompt scheduling, TTS concurrency control.
**Avoids:** AI/TTS timeout blocking fire callback (pitfall 5); ElevenLabs 429 cascading failures (p-queue concurrency:1).

### Phase 6: Simple Recurrence (P2)
**Rationale:** Recurrence is an insert-next-row approach with no separate recurrence engine. It builds on the confirmed working fire path from Phase 2. Add daily/weekly/monthly only — cron strings map directly to these. Add DST unit tests here.
**Delivers:** Cron-expression recurring support in scheduler (activeCrons Map + fire-then-rearm); interval-based recurring (update scheduledAt + re-enter scheduler); startup recovery for missed recurring fires; unit tests for `computeNextFireAt()` at March and October DST transition moments.
**Addresses features:** Simple recurrence, recurrence display in dashboard.
**Avoids:** DST drift (pitfall 6 — unit tested here); recurring schedule lost after crash (pitfall 2 — transaction verified here).

### Phase Ordering Rationale

- Schema is the unconditional root blocker — nothing can be built without it, and schema design decisions (cron string storage) prevent pitfall 6.
- Text scheduling (Phase 2) must be end-to-end working before adding the cancel window (Phase 3), because the cancel window wraps the fire path.
- API + dashboard (Phase 4) comes after the backend is stable — building the UI on a still-changing backend wastes iteration cycles.
- Voice and AI (Phase 5) are parallel to each other and sequential after Phase 4 — they add content types to a confirmed stable pipeline.
- Recurrence (Phase 6) is last because it depends on the fire path being thoroughly tested, and recurrence bugs (silent schedule death) are the hardest to detect without a stable baseline.

### Research Flags

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1 (DB schema):** Directly mirrors existing `reminders` table; all column decisions are made in research.
- **Phase 2 (core scheduler):** Direct mirror of `reminderScheduler.ts`; APIs runtime-verified.
- **Phase 3 (cancel window):** `notificationMsgId` pattern already in use in three places in the codebase.
- **Phase 4 (API + dashboard):** Standard CRUD; follows established Fastify route + React Query patterns already in the project.

Phases that may benefit from additional research during planning:
- **Phase 5 (voice + AI):** ElevenLabs concurrency behavior under simultaneous fires should be verified if account plan is above Free tier. Gemini 2.5-flash socket-stall bug should be re-checked if the SDK is upgraded before this phase.
- **Phase 6 (recurrence):** Verify that the test environment can mock `Date.now()` in a way that node-cron's internal clock respects, before writing DST unit tests.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs runtime-verified in project's node_modules; ElevenLabs concurrency limits from official docs |
| Features | HIGH | Codebase integration points directly inspected; feature dependencies clearly mapped |
| Architecture | HIGH | Based on direct codebase analysis of all relevant source files; build order confirmed by dependency graph |
| Pitfalls | HIGH | 4 of 6 pitfalls backed by specific GitHub issues and official docs; 2 from codebase inspection of existing failure modes |

**Overall confidence:** HIGH

### Gaps to Address

- **Baileys RC version:** RC9 has the stale-socket bug (issue #2132). Before implementation starts, check if a newer RC or stable release has fixed it. The `Promise.race` timeout mitigation is required regardless.
- **ElevenLabs plan tier:** `p-queue` concurrency is set to 1 (conservative for Free tier). If the account is on Starter or Creator tier (3–5 concurrent), concurrency can be raised. Verify plan tier at Phase 5 implementation time.
- **`buildSystemPrompt` visibility in gemini.ts:** It is currently an internal (non-exported) function. It needs to be exported or its relevant logic extracted before `generateScheduledContent` can reuse it. Flag this at Phase 5 planning.
- **Dashboard contact picker:** Verify that the existing `/api/contacts` endpoint returns enough data (JID + display name) for the recipient picker without requiring an endpoint change.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `src/reminders/reminderScheduler.ts`, `reminderService.ts`, `src/groups/reminderScheduler.ts`, `src/db/schema.ts`, `src/pipeline/messageHandler.ts`, `src/calendar/personalCalendarPipeline.ts`, `src/voice/tts.ts`, `src/whatsapp/sender.ts`, `src/ai/gemini.ts`, `src/api/server.ts`, `src/index.ts`
- Runtime verification: `node-cron` 4.2.1 APIs (`validate()`, `getNextRun()`, `Asia/Jerusalem` timezone) tested in project's node_modules
- Runtime verification: `p-queue` 9.1.0 API tested in project's node_modules
- ElevenLabs concurrent request limits: https://help.elevenlabs.io/hc/en-us/articles/14312733311761
- `cronstrue` README: https://github.com/bradymholt/cRonstrue

### Secondary (MEDIUM confidence)
- Baileys RC9 stale-socket bug: https://github.com/WhiskeySockets/Baileys/issues/2132, issue #2098
- node-cron DST issues: node-cron/node-cron #157, kelektiv/node-cron #881
- Gemini 2.5-flash socket stall: googleapis/python-genai #1893, Google AI Developers Forum — 120s timeout thread
- ElevenLabs 429 handling: https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429
- SQLite WAL concurrent writes: https://www.sqlite.org/wal.html
- AppSignal: Job schedulers for Node (Bull vs Agenda benchmark)
- LogRocket: Comparing best Node.js schedulers

### Tertiary (LOW confidence)
- WhatsApp ban risk from automated sends: whautomate.com/top-reasons-why-whatsapp-accounts-get-banned-2025 — general guidance; actual ban threshold for personal-scale bots is unknown

---

*Research completed: 2026-03-30*
*Ready for roadmap: yes*

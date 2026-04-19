# Phase 39: Actionables Data Model & Migration - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the unified `actionables` table with the full lifecycle schema, ship a Drizzle migration that runs cleanly + idempotently against the current production DB, and backfill in-flight rows from the legacy `reminders (source='commitment')` and `todoTasks` tables into the new model without losing Google Tasks IDs.

Out of this phase: changing the detection pipeline (Phase 40), shipping the approval UX (Phase 41), context enrichment (Phase 42), dashboard views (Phase 43).

</domain>

<decisions>
## Implementation Decisions

### Backfill semantics — grandfather vs re-gate

**Rule: don't force re-approval for anything that's already in Google Tasks.** Only re-gate items that never reached Google Tasks (mid-detection, sync failures).

Mapping from legacy rows → `actionables`:

| Legacy source | Legacy status | → `actionables.status` | Notes |
|---|---|---|---|
| `reminders(source='commitment')` | `pending` | `approved` | Already pushed to Google Tasks; keep `todoTaskId`/`todoListId`; fireAt timer re-armed if future |
| `reminders(source='commitment')` | `fired` | `fired` | Terminal |
| `reminders(source='commitment')` | `cancelled` | `rejected` | Terminal |
| `reminders(source='commitment')` | `skipped` | `expired` | Terminal |
| `reminders(source IS NULL)` (self-chat user commands) | `pending` | `approved` | DETC-03 semantics — user-initiated, already acted on; timers re-armed |
| `reminders(source IS NULL)` | `fired` / `cancelled` / `skipped` | `fired` / `rejected` / `expired` | Terminal mapping |
| `todoTasks` | `synced` | `approved` | Already in Google Tasks; keep `todoTaskId`/`todoListId` |
| `todoTasks` | `pending` | `pending_approval` | Never synced — apply the new gate so the user sees them in the preview flow once v1.8 ships |
| `todoTasks` | `failed` | `pending_approval` | Sync failed — same treatment as pending |
| `todoTasks` | `cancelled` | `rejected` | Terminal |

### Legacy table fate — code-level retire, SQL-level keep

- The Drizzle schema removes `todoTasks` and stops importing legacy `reminders` query functions from the code path (done in Phases 40 and 41, not here — Phase 39 just creates the new table and backfills)
- The SQLite tables themselves are **left in place, untouched** — no DROP, no RENAME — so rollback is trivial if a bug surfaces in v1.8 phases
- Formal cleanup (DROP TABLE + migration) deferred to a future milestone — not in v1.8 scope

### Schema shape

Columns on the `actionables` table:

- `id` (UUID, PK)
- `sourceType` — enum `'commitment' | 'task' | 'user_command'` (kept distinct for analytics + pipeline routing)
- `sourceContactJid` — for `user_command` this is `config.USER_JID`; otherwise the contact's JID
- `sourceContactName` — snapshot at detection time (contact may be renamed later)
- `sourceMessageId` — WhatsApp message id of the trigger (nullable for `user_command` which has no inbound message)
- `sourceMessageText` — snapshot of the full trigger text
- `detectedLanguage` — `'he' | 'en'` snapshot at detection time; approval preview and confirmations render in this language
- `originalDetectedTask` — immutable audit field: exactly what Gemini extracted (or what the user typed for `user_command`)
- `task` — mutable; starts = `originalDetectedTask`; replaced by `edit: <text>` approval grammar
- `status` — enum `'pending_approval' | 'approved' | 'rejected' | 'fired' | 'expired'`
- `detectedAt` — ms epoch
- `fireAt` — ms epoch, nullable (null for timeless tasks)
- `enrichedTitle` — populated by Phase 42 on approval; null until then
- `enrichedNote` — populated by Phase 42 on approval; null until then
- `todoTaskId` — Google Tasks id, nullable (null for rejected/expired or pre-approval)
- `todoListId` — Google Tasks list id, nullable
- `approvalPreviewMessageId` — WhatsApp message id of the self-chat preview (used by Phase 41 for quoted-reply matching)
- `createdAt`, `updatedAt` — standard timestamps

### Source-chat context for later enrichment (Phase 42)

- Phase 42 will **re-fetch** the last ~10 messages from the source chat at approval time — no snapshot stored on `actionables`
- Reason: the user may keep chatting between detection and approval; fresh messages may matter more than the detection-time window
- The `messages` table already has FTS5 + JID indexing — queries are cheap

### Retention — keep forever for v1.8

- No time-based GC for rejected/expired actionables in v1.8
- Dashboard `/actionables` audit view (Phase 43) uses a `LIMIT 50` query on recent terminal states
- If DB size becomes a real problem, add retention policy in a later milestone — not v1.8 scope

### Migration mechanics (Claude's discretion)

- Hand-written SQL migration (per the existing convention after `0010` — FTS5 forced hand-rolled)
- Migration runs in a single transaction
- Idempotent guard: check if `actionables` table exists at the top of the migration; no-op if it does
- Indexes on `status`, `detectedAt DESC`, `sourceContactJid` — final index list is Claude's call
- Backfill SQL runs after the CREATE TABLE; uses `INSERT ... SELECT` with the mappings above

### Claude's Discretion

- Exact column types (TEXT vs INTEGER for timestamps — follow existing `scheduled_messages` conventions)
- Index strategy and names
- Drizzle schema file layout (one file or split by table — follow `schema.ts` conventions)
- Migration file naming (continue from `0011` or whatever the latest is)
- Query function signatures, beyond the canonical list in SC#5 of the phase definition
- Whether to use Drizzle `sql` helpers or raw SQL strings for the backfill step

</decisions>

<specifics>
## Specific Ideas

- Follow the same "hand-written migration, never run `db:generate` after the FTS5 boundary" convention that v1.5+ migrations use
- Backfill should be logged at INFO level so the first post-deploy startup shows "backfilled N commitment-source reminders, M todoTasks into actionables"
- Preserve `config.USER_JID` as the `sourceContactJid` for `user_command` rows — makes the data model uniform and avoids a special null-handling branch in Phase 41

</specifics>

<deferred>
## Deferred Ideas

- Retention / GC policy for old rejected/expired actionables — future milestone
- Formal DROP of legacy `todoTasks` and commitment-source rows in `reminders` — future cleanup pass, not v1.8
- `actionables.editedAt` / `approvedAt` / `firedAt` per-transition timestamps — skip unless a real audit need surfaces (current `detectedAt` + `updatedAt` is enough for v1.8)
- Dashboard write mutations against `actionables` — explicit v1.8 out-of-scope; approve/reject/edit stays WhatsApp-only

</deferred>

---

*Phase: 39-actionables-data-model*
*Context gathered: 2026-04-19*

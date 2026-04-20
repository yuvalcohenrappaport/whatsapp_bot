# Phase 45: Dashboard Pending-Tasks Write Actions - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The Phase 43 read-only `/pending-tasks` page gains per-row Approve / Reject / Edit controls that route through the Phase 41 `approvalHandler` so the outcome is byte-identical to a WhatsApp quoted-reply — including Phase 42 Gemini enrichment, Google Tasks sync, and the existing self-chat confirmation messages. Write paths are JWT-gated, idempotent against concurrent WhatsApp replies on the same row, and surface via the existing `actionables` SSE stream.

Out of scope: bulk actions, filter-based batch approvals, mobile-specific UX, and any changes to the WhatsApp-side approval grammar.

</domain>

<decisions>
## Implementation Decisions

### Button UX on pending cards
- **Placement:** Inline row at card bottom, always visible (not hover-only, not kebab menu). Three buttons in a single horizontal row.
- **Labels:** Icon + text — `✅ Approve`, `✏️ Edit`, `❌ Reject`. Match the existing LinkedIn queue action language.
- **Destructive UX for Reject:** Fire-and-forget on click, no modal. Show a toast `Rejected — Undo` for ~5s with a one-click Undo affordance.
- **Keyboard shortcuts:** None on the row (mouse-first). Inside the Edit textarea, Esc cancels and Cmd/Ctrl+Enter saves.

### Inline Edit flow
- **Editor UI:** Inline — the card morphs in place. Task headline becomes a textarea; source snippet, contact, and timestamp stay visible above for context.
- **Action buttons in edit mode:** `Cancel` and `Save & Approve` only. No standalone "Save" — edit implies approve, matching the WhatsApp `edit: <text>` grammar in `approvalHandler.ts:153-164`.
- **Keyboard:** Esc cancels, Cmd/Ctrl+Enter triggers `Save & Approve`.
- **RTL handling:** Textarea direction matches the row's `detectedLanguage` — Hebrew rows get an RTL textarea, English rows get LTR. Mirrors the Phase 43 end-to-end RTL lock.

### Click-through behavior (optimism + latency)
- **Approve/Reject:** Optimistic. Row vanishes instantly on click. SSE confirms the transition when the server processes it. On server error, row snaps back and an error toast surfaces.
- **Approve latency:** Approve takes 3–5s for Gemini enrichment + Google Tasks sync. During that window the row is simply gone from Pending; it reappears in the Recent section (with enriched title) as soon as SSE delivers the terminal-status update. No "Approving…" chrome.
- **Enrichment/Tasks failure:** Inherit Phase 42 fallback semantics — approval succeeds even if enrichment or Google Tasks push fails. The Recent row shows the non-enriched title in that case (no extra dashboard-side error).

### Toasts and feedback
- **Success toasts:** Minimal — only Reject shows `Rejected — Undo`. Approve and Edit have no success toast (the row transition through SSE into Recent is the feedback).
- **Error toasts:** Single channel for all write failures. Copy distinguishes `Already handled in WhatsApp` (race), `Network error — retry`, and generic server errors. Row rollback happens on error.

### Cross-surface parity with WhatsApp
- **Approve echo:** Yes — `approveAndSync` fires the same `✅ Added` / `✅ נוסף` self-chat message it fires today. A single WhatsApp audit trail regardless of which surface triggered the action.
- **Reject echo:** Yes — same symmetric behavior. Dashboard-initiated reject produces the same `❌ Dismissed` / `❌ בוטל` self-chat line.
- **Edit echo:** Edit = save + approve path, so same as approve — the WhatsApp confirmation shows the post-edit task text (matching the existing `approvalHandler` behavior where the edit-then-approve sequence produces one confirmation with the edited title).

### Concurrent WhatsApp race handling
- **Detection:** Server MUST be the arbiter — any write route checks current status in the same transaction as the mutation, and rejects with a structured `already_handled` response if the row is no longer `pending_approval`.
- **Dashboard UX on race:** Toast `Already handled in WhatsApp` + row stays gone (do NOT rollback, since the end state is correct). SSE will populate the Recent section with the WhatsApp-driven terminal row.
- **Idempotency guarantee:** A second identical Approve/Reject call after the first succeeds MUST not double-push to Google Tasks, double-send WhatsApp confirmations, or produce a status-transition error. Safe to retry on network flake.

### Undo for Reject
- **Window:** ~5s from the toast appearing.
- **Mechanism:** Server exposes an "unreject" write path that flips `rejected → pending_approval` only when the row is currently `rejected` AND was rejected within a short grace window (server-enforced, not client-trusted).
- **WhatsApp behavior on Undo:** Silent. No compensating WhatsApp message is sent. The original Reject echo (if already delivered to self-chat) remains visible — acceptable trade-off to keep WhatsApp uncluttered.

### Claude's Discretion
- HTTP verb and exact URL shape for the three write routes (`POST /api/actionables/:id/approve`, `:id/reject`, `:id/edit`, `:id/unreject` — or alternative).
- Whether `approveAndSync` is refactored to accept a `sock: WASocket | null` vs extracted into a reusable service shared by WhatsApp + dashboard. Planner picks the cleanest factoring.
- Zod schema locations (mirror the Phase 43 `actionablesSchemas` module or co-locate).
- Exact toast component — use the existing shadcn toast primitive already on the dashboard.
- Optimistic-update mechanism — direct state mutation in the existing `useActionablesStream` hook vs a separate mutation hook that invalidates/patches. Pick based on current patterns.
- Undo implementation — client-side timer + deferred commit vs immediate server-side reject-with-grace. Server-side grace is preferred for correctness but Claude picks.
- Loading / disabled-button visuals during in-flight state.
- Precise toast copy wording (English/Hebrew consistency with existing dashboard strings).

</decisions>

<specifics>
## Specific Ideas

- **LinkedIn queue page (Phase 36) is the reference** for optimistic Approve/Reject/Edit with rollback. Re-use its mutation-hook pattern, toast usage, and error surfacing.
- **`approvalHandler.approveAndSync` in `src/approval/approvalHandler.ts`** is the existing single source of truth for approve semantics (enrich → Google Tasks push → status flip → self-chat confirm). Dashboard routes MUST funnel through it (or through a shared service extracted from it) — not a parallel implementation.
- **Phase 43 CONTEXT + shipped `PendingTasks.tsx`** locks the visual card shape: Hebrew rows render RTL end-to-end, full multi-line source snippet, absolute IST timestamp, amber arrival flash. Phase 45 must preserve all of that.
- **Edit = Save & Approve** is the WhatsApp grammar from `replyParser` — do not invent a "Save only" semantic on the dashboard.

</specifics>

<deferred>
## Deferred Ideas

- Bulk Approve / Reject All — future enhancement, not in DASH-APP-01..03 scope.
- Keyboard shortcuts on focused cards (A / R / E) — deferred; current phase is mouse-first.
- Mobile-specific touch UX — out of scope; dashboard is desktop-first.
- Editing an already-approved Google Task (post-approval edit) — separate concern, not part of Phase 45.
- Analytics / telemetry on which surface was used (dashboard vs WhatsApp) — future observability phase.

</deferred>

---

*Phase: 45-dashboard-pending-tasks-write-actions*
*Context gathered: 2026-04-20*

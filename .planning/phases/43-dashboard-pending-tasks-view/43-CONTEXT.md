# Phase 43: Dashboard Pending Tasks View - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

A read-only React dashboard page in whatsapp-bot that lists pending actionables and a recent audit trail of approved/rejected/expired actionables, backed by a new JWT-gated Fastify REST route against the existing `actionables` query layer. Live updates via the existing dashboard SSE channel (or a manual-refresh fallback). The page performs no mutations — approve/reject/edit stay in WhatsApp per v1.8 milestone scope.

</domain>

<decisions>
## Implementation Decisions

### Route & Page Structure
- **Route path:** `/pending-tasks` (user-facing term over internal `actionables`)
- **Default landing section:** Pending (if layout ends up tabbed)
- **Sidebar nav:** New top-level entry in the dashboard sidebar (not nested under an existing group)

### Row / Card Design (Pending)
- **Primary emphasis:** Proposed task text is the headline; contact name is secondary metadata
- **Source snippet:** Rendered full multi-line on the card (wrapped, capped at a reasonable line count — Claude picks exact cap)
- **Language rendering:** Mirror language direction per row — Hebrew rows render RTL end-to-end (task + snippet), English rows render LTR. No blanket LTR + language badge.
- **Timestamp:** Absolute IST — e.g. `2026-04-20 14:32`. Not relative.

### Audit Section Scope
- **Scope:** Filterable by status — default view shows all; filter chips at the top for `All / Approved / Rejected / Expired`; cap at the most recent 50 rows per the roadmap success criterion
- **Row layout:** Enriched Google Tasks title is the headline; original detected task shown as a subtle secondary line (e.g. "Originally: …") on the same card, not hidden behind expand
- **Audit-row fields that must appear:**
  - Color-coded status badge (approved/rejected/expired)
  - Terminal timestamp (approved_at / rejected_at / expired_at) — not just detected_at
  - Link to Google Tasks when `todo_task_id` is present (approved rows)
  - Enriched note preview (the Gemini-generated contact + snippet + trigger-message note)
- **Default ordering:** Terminal timestamp descending — most recently approved/rejected/expired at the top

### Live-Update Behavior
- **New pending actionable while page is open:** Row slides in at top of the pending list with a ~300ms amber arrival flash — matches the Phase 37 LinkedIn queue pattern for consistency

### Claude's Discretion
- **Page layout** (tabs vs stacked sections vs side-by-side split) — pick based on the existing LinkedIn queue page and dashboard conventions; default landing on Pending if tabbed
- **Pending → audit transition animation** (fade-across vs flash-and-remove vs silent) — pick consistent with other dashboard motion
- **SSE-unavailable fallback** (silent polling vs manual-refresh button + stale banner) — pick consistent with the LinkedIn queue SSE pattern
- **Empty state** for the pending section (celebratory vs neutral vs explanatory) — pick consistent with existing empty states in the dashboard
- **All technical / architectural decisions** — SSE event shape, new REST route naming, Zod schemas, hook wiring, whether to extend the existing SSE channel or add a new one

</decisions>

<specifics>
## Specific Ideas

- **Phase 37 amber arrival flash (300ms)** is the owner's reference for new-row motion — the LinkedIn queue already ships this pattern, re-use/match it.
- **LinkedIn queue / `/api/linkedin/*`** is the reference shape for JWT gating, SSE integration, card density, and empty-state voice.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 43-dashboard-pending-tasks-view*
*Context gathered: 2026-04-20*

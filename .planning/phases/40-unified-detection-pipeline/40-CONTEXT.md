# Phase 40: Unified Detection Pipeline - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Scope note:** This CONTEXT captures UX decisions for Phases 40, 41, and 43 (v1.8 user-facing surface) since UX was discussed holistically. Phase 40 implements only the detection-pipeline rewrite and the "silent dark launch" interim behavior. Phase 41 implements the approval UX, debounced batch previews, quoted-reply grammar, and the Phase-41-landing digest. Phase 43 implements the dashboard view. Phase 42 (enrichment at approval) has one decision below (9A: user_command still runs enrichment).

<domain>
## Phase Boundary (Phase 40)

Rewire private-chat detection so every detected item lands as exactly one `pending_approval` actionable, no Google Tasks entry is created at detection time, and the parallel `commitments → reminders` and `commitments → todoTasks` write paths are retired. The user-visible surface during Phase 40 is **silent** — no self-chat notifications fire until Phase 41 ships.

</domain>

<decisions>
## Implementation Decisions — Phase 40 (detection pipeline)

### Interim UX: silent dark launch

- Phase 40 **suppresses all detection self-chat notifications**. The current "🔔 Commitment detected: … Reply cancel to remove." message path is gated off.
- Items accumulate silently in `actionables` with status `pending_approval` through the dark-launch window.
- When Phase 41 ships, its first boot posts a one-time digest listing the pending count (see Phase-41 decisions below), then the new batched-preview flow starts.
- The gate is implemented via a feature flag or a `commitment_detection_ux` setting (Claude's discretion) so the old notification path can be toggled back on if Phase 41 slips.

### Legacy code retirement approach

- `src/commitments/commitmentPipeline.ts` — retain the file but retire the write paths to `reminders(source=commitment)` and `todoPipeline.processDetectedTask`. The pre-filter, cooldown, blocklist, and incoming-allowlist guards are preserved byte-for-byte (SC#4) but relocated into the new unified pipeline.
- `src/todo/todoPipeline.ts` — retain the file. Its `processDetectedTask` function becomes unreachable from the detection path after Phase 40. Delete deferred per CLAUDE.md "never delete files without asking" — will be revisited after Phase 41/42 stabilize.
- `src/todo/todoService.ts` `createTodoTask` — **keep** the function. Phase 42 (enrichment at approval) will call it at approval time. Phase 40 just removes the calls from the detection path.
- `src/reminders/reminderService.ts` — self-chat `remind me to X` commands continue to write `reminders` rows in Phase 40. They migrate to `actionables` in Phase 41 under DETC-03.

### Detection classification

- Gemini continues to classify each detected item as `commitment` or `task` (the existing schema in `CommitmentDetectionService.extractCommitments` is preserved).
- The classification is persisted as `actionables.sourceType` verbatim (`commitment` / `task`). Reason: analytics and future routing (e.g., different enrichment prompts per type) are cheap to keep and hard to reconstruct.
- No re-classification happens at approval time (Phase 42).

### Guards — pre-filter / cooldown / blocklist / allowlist

- Preserved byte-for-byte per SC#4.
- Relocation: move the guards from `commitmentPipeline.processCommitment` into the new unified pipeline entry point. The relocation is a code move, not a refactor — same checks, same order, same settings keys (`commitment_detection_enabled`, `commitment_blocklist`, `commitment_incoming_allowlist`).
- The 5-minute `COOLDOWN_MS` constant stays at 5 minutes. Adjusting it is out of scope.

## Implementation Decisions — Phase 41 (WhatsApp approval UX)

### Preview message format — Standard (4 lines)

Every preview has this shape in the source chat's detected language (he/en):

```
📝 <task>
👤 <name>
💬 "<snippet>"
Reply ✅ / ❌ / edit: <text>
```

- No detection timestamp in the preview (noise).
- No deadline in the preview — enrichment resolves deadlines at approval time.
- Snippet is the truncated `originalText` (same 100-char cutoff as the existing commitment notification).
- Hebrew template mirrors line-for-line with `📝 <משימה>` / `👤 <שם>` / `💬 "<תקציר>"` / `השב ✅ / ❌ / עריכה: <טקסט>`.

### Batched preview per source chat (debounce 2 min)

- **Per-source-chat debounce window of 2 minutes.** When a detection fires, the bot does NOT send a preview immediately. Instead the actionable is added to an in-memory debounce bucket keyed by `sourceContactJid`. A 2-min timer starts; if more detections from the same chat arrive, they join the bucket and reset the timer.
- When the debounce window closes (2 min quiet), the bot sends one preview message listing every pending actionable from that bucket with per-item numbers:

```
📝 3 items from Lee:
1. Send Q2 report
   💬 "I'll send it tomorrow"
2. Share the slide deck
   💬 "I'll share the deck too"
3. Review quarterly numbers
   💬 "I'll look at the numbers"

Reply: `1 ✅` / `2 ❌` / `3 edit: <text>` (or `✅` to approve all)
```

- The `approval_preview_message_id` column on every actionable in the bucket is set to the *same* message id — the quoted-reply matcher in Phase 41 looks up actionables by `(preview_msg_id, item_number)`.
- Debounce buckets are scoped per chat so preview language always matches the single source chat (no Hebrew/English mixing in one message).
- If only one item is in the bucket at window close, the preview collapses to the un-numbered single-item format (no "1." prefix, no item count header).
- Debounce state is in-memory. On restart, buckets are flushed — any pending actionables simply sit in `pending_approval` and get picked up next time a detection fires from that chat.

### Approval grammar — Lenient, bilingual EN + HE

For a numbered preview, valid quoted-replies:

| Action | EN synonyms | HE synonyms |
|---|---|---|
| Approve item N | `N ✅` / `N ✓` / `N approve` / `N ok` / `N yes` / `N y` | `N אישור` / `N כן` |
| Reject item N | `N ❌` / `N ✗` / `N reject` / `N no` / `N n` | `N ביטול` / `N לא` |
| Edit item N | `N edit: <new task text>` | `N עריכה: <טקסט>` |
| Apply to all | `✅` or `❌` (no item number) | `אישור` or `ביטול` (no item number) |

- For single-item previews (un-numbered), the leading `N` is omitted: `✅` / `❌` / `edit: <text>`.
- Multiple actions in one reply are allowed: `1 ✅ 2 ❌ 3 edit: Send report to Lee`.
- Unknown grammar → bot re-posts the grammar hint as a quoted-reply to the same preview.

### Confirmation format — Minimal

- On approve (or edit+approve): one self-chat message per item `✅ Added: <enriched_title>` (in source chat's language per UX Q8-B), posted after enrichment + Google Tasks push completes. If the batched reply approves multiple items, the bot sends one confirmation per item.
- On reject: `❌ Dismissed` (source language).
- On edit: no separate "edit confirmed" message — edits go straight to enrichment + approval, and the same `✅ Added: <enriched_title>` confirmation fires.
- No WhatsApp reactions (Baileys flakiness documented in v1.4 MILESTONES).
- Enrichment failures: confirmation shows the original detected task instead of enriched title, prefixed with a warning: `⚠️ Added (enrichment unavailable): <original_task>`.

### Expiry — Silent

- 7-day-old `pending_approval` actionables flip to `expired` via the hourly scan.
- No self-chat message on expiry. Expired items show up only in the dashboard audit view.

### One-time digest when Phase 41 first ships

- On the first boot after the Phase 41 deploy, the bot detects that there are N > 0 `pending_approval` actionables accumulated during the Phase 40 dark launch and posts a single self-chat message:
  > `⏳ 12 items are waiting for approval. You'll see them as they were detected, starting now. (Reply with ? for grammar reference.)`
- After posting the digest, the bot flushes every accumulated pending actionable through the normal debounce/preview flow (grouped by source chat, respecting the per-chat debounce but no wait — the bucket flushes immediately at digest time).
- The digest fires exactly once: a one-shot flag (settings key `v1_8_approval_digest_posted = true`) prevents re-posting on restart.

### Self-chat direct commands (user_command)

- `remind me to X at Y` in the owner's self-chat continues to write an `actionable` with `status='approved'` and `source_type='user_command'` (DETC-03).
- **Enrichment still runs** on user_command actionables (UX Q9A-1) — uniform pipeline, minimal branching. For user_command the "source chat" is the self-chat, which usually has no useful prior context; the enricher will effectively echo the task verbatim. Accepted cost: one wasted Gemini call per direct command, in exchange for code simplicity.
- Confirmation shape matches detected-item approvals: `✅ Added: <enriched_title_from_gemini>`.

## Implementation Decisions — Phase 43 (dashboard)

### Layout — LinkedIn-queue style

- New dashboard route `/actionables` (or similar — Claude's discretion on URL).
- Status strip at the top with mini-counters: `N pending`, `M approved this week`, `K rejected`, `P expired`. Mirrors the v1.7 `LinkedInQueue` status strip.
- Card list below the strip, one card per actionable, ordered by `detected_at desc`.
- Each card shows: contact name, proposed task, snippet, detected_at, status badge, and a per-item chip for `source_type` (commitment / task / user_command) and `detected_language` (he / en).
- For terminal states, the card also shows the `enriched_title` below the original task so you can compare what Gemini produced vs what was detected.
- Filter tabs: Pending / All Terminal / Approved / Rejected / Expired.
- Read-only — no approve/reject/edit buttons on the dashboard.
- Reuse SSE + the optimistic-patch pattern from the v1.7 LinkedIn queue where practical — Claude's discretion on whether to wire SSE for this phase or start with a manual refresh button and add SSE later.

### Claude's Discretion

- Exact URL path (`/actionables` vs `/pending-tasks`)
- Mini-counter weekly-window math (rolling 7 days vs ISO week)
- Whether SSE or polling is used
- Dashboard pagination threshold (50 / 100 / infinite scroll)
- Exact copy of the grammar-reference help message (`?` query) in Phase 41

</decisions>

<specifics>
## Specific Ideas

- The one-time Phase-41-landing digest is modeled on the existing "Missed N reminder(s) while offline" recovery message in `reminders/reminderService.ts::recoverReminders` — owner-facing, not intrusive, posts once.
- Per-item confirmation messages echo the existing reminder `fireReminder` output shape (`🔔 Reminder: <task>`) so the self-chat feel is consistent with v1.5's reminder style.
- The numbered-grammar pattern is already in the codebase — `reminderService` uses number-based disambiguation (`pendingCancelIds` / `pendingEditIds`) when multiple reminders match a cancel/edit command. The batched-preview grammar extends the same idea.
- LinkedIn queue dashboard components (`LinkedInPostCard`, `StatusStrip`, optimistic-patch layer) are worth reading before Phase 43 starts — same pattern will save implementation time.

</specifics>

<deferred>
## Deferred Ideas

- Dashboard mutations (approve/reject/edit from the web UI) — explicit v1.8 out-of-scope; approval remains WhatsApp-only.
- WhatsApp reactions as confirmation ack — deferred until Baileys reaction reliability improves.
- Per-contact debounce-window tuning (some chats may want 30s, others 5m) — v1.8 uses one global 2-min window.
- Bulk operations (approve-all from a single reply without listing per-item numbers) — partially covered by `✅`/`❌` without a number, but a full bulk-reject doesn't exist for batched previews.
- User-configurable expiry window (currently hard-coded 7 days) — setting exposed in a future milestone if the 7-day default turns out wrong.
- Analytics on enrichment quality (did the Gemini-enriched title change the task text significantly, and does the owner edit after approval?) — future milestone.
- Skip-enrichment fast path for `user_command` — rejected (UX Q9A-1) but noted in case the Gemini cost shows up as a real problem.

</deferred>

---

*Phase: 40-unified-detection-pipeline*
*Context gathered: 2026-04-19*

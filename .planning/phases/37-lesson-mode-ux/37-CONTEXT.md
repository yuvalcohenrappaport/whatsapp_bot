---
phase: 37-lesson-mode-ux
status: ready-for-planning
gathered: 2026-04-15
---

# Phase 37: Lesson Mode UX — Context

<domain>
## Phase Boundary

The owner can complete pm-authority's existing two-phase lesson-mode review entirely inside the dashboard:

1. **Lesson selection** — a PENDING_LESSON_SELECTION post surfaces 4 candidate lessons (text + rationale). The owner picks one, which advances the post into variant generation.
2. **Variant finalization** — a PENDING_VARIANT post surfaces 2 full-post variants (content + image prompt + generated fal.ai image). The owner picks one, which finalizes it as the chosen variant.
3. **Inline image rendering** — when fal.ai image generation finishes for a variant, the image renders on the variant card live, without a manual reload.

This replaces the Telegram-only UX for lesson-mode posts. pm-authority's state machine and HTTP endpoints already exist from Phase 33. Phase 37 is a pure dashboard-side UX phase — no new backend mutations, just wiring the proxy and building the views.

Scope excludes: starting a new lesson run (that's Phase 38), editing lessons/variants, reordering candidates, lesson-mode generation logic itself.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Lesson candidate card list

- **Layout:** Vertical stack — one card per row, full width. Prioritizes readability of long lesson text + rationale; mobile-friendly by default.
- **Card content:** Locked fields (lesson text, rationale) PLUS a letter tag (A / B / C / D) so the owner can verbally refer to "the second one", AND generation metadata (model, timestamp, token cost) for quality comparison.
- **Click interaction:** Two-step focus-then-confirm. Clicking a card visually highlights/focuses it (not destructive — freely switchable). A sticky "Confirm selection" button at the bottom of the viewport commits the choice. Lets the owner compare before committing, with no mid-click terminal regret.
- **Page header:** Rich context above the card list — project name, perspective, language, generation timestamp, AND the original source snippet/content that produced these 4 candidates. Gives the owner everything they need to make an informed pick without bouncing elsewhere.

### Area 2 — Variant side-by-side layout

- **Desktop:** 2 columns, 50/50. **Mobile:** Stack vertically (standard responsive). Horizontal swipe/carousel was considered and rejected.
- **Per-variant card content:** Full post content (Hebrew + English per existing bilingual pattern), collapsible image prompt, generated fal.ai image (or pending placeholder — see Area 3), AND generation metadata (model, timestamp, token cost). No tone/angle summary, no per-language character counts.
- **Finalize interaction:** Mirror Area 1's focus-then-confirm. Click a variant card to focus/highlight, then a sticky "Finalize this variant" button at the bottom commits. Same pattern across both steps = consistent muscle memory.
- **Image prompt display:** Collapsed behind a "Show image prompt" toggle by default. The prompt is implementation-adjacent detail; the generated image is what matters. Toggle lets curious inspection without cluttering the default view.

### Area 3 — Image-generation pending UX

Two distinct wait scenarios exist and need separate treatment:

**Scenario A — After confirming a lesson (pm-authority generates 2 variants, ~10-60s LLM call):**
- **Behavior:** Modal overlay with spinner, locked on the current page (the lesson-selection view). No navigation, no bounce-back to queue. When generation completes, the modal dismisses and the view auto-navigates to the variant page for this same post. The owner never loses context.

**Scenario B — On the variant page, content loaded but one or both fal.ai images still rendering:**
- **Placeholder:** Spinner + "Generating image…" text + elapsed seconds counter inside the image area of the variant card. Content around it (copy, prompt toggle, metadata) is fully interactive — the owner can read the copy while images finish.
- **Failure handling:** No client-side timeout. Trust the backend / SSE to surface completion or failure. The spinner waits until a terminal signal arrives. If pm-authority emits a variant with a failure state, the card renders whatever error surface the backend provides.

### Area 4 — Queue integration

- **Visual standout:** A PENDING_LESSON_SELECTION or PENDING_VARIANT post in the main queue list is visually distinct: status-pill color switches (e.g. purple for lesson-pending, indigo for variant-pending — final palette at planner discretion) AND the card gets a 4px-ish left-edge colored accent stripe matching the pill. "Needs your decision" items are impossible to miss.
- **Real-time arrival:** When a new pending-action post arrives via SSE while the owner is on `/linkedin/queue`, the card slides into place AND briefly flashes (≈300ms amber background) to announce itself. No toast — the flash is enough without being noisy.

### Claude's Discretion

The following decisions were deferred to Claude with a recorded lean. The planner should act on the lean unless a better option surfaces during research.

- **Update mechanism for fal.ai image arrival on the variant card** — Lean: piggyback on the existing `/api/linkedin/queue/stream` SSE (built in Phase 35-02). The stream already broadcasts post-state changes with 3s upstream polling + sha1 dedup; when a variant's image URL flips from null to populated, the stream re-emits and the variant page re-renders. Zero new endpoints. Fallback if SSE filtering proves awkward: a dedicated 2-3s poll of `/api/linkedin/posts/{id}` scoped to the variant view, auto-stopping when all image URLs are non-null.

- **Queue integration pattern (inline vs tab vs route)** — Lean: **inline** in the existing queue list. The Phase 35 `LinkedInPostCard` already supports multiple statuses and has slot props for action surfaces (per the Phase 36 plan pattern). A PENDING_LESSON_SELECTION post renders the same card shell but swaps the actions slot for a "Pick lesson" entry button, which navigates to a full-page lesson-selection view. Same for PENDING_VARIANT → "Pick variant" → variant-finalization view. A separate tab/route was considered and rejected — it would duplicate layout, auth, and SSE wiring while fragmenting the mental model (pm-authority doesn't split "normal review" from "lesson mode" — it's one pipeline with more states).

- **Status-strip counters** — Lean: add **2 dedicated mini-counters** to the existing top status strip, separate from the current "pending" tile: "Lessons to pick: N" and "Variants to finalize: N". These items are actionable blockers and deserve their own visibility rather than being bulked into a general "pending" count. Existing tiles (next publish slot, approved count, last published) stay. If the strip runs out of horizontal space on narrow viewports, the planner can collapse to a single "Action needed: N" tile that expands on hover/tap — Claude's call at implementation time.

</decisions>

<specifics>
## Specific References and Patterns

- **Focus-then-confirm pattern** shows up in both Area 1 and Area 2 — consistency is explicit. The sticky confirm button should be styled the same in both views (same position, same animation, same keyboard shortcut if any).

- **Letter tags (A/B/C/D)** on lesson cards are purely a labeling aid for verbal reference. They do NOT imply ordering, preference, or grouping — the 4 candidates are peers.

- **Generation metadata (model, timestamp, token cost)** is shown on BOTH lesson cards and variant cards, in a consistent format. The planner should extract this into a shared `GenerationMetadata` presentational component rather than duplicating the layout.

- **Modal overlay during lesson→variant generation** is locked to the current page by design — the owner just made a commitment and should not be allowed to wander away and forget they're mid-flow. If the generation takes longer than expected, the modal stays; the owner can hard-refresh or use the browser back button as an escape hatch, which will land them back on `/linkedin/queue` where the post will still show the correct state (PENDING_VARIANT once generation finishes, per backend).

- **Left-edge accent stripe + pill color** combine to make pending-action posts impossible to miss in the list — both are required, not either-or.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed inside Phase 37 scope. New-lesson-run form is already scoped to Phase 38 and was not touched here.

</deferred>

---

*Phase: 37-lesson-mode-ux*
*Context gathered: 2026-04-15*

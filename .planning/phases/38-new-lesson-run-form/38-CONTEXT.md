---
phase: 38-new-lesson-run-form
status: ready-for-planning
gathered: 2026-04-17
---

# Phase 38: New Lesson Run Form — Context

<domain>
## Phase Boundary

The owner can start a brand-new lesson-mode generation run entirely from the dashboard via a form — replacing the `SSH + generate.py --mode lesson` CLI workflow. The form submits to a proxy route that kicks off a lesson-mode run in pm-authority. The resulting post appears in the queue as PENDING_LESSON_SELECTION within seconds, entering the Phase 37 lesson-pick → variant-pick flow.

Scope excludes: manual post creation (future todo), editing generation parameters after submission, viewing run history/logs in the dashboard, any changes to pm-authority's generation logic itself.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Form field design

- **Project picker:** Dropdown populated from a live API call listing all known pm-authority projects, PLUS a "Custom..." option that reveals a free-text field for projects not yet in the dropdown. If pm-authority rejects an unknown name (400/404), the error surfaces inline on the form (Area 3 decision).
- **Perspective:** Two-option radio group — "Yuval (first person)" / "Claude (collaborator)". Matches the existing `--perspective` CLI flag exactly. No hidden/advanced toggle.
- **Language:** Three radio buttons — English / Hebrew / Bilingual (he+en). Maps to pm-authority's generation modes. Always visible, not dependent on project selection.
- **Topic hint:** Optional free-text field. Lets the owner steer what lesson the generator picks from the project context. Can be left empty — pm-authority decides autonomously when blank.
- **No other fields exposed.** The form covers the common case (project + perspective + language + optional topic). Power users SSH for edge-case flags (`--samples`, `--dry-run`, `--screenshot`).

### Area 2 — Submission + progress experience

- **After submit:** Immediately redirect to `/linkedin/queue` with a toast: "Lesson run started for {project name}". Form fields are NOT shown during the wait — the owner is on the queue page.
- **Post arrival:** The new PENDING_LESSON_SELECTION post appears via SSE with the Phase 37 300ms amber flash + purple pill + left-edge stripe. No special linking between the toast and the arriving card — the visual signals are sufficient.
- **Concurrent runs:** Allow stacking — the owner can submit multiple runs. If pm-authority doesn't support queuing and returns 409, the form shows an inline error with retry countdown (Area 3 decision). Each accepted run produces its own queue card independently.
- **Navigation away:** No special handling. If the owner leaves the queue page before the post appears, it's already there when they return. No persistent banner or progress tracker.

### Area 3 — Error + validation UX

- **Validation timing:** On blur (immediate per-field feedback when leaving a field) plus re-validate on submit. Standard form UX.
- **Generator busy (409):** Inline error under the Submit button: "Generator is busy — try again in a minute" with a retry countdown timer. The owner waits for the timer or refreshes.
- **Partial failure (generation started but crashed):** If no PENDING_LESSON_SELECTION post appears within 3 minutes of submit, show a subtle warning banner on the queue page: "Lesson run for {project} may have failed — check logs". Requires the dashboard to track "pending run" state (project name + submit timestamp) in local state or localStorage, and check against SSE arrivals.
- **Unknown custom project name:** Pass through to pm-authority. If pm-authority rejects (400/404), show the error inline on the form. No client-side validation against the project list for the custom free-text field — the API is the source of truth.

### Area 4 — Entry point + placement

- **Form location:** Claude's discretion. Lean: dedicated page or sheet/drawer — the form has enough fields (project dropdown + perspective radio + language radio + topic hint + submit) that a modal feels cramped. A slide-out sheet from the queue page is clean, or a dedicated `/linkedin/new-run` page with sidebar entry. Either works.
- **Discovery:** A prominent "New Lesson Run" button in the queue page header — always visible, primary action color. This is the main entry point.
- **Empty state:** No special treatment. Same header button, same empty-state message ("No posts in the queue"). No duplicate CTA in the empty area.
- **Form reset after submission:** Remember the last submission's values (project, perspective, language) — pre-filled when the owner returns to the form. Convenient for batch runs against the same project. Topic hint resets to empty each time.

### Claude's Discretion

- **Form location (page vs sheet vs drawer):** Lean toward a slide-out sheet/drawer from the queue page — keeps the owner in the queue context, avoids a separate route. But a dedicated page is acceptable if the sheet feels too constrained for the field count. The planner decides at implementation time.
- **3-minute failure banner implementation:** The planner decides whether to use localStorage (survives page reload) or React state (simpler, lost on reload) for tracking pending-run metadata. localStorage is more robust for the "navigate away and come back" case.

</decisions>

<specifics>
## Specific References and Patterns

- **Proxy route:** pm-authority already exposes `POST /v1/lesson-runs` (Phase 33-04). The whatsapp-bot proxy already has `POST /api/linkedin/lesson-runs` wired (Phase 34-03). The form just needs to call the existing proxy route — no new backend work unless the route doesn't accept `topic_hint`.

- **Project list endpoint:** pm-authority may or may not have a `GET /v1/projects` endpoint. If not, the planner should add one (simple SELECT DISTINCT project_name FROM sequences) in Plan 38-01 as cross-repo foundation work, mirroring the Phase 37-01 pattern.

- **Toast pattern:** Reuse the existing `sonner` toast pattern from Plan 36-02 (approve/reject/edit toasts). "Lesson run started for {project}" matches the established tone.

- **Retry countdown timer:** A simple `useState` countdown (60s → 0) with `setInterval`. Disable the Submit button while counting. When timer reaches 0, re-enable. No auto-retry.

- **Radio group styling:** Match the existing dashboard radio/select patterns. Nothing custom — standard shadcn/ui RadioGroup.

- **Form remembers last values:** Store in localStorage under a `linkedin-new-run-defaults` key. Read on mount, write on successful submit. Topic hint always resets to empty.

</specifics>

<deferred>
## Deferred Ideas

- **Manual post creation from dashboard** — captured as a todo (`2026-04-16-create-new-posts-from-dashboard.md`). Distinct from lesson-run form: lesson runs go through the full pm-authority generation pipeline, manual posts are direct DRAFT inserts with owner-authored content.
- **Language option on variant pick** — captured as a todo (`2026-04-17-language-option-on-variant-pick.md`). Distinct from the lesson-run language selector: this todo is about changing language AFTER variants are generated.
- **Run history / log viewer** — the owner might want to see past lesson runs and their outcomes. Out of Phase 38 scope — the queue page already shows the resulting posts. A dedicated run-history view is a future phase if needed.

</deferred>

---

*Phase: 38-new-lesson-run-form*
*Context gathered: 2026-04-17*

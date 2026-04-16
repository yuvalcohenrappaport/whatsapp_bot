---
created: 2026-04-16
title: Create new LinkedIn posts directly from dashboard
area: ui
milestone_target: v1.7 (or later)
phase_target: 39+ (after Phase 38 "New Lesson Run Form")
files: []
---

## Problem

Today, new LinkedIn posts enter the pm-authority pipeline only two ways:

1. **Lesson-mode generation runs** — SSH into server + `generate.py --mode lesson`. Phase 38 replaces this with a dashboard form (project-picker + perspective + language).
2. **Manual Telegram flow** — owner types content into the Telegram bot, which creates a post record directly in pm-authority's `state.db`.

There is NO way to write a brand-new post manually from the dashboard — the v1.7 milestone surfaces every *review* action (approve, reject, edit, regen, image, lesson-mode), but the *authoring* entry point is still Telegram-only for anything that isn't a lesson-mode generation.

This is the last Telegram-dependency in the authoring flow. As soon as Phase 38 lands, the owner still has to Telegram-write ad-hoc posts that aren't tied to a lesson-mode sequence.

## Solution

**TBD — discovery work needed before planning.** Open questions for a future `/gsd:discuss-phase`:

- Form fields: just content (Hebrew + English) + manual image upload, or also project/perspective/language selectors like Phase 38's form?
- Initial state: does the post land directly as DRAFT (ready for Approve), or PENDING_PII_REVIEW (treated like an uploaded-image post), or a new NEW_DRAFT state?
- Image workflow: mandatory image upload at creation time, or allow text-only, or "optionally attach"?
- Bilingual authoring: one bilingual form with RTL Hebrew + LTR English tabs (mirror Plan 36-02's EditPostDialog), or one-at-a-time?
- Scheduling: pick a publish slot at creation time, or always land as "next available"?
- Sequence binding: tie to an existing sequence, or create a standalone post with no sequence?

**Likely implementation shape (rough sketch, not a commitment):**
- pm-authority: new `POST /v1/posts` endpoint on the FastAPI sidecar that takes `{content, content_he?, project, image?}` and inserts a row in `posts` at DRAFT or PENDING_PII_REVIEW depending on whether an image came with it.
- whatsapp-bot proxy: mirror route at `POST /api/linkedin/posts` (Zod-validated, JWT-gated).
- Dashboard: `/linkedin/queue/new` page with a form reusing `EditPostDialog`'s bilingual tabs + `LinkedInImageDropZone`'s upload path. Sidebar gets a "New post" button + keyboard shortcut.

**Dependencies:**
- Builds on Phase 36 (image drop + PII gate) and Phase 38 (form UX patterns).
- Belongs in a future phase (likely Phase 39 in v1.7 — if v1.7 is still open when we get to it — or v1.8 if the milestone has been closed).

**Not urgent** — the Telegram bot still works as an escape hatch. Capture this for later, don't plan it into v1.7 unless the owner wants to extend the milestone.

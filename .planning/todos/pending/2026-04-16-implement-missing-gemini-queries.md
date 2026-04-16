---
created: 2026-04-16
title: Implement getPairedExamples + getAllFromMeMessages in messages.ts
area: database
files:
  - src/db/queries/messages.ts
  - src/ai/gemini.ts:149
  - src/ai/gemini.ts:243
---

## Problem

`src/ai/gemini.ts:1` imports 4 functions from `src/db/queries/messages.ts`:
- `getRecentMessages` ✓ exists
- `getStyleExamples` ✓ exists
- `getPairedExamples` ✗ MISSING — imported by `gemini.ts:149` in persona generation
- `getAllFromMeMessages` ✗ MISSING — imported by `gemini.ts:243` in `generateGlobalPersona`

The missing imports caused the whatsapp-bot PM2 process to crash-loop on boot with `SyntaxError: The requested module '../db/queries/messages.js' does not provide an export named 'getAllFromMeMessages'`. The implementations appear to live on the unmerged `feat/contact-name-in-tasks-events` branch.

Commit `82e9fdd` (Phase 31-01, 2026-03-30) added the imports without landing the queries on main. The bug remained dormant until a fresh `pm2 restart whatsapp-bot` during Phase 37 live verification (2026-04-16) and surfaced the crash loop.

## Solution

Temporary fix applied during Phase 37: added throwing stubs `getPairedExamples` + `getAllFromMeMessages` to `src/db/queries/messages.ts` that raise "not implemented" errors on call. This unblocks ESM module load. Neither function is invoked on Fastify boot or during any Phase 37 dashboard walkthrough — they only run for paired-style example generation and global persona regeneration, which are not in the Phase 37 flow.

**Proper fix TBD:**
1. Inspect the `feat/contact-name-in-tasks-events` branch for the real implementations
2. Understand expected semantics — `getPairedExamples(contactJid, limit)` presumably returns back-and-forth message pairs for a contact; `getAllFromMeMessages(limit)` returns all outbound messages globally
3. Port the Drizzle queries onto main (or cherry-pick just the queries, not the unrelated feature work on that branch)
4. Replace the stubs in `messages.ts` with real implementations
5. Verify by exercising the persona-generation path (check `src/ai/gemini.ts:149` + line 243 callsites)

Not urgent — the personality features aren't used in Phase 37 / 38 flows. Capture for a dedicated "merge stranded branch work" session.

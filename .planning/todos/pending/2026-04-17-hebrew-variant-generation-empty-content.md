---
created: 2026-04-17
title: Hebrew lesson-mode variants generate with empty content
area: general
files:
  - /home/yuval/pm-authority/generation/generator.py
---

## Problem

When a lesson-mode generation run uses `language=he`, the pick-lesson → variant generation step produces variants with empty `content` fields but populated `image_prompt` fields. Observed on post `d6cfa5b4-b649-4f2e-ae97-a53bf7c92590` (WhatsApp Bot project, language=he) — both variants (id 11, 12) have `content=''` with 450/472-char image prompts.

English-mode variant generation works correctly — post `59c52507` (language=en) produced variants with 1763/1824-char content.

Surfaced during Phase 38 live verification. The dashboard correctly renders the empty cards — the bug is in pm-authority's generation pipeline, not the dashboard.

## Solution

Investigate pm-authority's `generate_lesson_variants` (or the pick-lesson slow path in `workers.py`) to trace where variant content gets populated:

1. Check if the Claude CLI prompt for Hebrew variant generation includes the right output format instructions
2. Check if `_parse_response` handles Hebrew/bilingual XML tags correctly for variants (Phase 7's `_parse_response` might only handle Hebrew for posts, not variants)
3. Check if the variant INSERT statement correctly maps the parsed content field

Likely fix: the variant generation prompt needs the same bilingual handling that Phase 7 added to the main generation path.

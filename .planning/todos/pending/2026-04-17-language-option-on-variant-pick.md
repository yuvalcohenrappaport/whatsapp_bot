---
created: 2026-04-17
title: Add language option when picking a variant
area: ui
files:
  - dashboard/src/pages/LinkedInVariantFinalization.tsx
  - src/api/linkedin/routes/writes.ts
---

## Problem

When the owner finalizes a variant (PENDING_VARIANT → picks 1 of 2), there is no way to specify the target language. The variant content is generated in whatever language the original post was configured with (`language: "en"` produces English-only). If the owner wants bilingual (Hebrew + English) output, there's no control for that at pick time.

Surfaced during Phase 37 live verification — the test post was `language: "en"` and produced English-only variants. The owner expected bilingual content.

## Solution

Add a language selector to the variant finalization page (LinkedInVariantFinalization.tsx), next to the "Finalize this variant" sticky confirm bar:

1. **pm-authority:** Accept an optional `language` param on `POST /v1/posts/{id}/variants/{variantId}/pick` — when provided, regenerate/translate the chosen variant's content into the requested language(s) before finalizing. Requires understanding how `post_variant_and_generate_image_sync` handles language.
2. **Proxy:** Pass `language` through in the request body Zod schema.
3. **Dashboard:** Add a simple `<Select>` (English / Hebrew / Both) next to the finalize button. Default to the post's current `language` value.

Alternatively, language could be set at lesson-run creation time (Phase 38's form) rather than at variant-pick time. Needs discovery to determine the right UX placement.

Dependencies: May overlap with Phase 38 (New Lesson Run Form) which already has a language field in the form spec.

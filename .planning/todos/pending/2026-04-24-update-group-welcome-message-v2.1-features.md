---
created: 2026-04-24
title: Update group welcome message with all v2.1 features at end of Phase 55
area: groups
blocks: v2.1-milestone-close
files:
  - src/groups/welcomeMessage.ts (or wherever the welcome template lives)
---

## Problem

The bot posts a welcome/help message when added to a group or when an @mention is classified as non-travel (see `formatHelpText` in `src/groups/travelHandler.ts`). That text lists the travel-query surface from v1.4 but knows nothing about the v2.1 additions:

- `!pref <text>` — freeform preference (Phase 51-03)
- `!budget <category> <amount> <currency>` — per-category budget seed (Phase 51-03)
- `!dates <start> <end>` — trip window (Phase 51-03)
- Multimodal drops (Phase 52) — "send a screenshot of a booking, I'll file it"
- Day-of briefing at 08:00 destination-tz (Phase 54)
- `/trips/:groupJid` dashboard link (Phase 55)
- Auto-archive at `end_date + 3d`, `trip_archive` history (Phase 51-05)
- Conflict alerts — what they look like and how to silence (Phase 51-04)

New members dropped into an active trip group won't discover any of this unless we surface it.

## Solution

At the **end of Phase 55 (milestone close)**, rewrite the welcome/help text to describe the full v2.1 surface:

1. Audit every `sock.sendMessage` call site that emits onboarding/help copy (at least `travelHandler.ts::formatHelpText`, possibly welcome handlers elsewhere).
2. Draft bilingual (he/en) copy that lists each user-facing verb with one-line examples. Keep discreet — per v2.1 brand, no emoji clutter.
3. Gate by `group.travelBotActive` so non-travel groups don't get the trip surface.
4. Update the fallback `isTravelRelated: false` help text in `travelHandler.ts:299` to mention the `!`-commands ("try `!pref`, `!budget`, `!dates`, or phrase your request like a flight/hotel/restaurant query").
5. Test by @-mentioning the bot with a vague message and checking the returned help is complete.

## Why defer to end of Phase 55

Each of Phases 52-55 adds user-facing surfaces (multimodal intake, restaurant search, day-of briefing, dashboard). Writing the welcome text before those ship means rewriting it each phase. Doing it once at milestone close captures the full v2.1 brand voice in a single pass.

## Acceptance

- Help text includes every `!`-verb and every trigger (@mention, reply-chain, image drop, dashboard link) from v2.1
- Hebrew version reads idiomatically (avoid word-for-word translation — follow `feedback_hebrew_bilingual_style` memory)
- One-sentence trigger per feature, no walls of text
- Manually verified by sending a vague @mention in the Italy test group

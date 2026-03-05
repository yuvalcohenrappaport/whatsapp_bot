# OA-001: WhatsApp Personal Assistant & Group Organizer

> Date: 2026-03-05
> Source: DISC-001

## 1. Business Objective
Eliminate the burden of WhatsApp message management during busy periods and remove the need for a human "group organizer" in friend groups — enabling hands-free personal messaging and self-running trip/event planning.

## 2. Key Results
How will we know if we succeeded?

- **KR1:** 80%+ of proposed dates in group chats are automatically extracted and converted to calendar events within the first month of friend group launch
- **KR2:** At least 2 trips/events are planned to completion using the bot's group features within the first 3 months
- **KR3:** Group chat engagement around planning topics increases measurably (more replies to bot-generated calendar confirmations and reminders)
- **KR4:** Owner spends <5 min/day on dashboard management (drafts, contact adjustments) — proving "hands-free" goal
- **KR5:** Zero WhatsApp bans during the first 3 months of multi-group operation

## 3. Customer Problem
**For the owner (primary user):** Managing a high volume of WhatsApp messages during busy periods is overwhelming. Manually replying, tracking conversations, and deciding what needs attention is a constant cognitive drain. Current workaround: ignoring messages and catching up later, which damages relationships and misses time-sensitive conversations.

**For friend groups:** Trip and event planning stalls in group chats because no one wants to be the organizer. Dates get mentioned and forgotten, nobody creates calendar events, and plans die in the chat. Current workaround: one person (the "ambitious friend") steps up and does the work manually, or the trip simply doesn't happen.

## 4. Target Market
- **Primary user:** Tech-savvy individual who manages multiple active WhatsApp conversations and groups daily
- **Secondary users:** Friends and family in shared WhatsApp groups who benefit from automated group organization without any setup or onboarding
- **Scale:** 1 power user + 3-5 friend groups (10-30 people) in the immediate term

## Risks Summary

| Risk | Level | Mitigation |
|------|-------|------------|
| Value | Medium | AI voice improves over time; group "virtual organizer" addresses observed pain. Validate with real usage data post-launch. |
| Usability | Low | Owner built the dashboard for themselves; friends interact passively through normal group chat. |
| Feasibility | Medium-High | Baileys ban risk is the ceiling. Rate limiting, reply caps, and human-like delays are in place. Monitor closely. |
| Viability | Low-Medium | Personal/friends scope keeps exposure low. WhatsApp ToS risk scales with users — defer commercial ambitions until ban risk is better understood. |

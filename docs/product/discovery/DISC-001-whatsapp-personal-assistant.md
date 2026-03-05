# DISC-001: WhatsApp Personal Assistant & Group Organizer

> Date: 2026-03-05
> Status: Validated

## Idea Summary
An AI-powered WhatsApp management platform for personal use — combining hands-free message management (auto-replies that learn your voice) with group utilities that act as a "virtual organizer" for trip planning and event coordination. Built on Baileys + Gemini AI with a React dashboard as the control center.

## Four Risks Assessment

### Value Risk: Medium
The bot solves a real personal pain — managing message overload during busy periods with AI replies that learn the user's communication style over time. Cold-start period produces robotic replies, but quality improves as the persona model trains on more data. For friends, the value proposition is clear: "No one has to be the group planner — the bot handles it." However, this is pre-launch with friends, so group feature value is based on observed pain points (trip planning stalls without an organizer) rather than validated usage data.

### Usability Risk: Low
Purpose-built by the primary user for their own workflow. The React dashboard serves as a smooth daily control center with no reported friction points. For friends, usability risk is also low — they interact with the bot passively through existing group chats, requiring zero onboarding or setup.

### Feasibility Risk: Medium-High
Core technology is proven and running 24/7 via PM2. The tech stack (Baileys, Gemini, SQLite, Fastify, React) is solid. The primary concern is **WhatsApp ban risk** — Baileys uses an unofficial API, and WhatsApp actively combats unauthorized automation. Mitigation measures are in place (rate limiting, auto-reply caps, human-like behavior), and no bans have occurred to date. However, this risk is the ceiling for growth — it multiplies with each additional user instance in the future "personal assistant for everyone" phase.

### Viability Risk: Low-Medium
Currently scoped to personal use and friends/family — no monetization pressure, minimal legal exposure. WhatsApp ToS violation is the main viability concern, but at this scale the risk is manageable. If the product ever scales commercially, this risk would escalate significantly.

## Discovery Insights
- The bot replaces the "ambitious friend" who organizes trips — a role nobody wants to fill
- Two-phase rollout is smart: group features first (zero onboarding for friends), personal assistants later (high complexity)
- AI voice learning is a strong value loop but has a cold-start problem
- Ban risk from Baileys is the single biggest constraint on the product's future
- Pre-launch with friends — all group feature assumptions are untested
- Success is measurable: more events created, trip planning advances further, higher group engagement

## Outcome
Validated for launch. Core personal value is proven through daily use. Group features address a real observed pain point but need validation through the upcoming friends launch.

## Recommended Next Steps
- [ ] Launch group features with friend groups (next week)
- [ ] Track calendar events created, group engagement, and trip planning completion
- [ ] Gather qualitative feedback from friends after 2-4 weeks
- [ ] Monitor ban risk indicators closely during increased usage
- [ ] Revisit discovery after 1 month of friend usage data

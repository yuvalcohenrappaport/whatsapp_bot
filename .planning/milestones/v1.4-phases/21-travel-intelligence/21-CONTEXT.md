# Phase 21: Travel Intelligence - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Open trip questions surface in the weekly digest until resolved, and the bot proactively suggests activities when a new destination is confirmed — rate-limited so it never spams the group. Two capabilities: digest integration and proactive suggestions.

</domain>

<decisions>
## Implementation Decisions

### Digest trip status section
- Placement: after the existing calendar events section in the weekly digest — not before, not separate
- Content: only open items (unresolved questions) — skip confirmed decisions entirely, they're stored but not repeated in digest
- Visibility: section only appears when the group has open items — no empty "No active trips" placeholder
- Language: always Hebrew — matches Phase 19 suggestion messages and all target groups
- Format: simple bullet list of open questions with age indicator (e.g., "❓ האם המקום כשר? (לפני 3 ימים)")

### Open item resolution
- Detection: automatic re-classification by tripContextManager — when a later message answers a tracked open question, the classifier marks it resolved
- No manual dismiss mechanism — keep it simple, auto-resolution only
- Expiry: 30 days — unresolved items silently removed after 30 days with no response
- Resolution UX: silent — resolved items just disappear from the next digest, no "resolved" notification
- Scope: explicit questions only ("מישהו יודע אם המקום כשר?", "מה עם ההסעות?") — not commitments or vague statements

### Proactive suggestion content
- Content: 3-4 popular activity tips for the confirmed destination — short, informational list
- Generation: Gemini-generated with destination name as input — one API call per trigger, destination-aware content
- Calendar tie-in: none — proactive suggestions are informational only, no Phase 19 suggest-then-confirm flow
- Transparency: message references what triggered it — "ראיתי שבחרתם אילת! הנה כמה רעיונות:" — gives context for why the message appeared
- Tone: friendly and helpful, not robotic — feels like a travel-savvy friend chiming in

### Rate limiting and timing
- Delay: 5-15 minute random delay after destination confirmation — avoids interrupting active conversation
- Cooldown: 2-hour minimum between proactive messages in the same group
- Daily cap: 3 proactive messages per day per group maximum
- Quiet hours: none — if the group is active enough to confirm a destination, a message is appropriate
- Counter persistence: in-memory only — resets on restart, restarts are rare enough that occasional extra messages are acceptable
- One-shot per destination: a destination triggers at most one proactive message — never again for the same destination

### Claude's Discretion
- How to integrate the trip status section into the existing weekly digest code
- How to detect "destination confirmed" signals from tripDecisions
- Gemini prompt design for generating destination-specific activity tips
- How to track which destinations have already triggered proactive messages (in-memory Set or similar)
- Exact format of the digest open items section (emoji, age calculation, truncation)

</decisions>

<specifics>
## Specific Ideas

- The weekly digest already exists — this adds a section, not a new message
- tripDecisions table already has type='destination' entries from Phase 18 — these are the trigger signal
- The 90% confidence threshold from STATE.md applies to the tripContextManager classifier, not the proactive trigger itself
- Open items are already tracked in tripDecisions with type='open_question' from Phase 18 — resolution means updating their status

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-travel-intelligence*
*Context gathered: 2026-03-02*

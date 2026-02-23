# Phase 9: Travel Search - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Group members can @mention the bot in a tracked WhatsApp group with a travel-related request (flights, hotels, restaurants, activities, or any travel query) and receive formatted search results directly in the group chat. The bot parses intent via Gemini, scrapes Google for results, and sends rich card-style responses.

</domain>

<decisions>
## Implementation Decisions

### @mention Detection
- Bot responds to both native WhatsApp @mention AND the bot's WhatsApp display name typed in the message text
- Display name is read from the bot's own WhatsApp profile (not a hardcoded keyword)
- Non-travel @mentions get a help text reply: short message explaining what the bot can do with example usage (e.g., "I can help with flights, hotels, and restaurants! Try: @bot flights to Rome next week")
- Reply chains supported: if someone replies to a bot travel result message, treat it as a follow-up travel request with context carried from the original

### Search Results Format
- Rich card style: each result as a mini-card with name, price (when available), rating, description snippet, and clickable link, separated by line breaks
- 3 results per request (concise, keeps group chat clean)
- Language matches the group's dominant language (same Hebrew/English detection as Phase 8 calendar confirmations)
- "Searching..." indicator sent immediately upon receiving a request, followed by the actual results message

### Search Data Source
- Primary: Google search scraping with node-fetch + cheerio (lightweight, no browser dependency)
- Show prices from search snippets when available; show "Price not listed" otherwise
- Fallback: if scraping fails (rate-limited, blocked, garbage HTML), fall back to Gemini knowledge-based recommendations (no live prices/links, but still useful suggestions)

### Request Types & Scope
- No category restriction: bot handles any travel-related query (flights, hotels, restaurants, activities, tours, car rentals, etc.). Gemini determines query type and builds appropriate search terms.
- Parse everything available from the message: destination, dates, budget, party size, preferences — build the most specific search query possible
- Vague requests: bot asks for clarification before searching (e.g., "Where? When?")
- Group context awareness: feed recent group messages to Gemini to infer missing details (e.g., if group discussed "trip to Barcelona March 10-15", a later "@bot find hotels" auto-fills Barcelona and those dates)

### Claude's Discretion
- Search query construction strategy (how to format Google queries for best travel results)
- Cheerio parsing selectors for Google search result extraction
- Rate limiting / throttling strategy for Google scraping
- Card formatting details (emoji usage, spacing, line breaks)
- How many recent group messages to include for context inference

</decisions>

<specifics>
## Specific Ideas

- Help text response should feel casual and friendly, matching the bot's tone from Phase 8 confirmations
- "Searching..." indicator should be immediate (before Gemini parsing even starts) for responsive feel
- Reply chain context: when a follow-up reply comes in, include the original search results + original query as context for Gemini to understand what the user wants next

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-travel-search*
*Context gathered: 2026-02-23*

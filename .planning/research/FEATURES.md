# Feature Landscape: Travel Agent Group Bot

**Domain:** WhatsApp group travel planning assistant — passive listener + proactive AI agent
**Researched:** 2026-03-02
**Confidence:** HIGH for domain patterns and competitive analysis; MEDIUM for specific new feature implementation complexity (dependent on existing code architecture which was read directly)

---

## Context: What Is Already Built

This is a subsequent milestone. The bot has:
- `@mention` travel search with Gemini grounded search (3 results with URLs, title, snippet, price)
- Reply chain follow-up on travel results (quotedMessageId tracked in-memory)
- Google Calendar date extraction from group messages (auto-add + confirmation message)
- Reply-to-delete calendar events
- Weekly AI digest (cron, summarizes last 7 days of chat + upcoming 14 days of events)
- Per-group keyword auto-response rules
- `groupMessages` SQLite table (full message history per group)
- Debounce pipeline (10s window batches messages for calendar extraction)
- Language detection (Hebrew/English auto-detect from char frequency)

**Critical integration points for new features:**
- `groupMessagePipeline.ts` → `initGroupPipeline()` is the main callback registration point
- `travelHandler.ts` → `handleTravelMention()` runs first in the callback chain (terminal on match)
- `reminderScheduler.ts` → `generateWeeklyDigest()` is the cron-triggered digest generator
- `groups` DB table has `calendarLink` but no trip-specific metadata columns yet
- `groupMessages` table has full history, queryable via `getGroupMessagesSince()`

---

## Table Stakes

Features users expect from any trip-planning assistant. Missing any makes the bot feel incomplete or behind-the-curve compared to tools like Wanderlog, TripIt, or Layla.ai.

| Feature | Why Expected | Complexity | Dependency On | Notes |
|---------|--------------|------------|---------------|-------|
| **Passive activity/plan detection from chat** | Every modern trip planning tool (Wanderlog, Mindtrip) monitors conversation and builds itinerary automatically. Users expect zero-friction capture — not having to @mention every time something is decided. | HIGH | Existing `groupMessagePipeline.ts` debounce buffer; `groupMessages` table | Must classify messages as "soft plan mention" (someone suggests) vs. "confirmed decision" (group consensus). Requires a Gemini intent pass on the debounced batch — layered on top of the existing date extractor, not replacing it. |
| **Suggest-then-confirm flow** | TripIt and Wanderlog both ask before acting. Silently auto-adding everything to Google Calendar is confusing. Users need to see what the bot detected and approve it. | MEDIUM | Existing calendar confirmation message pattern; quotedMessageId reply-to infrastructure | The bot already sends a confirmation after adding events. This extends that pattern to activities/plans: "I heard someone mention [X] — want me to add this?" with a ✅/❌ reply. Reuse the existing reply-to-delete infrastructure for reject flow. |
| **Enriched search results (ratings, hours, review count)** | Google Places, Wanderlog, and all competitor apps show star ratings, opening hours, and review counts alongside results. Three bare URLs with snippets is weak by 2025 standards. | MEDIUM | Existing `travelSearch.ts` + `geminiGroundedSearch()` + Gemini Maps Grounding API (GA Oct 2025) | Gemini Maps Grounding API is now GA and returns ratings, reviews, photos, hours, addresses per place. Can replace or augment the current Google Search grounding approach. Gemini returns a `google_maps_widget_context_token` for a rich interactive widget — but WhatsApp is text-only so just extract structured fields from the response. |
| **More than 3 results per search** | 3 results is too narrow when a group is choosing between 8 restaurants for dinner. Users will ask "more options" — the bot should either return 5-6 results initially or have a "show more" follow-up. | LOW | Existing reply chain follow-up (quotedMessageId) already works | Simple parameter change in `geminiGroundedSearch()` — increase the requested count to 5-6. Or leave at 3 + handle "more" follow-up via the existing reply chain. The reply chain is already built; the "show more" behavior is just a Gemini prompt change with the previous query in context. |
| **Trip memory — structured decisions** | Wanderlog and TripIt maintain a persistent, queryable itinerary. Users expect the bot to "remember" that "we're going to Eilat March 14-16 and staying at the Isrotel" across multiple conversations. | HIGH | New DB table needed; existing `groupMessages` provides raw history | Store confirmed decisions as structured records: `tripDecisions` table with `(groupJid, type, title, date, details, confirmedAt)`. Types: `destination`, `accommodation`, `activity`, `restaurant`, `transport`. Exposed to Gemini as context in subsequent searches. |
| **Trip-aware digest improvements** | The current weekly digest covers "messages + calendar events." For a trip planning group, the digest should surface unresolved open questions, confirmed decisions, and what's still undecided. | MEDIUM | Existing `generateWeeklyDigest()` in `reminderScheduler.ts` | Add a new "Trip Status" section to the digest prompt: confirmed decisions, open questions (detected but not confirmed), and explicitly missed items (e.g. "nobody has booked accommodation yet"). Read from `tripDecisions` table if it exists. |

---

## Differentiators

Features that set this bot apart from generic trip planners. Not expected by default, but immediately recognized as valuable when experienced.

| Feature | Value Proposition | Complexity | Dependency On | Notes |
|---------|-------------------|------------|---------------|-------|
| **Proactive destination-aware suggestions** | Once a destination is confirmed (e.g. "we're going to Barcelona"), the bot proactively surfaces relevant context: "Tip: La Boqueria is closed on Sundays — your current arrival day. Consider visiting Saturday instead." This is what Romie (WhatsApp travel agent) and Expedia's bot do. | HIGH | Trip memory (destination confirmed in `tripDecisions`); Gemini grounded search; reminderScheduler or message-triggered check | Trigger on destination confirmation. Run a Gemini grounded search for destination-specific tips, local calendar events, or conflicts with known plans. Post to group only when genuinely useful — not every message. Rate-limit heavily (once per confirmation, not per message). |
| **Open question tracking** | Bot detects "who's booking the hotel?" or "does anyone know if we need visas?" and tracks these as open items, surfacing them in the digest if never resolved. Common group trip failure mode: commitments made in chat that get buried and forgotten. | MEDIUM | `tripDecisions` or separate `tripOpenItems` table; digest prompt | Gemini classifies a message as containing an open question or unconfirmed commitment. Store it with the message ID. When the same topic appears resolved later (e.g., "I booked the hotel"), mark it closed. Surface open items in digest. |
| **Conversation recall ("what did we decide about X?")** | User asks "@bot what did we decide about the hotel?" Bot searches `groupMessages` for relevant past messages and summarizes. This is the "chat history recall" feature. Layla.ai and Mindtrip both offer this. | MEDIUM | Existing `getGroupMessagesSince()`; Gemini for summarization; existing reply-chain / @mention trigger | When @mention query looks like a recall question (keywords: "מה החלטנו", "what did we decide", "remind me"), instead of running a travel search, run a semantic lookup over stored `groupMessages`. No vector DB needed — pass last 200 messages to Gemini with "find what the group decided about: X" prompt. |
| **Multi-result comparison format** | When searching for accommodations or activities, format results as a side-by-side comparison: name, price, rating, distance, booking link. Users can react with 1/2/3 to vote. Better than a flat list. | LOW | Existing `travelFormatter.ts`; WhatsApp text formatting (bold, numbered lists) | Formatting change only — no new API calls. Add a "compare mode" to `travelFormatter.ts` when results include price + rating. WhatsApp supports numbered lists and bold natively. Optionally add a voting prompt at the bottom ("React 1/2/3 to vote"). |
| **Trip context passed to search** | When a user asks "@bot find hotels in Barcelona", the bot already knows from `tripDecisions` that travel dates are March 14-16, group size is 6, budget is ~€100/night. It passes this context to the Gemini search query automatically rather than making the user re-specify. | MEDIUM | Trip memory (`tripDecisions`); `parseTravelIntent()` + `geminiGroundedSearch()` | Extend `parseTravelIntent()` to accept a `tripContext` object (destination, dates, group size, budget from `tripDecisions`). Inject as additional context into the Gemini search prompt. Significant UX improvement for zero extra API cost. |
| **Booking link enrichment** | Results already include URLs. Differentiator: distinguish between "booking page" (direct link to buy) vs. "info page" (Wikipedia/blog). Flag booking-ready links explicitly so users know what they can act on immediately. | LOW | Existing `travelFormatter.ts`; URL analysis | Simple heuristic: if URL contains booking.com, airbnb.com, hotels.com, getyourguide.com, viator.com etc., prefix with "Book:" label. Requires a small domain whitelist — no new API needed. |

---

## Anti-Features

Features that look appealing but should be explicitly excluded from this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full booking integration (actual reservations)** | Booking.com, Airbnb, etc. require OAuth flows, payment handling, PCI compliance, and deep API partnerships that are multi-month projects. Commercial travel bots (Romie, IndiGo's bot) have enterprise agreements to do this. A personal WhatsApp bot should surface booking links, not execute bookings. | Show "Book here: [URL]" in results. The human clicks and books. |
| **Expense splitting / shared budget tracking** | Splitwise and Wanderlog both do this well and have mobile UIs. Doing it in WhatsApp text is clunky. Splitwise has a WhatsApp integration. Building a parallel implementation in a bot is scope creep with a worse UX than the dedicated tool. | Mention "use Splitwise" in the digest when budget-related messages are detected. |
| **Flight/hotel price monitoring (alerts)** | Requires polling external APIs (Skyscanner, Kayak) with continuous scheduled jobs, handling price API rate limits, and storing user preferences per search. High infrastructure complexity for a personal bot. | One-time search with "Searching..." indicator is sufficient. Google Flights is 1 click away. |
| **In-group voting system with WhatsApp reactions** | WhatsApp reaction events are available in Baileys but the reaction API is unreliable (reactions don't always fire as events, emoji normalization issues, LID vs JID mapping). Multiple community reports of reaction events being silently dropped. | Use numbered reply prompt: "Reply 1, 2, or 3 to vote." Simple text-based voting that doesn't rely on reactions. |
| **Group member preference profiles** | Knowing that "Uri doesn't eat gluten" or "Dana prefers 4-star hotels" requires persistent per-member storage, onboarding flows, and ongoing maintenance. No standard travel tool tries this at the group-member granularity for informal groups. | Pass the last 20 messages as context to every Gemini search so individual preferences mentioned in conversation are naturally captured. |
| **Automatic duplicate event deduplication across calendars** | Merging Google Calendar events from multiple groups and personal calendars requires Calendar API scopes for reading personal calendars, complex conflict detection, and user identity mapping. High privacy surface, complex auth. | Keep calendar creation per-group as it is. Users manage their own calendar merging. |
| **"Plan the whole trip" wizard-style flow** | Multi-step guided flows (destination → dates → accommodation → activities → ...) don't work in WhatsApp group chats. The conversation is not linear — 6 people interrupt each other. Any wizard state machine gets corrupted by off-topic messages. | Passive detection + suggest-then-confirm is the correct paradigm for a group chat context. Structured wizards work in 1:1 DM bots, not group chats. |
| **Rich media: maps, photos, embedded widgets** | Gemini Maps Grounding returns a `google_maps_widget_context_token` for a rich interactive widget. WhatsApp text messages cannot embed interactive maps or photo galleries. The widget is a web component. | Extract text fields (name, rating, hours, address) from Gemini's response. Link to Google Maps URL for the place. |

---

## Feature Dependencies

```
[Existing Message Pipeline]
    └──feeds──> [groupMessagePipeline.ts debounce]
                    └──currently──> [Date Extractor + Calendar]
                    └──NEW add──> [Activity/Plan Detector] ─────────────────────────────────────────────┐
                                                                                                         │
[Trip Memory — tripDecisions table] <───────────────────────────────────────────────────────────────────┘
    └──populated by──> [Suggest-then-Confirm Flow]
    │                      └──reuses──> [Existing confirmation message pattern]
    │                      └──reuses──> [Existing reply-to infrastructure]
    │
    └──read by──> [Trip-Aware Search (context injection into parseTravelIntent)]
    │                 └──reuses──> [Existing travelSearch.ts + Gemini grounded search]
    │
    └──read by──> [Trip-Aware Digest (new section in generateWeeklyDigest)]
    │                 └──reuses──> [Existing reminderScheduler.ts generateWeeklyDigest()]
    │
    └──read by──> [Proactive Destination-Aware Suggestions]
                      └──triggers on──> [destination confirmed in tripDecisions]
                      └──uses──> [Gemini Maps Grounding (GA) or grounded search]

[Enriched Search Results]
    └──replaces/extends──> [Existing geminiGroundedSearch() in travelSearch.ts]
    └──uses──> [Gemini Maps Grounding API — GA Oct 2025]
    └──feeds──> [Multi-result Comparison Format in travelFormatter.ts]

[Conversation Recall]
    └──triggers via──> [Existing @mention detection in travelHandler.ts]
    └──reads──> [groupMessages table (existing)]
    └──uses──> [Gemini for semantic summarization]
    └──requires──> [Intent classification: "recall question" vs "travel search"]

[Open Question Tracking]
    └──detected in──> [Activity/Plan Detector pass on debounced messages]
    └──stored in──> [tripOpenItems table (new) OR tripDecisions table with status field]
    └──surfaced in──> [Trip-Aware Digest]

[Booking Link Enrichment]
    └──pure formatting change in──> [travelFormatter.ts]
    └──no new dependencies]
```

### Critical Dependency: Trip Memory is the Foundation

All differentiating features — proactive suggestions, trip-aware search, trip-aware digest, open question tracking — depend on having structured trip decisions stored. Trip memory (`tripDecisions` table) must be built first. Without it, every other feature degrades to stateless behavior.

### Suggest-then-Confirm is Required Before Auto-adding Plans

The passive detection feature must NOT auto-add every detected plan to Google Calendar without confirmation. The existing date extraction auto-adds dates (with a confirmation message after the fact). For general plans and activities, the suggest-then-confirm gate is essential — the false-positive rate for casual mentions is much higher than for explicit dates.

---

## MVP Recommendation for This Milestone

Build in this order, with each layer enabling the next:

### Phase 1 — Foundation (required, enables everything)
1. **Trip memory schema** — `tripDecisions` table: `(id, groupJid, type, title, date, details, status, sourceMessageId, confirmedAt)`. Types: `destination`, `accommodation`, `activity`, `restaurant`, `transport`. Status: `suggested | confirmed | rejected`.
2. **Suggest-then-confirm flow** — When passive detection or @mention produces a plan (not just a date), post a suggestion message with ✅/❌ reply. On ✅, write to `tripDecisions` as `confirmed`. On ❌, mark `rejected`. Extend the existing reply-to-delete infrastructure.

### Phase 2 — Enriched Search (high-value, self-contained)
3. **Gemini Maps Grounding integration** — Migrate `geminiGroundedSearch()` to use the Gemini Maps Grounding API (GA). Extract ratings, hours, address alongside the existing title/url/snippet. Update `SearchResult` type and `travelFormatter.ts`. Increase result count to 5 for accommodation/activity searches, keep 3 for quick queries.
4. **Trip context injection** — When `tripDecisions` has a confirmed `destination` and optionally `dates`, inject them automatically into every `parseTravelIntent()` call so search queries include context the user didn't re-type.

### Phase 3 — Intelligence (higher complexity, high value)
5. **Passive activity/plan detection** — Add a Gemini classification pass to the debounced message batch in `groupMessagePipeline.ts`. Detect plans/activities/decisions mentioned in conversation. Gate on pre-filter (must contain a proper noun, place name, or activity keyword) to minimize Gemini calls. On detection, trigger suggest-then-confirm flow.
6. **Trip-aware digest** — Add "Trip Status" section to `generateWeeklyDigest()`. Read confirmed decisions from `tripDecisions`. Include open questions from `tripOpenItems` if built. Add a "what's still unconfirmed" summary.

### Defer
- **Proactive destination-aware suggestions** — Valuable but requires tuning the trigger rate carefully to avoid being spammy. High implementation risk of over-triggering. Build after Phase 3 is validated.
- **Conversation recall** — Valuable but requires careful UX so it doesn't conflict with travel search when the @mention query is ambiguous. Build after the intent classifier is tuned.
- **Open question tracking** — Adds complexity to the already-complex passive detection. Add as a v2 extension.

---

## Real-World Workflow This Feature Set Supports

A group plans a trip entirely through WhatsApp. The bot's role throughout:

1. **Pre-planning discussion**: Group says "let's go to Barcelona in March." Bot detects destination mention, suggests adding it as a confirmed trip decision. Group confirms.
2. **Date locking**: Someone says "how about March 14-16?" Date extractor fires (existing), adds to calendar. Bot also stores dates in `tripDecisions`.
3. **Accommodation search**: User asks "@bot find hotels in Barcelona for 6 people, budget €100/night." Bot injects known dates + group size from `tripDecisions` into the query automatically. Returns 5 enriched results with ratings, hours, booking links.
4. **Activity research**: User asks "@bot what are the best restaurants near Las Ramblas?" Gets enriched results with ratings, hours, address. Formatted as numbered list for easy discussion.
5. **Decision confirmation**: Group agrees on one option in chat. Bot detects "ok let's go with X" pattern, suggests confirming it. Group confirms — stored in `tripDecisions`.
6. **Weekly digest**: Bot sends digest that includes confirmed decisions ("Hotel booked ✅"), upcoming events (calendar), and open items ("Nobody has booked airport transfer yet").
7. **Trip recall**: Someone asks "@bot what hotel are we staying at?" Bot looks up `tripDecisions` for `accommodation` type and answers.

---

## Sources

- [Wanderlog vs TripIt: collaborative features comparison](https://www.wandrly.app/comparisons/wanderlog-vs-tripit) — Wanderlog real-time editing, voting, expense splitting (MEDIUM confidence — third-party comparison)
- [Best travel planning apps for groups 2025: Plan Harmony vs TripIt vs Wanderlog](https://www.planharmony.com/blog/best-travel-planning-apps-for-groups-in-2025-plan-harmony-vs-tripit-vs-wanderlog/) — group-specific feature priorities (MEDIUM confidence — vendor blog but factually grounded)
- [Layla.ai: conversational trip planning](https://layla.ai/about) — conversational UX pattern, real-time price integration, plan flexibility (HIGH confidence — official)
- [Grounding with Google Maps: GA announcement](https://developers.googleblog.com/en/your-ai-is-now-a-local-expert-grounding-with-google-maps-is-now-ga/) — confirmed GA Oct 2025, returns ratings, reviews, photos, hours, addresses (HIGH confidence — official Google developer blog)
- [Gemini API Maps Grounding docs](https://ai.google.dev/gemini-api/docs/maps-grounding) — API structure, `google_maps_widget_context_token`, available data fields (HIGH confidence — official docs)
- [Agentic AI in travel planning 2025](https://www.pymnts.com/news/artificial-intelligence/2025/agentic-ai-takes-the-wheel-in-travel-planning-and-booking/) — proactive AI travel agent patterns, Trip.com TripGenie, Expedia chatbot (MEDIUM confidence — industry news)
- [AI agent memory patterns: Redis blog](https://redis.io/blog/ai-agent-memory-stateful-systems/) — working memory, session memory, episodic memory layers; travel concierge benefits from state-based memory (HIGH confidence — technical reference)
- [7 mistakes in group trip planner logistics](https://www.ibookigo.com/post/7-mistakes-you-are-making-with-group-trip-planner-logistics-and-how-to-fix-them) — budget scatter, over-scheduling, communication fragmentation (MEDIUM confidence — industry blog)
- [How to plan a group trip: SquadTrip guide](https://squadtrip.com/guides/how-to-plan-a-group-trip/) — decision-making patterns, structured voting, anchor events concept (MEDIUM confidence — industry guide)
- [WhatsApp chatbots in travel and hospitality: Kommunicate](https://www.kommunicate.io/blog/whatsapp-chatbot-for-travel-and-hospitality/) — WhatsApp travel bot feature patterns, group chat integration (MEDIUM confidence — vendor blog, factually grounded)
- [Google Places API: places, ratings, reviews, hours](https://developers.google.com/maps/documentation/places/web-service/overview) — structured place data fields available (HIGH confidence — official docs)
- [TripIt 2025 features](https://www.wandrly.app/reviews/tripit) — email-based itinerary parsing, sharing, alerts — what TripIt does vs. doesn't do for groups (MEDIUM confidence — third-party review)

---

*Feature research for: WhatsApp Bot — Travel Agent Group Bot Milestone*
*Researched: 2026-03-02*
*Codebase read directly: src/groups/*, src/pipeline/messageHandler.ts, src/db/schema.ts, src/groups/reminderScheduler.ts*

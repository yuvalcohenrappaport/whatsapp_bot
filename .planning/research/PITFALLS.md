# Domain Pitfalls

**Domain:** WhatsApp Group Bot — Travel Agent Milestone (Always-Listening AI, Trip Memory, Proactive Suggestions, Google Calendar Itinerary)
**Researched:** 2026-03-02
**Confidence:** MEDIUM-HIGH — Gemini pricing verified via multiple 2026 sources. Baileys ban risk confirmed via GitHub issues and community reports. SQLite WAL limits confirmed via official SQLite docs. Google Calendar timezone pitfalls confirmed via official API docs and GitHub issues. Context rot confirmed via published research. Some cost estimates are modeled projections rather than measured figures.

---

> **Scope note:** This document covers pitfalls specific to adding travel agent features (always-listening AI, trip memory, proactive suggestions, richer search, Google Calendar itinerary) to the existing bot. Pre-existing pitfalls from earlier milestones (PTT flag, waveform generation, ElevenLabs model selection, FFmpeg path, temp file cleanup, voice clone quality) remain valid and are not repeated here. This file extends that prior context.

---

## Critical Pitfalls

Mistakes that cause cost blow-ups, permanent account bans, or mandatory architectural rewrites.

---

### Pitfall 1: Always-Listening Analysis Fires on Every Message — Gemini Costs Explode

**What goes wrong:**
The always-listening pipeline calls Gemini to classify every group message as "travel-related or not." In an active travel planning group, the group sends 100–300 messages per day (casual chat, jokes, logistics, yes/no replies). Each classification call consumes tokens even for "ignore this" outcomes. At Gemini 2.5 Flash pricing ($0.30/M input, $2.50/M output), a naive always-on implementation with a 500-token system prompt + message costs approximately $0.50–$2.50/month at moderate traffic — but that is assuming only classification. If the classification result is positive and triggers a full AI search + response, costs spike further.

The hidden multiplier: if thinking mode is accidentally enabled on the classifier (the default in some Gemini 2.5 Flash configurations), thinking tokens cost $3.50/M — 11.7x the standard output rate. A misfire with thinking-mode on a 50-message/day group can cost $5–$15/month just for message triage.

**Why it happens:**
Developers wire the `messages.upsert` Baileys event directly into a Gemini call, forgetting that every message — including bot-generated ones, reactions, status updates, and edit events — triggers the event. The system prompt and recent context get re-sent with every message, multiplying token cost.

**Consequences:**
- Uncapped Gemini costs; a busy group during trip planning season (50+ messages/hour) could generate $10–$30/month from classification alone
- Free tier (10 RPM, 250 RPD for Gemini 2.5 Flash) exhausted within hours of group activity
- Rate limit errors cascade into dropped messages with no user-visible error

**Prevention:**
1. **Two-tier classification**: Use a fast, cheap pre-filter in JavaScript before calling Gemini — keyword matching (city names, hotel, flight, dates, "נסיעה", "טיסה", "מלון") with a blocklist of trivial patterns (emoji-only, < 10 characters, reactions). Only pass candidates to Gemini.
2. **Disable thinking mode on the classifier call**: Explicitly set `thinkingConfig: { thinkingBudget: 0 }` on every classification call. Reserve thinking mode for response generation only.
3. **Reuse the existing 10-second debounce**: The existing date-extraction debounce already batches rapid messages. Use the same debounce for travel activity detection — classify the batch, not each message individually.
4. **Respect implicit caching**: Keep the system prompt identical across calls. As of May 2025, Gemini 2.5 models apply automatic context caching at 90% discount for repeated prefixes. A fixed system prompt cached across 100 calls costs 10% of what 100 independent calls cost.
5. **Cap daily Gemini spend** via Google AI Studio budget alerts before deploying.

**Cost estimate for correctly-implemented always-listener:**
- Pre-filter eliminates ~70% of messages
- 30 candidate messages/day × 700 tokens avg (prompt + message) = 21,000 input tokens/day
- 21,000 × 30 days = 630,000 input tokens/month → $0.19/month input
- 30 positive classifications × 200 token output = 6,000 tokens/month → $0.015/month output
- With context caching 90% discount on repeated system prompt: effectively $0.02–$0.05/month for classification
- Full response generation (search + calendar + reply) for 10 actions/day: ~$0.50–$1.50/month additional

**Warning signs:**
- Gemini spend dashboard shows > $1/week on a personal bot
- API logs show `gemini.generateContent` called for messages under 10 characters
- Thinking tokens appear in usage logs on classifier calls

**Phase to address:** Always-listening foundation phase — cost architecture must be decided before any Gemini classifier is wired to Baileys events.

**Confidence:** HIGH — pricing verified via official Gemini API pricing page and multiple 2026 cost guides. Thinking mode pricing ($3.50/M) confirmed via pricepertoken.com and aifreeapi.com.

---

### Pitfall 2: Proactive Bot Messages in a Group Trigger WhatsApp's Spam Detection

**What goes wrong:**
The bot detects travel planning activity and unprompted sends suggestions to the group: "I noticed you're planning a trip to Rome — want me to find hotels?" If this fires multiple times in a row, or fires for ambiguous messages, the group sees the bot as noisy. More critically, if the bot sends multiple unsolicited messages within a short window, WhatsApp's spam detection flags the number. The result is a temporary ban (24–72 hours) or a permanent ban if repeated. The project already uses an account that has been running for two milestones — a ban resets two milestones of setup.

**Why it happens:**
WhatsApp's spam detection evaluates messaging behavior patterns, not just volume. Sending automated messages to a group where members haven't explicitly triggered the bot looks indistinguishable from spam to WhatsApp's ML system. In 2025, WhatsApp banned 6.8 million accounts using pattern-based detection, and Baileys accounts have been banned even at low message volumes as Meta tightened unofficial API detection.

**Consequences:**
- Account ban (temporary or permanent) — all bot state survives in SQLite, but re-registration requires a new phone number
- Users mute or remove the bot from the group before a ban occurs
- Trust degradation: users stop using the bot entirely after one irrelevant suggestion

**Prevention:**
1. **Require explicit trigger**: Do not send unsolicited messages. Instead, react with an emoji (e.g., a luggage emoji) to signal detection without generating a full bot message. The user can then explicitly ask the bot to proceed.
2. **Per-group suggestion cooldown**: Never send more than 1 proactive suggestion to the same group within a 2-hour window, regardless of how many travel signals were detected.
3. **Confidence threshold**: Only fire a proactive suggestion when the classifier confidence exceeds 90%. At 75–89%, log the detection and wait for a stronger signal.
4. **Suggestion cap per day**: Hard cap of 3 unsolicited suggestions per group per calendar day. After the cap, switch to emoji-reaction-only mode.
5. **Human-like message timing**: Use the existing `sendWithDelay` pattern (already in `whatsapp/sender.ts`). Add 3–8 second randomized delay before any proactive message. Never send within 30 seconds of the triggering message.
6. **Message deduplication**: Track sent suggestion IDs to prevent resending the same suggestion if the debouncer fires the classifier twice on the same message cluster.

**Warning signs:**
- Bot sends 3+ unprompted messages within 10 minutes in a single group
- Group members ignore bot messages consistently (UX sign, not ban risk, but leading indicator)
- WhatsApp app on the registered phone shows "account at risk" warning (confirmed real via whatsmeow issue #810)

**Phase to address:** Proactive suggestions phase — must design the "trigger → signal → threshold → cooldown → send" chain before wiring any classifier output to `sendMessage`.

**Confidence:** HIGH — ban risk for proactive messaging confirmed via Baileys GitHub issues #1869, #1925, multiple community ban reports, and WhatsApp's own 2025 anti-spam announcement. Spam detection behavior confirmed via The Next Web analysis of WhatsApp's anti-spam systems.

---

### Pitfall 3: Trip Memory Accumulates Indefinitely — Context Rot Degrades AI Quality

**What goes wrong:**
The bot accumulates all conversation history for a trip: every message, every search result, every calendar event, every bot response. After 3–4 days of planning, the trip context reaches 50,000–200,000 tokens. Two effects occur simultaneously:
1. **Token cost**: Every Gemini call includes the full trip context, causing cost to grow quadratically with conversation length
2. **Context rot**: LLM performance degrades significantly as context grows. Research published by Chroma (2025) shows that recall accuracy drops substantially as the number of tokens in the context window increases. Old decisions ("we rejected that hotel") get confused with current state ("we liked that hotel"). The AI gives worse answers with more context than with less.

**Why it happens:**
The simplest trip memory implementation is an append-only log. Developers store every message and pass all of it to Gemini on each request. This works for the first 20 messages. After 200 messages over a multi-day trip, it breaks.

**Consequences:**
- Gemini calls for a mature trip cost 10–50x more than for a fresh trip
- AI suggestions contradict previous decisions because the model loses track of distant context
- SQLite `group_messages` table grows without bound; no partition or expiry strategy

**Prevention:**
1. **Trip-scoped context, not full history**: Only include messages within the active trip window (defined by trip start/end dates or a "trip active" flag). Past trips are archived and not sent to Gemini.
2. **Summarize-and-compress**: After each planning session (detected by a 2+ hour gap in group activity), generate and store a 200-word trip summary using Gemini. Future calls receive the summary, not the raw messages. The Mem0 pattern (2025) reduces token usage 80–90% vs. raw history while improving response quality.
3. **Structured trip state**: Instead of raw message history, maintain a structured JSON record: `{ destination, dates, confirmed_hotels, confirmed_flights, preferences, open_questions }`. Pass the structured state to Gemini, not the raw chat. Update the struct after each decision.
4. **Context window budget**: Hard cap the context passed to any single Gemini call at 50,000 tokens (well within the 1M window, but prevents cost explosion). Truncate oldest raw messages first, keep the trip summary always.
5. **Trip archival**: When a trip's end date passes, archive its SQLite rows and remove them from active context construction.

**Warning signs:**
- Gemini call logs show token counts growing trip-over-trip for the same number of interactions
- Bot gives contradictory suggestions ("I see you liked Hotel X" when Hotel X was previously rejected)
- SQLite `group_messages` table row count grows unboundedly month-over-month

**Phase to address:** Trip memory phase — the summarize-and-compress pattern must be in place before any trip context is passed to Gemini. Retrofitting this onto an existing append-only store requires a migration.

**Confidence:** HIGH — context rot confirmed by Chroma Research (2025) and Anthropic context engineering guide. Summarization effectiveness confirmed by Mem0 published benchmarks (80-90% token reduction, 26% quality improvement). SQLite unbounded growth is a standard operational concern.

---

### Pitfall 4: Google Calendar Service Account Owns All Calendars — Users Can't Edit Events

**What goes wrong:**
The bot authenticates to Google Calendar using a service account (the simplest OAuth flow for a server-side app). The service account creates a new trip calendar and adds events. Users receive the calendar invite and can view events — but they cannot edit or delete them, because the service account is the data owner and has the highest privilege. The intent was for the whole group to collaboratively manage the itinerary. Instead, only the bot can modify it.

**Why it happens:**
Google Calendar API documentation explicitly warns against using a service account as the calendar data owner for user-facing calendars. Service accounts own calendars with the highest privilege, and that privilege cannot be downgraded. Developers default to service accounts because they are easier to set up than OAuth with user delegation — no browser flow, no refresh token rotation, no user consent screen.

**Consequences:**
- Users cannot update event times, add notes, or delete events from the trip calendar — bot is the only editor
- If the bot deletes an event erroneously, users cannot restore it
- Sharing the calendar to group members is possible but they receive read-only access
- Requires architectural rework: either switch to user-delegated OAuth or accept read-only user access

**Prevention:**
Two valid architectures — choose one before writing any Calendar API code:

Option A (recommended for personal use): **User-delegated OAuth** — authenticate as the bot owner's Google account using offline OAuth2 with a refresh token stored in the DB. The owner's account creates the calendar and is data owner. Group members are invited as editors via the Calendar sharing API. Events can be edited by anyone in the group who accepts the invite.

Option B (acceptable tradeoff): **Service account + write-back bot** — use service account ownership but build a "edit event" command in the WhatsApp bot itself. Users request changes through the bot (e.g., "!move hotel to Tuesday") and the bot makes the edit. Avoids the OAuth complexity at the cost of all edits going through the bot.

Do not pursue a hybrid where you start with a service account and try to transfer ownership later — Google Calendar does not support calendar ownership transfer.

**Warning signs:**
- Users report they cannot edit events in the trip calendar
- Service account email appears as the event organizer (visible in Calendar UI)
- Google Calendar API returns 403 when a group member attempts to edit via a 3rd-party calendar app

**Phase to address:** Google Calendar integration phase — authentication architecture must be chosen before the first `calendar.events.insert` call. Switching later requires recreating all calendars under the new owner account.

**Confidence:** HIGH — service account ownership limitation explicitly documented in official Google Calendar API concepts page ("calendars have a single data owner with highest privileges; the data owner's access level cannot be downgraded"). OAuth vs. service account recommendation confirmed via official Google developer documentation.

---

## Moderate Pitfalls

Mistakes that cause user-visible degradation, non-trivial debugging time, or significant cost increases, but don't force rewrites.

---

### Pitfall 5: Always-Listener Fires on the Bot's Own Messages — Infinite Loop

**What goes wrong:**
The bot sends a proactive suggestion to the group. Baileys emits a `messages.upsert` event for this outgoing message (type `notify`, `fromMe: true`). The always-listener pipeline receives this event and, if not filtered, passes the bot's own message through the travel-activity classifier. The classifier detects "travel content" (because the bot's suggestion is about travel). The pipeline schedules another suggestion. The loop fires repeatedly until rate limits kick in.

**Why it happens:**
The existing `messageHandler.ts` already filters `fromMe: true` for 1:1 contacts, but the new group pipeline is a separate code path. Developers wire the new group activity classifier without porting the `fromMe` check from the existing handler.

**Consequences:**
- Rapid-fire bot messages in the group (3–10 messages in seconds) before the cooldown kicks in
- Rate-limit-induced ban risk (see Pitfall 2)
- Inflated Gemini costs for self-generated classification

**Prevention:**
- Filter `msg.fromMe === true` as the first check in the group message pipeline, before any classification
- Add a message ID deduplication cache (Map of `messageId → timestamp`) with a 60-second TTL; drop any message whose ID has already been processed
- Log a warning if the classifier is called with a message whose `senderJid` matches the bot's own JID

**Warning signs:**
- Bot sends identical or near-identical messages multiple times within seconds
- Gemini call logs show the bot's own reply text being classified
- Group message count spikes after a bot action

**Phase to address:** Always-listening foundation phase — add `fromMe` check before wiring the first classifier call.

**Confidence:** HIGH — `fromMe` filtering is a standard Baileys pattern; the risk of omitting it in a parallel code path is well-established in Baileys community discussions.

---

### Pitfall 6: Google Calendar Timezone Handling Creates Wrong Event Times

**What goes wrong:**
The bot extracts dates from WhatsApp messages like "let's fly on March 15 at 6pm." The date/time is stored and passed to Google Calendar API without explicit timezone specification. Google Calendar defaults to the calendar's timezone (which was set when the calendar was created — likely the server's local timezone, UTC, or Israel Standard Time). The event is created at the wrong absolute time, meaning it appears at the correct local time on the creator's device but at the wrong time for group members in a different timezone, or appears at the wrong time after daylight saving time changes.

**Why it happens:**
Google Calendar API's timezone handling is non-obvious. For timed events (not all-day events), the API accepts `dateTime` in ISO 8601 format. If no timezone offset is specified and the `timeZone` field is omitted, the API uses the calendar's configured timezone. Developers often format dates as `2025-03-15T18:00:00` (no offset), assuming it means local time — but "local" is undefined from the API's perspective. A confirmed bug in the PHP client (googleapis/google-api-php-client issue #2468) shows that even when specifying `timeZone: 'Etc/UTC'`, some API paths return events in the calendar's default timezone instead.

**Consequences:**
- Events appear at wrong times in some group members' calendars
- After Israel DST change (last Friday of October / last Friday of March), recurring events shift by 1 hour
- No error is thrown — the event is created "successfully" at the wrong time

**Prevention:**
1. Always include the explicit IANA timezone in every event creation: `timeZone: 'Asia/Jerusalem'` for Israel trips, the destination timezone for international destinations
2. Format all `dateTime` fields with the explicit UTC offset: `2025-03-15T18:00:00+02:00` rather than `2025-03-15T18:00:00`
3. Store extracted dates as UTC timestamps in SQLite and convert to the target timezone at Calendar API call time
4. Never use `Etc/UTC` as a timezone string for events — use the actual IANA timezone name
5. After creating an event, immediately read it back via `calendar.events.get` and verify the `dateTime` matches the intended time

**Warning signs:**
- Events appear 1–2 hours off from the intended time
- Events shift after daylight saving changes
- Group members in different timezones see different event times in their Calendar app

**Phase to address:** Google Calendar integration phase — timezone strategy must be established before writing event creation code.

**Confidence:** HIGH — confirmed via Google Calendar API official documentation on event timezones, known bug in googleapis/google-api-php-client issue #2468, and Google Calendar community thread on all-day event timezone handling.

---

### Pitfall 7: Richer Search Results Grounded in Google Search — Cached Pages, Not Live Prices

**What goes wrong:**
Gemini with Google Search grounding is used to fetch hotel prices, flight availability, and attraction hours for the trip. The bot presents these as current facts: "Hotel X costs ₪450/night." The user books based on this, only to find the actual price is ₪680/night. Google Search grounding reduces hallucinations but returns Google Search results, which may be cached, seasonal, or from aggregator sites that don't reflect real-time inventory.

**Why it happens:**
Google's documentation acknowledges that "for real-time information such as stock prices, the results are mixed, with Google Search possibly returning cached content." Travel prices are similarly dynamic — hotel and flight prices fluctuate by hour. Gemini's grounding retrieves what Google Search currently indexes, not what the booking engine quotes at reservation time.

**Consequences:**
- Users get incorrect pricing expectations, leading to frustration
- Users blame the bot for "lying" when prices differ
- Legal/trust issue if the bot presents grounded prices as booking-ready quotes

**Prevention:**
1. Always qualify grounded price results with an explicit disclaimer: "Based on web search — prices change frequently. Verify before booking."
2. Do not present prices as facts; present them as reference ranges: "Hotels in this area typically range from $X to $Y per night based on current search results."
3. For flight availability specifically, note that Google Search grounding cannot provide seat-level availability — only price ranges from aggregators
4. Structure the bot's response template to always include a booking link rather than a price figure: "Search current prices: [link]"
5. Do not store grounded prices in the trip memory as confirmed data — store them as "estimated at time of search" with a timestamp

**Warning signs:**
- Users report price discrepancies between bot-stated prices and booking sites
- Bot presents prices without a qualifying phrase like "approximately" or "based on current search"
- Trip memory stores grounded prices as confirmed budget figures

**Phase to address:** Richer search results phase — response template must include the disclaimer before any grounded search result is presented to users.

**Confidence:** MEDIUM-HIGH — Google Search grounding for Gemini confirmed via official Gemini API docs and developer blog. Cached content limitation acknowledged in official documentation. Real-time travel pricing limitation inferred from how Google Search indexes travel sites (LOW confidence on the specific failure rate; MEDIUM on the underlying cause).

---

### Pitfall 8: Suggest-Then-Confirm Flow Breaks Under Message Ordering Ambiguity

**What goes wrong:**
The bot asks "Should I add Hotel X to the itinerary? Reply ✅ or ❌." Two group members reply in quick succession: one replies ✅, another replies with an unrelated message at nearly the same time. The bot's reply parser sees two incoming messages close together and ambiguously associates both with the pending confirmation. Alternatively, the bot sends a follow-up suggestion before the first confirmation is resolved, creating two simultaneous pending confirmations. The confirmation state machine breaks.

**Why it happens:**
The existing draft system (`drafts` table + `markDraftSent`/`markDraftRejected`) was designed for 1:1 private chats where only one person confirms. In a group, multiple people can respond. The "pending confirmation" concept does not map cleanly to a multi-participant group without explicit state scoping.

**Consequences:**
- Bot takes the wrong action (adds a hotel that was rejected, or vice versa)
- Two pending confirmations confuse the state machine, causing the second to never resolve
- User confusion: "I said ✅ and it still didn't add it"

**Prevention:**
1. **Scope confirmations to a specific quoted message**: When the bot asks for confirmation, the user must reply by quoting the bot's question message (Baileys `quotedMessageId`). Only a reply that quotes the specific bot message counts as a confirmation. Unquoted ✅/❌ messages are ignored for confirmation purposes.
2. **One pending confirmation per group at a time**: Before sending a new confirmation request, check if a previous one is still pending. If yes, either wait or explicitly cancel the old one.
3. **Confirmation timeout**: Pending group confirmations expire after 30 minutes. If unresolved, the bot logs the expiry and takes no action.
4. **Only the group admin (trip organizer) can confirm**: Optionally, scope confirmation authority to the group admin JID stored in the groups table.
5. **Do not use the existing private-chat draft table for group confirmations** — create a separate `group_confirmations` table scoped to `(group_jid, message_id)`.

**Warning signs:**
- Bot adds or removes items from the itinerary without the owner confirming
- "Pending confirmation" state persists in DB after group resolution
- Multiple ✅ replies in a short window cause duplicate calendar events

**Phase to address:** Suggest-then-confirm phase — design the confirmation state machine for group semantics before writing any confirmation-resolution code.

**Confidence:** MEDIUM-HIGH — inferred from the existing draft system design (private-chat scoped) and known WhatsApp group message ordering behavior. Quoted-message scoping is a well-established pattern for disambiguation in Baileys-based bots.

---

### Pitfall 9: Gemini Free Tier Rate Limits Are Exhausted Within Hours by Always-On Bot

**What goes wrong:**
Gemini 2.5 Flash free tier allows 10 RPM and 250 RPD as of March 2026 (reduced from higher limits in December 2025). An always-listening bot that classifies messages without batching will exhaust the 250 RPD limit before noon on an active planning day. Classification calls for 30 messages/hour × 12 hours = 360 calls/day, exceeding the 250 RPD limit by 44%. Once the limit is hit, all Gemini calls fail with 429 errors — the bot goes silent with no user-visible error.

**Why it happens:**
Developers test on the free tier during development and assume volume is low enough. But even a quiet group generates hundreds of messages per day during active trip planning (dates, links, questions, memes). The December 2025 Google quota reductions cut free tier limits by 50–80%, making the problem worse.

**Prevention:**
1. **Enable billing before deploying the always-listener**: Tier 1 (paid) raises limits to 300 RPM and 1,000 RPD — enough for any personal bot. At the cost estimates above (~$0.50–$2.00/month), billing is affordable.
2. **Aggressive batching**: The 10-second debounce already batches messages. Extend to 30 seconds for the travel classifier specifically, collapsing a burst of 10 messages into one classifier call.
3. **Add a local RPM circuit breaker**: Track Gemini calls per minute in memory. If approaching 8/minute (80% of free tier limit), queue subsequent calls rather than dropping them.
4. **Handle 429 gracefully**: Catch `RESOURCE_EXHAUSTED` errors from the Gemini API. Do not crash the message handler. Log the error, drop the classification silently, and resume when the window resets.

**Warning signs:**
- Gemini API returns `RESOURCE_EXHAUSTED` or 429 errors after noon on active days
- Bot stops responding to group messages during busy planning sessions
- Logs show Gemini call counts approaching 250/day

**Phase to address:** Always-listening foundation phase — add billing and the circuit breaker before deploying to any active group.

**Confidence:** HIGH — rate limits verified via official Gemini API rate limits documentation and multiple 2026 rate limit guides confirming the December 2025 reductions.

---

### Pitfall 10: Message Pipeline Ordering Breaks When Always-Listener Runs Alongside Existing Handlers

**What goes wrong:**
The existing `messageHandler.ts` already handles group messages via `groupMessageCallback`. The new always-listener registers its own event handler on the same `messages.upsert` event. Both handlers fire for every message, potentially in parallel. The new handler reads and writes `group_messages` rows; the existing handler also reads group context. SQLite WAL mode allows only one simultaneous writer — if both handlers attempt concurrent writes, one gets `SQLITE_BUSY`. With the default `busy_timeout`, the second write fails silently or throws an unhandled exception.

**Why it happens:**
Two independent `sock.ev.on('messages.upsert', ...)` listeners on the same Baileys socket both fire on the same event. Node.js executes them in registration order but does not serialize their async operations. Both can be in-flight simultaneously, racing to write to the same SQLite table.

**Consequences:**
- Intermittent `SQLITE_BUSY` errors on group message writes
- Message dropped from `group_messages` — trip context is incomplete
- Hard to reproduce (race condition, depends on message timing)

**Prevention:**
1. **Single entry point for all group message processing**: Do not register a second `messages.upsert` listener. Extend the existing `groupMessageCallback` pipeline to include the always-listener step. Message processing is sequential within a single async function.
2. **Pipeline stage ordering**: Within the single handler, enforce this order:
   1. Insert to `group_messages` (write — must complete before any reads)
   2. Run keyword pre-filter (pure JS, no DB)
   3. If pre-filter passes: call Gemini classifier (async, non-DB)
   4. If classifier positive: trigger proactive suggestion flow
3. **SQLite `busy_timeout`**: Already set to WAL mode. Verify `PRAGMA busy_timeout = 5000` is set on startup. This allows 5 seconds of retry before failing, which covers most transient write contention.
4. **Serialize writes with a queue**: If parallel writes are unavoidable, use a lightweight async queue (e.g., `p-queue` with concurrency 1) for all SQLite writes in the message pipeline.

**Warning signs:**
- `SQLITE_BUSY` errors appearing in logs during group activity bursts
- `group_messages` table is missing rows that should have been inserted
- Two Gemini classification calls appearing in logs for the same `messageId`

**Phase to address:** Always-listening foundation phase — pipeline integration design before any new event listener is registered.

**Confidence:** HIGH — SQLite single-writer limitation confirmed via official SQLite WAL documentation. The specific risk of parallel Baileys event handlers is directly implied by the existing `messageHandler.ts` architecture (single `groupMessageCallback` hook pattern already guards against this; extending it correctly is the prevention).

---

## Minor Pitfalls

Issues that are annoying but recoverable without significant rework.

---

### Pitfall 11: Trip Memory Contains Privacy-Sensitive Personal Travel Data

**What goes wrong:**
The trip memory accumulates everything discussed in the group: passport details if mentioned, accommodation addresses, flight numbers, who is traveling with whom. This data lives in plaintext SQLite and is passed wholesale to Gemini (Google's servers). For a personal family bot this is an accepted tradeoff, but if a group member objects to their travel plans being processed by Google's AI, there is no mechanism to delete their specific messages.

**Prevention:**
- Document the data flow clearly in a comment in the codebase: "Group messages are stored in SQLite and sent to Google Gemini for classification. All group members implicitly accept this by remaining in the group."
- Implement a `!forget` command that deletes all messages from a specific sender's JID from the trip memory
- Do not send group member phone numbers or JIDs to Gemini — strip PII from the message context before classification
- Set a retention policy for `group_messages`: delete rows older than 90 days automatically (a SQLite cleanup job on startup)

**Phase to address:** Trip memory phase — retention and PII stripping built in from the start.

**Confidence:** MEDIUM — GDPR chatbot compliance sources confirm the principle; specific WhatsApp/Gemini data processing details are inferred rather than from a direct official source.

---

### Pitfall 12: Google Calendar Event Spam When Dates Are Extracted from Casual Mentions

**What goes wrong:**
A group member says "remember when we went to Eilat last March?" The date extractor (10-second debounce, currently used for date extraction) extracts "last March" and the bot creates a calendar event for a past date, or creates an event for an ambiguous future date. The group's itinerary calendar fills with spurious events from casual historical references.

**Prevention:**
- Gate calendar event creation on an explicit confirmation flow (Pitfall 8's suggest-then-confirm). Never auto-create a calendar event without user approval.
- Add a date relevance filter: dates more than 7 days in the past are not candidates for itinerary events
- Distinguish date mentions by context: the classifier prompt should include "is this date being planned for the future trip, or is it a historical reference?" as a classification dimension
- Allow `!remove last event` command as a quick recovery path for spurious events

**Phase to address:** Google Calendar integration phase.

**Confidence:** MEDIUM — inferred from the existing 10-second debounce and date extraction pattern in the codebase. Specific false-positive rate not measured.

---

### Pitfall 13: Stale In-Memory Trip State After Server Restart

**What goes wrong:**
Trip context, pending confirmations, and classifier debounce state live in `Map` objects (following the existing ephemeral state pattern in `messageHandler.ts`). After a server restart, all in-memory state is lost. A pending confirmation that was waiting for ✅/❌ is now invisible to the bot. The next ✅ from a user is treated as an orphaned message. A trip that was "active" in memory is gone — the bot has no awareness of the current planning session.

**Prevention:**
- Persist pending group confirmations in a `group_confirmations` SQLite table (not in memory)
- Persist the "active trip" flag and current trip summary in the `groups` table or a new `trips` table
- On startup, reload active trip state from SQLite into memory before processing any messages
- For the classifier debounce specifically, lost state on restart is acceptable — the worst case is one missed classification after a restart

**Phase to address:** Trip memory phase.

**Confidence:** HIGH — directly implied by the existing architecture (`lastAutoReplyTime` Map resets on restart, per existing code comment).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Always-listening foundation | Gemini cost explosion on every message | Two-tier pre-filter + debounce batching + disable thinking mode on classifier |
| Always-listening foundation | Self-message reflection loop | First-line `fromMe` filter before any classification |
| Always-listening foundation | Free-tier rate limit exhaustion | Enable billing; add circuit breaker; handle 429 gracefully |
| Always-listening foundation | Pipeline concurrency / SQLite busy | Extend single `groupMessageCallback`; do not add a second `messages.upsert` listener |
| Proactive suggestions | Ban risk from unsolicited group messages | Emoji-reaction signal first; explicit trigger before full message; per-group 2-hour cooldown |
| Proactive suggestions | User annoyance / trust erosion | Confidence threshold > 90%; daily cap of 3; human-like send delay |
| Trip memory | Context rot + cost blowup | Summarize-and-compress after each session; 50K token hard cap; structured trip state |
| Trip memory | Privacy / PII in Gemini context | Strip JIDs/phone numbers; 90-day retention; `!forget` command |
| Trip memory | Stale state after restart | Persist active trip flag and pending confirmations in SQLite |
| Suggest-then-confirm | Multi-user confirmation ambiguity | Quoted-message scoping; single pending confirmation per group; 30-min timeout |
| Richer search | Stale prices presented as facts | Always include disclaimer; present as ranges; include booking link |
| Google Calendar integration | Service account ownership lock-in | Choose auth architecture (user OAuth vs. bot-only) before first API call |
| Google Calendar integration | Wrong event timezone | Explicit IANA timezone on every event; store UTC; read-back verification |
| Google Calendar integration | Event spam from casual date mentions | Require confirmation before any `events.insert`; reject past dates |

---

## Cost Modeling: Gemini 2.5 Flash — Always-Listening Pattern

**Assumptions:** Active trip planning group, 100 messages/day, 30-day trip planning period. Gemini 2.5 Flash at $0.30/M input, $2.50/M output (March 2026). Context caching active at 90% discount on system prompt.

| Scenario | Monthly Gemini Cost | Notes |
|----------|---------------------|-------|
| Naive: every message classified, no pre-filter, thinking mode on | ~$15–$40/month | Thinking tokens ($3.50/M) are the budget killer |
| Naive: every message classified, no pre-filter, thinking mode off | ~$1.50–$4.00/month | Much better; still suboptimal |
| Optimized: pre-filter eliminates 70%, 30-second debounce, caching | ~$0.20–$0.80/month | Target range for personal bot |
| Optimized + full responses (searches, calendar, replies) at 10/day | ~$0.70–$2.50/month | Total realistic monthly cost |

**Bottom line:** A correctly implemented always-listener on Gemini 2.5 Flash costs $1–$3/month for a personal travel group. An incorrectly implemented one (no pre-filter, thinking mode on) costs $15–$40/month.

---

## Sources

- [Baileys GitHub Issue #1869 — High Number of Bans](https://github.com/WhiskeySockets/Baileys/issues/1869) — HIGH confidence — ban patterns documented by community; accounts banned after group posting
- [kobie3717/baileys-antiban — Anti-Ban Middleware](https://github.com/kobie3717/baileys-antiban) — MEDIUM confidence — rate limit recommendations (8 msg/min, 200/hr, 1500/day) from community-maintained anti-ban library
- [whatsmeow Issue #810 — "Account at risk" Warning](https://github.com/tulir/whatsmeow/issues/810) — MEDIUM confidence — "account may be at risk" warning affecting both WhatsMeow and Baileys accounts
- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — HIGH confidence — $0.30/M input, $2.50/M output for Gemini 2.5 Flash; $3.50/M for thinking tokens
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) — HIGH confidence — 10 RPM, 250 RPD for Gemini 2.5 Flash free tier
- [Gemini API Rate Limits 2026 — LaoZhang](https://blog.laozhang.ai/en/posts/gemini-api-rate-limits-guide) — MEDIUM confidence — December 2025 quota reduction details
- [Gemini API Context Caching](https://ai.google.dev/gemini-api/docs/caching) — HIGH confidence — 90% discount on cached tokens for Gemini 2.5 models; implicit caching enabled by default since May 2025
- [Gemini API Pricing 2026 — aifreeapi.com](https://www.aifreeapi.com/en/posts/gemini-api-pricing-2026) — MEDIUM confidence — pricing breakdown including thinking mode
- [Context Rot — Chroma Research](https://research.trychroma.com/context-rot) — HIGH confidence — empirical evidence of LLM performance degradation with context growth
- [Active Context Compression — arxiv.org](https://arxiv.org/html/2601.07190) — MEDIUM confidence — 22.7% token savings with frequent small compressions
- [Mem0 LLM Chat History Summarization Guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) — MEDIUM confidence — 80-90% token reduction, 26% quality improvement with smart memory vs. raw history
- [Effective Context Engineering — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — HIGH confidence — context management best practices for AI agents
- [Google Calendar API — Calendars and Events Concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) — HIGH confidence — service account ownership limitation: "data owner's access level cannot be downgraded"
- [Google Calendar API — Create Events](https://developers.google.com/workspace/calendar/api/guides/create-events) — HIGH confidence — timezone specification requirements for timed events
- [Google Calendar API — googleapis/google-api-php-client Issue #2468](https://github.com/googleapis/google-api-php-client/issues/2468) — MEDIUM confidence — timezone inconsistency bug when retrieving events
- [SQLite WAL Mode — Official Documentation](https://sqlite.org/wal.html) — HIGH confidence — "only one writer at a time" limitation in WAL mode
- [SQLite Concurrent Writes — tenthousandmeters.com](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — MEDIUM confidence — SQLITE_BUSY behavior under concurrent writers
- [Grounding with Google Search — Gemini API Docs](https://ai.google.dev/gemini-api/docs/google-search) — HIGH confidence — grounding capabilities and real-time information limitations
- [WhatsApp Anti-Spam 2025 — About.fb.com](https://about.fb.com/news/2025/08/new-whatsapp-tools-tips-beat-messaging-scams/) — HIGH confidence — 6.8M accounts banned in H1 2025; pattern-based detection
- [Phone Number Age and Ban Risk — GREEN-API](https://green-api.com/en/blog/reduce-the-risk-of-WA-blocking/) — MEDIUM confidence — account age significantly affects ban resistance; 25–30 day safe window
- [GDPR Chatbot Compliance — moinAI](https://www.moin.ai/en/chatbot-wiki/chatbots-data-protection-gdpr) — MEDIUM confidence — data retention, PII minimization, and right-to-deletion requirements for chatbots

---

*Pitfalls research for: WhatsApp Bot — Travel Agent Milestone*
*Researched: 2026-03-02*

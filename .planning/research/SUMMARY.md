# Project Research Summary

**Project:** WhatsApp Group Bot — Travel Agent Milestone (v1.4)
**Domain:** Always-listening AI travel agent integrated into an existing WhatsApp group bot
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

This milestone adds travel agent intelligence to an already-working WhatsApp bot. The core design challenge is not "how to build a travel bot" but "how to safely layer AI capabilities onto a production system without breaking what exists." The recommended approach treats the existing message pipeline (`groupMessagePipeline.ts`) as the single integration point — all new features are added as additional steps within the one registered callback, not as parallel event listeners. The central new capability is trip memory: a structured `tripContexts` + `tripDecisions` DB layer that stores what the group is planning. Every other feature — enriched search, proactive suggestions, trip-aware digests, conversation recall — depends on this foundation being in place first.

The primary risk in this milestone is two-sided: doing too much AI on too many messages (Gemini cost explosion and WhatsApp ban risk from overactive proactive messaging) or doing too little (stateless behavior that forgets what the group decided five minutes ago). Both are solved by the same discipline: debounce + batch Gemini calls (30-second window, pre-filter non-travel messages), persist trip state to SQLite (never memory-only), and enforce hard rate limits on any unsolicited bot message (2-hour per-group cooldown, max 3/day). A correctly-implemented always-listener costs $1–3/month on Gemini 2.5 Flash; an incorrectly implemented one costs $15–40/month.

The stack requires zero new npm packages for the first three phases. Everything needed — Gemini structured output, SQLite persistence, FTS keyword search, WhatsApp reactions — is already installed. The only potential addition is `sqlite-vec` for semantic search, explicitly deferred until keyword search proves insufficient. The build order is dependency-driven: DB schema extensions first, enhanced date extraction second (low-risk validation of the schema extension pattern), trip context manager third (the core), chat history search fourth (independent), and the suggest-then-confirm / proactive trigger last (most complexity, depends on everything else working).

## Key Findings

### Recommended Stack

The existing stack handles all new requirements without modification. `better-sqlite3` v12.6.2 includes FTS5 by default; the existing `@google/genai` SDK supports Maps Grounding and structured output with `responseSchema`; `node-cron` covers any scheduled jobs; Drizzle ORM handles schema migrations and upsert patterns. The critical stack clarification: Zod v4 ships `z.toJSONSchema()` natively — the installed `zod-to-json-schema` library must NOT be used for any new code (it silently breaks with Zod v4). See [STACK.md](./STACK.md) for full decision map and all code samples.

**Core technologies (new decisions):**
- SQLite FTS5 (built-in via `better-sqlite3`): chat history keyword search — no new library; Drizzle does not support FTS5 natively (issue #2046, open since March 2024), so raw `db.prepare()` queries are used
- Gemini Maps Grounding (API feature, no npm): replaces `googleSearch` tool in `travelSearch.ts` with `googleMaps` tool — returns ratings, hours, address, and review counts for 250M+ places
- Gemini `responseSchema` + `z.toJSONSchema()`: structured activity detection and trip context extraction — use Zod v4's native method, not the installed `zod-to-json-schema` library
- Drizzle schema extension: `tripContexts` and `tripDecisions` tables added to existing schema; no new ORM
- WhatsApp reactions + quoted replies: suggest-then-confirm UX — interactive buttons are Business API-only and will cause bans on personal accounts

**Explicitly excluded:**
- `@googlemaps/places` or `@googlemaps/google-maps-services-js`: extra billing, latency, API key — Maps Grounding achieves the same inside the existing Gemini call
- `sqlite-vec` v0.1.7-alpha.2: alpha, stalled maintenance (no commits ~6 months as of mid-2025) — deferred; if semantic search is ever needed, use `gemini-embedding-001` (NOT `text-embedding-004`, deprecated August 2025)
- WhatsApp interactive buttons: Business API only — use numbered text lists and quoted-reply confirmations instead
- Any external vector DB or job queue: overkill for a personal bot running 3–20 groups

### Expected Features

**Must have (table stakes):**
- Passive activity/plan detection from conversation — users expect zero-friction capture without @mentioning the bot for every decision; every modern trip planning tool (Wanderlog, Mindtrip) does this
- Suggest-then-confirm flow — the bot must not silently auto-add everything; the false positive rate for casual mentions is much higher than for explicit dates
- Enriched search results (ratings, hours, review counts) — bare URLs with snippets is weak by 2025 standards; Gemini Maps Grounding is now GA
- Trip memory (structured decisions) — users expect the bot to remember "we're staying at the Isrotel" across multiple conversations
- Trip-aware weekly digest — "Trip Status" section added to existing `generateWeeklyDigest()`: confirmed decisions, open items, what is still unconfirmed

**Should have (differentiators):**
- Trip context injection into search — bot auto-includes known dates, group size, budget in every @mention query at no extra API cost
- Conversation recall ("what did we decide about X?") — history search via `queryType: 'history_search'` in existing travel handler
- Multi-result comparison format — numbered list with rating, price, booking link for accommodation/activity searches
- Booking link enrichment — label booking-ready URLs explicitly vs. info pages using a domain whitelist heuristic

**Defer to v2+:**
- Proactive destination-aware suggestions — valuable but high risk of over-triggering; build after passive detection confidence is validated
- Open question tracking — adds complexity to the already-complex passive detection phase
- Full booking integration, expense splitting, flight price monitoring, per-member preference profiles, rich media — all explicitly excluded anti-features for this milestone

See [FEATURES.md](./FEATURES.md) for the full feature dependency graph and real-world workflow walkthrough.

### Architecture Approach

All new features integrate through the single registered `groupMessageCallback` in `groupMessagePipeline.ts`. Calling `setGroupMessageCallback()` from a new module silently overwrites the first registration and breaks the entire existing pipeline with no error thrown — this is the most dangerous architectural mistake possible in this codebase. The new trip context manager is added as a non-terminal step at position [3.5] (after keyword rules, before reply-to-delete), following the same `async function returning void, errors caught internally` pattern used by `handleKeywordRules()`. Trip state is persisted to SQLite using Drizzle upsert — not in-memory Maps — because planning conversations span hours and bot restarts are real. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full component boundary map, data flow diagrams, and dependency-driven build order.

**Major components:**
1. `src/groups/tripContextManager.ts` (NEW) — 30-second debounce buffer, Gemini classification call on batch, DB upsert to `tripContexts`, decision detection, proactive trigger; inserted at pipeline step [3.5]
2. `src/groups/suggestionTracker.ts` (NEW) — ephemeral `pendingSuggestions` Map with 200-entry size cap and 2-hour TTL; `storeSuggestion()` / `checkAndClearSuggestion()` interface
3. `src/db/schema.ts` + new query files (MODIFY/NEW) — `tripContexts` table (one active row per group, upsert merge strategy), `tripDecisions` table (append-only typed decisions), `searchGroupMessages()` function on existing table
4. `src/groups/travelHandler.ts` (MODIFY) — add `pendingSuggestions.has(quotedMessageId)` check alongside existing `travelResultMessages` check
5. `src/groups/travelParser.ts` (MODIFY) — extend `queryType` enum with `'history_search'`
6. `src/groups/dateExtractor.ts` (MODIFY) — add optional `location`, `description`, `url` fields to Zod schema (backward-compatible, all new fields `.optional()`)

**Unchanged:** `src/groups/travelSearch.ts` (until Phase 3 Maps Grounding swap), `src/groups/keywordHandler.ts`, `src/groups/reminderScheduler.ts`, `src/pipeline/messageHandler.ts`, `src/api/state.ts`

### Critical Pitfalls

1. **Always-listener fires on every message — Gemini cost explosion** — Prevent with a two-tier approach: JavaScript keyword pre-filter eliminates ~70% of messages before Gemini is called (city names, hotel/flight/restaurant keywords, Hebrew travel vocabulary "נסיעה", "טיסה", "מלון"); 30-second debounce batches the rest into one call per window; `thinkingConfig: { thinkingBudget: 0 }` disabled on classifier calls. Without this, costs reach $15–40/month; with it, $1–3/month.

2. **Proactive messages trigger WhatsApp spam detection and account ban** — The bot must not send multiple unsolicited text messages in quick succession. Enforce: emoji-reaction signal before any full text message; 2-hour per-group cooldown; max 3 unsolicited messages/day/group; confidence threshold above 90% before sending; 3–8 second randomized delay. A single run of rapid-fire bot messages is enough for a temporary ban on a personal account.

3. **Single-slot pipeline callback silently overwritten** — Never call `setGroupMessageCallback()` from a new module. All new pipeline steps must be added inside the existing callback in `groupMessagePipeline.ts`. This is the architectural invariant that protects all existing functionality.

4. **Trip memory context rot degrades AI quality** — As context grows beyond ~50,000 tokens, LLM recall accuracy drops measurably (Chroma Research 2025 — empirical). After each planning session (2+ hour gap in group activity), generate and store a 200-word trip summary using Gemini. Pass the summary to Gemini in subsequent calls, not the raw message history. Hard-cap context at 50,000 tokens per call.

5. **Google Calendar service account ownership cannot be transferred** — The auth architecture (user-delegated OAuth vs. service account with bot-only edits) must be chosen before the first `calendar.events.insert` call. Switching later requires recreating all calendars under the new owner. Always specify explicit IANA timezone (`Asia/Jerusalem` or destination timezone) on every Calendar event — bare `dateTime` without UTC offset causes wrong-time events with no API error.

## Implications for Roadmap

Based on combined research, a 5-phase build order driven by technical dependencies:

### Phase 1: DB Foundation + Enhanced Date Extraction
**Rationale:** Every subsequent feature reads from or writes to the new DB tables. Migrations must run and be verified before any application logic is added. Enhanced date extraction is isolated to one file and validates the Zod schema extension pattern (`.optional()` fields on existing schema) at low risk before the same pattern is applied to the more complex trip context schema.
**Delivers:** `tripContexts` and `tripDecisions` Drizzle table definitions, Drizzle migration, `tripContexts.ts` and `tripDecisions.ts` query files, `searchGroupMessages()` added to `groupMessages.ts`, calendar events extended with optional `location`/`description`/`url` fields from enriched date extraction, `calendarService.ts` updated with optional `location` parameter
**Addresses:** Trip memory foundation (prerequisite for all differentiating features), calendar event quality (visible immediate improvement)
**Avoids:** Retrofitting migrations onto a running system with existing data; breaking the existing `DateExtractionSchema` contract by changing field types instead of adding optional fields
**Research flag:** SKIP — standard Drizzle migration and Zod schema extension patterns, well-documented in existing codebase

### Phase 2: Trip Context Manager (Core Intelligence)
**Rationale:** The always-listening accumulator is the central new component. Proactive suggestions, trip-aware search context injection, and the trip-aware digest all depend on it. Must be built and verified in isolation — accumulation + storage only, no proactive send path yet — before the higher-risk outbound messaging is enabled. This is the phase where the cost architecture is established.
**Delivers:** `src/groups/tripContextManager.ts`, 30-second debounce pipeline step at position [3.5] in `groupMessagePipeline.ts`, Gemini batch classification with `TripContextUpdateSchema`, `tripContexts` DB upsert on travel signals, `tripDecisions` DB insert on high-confidence commitment detection, Gemini billing enabled, 429 error handler, `fromMe` guard verified in pipeline
**Addresses:** Passive activity/plan detection (table stakes), trip memory accumulation (foundation for all differentiators)
**Avoids:** Gemini cost explosion (two-tier pre-filter + debounce + `thinkingBudget: 0` on classifier), self-message reflection loop (`fromMe` check as first pipeline guard), pipeline concurrency and SQLite busy errors (single callback, not a second `messages.upsert` listener), free-tier 429 exhaustion (billing enabled, circuit breaker added)
**Research flag:** NEEDS RESEARCH — Gemini classifier prompt tuning for mixed Hebrew/English group chat; pre-filter keyword vocabulary list for Hebrew travel signals; confidence threshold calibration before enabling any outbound messaging

### Phase 3: Enriched Search + Trip Context Injection
**Rationale:** Self-contained improvement to the existing travel search flow. Depends on `tripDecisions` table (Phase 1) being queryable for context injection. No new pipeline steps — pure modifications of existing `travelSearch.ts`, `travelFormatter.ts`, and `parseTravelIntent()`.
**Delivers:** Gemini Maps Grounding integration in `travelSearch.ts` (ratings, hours, address alongside existing URL/snippet, with `googleSearch` fallback path), trip dates/destination/budget auto-injected into every @mention query from `tripDecisions`, 5 results for accommodation/activity searches vs. 3 for quick queries, booking link labeling in `travelFormatter.ts`, price disclaimer in all search result responses
**Addresses:** Enriched search results (table stakes), trip context injection into search (differentiator), multi-result comparison format, booking link enrichment
**Avoids:** Stale prices presented as facts (always include "prices change frequently — verify before booking" disclaimer; present price ranges not exact figures; never store grounded prices as confirmed budget data)
**Research flag:** SKIP — Maps Grounding is GA with official docs; context injection is a prompt string change; booking link labeling is a URL domain heuristic

### Phase 4: Chat History Search
**Rationale:** Fully independent of trip context accumulation. Builds on `searchGroupMessages()` from Phase 1. Confined to the existing travel @mention flow with no new pipeline steps — a single new dispatch case in `travelHandler.ts`. Can be developed in parallel with Phase 3.
**Delivers:** `queryType: 'history_search'` in `travelParser.ts`, LIKE-based `searchGroupMessages()` query using existing `idx_group_messages_group_ts` index, chronological formatted output in `travelFormatter.ts`, intent disambiguation (recall question vs. live travel search)
**Addresses:** Conversation recall — "what did we decide about X?", "what hotel are we staying at?" (differentiator)
**Avoids:** Ambiguity between recall queries and live travel searches — the `queryType` classification in `travelParser.ts` handles the disambiguation before any search is executed
**Research flag:** SKIP — LIKE query on an indexed existing table; well-understood pattern; FTS5 upgrade deferred until proven slow at real group message volumes

### Phase 5: Suggest-Then-Confirm + Proactive Trigger
**Rationale:** Most complex phase. Depends on trip context (Phase 2) working and validated with real group data — the proactive trigger needs accumulated context with calibrated confidence levels before it can fire responsibly. Introduces cross-message state (pending confirmations) and the unsolicited send path, which carries the highest ban risk of any feature in this milestone.
**Delivers:** `src/groups/suggestionTracker.ts` with `pendingSuggestions` Map (200-entry cap, 2-hour TTL), quoted-reply confirmation routing added to `travelHandler.ts`, proactive trigger at end of context flush in `tripContextManager.ts` (2-hour cooldown, max 3/day cap, 90% confidence threshold), `group_confirmations` table for persistent pending confirmation state (survives restarts), human-like 3–8 second randomized send delay
**Addresses:** Suggest-then-confirm flow (table stakes), proactive destination-aware suggestions (differentiator — only enabled after Phase 2 confidence calibration is validated)
**Avoids:** Multi-user confirmation ambiguity (quoted-message scoping — only a reply that quotes the specific bot message counts; single pending confirmation per group; 30-minute timeout), WhatsApp ban risk (emoji-reaction signal first; 90% confidence threshold before any text message; per-group cooldown enforced), stale in-memory state after restart (pending confirmations persisted in `group_confirmations` table, not just in Map)
**Research flag:** NEEDS RESEARCH — confirmation state machine design for group chat semantics (who can confirm: any member vs. group admin only; what to do with simultaneous ✅ and ❌ replies; timeout handling); rate limit threshold tuning based on Phase 2 real-group confidence data

### Phase Ordering Rationale

- **DB schema first:** No phase can function without the persistence layer. Drizzle migrations are idempotent and safe to run as the first change on a live system.
- **Date extraction second:** Isolated, backward-compatible Zod schema extension. Validates the `.optional()` field addition pattern at minimal risk and ships visible calendar quality improvement independently before the more complex trip context schema is written.
- **Trip context manager third (not fifth):** It is the dependency of proactive suggestions — not a follow-on. Building it without the outbound send path first allows it to be validated with real group data and calibrate confidence thresholds before the higher-risk messaging is enabled.
- **Chat history search fourth:** Fully independent of trip context. Can be developed during Phase 2–3 execution with no coordination, then merged when ready.
- **Suggest-then-confirm last:** Has the most moving parts and the highest ban risk if misconfigured. Building it last means it has real trip context to work with, the classifier confidence has been calibrated on real data, and the team has confirmed the pipeline is stable before enabling unsolicited outbound messages.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (Trip Context Manager):** Gemini classifier prompt engineering for travel signal detection in mixed Hebrew/English casual group chat. The pre-filter keyword list needs to cover Hebrew travel vocabulary. The critical design question: what signal combinations distinguish "we're actually planning Rome" from "someone mentioned Rome in a nostalgic story"? Confidence calibration requires testing against a sample of real group messages before wiring to the pipeline.
- **Phase 5 (Suggest-Then-Confirm):** Confirmation state machine design for group semantics. The existing draft system is 1:1 private-chat scoped. Group semantics — who can confirm, what happens with simultaneous replies within seconds of each other, whether to require group admin confirmation — need explicit design decisions before any confirmation-resolution code is written.

Phases with standard patterns (skip research-phase):
- **Phase 1 (DB Foundation):** Drizzle migration pattern is identical to existing schema additions already in the codebase. Zod schema extension with `.optional()` fields is documented. No unknowns.
- **Phase 3 (Enriched Search):** Maps Grounding is GA with official docs and a documented `tools` config change. Trip context injection is a prompt string change in `parseTravelIntent()`. Booking link labeling is a URL domain whitelist heuristic.
- **Phase 4 (Chat History Search):** SQLite LIKE query on an indexed table. Existing `travelHandler.ts` dispatch pattern extended with one new `queryType` case. Straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All decisions verified via official docs, GitHub issues, and release notes. Zero new packages confirmed for Phases 1–4. The only uncertain item (`sqlite-vec`) is explicitly deferred. The `zod-to-json-schema` breakage with Zod v4 is confirmed via multiple sources. |
| Features | HIGH for table stakes, MEDIUM for differentiators | Table stakes verified against Wanderlog, TripIt, Layla.ai, and the Gemini Maps Grounding GA announcement. Differentiator complexity estimates are based on direct codebase inspection of all integration points, not measured implementation time. |
| Architecture | HIGH | All integration patterns derived from direct inspection of actual source files — `groupMessagePipeline.ts`, `messageHandler.ts`, `travelHandler.ts`, `travelParser.ts`, `dateExtractor.ts`, `schema.ts`, `calendarService.ts`, `state.ts`. No assumptions about existing code structure. |
| Pitfalls | HIGH for critical pitfalls, MEDIUM for minor | Gemini pricing, rate limits, ban risk from proactive messaging, context rot, and Calendar service account limitation all verified via official documentation. Cost estimates are modeled projections using verified pricing figures. False positive rates for casual mention detection are not empirically measured — inferred from classifier domain difficulty. |

**Overall confidence:** HIGH

### Gaps to Address

- **Gemini classifier prompt quality for Hebrew/English group chat:** The research establishes that a pre-filter + 30-second debounce is required and identifies the Hebrew keyword vocabulary needed. The specific prompt wording for mixed-language travel signal detection has not been validated against real group messages. During Phase 2 planning, draft and test the classifier prompt on a sample of representative group message batches before wiring to the pipeline. Pay particular attention to Hebrew-dominant messages and casual mentions of past travel.

- **Gemini Maps Grounding reliability:** Maps Grounding is newly GA (Oct 2025); real-world reliability vs. the established `googleSearch` grounding is less documented. Design a `googleSearch` fallback path in `travelSearch.ts` from the start of Phase 3 — if Maps Grounding returns empty or malformed structured data, fall back automatically without user-visible error.

- **Confirmation authority in groups:** PITFALLS.md recommends scoping confirm/deny to quoted-message replies, but does not resolve whether only the group admin or any group member can trigger a bot action through confirmation. This needs an explicit design decision during Phase 5 planning. Defaulting to "any member can confirm" is simpler but may lead to accidental confirmations; "admin only" is safer but may feel restrictive in a collaborative planning context.

- **Trip archival and data retention:** PITFALLS.md recommends a 90-day `group_messages` retention policy and trip archival when a trip's end date passes. The implementation approach (startup cleanup job, cron job, or lazy cleanup on access) is not specified. Address during Phase 2 planning as part of the trip memory data lifecycle design.

- **`tripContexts` vs. `tripDecisions` table boundary:** ARCHITECTURE.md defines `tripContexts` as the accumulated working state (one row per group, upsert) and `tripDecisions` as confirmed decisions (append-only). FEATURES.md uses slightly different field names for similar concepts. Before Phase 1 migration is written, reconcile the two schemas into a single canonical definition to avoid a migration delta later.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all relevant source files — pipeline structure, callback registration, state patterns, Zod schemas, DB query patterns, existing handler logic (every file referenced in ARCHITECTURE.md)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html) — FTS5 built-in to `better-sqlite3` confirmed
- [Drizzle ORM FTS5 issue #2046](https://github.com/drizzle-team/drizzle-orm/issues/2046) — no native FTS5 support confirmed, open since March 2024
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — $0.30/M input, $2.50/M output, $3.50/M thinking tokens for Gemini 2.5 Flash
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) — 10 RPM, 250 RPD free tier; December 2025 reductions confirmed
- [Gemini API Context Caching](https://ai.google.dev/gemini-api/docs/caching) — 90% discount on cached prefix tokens, implicit caching enabled since May 2025
- [Gemini Maps Grounding GA announcement](https://developers.googleblog.com/en/your-ai-is-now-a-local-expert-grounding-with-google-maps-is-now-ga/) — confirmed GA Oct 2025, ratings/reviews/hours/addresses/photos available
- [Gemini API Maps Grounding docs](https://ai.google.dev/gemini-api/docs/maps-grounding) — `googleMaps` tool config, `retrievalConfig` with lat/lng bias, `google_maps_widget_context_token`
- [Gemini structured output docs](https://ai.google.dev/gemini-api/docs/structured-output) — `responseSchema` pattern confirmed on all Gemini 2.5 models
- [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings) — `gemini-embedding-001` GA; `text-embedding-004` deprecated August 2025
- [Zod v4 + Gemini structured output — `z.toJSONSchema()`](https://www.buildwithmatija.com/blog/zod-v4-gemini-fix-structured-output-z-tojsonschema) — `zod-to-json-schema` v3.25.x silently broken with Zod v4 confirmed
- [Google Calendar API concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) — service account data ownership limitation: "data owner's access level cannot be downgraded"
- [Google Calendar API create events](https://developers.google.com/workspace/calendar/api/guides/create-events) — timezone specification for timed events
- [SQLite WAL mode docs](https://sqlite.org/wal.html) — single writer limitation confirmed
- [WhatsApp anti-spam 2025](https://about.fb.com/news/2025/08/new-whatsapp-tools-tips-beat-messaging-scams/) — 6.8M accounts banned H1 2025; pattern-based detection
- [Baileys ban reports — GitHub #1869, #1925](https://github.com/WhiskeySockets/Baileys/issues/1869) — ban patterns documented by community
- [Baileys reactions — GitHub #1029](https://github.com/WhiskeySockets/Baileys/issues/1029) — `react` payload API confirmed
- [WhatsApp Business API buttons — WATI docs](https://www.wati.io/en/blog/whatsapp-business-interactive-message-templates/) — interactive buttons require Business API, not available on personal accounts
- [Context rot — Chroma Research 2025](https://research.trychroma.com/context-rot) — empirical evidence of LLM recall degradation as context grows
- [Effective context engineering — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — context management best practices for AI agents

### Secondary (MEDIUM confidence)
- [Mem0 LLM chat history summarization guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) — 80–90% token reduction, 26% quality improvement with summarize-and-compress vs. raw history
- [Active context compression — arxiv.org](https://arxiv.org/html/2601.07190) — 22.7% token savings with frequent small compressions
- [Wanderlog vs TripIt comparison](https://www.wandrly.app/comparisons/wanderlog-vs-tripit) — group travel feature priorities and expectations
- [Layla.ai about](https://layla.ai/about) — conversational trip planning UX patterns
- [Agentic AI in travel planning 2025](https://www.pymnts.com/news/artificial-intelligence/2025/agentic-ai-takes-the-wheel-in-travel-planning-and-booking/) — proactive AI travel agent patterns
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) — alpha status, maintenance concern (no commits ~6 months)
- [Gemini API Rate Limits 2026 — LaoZhang](https://blog.laozhang.ai/en/posts/gemini-api-rate-limits-guide) — December 2025 quota reduction details
- [SQLite concurrent writes](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — `SQLITE_BUSY` behavior under concurrent writers
- [GDPR chatbot compliance — moinAI](https://www.moin.ai/en/chatbot-wiki/chatbots-data-protection-gdpr) — data retention and PII minimization requirements

### Tertiary (LOW confidence — inferred or single source)
- Specific false-positive rates for casual travel mention detection: not measured; inferred from classifier domain difficulty and mixed-language group chat experience
- Real-world reliability delta between Gemini Maps Grounding and established `googleSearch` grounding: insufficient production data as of March 2026 given recent GA date

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*

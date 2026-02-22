# Project Research Summary

**Project:** WhatsApp AI Impersonation Bot
**Domain:** WhatsApp AI Bot / Chat Impersonation (Personal Use)
**Researched:** 2026-02-22
**Confidence:** MEDIUM

## Executive Summary

This project is a personal AI bot that impersonates the user in WhatsApp conversations — generating replies in the user's voice, managing them through a draft approval flow or autonomous send, and surfacing everything through a web dashboard. Experts build this class of tool as a single Node.js process combining the WhatsApp Web client layer, an AI inference layer, and a co-located API server, all backed by a single SQLite file. Baileys (`@whiskeysockets/baileys`) is the clear library choice over `whatsapp-web.js` for a headless home server: it eliminates the Puppeteer/Chromium dependency, reducing RAM from 300-600 MB to ~50 MB. The Gemini SDK to use is the new `@google/genai` package (v1.42.0), not the deprecated `@google/generative-ai` which reached end-of-life in August 2025.

The recommended approach is a phased build that prioritizes correctness and safety over features. Start with a rock-solid WhatsApp connection layer that includes session persistence, health monitoring, QR-over-web re-auth, message deduplication, and human-like send delays — all of which must exist from day one, not be retrofitted. Then layer in the Gemini AI engine with strict per-contact context isolation. Only after draft-approval mode has validated reply quality should autonomous sending be enabled. Style learning from exported chat history is a Phase 2 enhancement that significantly improves impersonation quality with minimal engineering overhead (few-shot prompting, no fine-tuning).

The dominant risk is WhatsApp account ban. Meta has automated detection for unofficial API usage and bot-like patterns, and a permanent ban ends the project. This risk is addressable: the bot operates on inbound messages from a whitelist only (no bulk outreach), uses randomized reply delays, and starts in draft-approval mode. The second major risk is privacy: third-party conversation messages are sent to the Gemini API without contact consent. Data minimization must be designed into the prompt assembly layer from the start. A secondary SIM/number dedicated to the bot — not the user's primary personal number — is mandatory.

---

## Key Findings

### Recommended Stack

The stack is conventional Node.js server-side TypeScript with a React SPA dashboard. The critical choices are Baileys over whatsapp-web.js (WebSocket-native, no Chromium, 50 MB RAM), Fastify over Express (first-class TypeScript, 3-4x faster), and Drizzle + SQLite over PostgreSQL (zero operational overhead for single-server personal use). PM2 manages the process with automatic systemd integration for boot persistence. The project must run as an ESM module since Baileys v7 is ESM-only.

**Core technologies:**
- `@whiskeysockets/baileys` v7.0.0-rc.9: WhatsApp Web connection — pure WebSocket, no Puppeteer, native multi-device support, only actively maintained fork
- `@google/genai` v1.42.0: Gemini AI inference — official GA SDK (old `@google/generative-ai` is EOL August 2025, must not be used)
- `Fastify` v5.x: API server — faster than Express, first-class TypeScript, serves dashboard static build
- `React + Vite` v19/v6: Dashboard UI — largest ecosystem for admin UIs, shadcn/ui components on Tailwind
- `Drizzle ORM + better-sqlite3`: Storage — TypeScript-native schema, no daemon, zero network overhead
- `PM2` v5.x: Process management — `pm2 startup` generates systemd unit, `pm2 save` persists across reboots
- `ws` / Socket.io: Dashboard real-time updates — server pushes draft and status events to the UI
- `zod` + `pino`: Validation and structured logging — essential for debugging WhatsApp event handling

**Version constraint:** Node.js 20 LTS via nvm (not apt — Ubuntu 24.04 apt ships an older version). Baileys v7 requires ESM module type in package.json.

### Expected Features

The MVP must prove the core loop: incoming message → AI-generated reply in user's style → draft queued or sent → user can audit. Every feature that breaks this loop is a gap; everything else is enhancement.

**Must have (table stakes):**
- WhatsApp connection via Baileys with QR auth and persistent session across restarts
- Per-contact whitelist — bot replies only to explicitly configured contacts
- Draft/approval mode — AI generates reply, human approves before send
- Gemini API integration with persona system prompt
- Last 20-100 messages passed as conversation context on each reply
- Web dashboard: contact management, pending drafts with approve/reject, activity log
- Global on/off toggle — immediate kill switch
- Graceful reconnect with exponential backoff
- Message deduplication (by WA message ID) — mandatory before any send logic

**Should have (differentiators):**
- Auto-reply mode (enable per-contact after draft mode validates quality) with randomized send delay
- Owner notification when auto-reply fires
- Per-contact relationship context ("this is my mom") injected into system prompt
- Chat history ingestion from WhatsApp .txt export for few-shot style learning
- QR code served through web dashboard for remote re-auth over Tailscale
- Snooze/pause per contact for when user is actively in a conversation
- System prompt editor in dashboard UI

**Defer (v2+):**
- Confidence scoring / uncertainty flag — route low-confidence replies to draft mode even in auto mode
- Conversation digest — weekly summary of bot activity
- Multi-account support — architectural complexity not justified for personal use
- Voice message generation — out of scope for text impersonation

**Anti-features (never build):**
- Bulk/broadcast messaging — #1 ban trigger
- Group chat auto-reply — socially dangerous, spam reports, default-off
- Contact scraping / auto-discovery — ban trigger
- Fine-tuning LLM on chat data — GPU, weeks of work; few-shot prompting delivers 80% of the quality

### Architecture Approach

The system runs as a single PM2-managed Node.js process with clear module boundaries: WhatsApp client layer, message router, AI service, draft queue, SQLite DB, and a co-located Fastify API server with Socket.io for dashboard real-time updates. The React dashboard SPA is served as static files from the same Fastify server. This is deliberately a monolith-by-module, not microservices — inter-process communication and external queue overhead are unjustified for a single-account personal bot.

**Major components:**
1. **WhatsApp Client** (`src/whatsapp/`) — Baileys connection, QR auth, session persistence, reconnect logic
2. **Message Router** (`src/router/`) — allowlist gate, auto vs. draft mode dispatch, message deduplication
3. **AI Service** (`src/ai/`) — Gemini multi-turn chat sessions via `startChat()`, prompt builder, persona loader
4. **Draft Queue** (`src/db/drafts.ts`) — SQLite-backed lifecycle: `pending → approved → sent | rejected`
5. **SQLite DB** (`src/db/`) — all persistence: messages, contacts, drafts, config; Drizzle schema + migrations
6. **API Server** (`src/api/`) — Fastify REST endpoints + Socket.io; serves dashboard static build
7. **Web Dashboard** (`dashboard/`) — React SPA; real-time updates via Socket.io, React Query for data fetching

**Key patterns to follow:**
- Event-driven pipeline: `receive → allowlist gate → persist → AI generate → draft queue → send/hold`
- Gemini `startChat()` with `history` array (not raw string injection) for multi-turn conversations
- Prompt structure: static content (system prompt + style examples) first for context cache hit rate; dynamic (recent messages) last
- Per-contact context strictly scoped by JID — never share in-flight state between contacts
- Single config table in SQLite drives per-contact behavior (mode, style instructions, enabled flag)

**Database schema (5 tables):** `contacts`, `messages`, `drafts`, `sessions`, `config`

### Critical Pitfalls

1. **WhatsApp account permanent ban** — Use a dedicated secondary number. Implement randomized send delays (15s–3min), per-contact rate limits, message deduplication, and group JID filtering from day one. Start in draft mode; never auto-send before validating reply patterns feel human.

2. **Unofficial library silent break after Meta protocol update** — Pin library versions. Implement a heartbeat health-check that alerts when no messages are processed during expected active hours. Design the WhatsApp client behind an abstraction layer to enable library swaps without touching the rest of the codebase.

3. **Session loss requiring manual QR scan on headless server** — Serve the QR code through the web dashboard so re-auth can be done remotely over Tailscale. Alert immediately on `loggedOut` disconnect events. Never run the process as root.

4. **Cross-contact context contamination** — Every conversation's history and state must be strictly scoped by JID. No global/module-level state for conversations. Validate with integration tests that simulate simultaneous messages from different contacts and assert no cross-contamination.

5. **AI reveals bot, makes commitments, or damages relationships** — Start all contacts in draft-approval mode. Add hard constraints to system prompt: no commitments, no specific facts about the user's life, no first-person factual claims. Cap reply length. Add a hardcoded (not LLM-generated) response to "are you a bot?" questions.

6. **Sending third-party messages to Gemini without consent (privacy/GDPR)** — Minimize what reaches the API: anonymize contact names, strip phone numbers. Use Gemini Tier 1 paid access with data-not-used-for-training terms. Restrict history window to last N messages rather than full history.

---

## Implications for Roadmap

Based on research, the dependency graph and pitfall-to-phase mapping imply a 5-phase structure.

### Phase 1: WhatsApp Foundation

**Rationale:** Everything depends on a reliable, authenticated WhatsApp connection. The ban-risk mitigations (delay simulation, deduplication, rate limiting, JID filtering) must be built here — retrofitting them later risks real account harm. This is also the riskiest unknown: validate that Baileys v7 ESM works correctly on yuval-server before building on top of it.

**Delivers:** Authenticated Baileys connection with persistent session, QR-over-dashboard re-auth path, message deduplication, send delay simulation, group JID filtering, heartbeat health monitoring, graceful reconnect with exponential backoff, and PM2 process management.

**Addresses features:** WhatsApp Web connection, reliable session persistence, graceful reconnect, global on/off toggle (stub), message deduplication.

**Avoids pitfalls:** Pitfall 1 (ban), Pitfall 2 (silent library break), Pitfall 3 (QR re-auth on headless server).

**Research flag:** Needs validation — Baileys v7.0.0-rc.9 is release candidate; test ESM module init, session persistence, and reconnect behavior on Ubuntu 24.04 early.

### Phase 2: AI Response Engine

**Rationale:** With WhatsApp layer stable, layer in Gemini integration. Context isolation (per-contact scoping) must be established here before any LLM calls. Draft-approval mode is the only send mode initially — no autonomous sends until Phase 3 validates quality. Privacy/data minimization built into this layer from the start.

**Delivers:** Gemini `startChat()` multi-turn per contact, prompt builder (system persona + style instructions + history window), per-contact JID-scoped context isolation, draft queue (pending/approved/rejected lifecycle), draft-approval mode only, anonymized context sent to Gemini, Tier 1 API access configuration.

**Addresses features:** Gemini integration, conversation context window, draft/approval mode, per-contact mode toggle (draft-only initially), per-contact relationship context.

**Avoids pitfalls:** Pitfall 4 (cross-contact contamination), Pitfall 5 (wrong tone/hallucinations — via constraints in system prompt), Pitfall 6 (privacy — via data minimization), Mistake 1 (prompt injection).

**Research flag:** Standard patterns — Gemini `startChat()` is well-documented via official Google docs (HIGH confidence source).

### Phase 3: Style Learning and Auto Mode

**Rationale:** After draft mode has run for days/weeks and validated that reply quality is acceptable, enable auto-mode and add the style-learning enhancement that dramatically improves impersonation accuracy. Chat history ingestion from `.txt` exports is a discrete feature that can be developed and validated independently.

**Delivers:** WhatsApp `.txt` export parser, few-shot style examples injected as static system prompt block (distinct from dynamic conversation context), per-contact auto-reply mode with randomized delay, owner notification on auto-send, snooze/pause per contact, history summarization for long-running conversations (sliding window + periodic summary).

**Addresses features:** Chat history ingestion for style learning, auto-reply mode, response delay simulation, notification to owner, snooze per contact.

**Avoids pitfalls:** Pitfall 1 (ban — randomized delays), Pitfall 5 (tone drift — few-shot examples anchor style), Performance Trap 2 (growing LLM context cost — sliding window + summarization).

**Research flag:** Minimal — WhatsApp `.txt` export format is well-documented. Sliding window pattern is standard.

### Phase 4: Web Dashboard

**Rationale:** Dashboard is built last because it has no unique backend dependencies — it only consumes APIs that Phase 2 already defines. A minimal API was available in Phase 1-2 for QR display and basic status; this phase completes the full management UI. Draft approval and contact management are the highest-value dashboard features.

**Delivers:** React SPA with Vite, contact management (add/remove/configure), per-contact mode toggle, pending drafts list with approve/edit/reject actions, system prompt editor, activity log/message history view, real-time updates via Socket.io, Tailscale-accessible over LAN, JWT session auth.

**Addresses features:** Basic web dashboard, draft review UI, activity log, system prompt editor in UI, per-contact management.

**Avoids pitfalls:** Pitfall 3 (QR-over-web re-auth UI), Mistake 2 (dashboard auth — bind to localhost, JWT auth, Tailscale access only).

**Research flag:** Standard patterns — React + Vite + shadcn/ui is well-documented. React Query for server state is established.

### Phase 5: Production Hardening

**Rationale:** The system is functionally complete after Phase 4. This phase hardens it for 24/7 unattended operation: alerting on silent failures, context cache optimization to reduce Gemini costs, storage encryption, secrets management, and draft timeout handling.

**Delivers:** Alerting pipeline (notification when no messages processed during active hours), Gemini context caching configuration (static prompt content above 2,048 token minimum for cache eligibility), SQLite filesystem permissions (mode 600), draft expiry/timeout handling, PM2 log rotation, API key rotation procedure, deployment runbook.

**Addresses features:** Production monitoring, cost optimization, security hardening.

**Avoids pitfalls:** Pitfall 2 (silent library break — alerting), Mistake 3 (unencrypted storage), Mistake 4 (API key exposure), "Looks Done But Isn't" checklist items.

**Research flag:** Standard patterns — PM2, systemd, SQLite permissions are well-documented.

### Phase Ordering Rationale

- **Phases 1 before 2:** WhatsApp layer must be validated before AI can be tested end-to-end. Ban-risk mitigations in Phase 1 cannot be retrofitted.
- **Draft mode before auto mode:** Safety requirement. Auto-send with an unvalidated persona creates irreversible social damage. Draft mode is the quality gate.
- **Style learning (Phase 3) after core AI (Phase 2):** Few-shot style examples are an enhancement to an already-working prompt pipeline, not a foundation. Build and validate the foundation first.
- **Dashboard (Phase 4) after AI engine (Phase 2):** Dashboard is purely API consumption. APIs are more stable after Phase 2 defines the data model.
- **Hardening last:** Cannot harden what doesn't exist. Phase 5 addresses operational concerns on a complete system.

### Research Flags

**Phases needing closer attention during planning:**

- **Phase 1:** Baileys v7.0.0-rc.9 is a release candidate. Test ESM init, `useMultiFileAuthState` on disk, and reconnect on actual Ubuntu 24.04 hardware before locking the phase plan. Verify the Baileys wiki migration guide for v7 breaking changes (JID restructuring, auth state format changes).
- **Phase 2:** Gemini free tier rate limits (5-15 RPM) will be exceeded quickly during development. Budget for Tier 1 paid access from Phase 2 kickoff. Verify current context caching terms — 2,048 token minimum and implicit caching for Gemini 2.5 Flash may change.

**Phases with standard patterns (research not needed):**

- **Phase 3:** WhatsApp export parsing (.txt format), sliding window context, few-shot prompting — all well-documented.
- **Phase 4:** React + Vite + shadcn/ui + React Query — established ecosystem with extensive documentation.
- **Phase 5:** PM2 config, SQLite permissions, alerting patterns — operational, not novel.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | AI layer (Gemini SDK) is HIGH — official Google docs. WhatsApp layer (Baileys v7) is MEDIUM — RC version, community-maintained, fast-moving. Backend/storage are HIGH — Fastify, Drizzle, SQLite are mature. |
| Features | MEDIUM | Table stakes and MVP scope are well-established from comparable open-source projects. Personal-use impersonation is a niche — no commercial equivalents to benchmark against. Draft-first approach is the right conservative call. |
| Architecture | MEDIUM | Core patterns (event-driven pipeline, co-located single process, SQLite, Socket.io) are well-established. Specific component boundaries are design decisions with no single canonical answer. Gemini `startChat()` pattern is HIGH — official docs. |
| Pitfalls | MEDIUM | Ban risk, session loss, and silent library breaks are verified across multiple community sources. Privacy/GDPR analysis is HIGH — EDPB official guidance. Cross-contact contamination risk is inferred from architectural analysis. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Baileys v7 stability:** Library is at RC9. Core behavior (session, reconnect, message events) should be validated on actual hardware in Phase 1 before planning deeper phases. No single authoritative "production-ready" case study for Baileys v7 found.
- **Gemini rate limits and caching terms:** These change frequently. Verify current free vs. paid tier limits at Phase 2 kickoff. Context caching minimum token requirement (2,048) and implicit caching behavior should be tested empirically, not assumed from docs.
- **Send delay tuning:** Research identifies 15s-3min as a reasonable range, but the optimal distribution (uniform, exponential, based on message length) for minimizing ban risk is not well-documented. Start conservative (longer delays), tune empirically based on no-ban operation.
- **Draft timeout UX:** Research flags that drafts with no timeout leave contacts waiting. The right timeout (1 hour? 4 hours? contact-specific?) is a UX judgment call that needs definition in Phase 2 planning.

---

## Sources

### Primary (HIGH confidence)
- [GitHub: WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) — Baileys v7 API, ESM migration, auth state
- [Baileys Documentation](https://baileys.wiki/docs/intro/) — official wiki (v7, in progress)
- [npm: @google/genai v1.42.0](https://www.npmjs.com/package/@google/genai) — official Gemini SDK
- [Gemini API Rate Limits — Google AI for Developers](https://ai.google.dev/gemini-api/docs/rate-limits) — current rate limits (official)
- [Gemini API Pricing — Google AI for Developers](https://ai.google.dev/gemini-api/docs/pricing) — model pricing
- [Gemini Context Caching — Google AI for Developers](https://ai.google.dev/gemini-api/docs/caching) — caching requirements
- [Gemini Chat History Management — Firebase Docs](https://firebase.google.com/docs/ai-logic/chat) — `startChat()` / history array pattern
- [PM2 Quick Start](https://pm2.keymetrics.io/docs/usage/quick-start/) — process management
- [EDPB AI Privacy Risks and Mitigations (April 2025)](https://www.edpb.europa.eu/system/files/2025-04/ai-privacy-risks-and-mitigations-in-llms.pdf) — GDPR/privacy analysis
- [OWASP Prompt Injection](https://owasp.org/www-community/attacks/PromptInjection) — security baseline

### Secondary (MEDIUM confidence)
- [WhatsApp unofficial API risk analysis — bot.space](https://www.bot.space/blog/whatsapp-api-vs-unofficial-tools-a-complete-risk-reward-analysis-for-2025) — ban risk documentation
- [Meta 2026 AI chatbot policy — respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) — policy scope clarification
- [BrightCoding: Building with Baileys 2025](https://www.blog.brightcoding.dev/2025/08/28/building-whatsapp-bots-integrations-with-baileys/) — practical integration guide
- [Node.js ORM comparison 2025 — thedataguy.pro](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/) — Drizzle vs Prisma
- [Express vs Fastify 2025 — codetodeploy](https://medium.com/codetodeploy/express-or-fastify-in-2025-whats-the-right-node-js-framework-for-you-6ea247141a86) — framework comparison
- [Gemini Context Window Strategies — datastudios.org](https://www.datastudios.org/post/google-gemini-context-window-token-limits-model-comparison-and-workflow-strategies-for-late-2025) — token limits (verify at build time)
- [LLM Chat History Summarization — mem0.ai (Oct 2025)](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) — summarization patterns
- [whatsapp-web.js memory leak issue #5817](https://github.com/pedroslopez/whatsapp-web.js/issues/5817) — Puppeteer memory issues
- [Top WhatsApp ban reasons 2025 — whautomate.com](https://whautomate.com/top-reasons-why-whatsapp-accounts-get-banned-in-2025-and-how-to-avoid-them/) — ban triggers

### Tertiary (LOW confidence / validate at build time)
- Community reports on Baileys v7 RC stability — not yet confirmed production-ready
- Send delay optimal distribution — no authoritative source found; start conservative
- [Personalized chatbot from WhatsApp history — GitHub](https://github.com/RheagalFire/personalized_chat_bot) — style learning reference implementation (validate approach)

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*

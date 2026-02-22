# Feature Research

**Domain:** WhatsApp AI Impersonation Bot (Personal Use)
**Researched:** 2026-02-22
**Confidence:** MEDIUM — Table stakes and differentiators drawn from ecosystem research and comparable open-source projects. Personal-use impersonation bot is a niche not well-documented in commercial platforms (which focus on business/customer-service use cases). Core patterns are well-established.

---

## Feature Landscape

### Table Stakes

Features that users of this bot will expect from day one. Missing any of these makes the bot feel broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **WhatsApp Web connection** | The bot cannot function without stable, authenticated connection | Medium | Baileys (WhiskeySockets fork) is the current maintained library for personal account WS connection. Session persists via stored auth state. QR code auth is the entry point. |
| **Reliable session persistence** | Bot runs 24/7 — auth cannot expire silently | Medium | Multi-file auth state saves session to disk. Must survive server restarts. Without this, the bot disconnects undetected. |
| **Per-contact opt-in whitelist** | Bot must only auto-reply to selected contacts, not everyone | Low | Boolean flag per contact. Without this, bot replies to all incoming messages including group chats, strangers, spam. |
| **Auto-reply mode (fully autonomous)** | Core value prop: bot replies without user intervention | High | LLM generates response, sends immediately. Requires well-tuned prompt + context. |
| **Draft/approval mode** | User may not trust bot for some contacts or early in usage | Medium | Bot generates reply, holds it, notifies user, user approves or edits before send. This is the "training wheels" mode. |
| **Per-contact mode toggle** | Different contacts warrant different trust levels | Low | Each whitelisted contact independently set to auto or draft mode. |
| **Custom persona instructions** | LLM needs user-specific guidance to impersonate accurately | Low | System prompt containing tone, phrases, topics, relationship context per contact or globally. |
| **Conversation context window** | Replies must be contextually coherent, not one-shot | Medium | Last N messages (or full history) passed to Gemini on each response. Gemini 2.0 Flash supports 1M token context — practical limit is cost and latency. |
| **Global on/off toggle** | User must be able to stop the bot immediately | Low | Master kill switch, disables all auto-reply without removing config. |
| **Graceful reconnect on disconnect** | Server reboots, network blips must not permanently kill bot | Medium | Baileys emits connection state events. Auto-reconnect logic with exponential backoff. |
| **Basic web dashboard** | Configuration without editing raw files | Medium | React or plain HTML UI to manage contacts, mode, instructions. Must be LAN-accessible. |
| **Activity log / message history** | User needs to audit what the bot sent | Low | Timestamped log of: inbound message, generated reply, send status, mode (auto/draft). |

---

### Differentiators

Features that set this bot apart from generic auto-reply tools. Not expected, but high value once discovered.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Chat history ingestion for style learning** | Bot learns the user's actual writing patterns from exported WhatsApp chats | High | Export WhatsApp chat as .txt, parse, extract user's messages, inject as few-shot examples or fine-tuning data into system prompt. Dramatically improves impersonation quality. Few-shot prompting (no fine-tuning needed) is the practical approach with Gemini. |
| **Per-contact relationship context** | Bot knows "this is my mom" or "this is my coworker" and adjusts tone | Low | Simple text field per contact. Injected into system prompt. High impact for minimal effort. |
| **Notification to owner on auto-reply** | User knows what the bot said even in auto mode | Low | Push notification or secondary WhatsApp message to the user. Closes the feedback loop. |
| **Draft review UI in dashboard** | Approve/reject/edit AI drafts from a clean web UI | Medium | Real-time list of pending drafts. Click to approve, edit inline, or reject. Far better than Telegram/WhatsApp notification-based approval flows. |
| **Snooze / pause per contact** | Temporarily disable bot for a contact (e.g. active conversation) | Low | Time-based or manual unpause. Prevents bot from interrupting a live conversation the user is having. |
| **Response delay simulation** | Replies feel human — not instant | Low | Random delay (15s–3min) before sending. Mimics human typing time. Configurable per contact. |
| **Group chat exclusion by default** | Bot should never reply to group chats unless explicitly configured | Low | Groups involve multiple people — bot impersonating user in group is high-risk and socially inappropriate. Default-off. |
| **System prompt editor in dashboard** | Tune persona without touching config files | Low | Textarea with preview. Save + apply live. |
| **Conversation summary / digest** | Weekly digest of what the bot handled on your behalf | Medium | Summaries of conversations, contacts active, any flagged situations. Awareness without reading every message. |
| **Confidence scoring / uncertainty flag** | Bot flags replies it is unsure about for manual review | Medium | Gemini can be prompted to return a confidence flag. Low-confidence replies bypass auto-mode and queue for approval even in auto mode. |

---

### Anti-Features

Things to explicitly NOT build. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Multi-account support** | Adds architectural complexity (session isolation, UI per account), is not in scope for a personal tool | Build well for one account. Multi-account can be a later milestone if ever needed. |
| **Bulk/broadcast messaging** | WhatsApp actively detects and bans accounts for bulk sending. This is the #1 ban trigger. | Bot only replies to inbound messages from whitelisted contacts. Never initiates unsolicited messages. |
| **Contact scraping / auto-discovery** | WhatsApp bans accounts that enumerate contacts at scale | Contacts added manually by user in dashboard |
| **Group chat auto-reply** | Impersonating user in a group is socially dangerous (bot speaks "as you" to multiple people simultaneously) | Group chats excluded from bot scope entirely by default |
| **Voice message generation** | High complexity, not core to text impersonation | Text-only replies |
| **Fine-tuning the LLM on chat data** | Requires GPU, weeks of engineering, maintenance burden. Few-shot prompting achieves 80% of the quality at 5% of the effort. | Use few-shot examples in system prompt via WhatsApp export parsing |
| **Public-facing deployment** | Bot is personal infrastructure, not a SaaS. Exposing it publicly invites abuse and security risks. | LAN-only dashboard, Tailscale for remote access |
| **WhatsApp Business API** | Requires Meta approval, costs money, is designed for businesses not personal accounts. Impersonation use case does not fit the API's purpose-specific bot policy. | Use Baileys with personal WhatsApp account |
| **Webhook-first architecture** | WhatsApp personal accounts don't support webhooks (that is a Business API feature) | Event-driven via Baileys WebSocket connection |
| **Read receipts / "seen" control** | Manipulating read receipts is detectable and risks account quality score | Do not tamper with read receipt behavior |

---

## Feature Dependencies

```
WhatsApp Web connection
    └── Reliable session persistence
        └── Per-contact whitelist
            ├── Auto-reply mode
            │   ├── Conversation context window
            │   │   └── Chat history ingestion (enhances context quality)
            │   ├── Response delay simulation
            │   └── Notification to owner on auto-reply
            └── Draft/approval mode
                └── Draft review UI in dashboard
                    └── Approve / reject / edit actions

Per-contact whitelist
    └── Per-contact mode toggle (auto vs draft)
    └── Per-contact relationship context
    └── Snooze / pause per contact

Global on/off toggle
    └── (depends on nothing, gates all auto-reply behavior)

Basic web dashboard
    ├── Per-contact management UI
    ├── System prompt editor
    ├── Draft review UI
    ├── Activity log
    └── Global toggle

Gemini API integration
    ├── Auto-reply mode (generates text)
    ├── Draft mode (generates text for review)
    └── Confidence scoring / uncertainty flag (optional)
```

---

## MVP Definition

The MVP must prove the core loop: **user receives message → bot generates reply in user's style → reply is sent or queued → user can audit**.

**Include in MVP:**

1. WhatsApp connection via Baileys with QR auth and session persistence
2. Per-contact whitelist (manual JSON or simple dashboard entry)
3. Draft mode for all whitelisted contacts (safer MVP: nothing auto-sends)
4. Gemini API integration with system prompt containing persona instructions
5. Last 20 messages passed as context on each reply
6. Web dashboard: contact list, mode toggle, pending drafts with approve/reject, activity log
7. Global on/off toggle
8. Graceful reconnect on disconnect

**Defer from MVP:**

- Chat history ingestion / style learning (valuable but requires WhatsApp export parser; add in Phase 2)
- Auto-reply mode (enable after draft mode validates reply quality)
- Response delay simulation (add with auto-mode)
- Notification to owner on auto-reply (add with auto-mode)
- Confidence scoring (add when auto-mode is live)
- Snooze per contact (convenience feature, Phase 2+)
- Conversation digest (Phase 3+)

---

## Feature Prioritization Matrix

| Feature | User Value | Complexity | Risk | Priority |
|---------|-----------|------------|------|----------|
| WhatsApp connection + session | Critical | Medium | HIGH (ban risk) | P0 |
| Per-contact whitelist | Critical | Low | Low | P0 |
| Draft/approval mode | Critical | Medium | Low | P0 |
| Gemini integration | Critical | Medium | Low | P0 |
| Conversation context window | High | Medium | Low | P0 |
| Web dashboard (basic) | High | Medium | Low | P0 |
| Global on/off toggle | High | Low | Low | P0 |
| Activity log | High | Low | Low | P0 |
| Per-contact mode toggle | High | Low | Low | P1 |
| Auto-reply mode | High | Low | Medium | P1 |
| Response delay simulation | High | Low | Low | P1 |
| Owner notification on auto-reply | High | Low | Low | P1 |
| Chat history ingestion | High | High | Low | P1 |
| Per-contact relationship context | High | Low | Low | P1 |
| Draft review UI (rich) | Medium | Medium | Low | P2 |
| System prompt editor in UI | Medium | Low | Low | P2 |
| Snooze per contact | Medium | Low | Low | P2 |
| Confidence scoring | Medium | High | Low | P3 |
| Conversation digest | Low | Medium | Low | P3 |

**Risk column:** HIGH = account ban exposure, Medium = behavior correctness risk, Low = implementation risk only.

---

## Key Constraints Affecting Features

**Account ban risk is the primary constraint.** WhatsApp detects automation via:
- Message frequency anomalies (too fast, too regular)
- Bulk / unsolicited outbound messages
- Unofficial API patterns (Baileys partially mitigates by using WebSocket directly, not Puppeteer/Selenium)

Features that directly address this:
- Whitelist (only reply to known contacts, never initiate)
- Response delay simulation (natural timing)
- Group chat exclusion (no broadcast-like behavior)
- No bulk messaging anti-feature

**Personal account vs Business API.** WhatsApp's 2026 AI policy banned general-purpose AI chatbots from the Business Platform. This bot runs on a personal account via Baileys — outside the Business API entirely — so the policy does not directly apply. However, ToS for personal accounts prohibit automation, making ban risk a real operational concern.

**Privacy.** Chat history exported for style learning contains third-party messages. Parse only the user's own messages. Do not store third-party messages beyond the active conversation context window.

---

## Sources

- [WhatsApp Auto-Reply Bot (GitHub, Benojir)](https://github.com/Benojir/WhatsApp-Auto-Reply-Bot) — open source reference for auto-reply + group control + history
- [Personalized chatbot from WhatsApp history (GitHub)](https://github.com/RheagalFire/personalized_chat_bot) — style learning from exported chats
- [How to create an AI that chats like you — Towards Data Science](https://towardsdatascience.com/how-to-create-an-ai-that-chats-like-you-cb3484824797/) — few-shot vs fine-tuning tradeoffs
- [Fine-tuning an LLM on 240k text messages — Edward Donner](https://edwarddonner.com/2024/01/02/fine-tuning-an-llm-on-240k-text-messages/) — fine-tuning costs vs quality
- [Baileys documentation](https://baileys.wiki/docs/intro/) — session management, QR auth, message events
- [whatsapp-web.js account ban issue thread](https://github.com/pedroslopez/whatsapp-web.js/issues/532) — real-world ban reports with unofficial API
- [WhatsApp Bot Rate Limiting and Ban Risks — WATI](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/) — rate limit mechanics
- [Best Practices to Prevent Number Banning — Wasender](https://wasender.com/blog/save-number-from-banning/) — operational guidelines
- [Not All Chatbots Are Banned: WhatsApp 2026 AI Policy — respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) — policy scope clarification
- [Google Gemini Context Window Strategies 2025/2026](https://www.datastudios.org/post/google-gemini-context-window-token-limits-model-comparison-and-workflow-strategies-for-late-2025) — token limits for conversation history
- [Human-in-the-loop approval workflow for AI messaging — n8n](https://n8n.io/workflows/2907-a-very-simple-human-in-the-loop-email-response-system-using-ai-and-imap/) — approval pattern reference
- [AI personal assistant with RAG for WhatsApp — n8n](https://n8n.io/workflows/3947-ai-personal-assistant-with-gpt-4o-rag-and-voice-for-whatsapp-using-supabase/) — memory and context patterns

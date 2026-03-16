# Domain Pitfalls

**Domain:** WhatsApp Bot v1.5 -- Personal Assistant Features (Universal Calendar Detection, Smart Reminders, Microsoft To Do Sync)
**Researched:** 2026-03-16
**Confidence:** MEDIUM-HIGH -- Microsoft Graph To Do API verified via official docs. WhatsApp ban risk confirmed via Baileys GitHub issues and Meta 2026 policy. Scheduler crash recovery patterns confirmed via community experience. Gemini cost concerns carry over from v1.0 research with HIGH confidence. Some OAuth token lifetime specifics are based on general Microsoft identity platform docs rather than To Do-specific documentation.

---

> **Scope note:** This document covers pitfalls specific to adding v1.5 personal assistant features: expanding calendar detection from groups to all chats, building a reminder/scheduler system, and integrating Microsoft Graph API for To Do sync. Pitfalls from prior milestones (auto-reply cost, ban risk from group proactive messaging, trip memory context rot, service account calendar ownership) remain valid and are not repeated here. This file extends that prior context.

---

## Critical Pitfalls

Mistakes that cause account bans, data loss, or mandatory architectural rewrites.

---

### Pitfall 1: Universal Calendar Detection on Every 1:1 Message Multiplies Gemini Costs by 10-50x

**What goes wrong:**
The existing date extraction runs only for tracked groups (gated by `group.travelBotActive` in `messageHandler.ts`). Expanding to "all chats" means every incoming 1:1 message -- from friends, family, delivery notifications, OTP codes, spam -- now flows through the event detection pipeline. The bot currently processes messages from contacts in `off`, `draft`, and `auto` modes. If the event detector runs before the mode check (or runs regardless of mode), it fires on every single incoming message.

A typical personal WhatsApp account receives 50-200 messages/day across all 1:1 chats. Without pre-filtering, that is 1,500-6,000 Gemini classifier calls/month -- compared to the current group-only scope of maybe 100-300/month from a few active groups. At Gemini 2.5 Flash pricing ($0.30/M input), the raw cost increase is modest ($0.50-$2.00/month), but the real danger is rate limit exhaustion: the free tier's 250 RPD limit is blown by noon on a busy day.

The deeper trap: 1:1 messages have no group context. The classifier cannot batch them the way group messages are batched in the 10-second debounce window. Each message from a different contact is an independent classification call.

**Why it happens:**
Developers copy the group pipeline pattern (debounce + classify batch) into the 1:1 path without noticing that 1:1 messages arrive from dozens of different contacts spread across the day, making batching ineffective. The existing `processMessage` function processes messages serially per contact -- there is no natural batching point.

**Consequences:**
- Free-tier rate limits exhausted daily; paid tier costs 5-10x the group-only baseline
- Every OTP, delivery notification, and spam message wastes a Gemini call
- No latency benefit from batching since 1:1 messages are contact-isolated

**Prevention:**
1. **JavaScript pre-filter before any Gemini call**: Check message text against fast heuristics -- date/time patterns (`\d{1,2}[/.]\d{1,2}`, time words like "tomorrow", "next week", Hebrew equivalents), event-signal keywords ("meeting", "appointment", "dinner", "flight"). Only pass candidates to Gemini. This eliminates 80-90% of messages at zero API cost.
2. **Minimum message length**: Skip messages under 15 characters -- "ok", "thanks", "lol" never contain actionable calendar events.
3. **Skip known non-human senders**: Maintain a blocklist of JIDs for delivery bots, OTP services, and business notification accounts. These never produce personal calendar events.
4. **Per-contact opt-in, not global on**: Add a `calendarDetectionEnabled` boolean to the contacts table (default `false`). Only run detection for contacts where the user has explicitly enabled it. This reduces the blast radius from "all chats" to "chats I care about."
5. **Respect the existing mode check**: Only run calendar detection for contacts not in `off` mode. The current pipeline skips `off`-mode contacts at line 344 -- event detection should respect this same gate.

**Warning signs:**
- Gemini API usage dashboard shows > 200 calls/day after v1.5 deployment
- Event detection fires on OTP messages or delivery notifications
- Logs show classification calls for messages with < 10 characters

**Phase to address:** Universal calendar detection phase -- pre-filter architecture must be decided before wiring the detector to the 1:1 message path.

**Confidence:** HIGH -- directly implied by the current `messageHandler.ts` architecture where all 1:1 messages flow through `processMessage`. Cost model based on verified Gemini 2.5 Flash pricing.

---

### Pitfall 2: Reminder Scheduler Loses All Pending Reminders on Process Restart

**What goes wrong:**
The bot runs 24/7 on a home server via PM2 (`ecosystem.config.cjs` exists in the project). Node.js schedulers like `node-cron` or `setTimeout` chains store their schedule in memory. When PM2 restarts the process (crash, update, server reboot, OOM kill), all pending reminders vanish. A user sets a reminder for "tomorrow at 9am," the server reboots at 3am, and the reminder never fires. There is no recovery mechanism.

This is particularly insidious because the failure is silent. The user has no way to know the reminder was lost until the time passes. Unlike a missed auto-reply (which the user might notice from the conversation context), a missed reminder has no backup signal.

**Why it happens:**
The simplest reminder implementation is `setTimeout(sendReminder, msUntilReminder)`. This works in a never-restarting process. But PM2 restarts processes on crash, memory limits, and file changes. Home servers experience power fluctuations, kernel updates, and OOM kills. The existing codebase already uses in-memory Maps (`lastAutoReplyTime`, `autoCountWindowStart`) that reset on restart -- the pattern encourages more of the same.

**Consequences:**
- Users lose trust in the reminder feature after the first missed reminder
- No audit trail of what was scheduled vs. what was delivered
- Difficult to debug because there is no evidence of the lost reminder after restart

**Prevention:**
1. **Persist all reminders in SQLite**: Create a `reminders` table with columns: `id`, `contactJid`, `reminderText`, `triggerAt` (Unix ms), `status` ('pending' | 'sent' | 'failed' | 'cancelled'), `calendarEventId` (nullable), `todoTaskId` (nullable), `createdAt`. Every reminder is a database row, not a timer.
2. **Poll-based scheduler, not timer-based**: On startup and every 30-60 seconds, query `SELECT * FROM reminders WHERE status = 'pending' AND triggerAt <= ?` with current timestamp. Send any due reminders. This pattern survives restarts -- the query finds all overdue reminders after a reboot.
3. **Catch-up on startup**: When the process starts, immediately run the poll query. Any reminders that were due during downtime are sent with a note: "Reminder (delayed -- was due at [original time]): [text]". This makes the recovery visible to the user.
4. **Mark sent atomically**: Update reminder status to `sent` in the same transaction as logging the send. If the WhatsApp send fails, mark as `failed` with a retry count. Retry failed reminders up to 3 times with exponential backoff.
5. **Do not use node-cron for individual reminders**: `node-cron` is appropriate for recurring system tasks (daily cleanup, weekly report). It is not appropriate for user-created one-off reminders because it stores schedules in memory and has no persistence.

**Warning signs:**
- Any use of `setTimeout` or `node-cron` for user-created reminders
- No `reminders` table in the schema after the feature is built
- Reminders "work in development but not in production" (because dev rarely restarts)

**Phase to address:** Reminder system phase -- persistence-first design before any scheduler code is written.

**Confidence:** HIGH -- PM2 restart behavior is well-documented. The existing codebase pattern of in-memory Maps confirms the risk of following the same pattern for reminders.

---

### Pitfall 3: Microsoft Graph OAuth Token Expires Silently -- To Do Sync Breaks After 90 Days

**What goes wrong:**
Microsoft Graph API requires delegated authentication (user-level OAuth) to access To Do tasks -- app-only (client credentials) authentication cannot access the `/me/todo` endpoint. The OAuth flow produces an access token (1-hour lifetime) and a refresh token (90-day lifetime). The bot uses the refresh token to silently obtain new access tokens. After 90 days of inactivity (no token refresh), the refresh token expires. The bot cannot reach Microsoft To Do. All sync operations fail silently -- tasks created via WhatsApp are not synced, and the user does not know until they check To Do manually.

The subtler failure: if the user changes their Microsoft account password or enables MFA, the refresh token is immediately invalidated. The bot does not detect this because the failure only surfaces on the next token refresh attempt, which might be hours later. Between the password change and the next refresh, the bot continues operating with a cached access token that will expire within the hour.

**Why it happens:**
Developers implement the initial OAuth flow (browser redirect, consent screen, token exchange) but treat token management as "done" after the first refresh token is stored. Microsoft's refresh tokens for personal accounts have a 90-day sliding window -- they extend their lifetime when used, but expire if unused for 90 days. A bot that syncs daily will never hit this limit. But a user who stops using To Do sync for 3 months (vacation, different workflow) will return to a broken integration with no clear error.

**Consequences:**
- To Do sync fails silently after 90 days of inactivity
- Password changes or MFA enrollment break sync within 1 hour with no notification
- User discovers broken sync only when they check To Do and find missing tasks
- Re-authentication requires the user to go through the browser OAuth flow again

**Prevention:**
1. **Store refresh token in SQLite with expiry metadata**: Create a `tokens` table (or add columns to `settings`): `provider` ('microsoft'), `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `lastRefreshedAt`, `status` ('active' | 'expired' | 'revoked').
2. **Proactive token refresh**: Refresh the access token when it has < 5 minutes remaining, not when it has already expired. Check token health on every To Do API call.
3. **Monitor refresh token age**: If `lastRefreshedAt` is older than 60 days, send a WhatsApp notification to the bot owner: "Microsoft To Do connection will expire in ~30 days. Send 'reauth microsoft' to refresh." This gives the user a month of warning.
4. **Handle `invalid_grant` gracefully**: When a refresh fails with `invalid_grant`, immediately notify the user via WhatsApp: "Microsoft To Do disconnected -- password change or token expired. Send 'reauth microsoft' to reconnect." Do not retry indefinitely.
5. **Use MSAL (Microsoft Authentication Library)**: MSAL handles token caching, silent refresh, and error classification automatically. Using raw HTTP for the OAuth flow is error-prone. The `@azure/msal-node` package is the official Node.js implementation.
6. **Request `offline_access` scope**: Without `offline_access` in the initial authorization request, Microsoft does not issue a refresh token at all. This is the single most common mistake. MSAL requests it by default, but raw implementations often omit it.

**Warning signs:**
- No `offline_access` in the OAuth scope list
- Refresh token stored without an expiry timestamp
- No WhatsApp notification when token refresh fails
- Raw `fetch`/`axios` calls to Microsoft token endpoint instead of MSAL

**Phase to address:** Microsoft To Do sync phase -- OAuth architecture must be designed before any Graph API call is made. The token management strategy is a prerequisite, not an afterthought.

**Confidence:** MEDIUM-HIGH -- Refresh token 90-day lifetime confirmed via Microsoft identity platform documentation. `invalid_grant` on password change confirmed via Microsoft Learn Q&A. `offline_access` requirement confirmed via official Graph API auth docs. MSAL recommendation from official Microsoft Graph documentation.

---

### Pitfall 4: Reminder Messages Sent Proactively Trigger WhatsApp Ban Detection

**What goes wrong:**
Reminders are bot-initiated messages -- the bot sends a message to a contact without the contact having sent anything first. This is the most dangerous pattern for Baileys-based bots. WhatsApp's anti-spam system specifically targets accounts that send unsolicited messages to contacts who haven't recently messaged back. A user sets 5 reminders across different contacts for different times. The bot sends 5 unprompted messages throughout the day. To WhatsApp's detection system, this looks like a spammer drip-feeding messages across contacts.

The risk is amplified by the suggest-then-confirm pattern: the reminder triggers a WhatsApp message, and if the user also gets a calendar event suggestion in the same hour, that is 2 bot-initiated messages to the owner's JID within a short window. The bot's own JID (`config.USER_JID`) receives the most messages from the bot (drafts, notifications, reminders) -- making it the highest-risk conversation for pattern detection.

**Why it happens:**
The existing bot architecture sends messages reactively (in response to incoming messages). Reminders are the first purely proactive feature. The `sendWithDelay` function in `sender.ts` adds a 1.5-4s typing delay, which helps for reactive messages but does not address the proactive sending pattern that WhatsApp flags.

Additionally, Meta's January 2026 policy update explicitly prohibits general-purpose AI chatbots on WhatsApp Business API. While this targets the Business API and not personal accounts via Baileys, it signals increased enforcement against automated messaging patterns. Baileys GitHub issues #1869 and #1983 report bans increasing in late 2025.

**Consequences:**
- Temporary ban (24-72 hours) means all bot features are offline, not just reminders
- Permanent ban means losing the phone number and all bot configuration tied to it
- Two milestones of work become useless if the account is banned

**Prevention:**
1. **Send reminders only to self (USER_JID)**: Instead of the bot messaging the contact directly, send the reminder to the bot owner's own chat: "Reminder: Call dentist at 3pm. Reply 'send' to forward to [contact]." This keeps all proactive messages in a single conversation (self-chat), which WhatsApp does not flag as spam.
2. **Global daily message cap**: Hard limit of 10 bot-initiated (proactive) messages per calendar day. Reminders + calendar suggestions + draft notifications all count toward this cap. Beyond the cap, queue messages for the next day.
3. **Rate limit proactive messages**: Never send 2 proactive messages within 5 minutes. Queue them with a minimum 5-minute gap. The baileys-antiban library recommends max 8 messages/minute, but for proactive messages, be much more conservative.
4. **Track proactive vs. reactive ratio**: If the bot sends more proactive messages than reactive messages in a day, something is wrong. Alert the owner.
5. **Batch reminders**: If multiple reminders are due within a 15-minute window, combine them into a single message: "Upcoming reminders:\n- 3:00pm: Call dentist\n- 3:15pm: Pick up groceries"

**Warning signs:**
- Bot sends > 3 proactive messages within 1 hour
- Proactive messages outnumber reactive messages on any given day
- WhatsApp app on the registered phone shows account warnings
- Messages start failing with connection errors after a burst of proactive sends

**Phase to address:** Reminder system phase -- the proactive message strategy must be designed alongside the scheduler, not after.

**Confidence:** HIGH -- ban risk for proactive messaging confirmed via Baileys GitHub issues #1869, #1925, #1983. Rate limit recommendations from baileys-antiban library. Meta's 2026 policy direction confirmed via TechCrunch and respond.io.

---

## Moderate Pitfalls

Mistakes that cause user-visible bugs, non-trivial debugging time, or degraded experience, but do not force rewrites.

---

### Pitfall 5: Expanding Date Detection to 1:1 Chats Creates False Positives from Conversational Dates

**What goes wrong:**
Group messages about trips are contextually rich: "Let's fly to Rome on March 15th." 1:1 messages are conversationally ambiguous: "I had a great time last Tuesday," "How about next week sometime?", "my birthday is on the 5th." The existing date extraction logic (tuned for group travel planning) will treat all of these as calendar event candidates. The bot suggests creating a calendar event for "great time last Tuesday" -- a past date, clearly not an event.

The ambiguity is worse in Hebrew, where informal date references are common: "maybe after Pesach," "in two weeks or so," "sometime in the summer." These are vague time references, not concrete event dates.

**Why it happens:**
The date extraction model was trained/prompted for group travel planning context where date mentions almost always correspond to planned events. In 1:1 chats, date mentions serve many purposes: reminiscing, vague planning, scheduling, complaining about deadlines, forwarding articles with dates.

**Consequences:**
- Users receive irrelevant calendar event suggestions for casual date mentions
- Trust erosion: after 3-4 false positives, users ignore all suggestions (including correct ones)
- Wasted Gemini tokens on classification of non-actionable dates

**Prevention:**
1. **Separate classifier prompt for 1:1 vs. group context**: The group classifier assumes travel planning intent. The 1:1 classifier must be prompted differently: "Is this message describing a concrete future event that the user would want on their calendar? Exclude: past events, vague time references, forward-looking expressions without a specific date."
2. **Require both a date AND an activity**: "March 15th" alone is not enough. Require the message to contain both a temporal reference and an activity/event noun ("meeting", "dinner", "flight", "appointment"). This dramatically reduces false positives.
3. **Reject past dates**: Any extracted date that resolves to before today should be dropped immediately, before the suggest-then-confirm flow.
4. **Confidence threshold**: Only suggest calendar events when the classifier confidence exceeds 80%. For 1:1 chats, require higher confidence than for groups (where context is richer and the prior probability of a real event is higher).
5. **Track false positive rate**: Log every suggestion and its outcome (confirmed/rejected). If the rejection rate exceeds 50% for a contact, lower the suggestion frequency or disable detection for that contact.

**Warning signs:**
- Suggestion rejection rate > 40% across all 1:1 contacts
- Bot suggests events for messages like "remember when..." or "I think sometime next month"
- User explicitly says "stop suggesting events"

**Phase to address:** Universal calendar detection phase -- classifier prompt redesign for 1:1 context.

**Confidence:** MEDIUM-HIGH -- inferred from the existing group-focused classifier design and general NLP challenges with ambiguous temporal expressions. False positive rates are estimated, not measured.

---

### Pitfall 6: Timezone Bugs in Reminder Scheduling -- Server Time vs. User's Intended Time

**What goes wrong:**
User says "remind me at 9am tomorrow." The bot extracts "9am tomorrow" and schedules the reminder. But 9am in which timezone? The server runs in IST (Asia/Jerusalem, UTC+2/+3 depending on DST). If the Gemini classifier returns a naive datetime (no timezone info), the bot assumes server timezone. This works for the single-user case (bot owner is in Israel) -- until the user travels, or until Israel DST changes shift the offset.

Israel's DST transition (last Friday of March, last Sunday of October) creates a specific failure mode: a reminder set for "tomorrow at 2:30am" during the spring-forward transition will either fire twice or not at all, depending on how the scheduler handles the missing/repeated hour.

**Why it happens:**
`Date.now()` and `new Date()` in Node.js use the server's system timezone. If the server timezone is set to UTC (common in containers/cloud) but the user means IST, all reminders are off by 2-3 hours. Even if the server is correctly set to IST, DST transitions create edge cases.

**Consequences:**
- Reminders fire at wrong times (2-3 hours early/late)
- During DST transitions, reminders in the 2:00-3:00am window are unreliable
- Difficult to debug because the error depends on the time of year

**Prevention:**
1. **Store all reminder times as UTC timestamps in SQLite**: Convert user-intended time to UTC at creation time, store as Unix ms. The scheduler compares `Date.now()` (always UTC) to the stored UTC timestamp.
2. **Hardcode user timezone in config**: Add `USER_TIMEZONE: 'Asia/Jerusalem'` to the env schema. All natural language time parsing uses this timezone for conversion. This is a personal bot with one user -- no need for per-contact timezone support.
3. **Use a timezone-aware date library**: `Temporal` (if available) or `luxon` for all date arithmetic. Never use raw `Date` for timezone-sensitive operations. Specifically, use the library's "next occurrence of 9am in Asia/Jerusalem" rather than manual hour arithmetic.
4. **Avoid scheduling reminders during DST transition hours**: If a reminder resolves to the 2:00-3:00am window on a DST transition date, shift it to 3:05am and log a warning.
5. **Include the resolved time in the confirmation**: When the user sets a reminder, confirm: "Reminder set for tomorrow, Monday March 17 at 9:00 AM IST." This makes the interpretation visible and catchable.

**Warning signs:**
- Reminder fires 1 hour early/late after DST change
- Tests pass in CI (UTC) but fail locally (IST) or vice versa
- User says "remind me at 9am" and gets reminded at 7am or 11am

**Phase to address:** Reminder system phase -- timezone handling must be decided before any time parsing code is written.

**Confidence:** HIGH -- Israel DST edge cases well-documented. Node.js `Date` timezone behavior is a known source of bugs. Server timezone mismatch is a standard operational concern.

---

### Pitfall 7: Microsoft To Do Sync Creates Duplicate Tasks on Retry or Reconnection

**What goes wrong:**
The bot creates a task in Microsoft To Do via Graph API. The HTTP request succeeds (task is created), but the response is lost due to a network timeout or the bot process crashes before processing the response. On retry (or on startup catch-up), the bot does not know the task was already created. It creates the task again. The user sees duplicate tasks in To Do.

This is worse with the reminder-to-task sync flow: a reminder fires, the bot creates a To Do task AND sends a WhatsApp reminder. If the task creation succeeds but the WhatsApp send fails, the bot retries the entire flow -- creating another To Do task.

**Why it happens:**
The Microsoft Graph To Do API does not have idempotency keys. Creating a task with the same title and body always creates a new task -- there is no "upsert" or "create if not exists." Developers implement retry logic for resilience without accounting for the non-idempotent nature of the API.

**Consequences:**
- Duplicate tasks in To Do (annoying but not critical)
- If duplicates accumulate, user loses trust in the sync feature
- Difficult to detect programmatically since To Do tasks have no unique external ID

**Prevention:**
1. **Store the To Do task ID locally before confirming**: The flow should be: (a) create task in To Do, (b) store the returned task ID in the `reminders` table `todoTaskId` column, (c) mark the reminder as synced. If step (b) succeeds, the sync is recorded. If the process crashes between (a) and (b), the startup catch-up can check for reminders with `todoTaskId IS NULL` and query To Do for recent tasks matching the title to deduplicate.
2. **Separate the To Do sync from the WhatsApp send**: These are independent operations. Do not bundle them in a single retry loop. Create the task first, record its ID, then send the WhatsApp message. Each step retries independently.
3. **Title-based dedup check before creation**: Before creating a task, query `GET /me/todo/lists/{listId}/tasks?$filter=title eq '{title}'` to check if a task with the same title already exists within the last hour. This is imperfect (different tasks can have the same title) but catches the most common duplication case.
4. **Idempotency token in task body**: Embed a unique ID (the reminder's UUID) in the task's body or a linked resource. Before creating, search for tasks containing that UUID. This is more robust than title matching.

**Warning signs:**
- Users report duplicate tasks in To Do
- `reminders` table has rows with `todoTaskId IS NULL` after a known crash/restart
- Multiple To Do tasks created within seconds with the same title

**Phase to address:** Microsoft To Do sync phase -- deduplication strategy must be built into the sync logic from day one.

**Confidence:** MEDIUM -- Microsoft Graph To Do API lacks idempotency keys based on API documentation review. Deduplication via title or body search is a workaround, not an official pattern.

---

### Pitfall 8: Suggest-Then-Confirm for 1:1 Calendar Events Overloads the Owner's Self-Chat

**What goes wrong:**
The existing suggest-then-confirm pattern sends suggestions to `config.USER_JID` (the bot owner's self-chat). With group-only detection, this produces a manageable number of suggestions. Expanding to all 1:1 chats means every detected event across every conversation produces a notification in the owner's self-chat. On a busy day (10+ active contacts, each mentioning dates), the owner receives 5-15 confirmation requests interspersed with draft approvals, snooze notifications, and reminder confirmations. The self-chat becomes an unreadable wall of bot notifications.

The existing draft system uses `lastNotifiedJid` (a single module-scoped variable) to track context. If 3 calendar suggestions arrive from 3 different contacts, `lastNotifiedJid` points to the last one only. The owner's "snooze" or approval actions apply to the wrong contact.

**Why it happens:**
The self-chat was designed as a control channel for a low-volume feature (draft approvals for active contacts). Adding calendar suggestions, reminders, and To Do sync confirmations multiplies the volume beyond what a single-threaded approval queue can handle.

**Consequences:**
- Owner misses or ignores suggestions due to notification fatigue
- `lastNotifiedJid` mismatch causes approvals/rejections applied to wrong contacts
- No way to distinguish between "pending draft," "pending calendar suggestion," and "pending reminder" in the self-chat

**Prevention:**
1. **Typed notification system**: Each notification in the self-chat should be prefixed with a type tag: `[DRAFT]`, `[EVENT]`, `[REMINDER]`, `[TODO]`. The bot's command parser recognizes which type is being approved.
2. **Replace `lastNotifiedJid` with a proper pending queue**: Instead of a single variable, maintain a `pending_actions` table in SQLite with `(id, type, contactJid, details, status, createdAt)`. Each approval command references the latest pending action of a specific type, or the user can approve by replying to the specific notification message (quoted message ID).
3. **Auto-expire low-confidence suggestions**: Calendar event suggestions from 1:1 chats with classifier confidence < 90% could auto-expire after 10 minutes with no action, reducing clutter.
4. **Batch notifications**: If 3 event suggestions are detected within 5 minutes, send a single summary: "Detected 3 potential events:\n1. Dinner with Mom - March 18\n2. Dentist - March 19\n3. Team meeting - March 20\nReply 1/2/3 to add, or 'all' to add all."
5. **Daily digest mode**: For low-urgency calendar events, accumulate detections and send a daily summary at a fixed time: "Today's detected events: ..."

**Warning signs:**
- Owner's self-chat receives > 10 bot messages per day
- Owner stops responding to suggestions (approval rate drops)
- Wrong contact gets approved/rejected due to `lastNotifiedJid` race

**Phase to address:** Universal calendar detection phase -- notification architecture must be redesigned before expanding detection scope.

**Confidence:** HIGH -- directly observable from the current `messageHandler.ts` code where `lastNotifiedJid` is a single module-scoped variable (line 52). The scaling problem is a direct consequence of expanding to all chats.

---

### Pitfall 9: Microsoft Graph App Registration Requires Specific Tenant Configuration for Personal Accounts

**What goes wrong:**
To use Microsoft Graph API with a personal Microsoft account (not a work/school account), the Azure AD app registration must be configured with "Accounts in any organizational directory and personal Microsoft accounts" as the supported account type. If the developer selects "Single tenant" or "Multi-tenant (organizational only)" during app registration, the OAuth flow will fail for personal accounts with an unhelpful error like `AADSTS50020: User account does not exist in tenant`.

Additionally, the `/me/todo/lists` endpoint requires `Tasks.ReadWrite` delegated permission. This permission must be explicitly granted in the app registration AND the user must consent to it during the first OAuth flow. If the permission is missing, API calls return 403 with no indication of which permission is missing.

**Why it happens:**
The Azure portal defaults to "Single tenant" for new app registrations. Developers who follow generic Microsoft Graph tutorials often skip the account type selection, ending up with an app that only works for accounts in their specific Azure AD tenant. Personal Microsoft accounts (outlook.com, hotmail.com, live.com) require the "personal accounts" option to be explicitly selected.

**Consequences:**
- OAuth flow fails for personal Microsoft accounts with cryptic errors
- Requires deleting and recreating the app registration (the account type cannot be changed after creation in some cases)
- Time wasted debugging authentication errors that look like token issues but are actually app registration issues

**Prevention:**
1. **Select "Accounts in any organizational directory and personal Microsoft accounts (Multitenant)" during app registration**: This is the only option that works for personal accounts. Document this choice prominently in setup instructions.
2. **Add `Tasks.ReadWrite` to API permissions before first OAuth attempt**: In the Azure portal, go to API Permissions > Add a permission > Microsoft Graph > Delegated > Tasks.ReadWrite. Without this, the consent screen may succeed but the API will reject calls.
3. **Set the redirect URI correctly**: For a CLI/bot flow, use `http://localhost:PORT/callback` as the redirect URI. Mobile/SPA redirect URIs will not work for a server-side bot.
4. **Test the OAuth flow with MSAL's interactive login sample first**: Before integrating into the bot, verify the app registration works by running MSAL's standalone auth code flow sample. This isolates app registration issues from bot code issues.
5. **Store the app registration details (client ID, tenant ID, redirect URI) in the bot's `.env` file**: Use the Zod schema to validate they are present at startup, just like the existing Gemini API key validation.

**Warning signs:**
- `AADSTS50020` or `AADSTS700016` errors during OAuth flow
- OAuth consent screen does not show `Tasks.ReadWrite` permission
- Authentication works with work account but fails with personal account

**Phase to address:** Microsoft To Do sync phase -- app registration is the first step, before any code is written.

**Confidence:** MEDIUM-HIGH -- app registration account type behavior confirmed via Microsoft Learn documentation. Permission requirements confirmed via Graph API permissions reference. The "cannot change account type after creation" limitation may have been relaxed in recent Azure portal updates -- verify at implementation time.

---

### Pitfall 10: Calendar Event and Reminder Confirmation Patterns Conflict with Existing Draft Approval

**What goes wrong:**
The existing bot uses a simple approval protocol: the owner replies with a checkmark or X emoji to approve/reject the latest pending draft. v1.5 adds two more confirmation types: calendar event suggestions ("Add 'Dinner with Mom' on March 18?") and reminder confirmations ("Set reminder for 3pm?"). All three use the owner's self-chat. If a draft and a calendar suggestion are both pending, what does a checkmark approve? The existing `getLatestPendingDraft()` function only looks at drafts -- it does not know about pending calendar suggestions or reminders.

**Why it happens:**
The draft approval system was designed as the only confirmation type. It uses a dedicated `drafts` table and a linear "most recent pending" lookup. Adding new confirmation types without unifying the approval mechanism creates ambiguity.

**Consequences:**
- Checkmark approves a draft when the user intended to approve a calendar event (or vice versa)
- If both a draft and a calendar event are pending, one is invisible to the approval parser
- Adding each new confirmation type requires modifying the `handleOwnerCommand` function, creating a growing if/else chain

**Prevention:**
1. **Unified pending action system**: Create a single `pending_actions` table: `(id, type, targetJid, details JSON, status, createdAt, expiresAt)`. Types: 'draft', 'calendar_event', 'reminder', 'todo_task'. The checkmark approves the most recent pending action regardless of type.
2. **Quoted-message disambiguation**: Require the user to approve by quoting the specific notification message. The bot matches the quoted message ID to the pending action. Unquoted checkmarks approve the most recent action of any type.
3. **Type-specific emoji shortcuts**: Checkmark for drafts (existing), calendar emoji for calendar events, bell emoji for reminders. This is more intuitive than a single checkmark for everything.
4. **Numbered approval**: When multiple actions are pending, list them with numbers: "Pending:\n1. [DRAFT] Reply to Mom\n2. [EVENT] Dinner March 18\nReply 1 or 2 to approve."

**Warning signs:**
- User approves a checkmark and the wrong action fires
- `handleOwnerCommand` grows beyond 100 lines of type-checking conditionals
- Pending actions from different types "shadow" each other

**Phase to address:** Must be addressed in the first phase that adds a new confirmation type (likely calendar detection). Retrofitting is expensive because it requires migrating the existing draft system.

**Confidence:** HIGH -- directly observable from the current code: `handleOwnerCommand` at line 125 only handles drafts and snooze. Adding more types without a unification layer is a guaranteed conflict.

---

## Minor Pitfalls

Issues that are annoying but recoverable without significant rework.

---

### Pitfall 11: Microsoft To Do Task Lists Are User-Specific -- Cannot Share Tasks

**What goes wrong:**
The developer assumes Microsoft To Do tasks can be shared between users (like a shared Google Calendar). To Do tasks are personal -- they belong to a single Microsoft account and cannot be shared. If the bot creates tasks in the owner's To Do, no one else can see them. This is fine for a personal assistant bot, but if the feature is later extended to "create To Do tasks for group trip action items," it will not work.

**Prevention:**
- Design the To Do sync as a personal feature from the start: the bot creates tasks in the owner's To Do list only
- For shared task management, use Microsoft Planner (different API, different permissions) or stay with the existing Google Calendar which supports sharing
- Document this limitation in the feature spec: "To Do sync is owner-only; shared task management is out of scope"

**Phase to address:** Microsoft To Do sync phase -- feature scoping.

**Confidence:** HIGH -- Microsoft To Do's personal-only nature confirmed via official API documentation.

---

### Pitfall 12: Reminder Natural Language Parsing Fails on Hebrew and Mixed-Language Input

**What goes wrong:**
User sends "remind me to call the dentist machaar (tomorrow in Hebrew: machar) at 3." The NLP parser (Gemini) receives mixed Hebrew-English input. Gemini handles this well in general, but edge cases arise: Hebrew date formats ("5 be'april"), informal Hebrew time references ("achrei hatzaharayim" = afternoon, no specific hour), and Hebrew-specific relative dates ("yom shlishi haba" = next Tuesday, but which Tuesday if today is Tuesday?).

**Prevention:**
1. **Prompt Gemini with explicit locale context**: Include in the system prompt: "The user communicates in Hebrew and English. Parse dates relative to timezone Asia/Jerusalem. 'machar' means tomorrow. 'hayom' means today. When a time is ambiguous (e.g., 'afternoon'), default to 2:00 PM."
2. **Always confirm the parsed time back to the user**: "Reminder set for Tuesday, March 18, 3:00 PM IST -- reply X to cancel." This catches parsing errors before they become missed reminders.
3. **Reject ambiguous time references**: If the parsed time has no specific hour (e.g., "sometime next week"), ask the user: "What time should I remind you?" rather than guessing.
4. **Test with a corpus of real Hebrew date expressions**: Collect 20-30 real examples from the bot owner's chat history and validate Gemini's parsing accuracy before deploying.

**Phase to address:** Reminder system phase -- prompt engineering for multilingual date parsing.

**Confidence:** MEDIUM -- Gemini's Hebrew NLP capabilities are generally strong but edge cases with mixed-language input are not well-documented. Specific failure modes are inferred from general multilingual NLP challenges.

---

### Pitfall 13: Gemini API Pre-Filter Rejects Legitimate Events Due to Overly Aggressive Keyword Matching

**What goes wrong:**
The JavaScript pre-filter (designed to reduce Gemini costs) uses keyword matching to decide which messages reach the classifier. The keyword list misses legitimate event signals: "let's grab coffee" (no date keyword), "pick you up at 7" (no event keyword), "reservation confirmed" (forwarded message, not conversational). Messages that contain real events but use indirect language bypass the pre-filter and never reach Gemini.

Conversely, messages like "I have a date tonight" (the word "date" triggers the filter) or "time to eat" (the word "time" triggers it) produce false positives that waste Gemini calls.

**Prevention:**
1. **Use a two-word co-occurrence filter, not single keywords**: Require at least one time-word AND one activity-word. "Coffee at 3" passes (activity + time). "I have a date" alone does not.
2. **Log pre-filter pass/reject with message text (in development)**: Review the filter's decisions on real messages over 1-2 weeks. Tune the keyword list based on actual pass/reject patterns.
3. **Fail open, not closed**: If the pre-filter is uncertain, let the message through to Gemini. The cost of one extra Gemini call ($0.0002) is far less than the cost of a missed event.
4. **Allow a configurable "filter sensitivity" setting**: Start with a low threshold (let more through to Gemini) and tighten over time as the keyword list is refined.

**Phase to address:** Universal calendar detection phase -- pre-filter tuning during the rollout period.

**Confidence:** MEDIUM -- pre-filter accuracy is difficult to estimate without real message data. The risk of over-filtering is a general NLP engineering concern.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Universal calendar detection | Gemini cost blow-up from processing every 1:1 message | JS pre-filter with date+activity co-occurrence; per-contact opt-in; respect contact mode |
| Universal calendar detection | High false positive rate from conversational date mentions in 1:1 | Separate classifier prompt for 1:1 context; require date+activity; reject past dates |
| Universal calendar detection | Self-chat notification overload from expanded detection scope | Typed notifications; replace `lastNotifiedJid` with pending action queue; batch notifications |
| Universal calendar detection | Pre-filter too aggressive, misses real events | Two-word co-occurrence; fail open; log and tune |
| Reminder system | Lost reminders on process restart | Persist in SQLite; poll-based scheduler; startup catch-up |
| Reminder system | Ban risk from proactive reminder messages | Send to self-chat first; daily cap of 10 proactive messages; batch nearby reminders |
| Reminder system | Timezone bugs (DST, server vs. user timezone) | Store UTC; hardcode user TZ in config; use luxon/Temporal; confirm parsed time to user |
| Reminder system | Hebrew/mixed-language date parsing failures | Locale-aware Gemini prompt; always confirm parsed time; reject ambiguous references |
| Microsoft To Do sync | OAuth token expires silently after 90 days | Proactive token health monitoring; WhatsApp notification on expiry; use MSAL |
| Microsoft To Do sync | Azure app registration wrong for personal accounts | Select "personal accounts" account type; add Tasks.ReadWrite permission; test before integrating |
| Microsoft To Do sync | Duplicate tasks on retry/reconnection | Store task ID before confirming; separate sync from send; idempotency via UUID in body |
| Microsoft To Do sync | Assumes shared tasks are possible | Design as owner-only from start; document limitation |
| Confirmation system (cross-cutting) | New confirmation types conflict with existing draft approval | Unified pending_actions table; quoted-message disambiguation; type-specific emoji shortcuts |

---

## Sources

- [Baileys GitHub Issue #1869 -- High Number of Bans](https://github.com/WhiskeySockets/Baileys/issues/1869) -- HIGH confidence -- ban patterns documented by community
- [Baileys GitHub Issue #1983 -- WhatsApp Number Banning](https://github.com/WhiskeySockets/Baileys/issues/1983) -- HIGH confidence -- recent ban reports
- [kobie3717/baileys-antiban -- Anti-Ban Middleware](https://github.com/kobie3717/baileys-antiban) -- MEDIUM confidence -- rate limit recommendations (8 msg/min, 200/hr, 1500/day)
- [Meta WhatsApp AI Chatbot Policy 2026 -- respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) -- HIGH confidence -- policy targeting Business API, not personal accounts
- [WhatsApp Chatbot Ban -- TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/) -- HIGH confidence -- Meta policy changes
- [Microsoft Graph To Do API Overview](https://learn.microsoft.com/en-us/graph/todo-concept-overview) -- HIGH confidence -- official API documentation
- [Microsoft Graph Delegated Auth](https://learn.microsoft.com/en-us/graph/auth-v2-user) -- HIGH confidence -- OAuth flow, refresh tokens, offline_access
- [Microsoft Graph Permissions Reference](https://learn.microsoft.com/en-us/graph/permissions-reference) -- HIGH confidence -- Tasks.ReadWrite scope, personal account support
- [Microsoft Refresh Token Lifetime](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens) -- HIGH confidence -- 90-day sliding window for personal accounts
- [Graph API OAuth2 Refresh Tokens Expiring -- Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1402711/graph-api-oauth2-refresh-tokens-expiring) -- MEDIUM confidence -- community-confirmed token expiry behavior
- [Tasks.ReadWrite Permission Details -- graphpermissions.merill.net](https://graphpermissions.merill.net/permission/Tasks.ReadWrite) -- MEDIUM confidence -- permission scope details
- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing) -- HIGH confidence -- $0.30/M input for Gemini 2.5 Flash
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) -- HIGH confidence -- 250 RPD free tier for Gemini 2.5 Flash
- [Gemini API Cost Guide 2026 -- CloudZero](https://www.cloudzero.com/blog/gemini-cost-per-api-call/) -- MEDIUM confidence -- cost optimization strategies
- [node-cron Timezone Support -- LogRocket](https://blog.logrocket.com/task-scheduling-or-cron-jobs-in-node-using-node-cron/) -- MEDIUM confidence -- timezone parameter usage
- [Cron Timezone Issues -- webhosting.de](https://webhosting.de/en/cron-time-zone-issues-cron-jobs-scheduling-errors/) -- MEDIUM confidence -- DST transition edge cases

---

*Pitfalls research for: WhatsApp Bot v1.5 -- Personal Assistant Features*
*Researched: 2026-03-16*

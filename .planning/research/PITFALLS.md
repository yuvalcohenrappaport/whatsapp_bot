# Pitfalls Research

**Domain:** Scheduled recurring messaging with voice/AI generation — added to existing WhatsApp bot
**Researched:** 2026-03-30
**Confidence:** HIGH (codebase read directly + verified with official sources and community issues)

---

## Critical Pitfalls

### Pitfall 1: Double-Fire on Reconnect

**What goes wrong:**
`initReminderSystem()` is called on every reconnect (by design — it already does this for reminders). The scheduled-messages equivalent reschedules active timers on reconnect. If the reconnect happens while a timer is already armed (e.g., 5 minutes before a scheduled send), a second timer is registered for the same message ID. The message fires twice.

**Why it happens:**
`scheduleReminder()` in `reminderScheduler.ts` already guards against this with `activeTimers.has(id)` — the new scheduler must replicate the same dedup guard. Developers copy the reconnect wiring without copying the guard. The bug only manifests when a reconnect overlaps with the timer's active window, so it is easy to miss in testing.

**How to avoid:**
- Replicate the `activeTimers` map pattern from `reminderScheduler.ts` exactly: `if (activeTimers.has(id)) clearTimeout(...)` before setting a new timer.
- Before arming the timer, re-read `status` from DB. Only arm if `status === 'pending'`.
- Status update (`'fired'`) must happen atomically before `sendMessage`, not after. A failed send with `status='fired'` is the safer failure mode (single lost send) vs. the double-send failure mode.

**Warning signs:**
- Two identical messages delivered seconds apart in WhatsApp.
- `activeTimers.size` grows unexpectedly after a reconnect log entry.

**Phase to address:** Scheduler core implementation (wherever the new `scheduledMessageScheduler.ts` is created).

---

### Pitfall 2: Recurring Schedule Lost After Crash Between `status='fired'` and `nextFireAt` Update

**What goes wrong:**
One-shot reminders write `status = 'fired'` once and are done. Recurring schedules need to write `status = 'fired'` and then compute and write `nextFireAt` and reset `status = 'pending'`. If the process dies between these two writes (PM2 SIGKILL, OOM, server power loss), the row is stuck as `'fired'` and the recurring schedule is silently dead.

**Why it happens:**
The existing reminder flow does a single status transition per row. Recurring flows require a read-modify-write cycle on `nextFireAt`. Without wrapping both writes in a `db.transaction()`, any crash window between them leaves the schedule corrupt.

**How to avoid:**
- Store `recurrenceCron` (text, nullable) and `nextFireAt` (integer ms) on the `scheduled_messages` table from day one.
- Fire logic: wrap `UPDATE status='fired'` + `UPDATE nextFireAt=computeNext(...)` + `UPDATE status='pending'` in a single `db.transaction()` call. Drizzle + better-sqlite3 transactions are synchronous and crash-safe.
- On startup recovery, scan for rows where `status='pending' AND nextFireAt <= now` — these are recurring jobs whose timer was not re-armed after restart.

**Warning signs:**
- Recurring message stopped firing with no error logs.
- DB row has `status='fired'` with no `nextFireAt` (or stale `nextFireAt` in the past) and `recurrenceCron` is non-null.

**Phase to address:** DB schema migration phase (must exist before any scheduler code is written).

---

### Pitfall 3: Cancel Window Race — Message Fires Before User Can Cancel

**What goes wrong:**
The pre-send notification says "sending in 60s — reply CANCEL to abort." The timer fires at T+60s. The owner reads the notification, taps, types "CANCEL" — but WhatsApp delivery latency plus typing time means the cancel arrives at T+62s. The message already sent.

**Why it happens:**
The cancel check runs inside `messageHandler.ts` driven by incoming messages. The timer runs on `setTimeout`. There is no coordination between the two. The timer callback fires first (it was queued first), marks `status='fired'`, calls `sendMessage`, and the cancel check runs afterward with nothing left to stop.

**How to avoid:**
- Store a `cancelRequestedAt` boolean/timestamp field in the DB row (not in memory).
- When a CANCEL message arrives, write `cancelRequestedAt = Date.now()` to the DB before doing anything else.
- Timer callback: read `cancelRequestedAt` from DB at fire time. If set, abort and mark `status='cancelled'`. This is race-free because better-sqlite3 reads are synchronous and execute before the async `sendMessage` call begins.
- Do NOT rely on in-memory Maps for cancel state — PM2 reloads wipe them, and reconnects are frequent on this server.

**Warning signs:**
- Owner reports "I cancelled but it sent anyway."
- Logs show `status='fired'` was written before the incoming CANCEL message was processed.

**Phase to address:** Cancel window implementation (same phase as pre-send notification logic).

---

### Pitfall 4: Baileys RC Stale Sock Silently Drops Scheduled Sends

**What goes wrong:**
Baileys 7.x RC has documented bugs where `sock` becomes silently disconnected while `getState().sock` returns a non-null value. The connection reports "Online" but the WebSocket is dead. A scheduled message calls `sock.sendMessage()`, the call hangs or returns without error, and the message is silently dropped. The scheduler marks it `'fired'` and moves on.

**Why it happens:**
RC9 specifically has a bug where the linked device state appears valid but the underlying socket is severed (issue #2132). The existing `fireReminder()` handles `!sock` — but the stale-sock case returns a truthy `sock` that silently fails. More programmatic sends increase the blast radius of this bug.

**How to avoid:**
- Wrap every scheduled `sock.sendMessage()` in `Promise.race([sock.sendMessage(...), rejectAfter(15_000)])`.
- On timeout or throw: write `status = 'send_failed'` (new status value) instead of `'fired'`. Hourly scan retries `'send_failed'` rows up to 3 times.
- After 3 failures, send a self-chat alert: "Scheduled message failed after 3 attempts: [task]" and mark `status = 'failed'`.
- Monitor Baileys changelog before locking the RC version for this milestone.

**Warning signs:**
- `sendMessage` call takes >10s (normal delivery is <2s).
- PM2 logs show `'fired'` but owner never received the message.
- Baileys logs show `close` immediately after `open` (the RC disconnect-on-reconnect pattern).

**Phase to address:** Scheduler fire implementation phase. Re-verify after any Baileys version bump.

---

### Pitfall 5: AI Generation or TTS Timeout Blocks the Fire Callback

**What goes wrong:**
A scheduled message with AI-generated text calls Gemini, then feeds the result to ElevenLabs TTS. Gemini 2.5-flash has a known socket-stall bug where requests hang indefinitely at the TCP level instead of returning 503. The `await generateJson(...)` call never resolves. The fire callback is permanently stuck in the `await`, no error is thrown, and subsequent scheduled fires queue up behind it (Node.js event loop is not actually blocked for other I/O, but the callback closure is stuck).

**Why it happens:**
`Promise` rejections only happen if the SDK sets a client-side timeout. The Gemini Node.js SDK does not set a default socket timeout. The ElevenLabs SDK similarly has no built-in global timeout for streaming responses. Both can hang indefinitely.

**How to avoid:**
- Wrap every Gemini call with `Promise.race([generateJson(...), rejectAfter(30_000)])`.
- Wrap every ElevenLabs TTS call with `Promise.race([textToSpeech(...), rejectAfter(30_000)])`.
- On timeout: fall back to the static text content (if provided) for text sends, or skip voice and send text-only for voice messages. Log the fallback.
- Pre-generate TTS OGG buffer at schedule-creation time for static-text scheduled messages and cache as a BLOB in the DB. Only call ElevenLabs at fire time for dynamically AI-written content.

**Warning signs:**
- `'fired'` status is never written for a schedule (callback stuck in `await` before the status write).
- PM2 memory grows steadily over hours (stuck promises accumulate closures).
- ElevenLabs dashboard shows in-flight requests that never completed.

**Phase to address:** AI generation and TTS integration phase.

---

### Pitfall 6: DST Shift Corrupts `nextFireAt` for Recurring Schedules

**What goes wrong:**
Israel observes DST (clocks advance last Friday of March, retreat last Sunday of October). A recurring schedule stored as "every day at 09:00 Asia/Jerusalem" stores `nextFireAt` as a UTC epoch. If `nextFireAt` is computed as `current_fire_at + 24 * 3600 * 1000` (a fixed 24h offset), the computed time drifts by ±1 hour on DST transition days. The bot fires at 08:00 or 10:00 instead of 09:00 on that one day.

**Why it happens:**
Developers add a fixed millisecond interval to compute the next occurrence. The existing `tomorrowNineAm()` function in `reminderService.ts` already avoids this by using `toLocaleString` to account for the timezone offset — but developers writing the recurrence logic reach for simple arithmetic instead.

**How to avoid:**
- Store `recurrenceCron` (e.g., `'0 9 * * *'`) as a string in the DB. Never store the recurrence as a fixed ms interval.
- Compute `nextFireAt` using `node-cron`'s next-occurrence API or `date-fns-tz`'s `zonedTimeToUtc`, always with `timezone: 'Asia/Jerusalem'`.
- Unit test `computeNextFireAt()` with mocked `Date.now()` set to the exact moment of the March and October DST transitions.

**Warning signs:**
- Recurring message fires 1 hour off target on the Sunday/Friday of clock change.
- `nextFireAt - prevFireAt` equals `23 * 3600 * 1000` or `25 * 3600 * 1000` (should always be exactly the wall-clock interval in ms for that specific transition day).

**Phase to address:** DB schema design phase (cron string must be stored from the first migration, not retrofitted).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Compute `nextFireAt` as `current + interval_ms` | Simple, no extra dependency | DST drift; off-by-one on interval boundaries | Never for user-visible wall-clock schedules |
| Store cancel state in memory (not DB) | No DB write on cancel | Lost on PM2 reload; race with timer on reconnect | Never — PM2 restarts are common on this home server |
| Reuse the existing `reminders` table for scheduled messages | No new migration | One-shot and recurring semantics diverge; `status` field overloaded; queries become complex | Only if all scheduled messages are strictly one-shot (no recurrence) |
| Pre-generate TTS for all messages at creation time | Simpler fire path; no ElevenLabs call at fire time | Stale audio if message text is edited; ElevenLabs credits wasted on cancelled schedules | Acceptable for static-text scheduled messages only |
| Skip cancel window for messages scheduled >24h away | Simpler implementation | Owner cannot abort a distant scheduled message from WhatsApp | Acceptable as MVP if dashboard CRUD cancel is implemented as the substitute |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ElevenLabs TTS at fire time | No timeout; hangs on 429 or platform congestion | `Promise.race` with 30s timeout; fall back to text-only send on failure |
| ElevenLabs 429 | Immediate retry triggers cascading 429s | Queue requests; exponential backoff from 1s, capped at 32s; distinguish `too_many_concurrent_requests` (needs queuing) vs `system_busy` (needs backoff) |
| Gemini at fire time | SDK socket stall on 2.5-flash — `await` never resolves | Explicit `AbortController` or `Promise.race` with 30s timeout on every call |
| Baileys audio PTT send | Sending audio without `ptt: true` delivers it as a file attachment, not a voice note | Keep `ptt: true, mimetype: 'audio/ogg; codecs=opus'` exactly as in the existing `sender.ts` |
| Baileys `sock` at fire time | `getState().sock` returns non-null stale socket (RC bug) | Wrap in try/catch + 15s timeout; write `'send_failed'` status for retry |
| SQLite under concurrent load | Scheduler timer fires + dashboard CRUD + incoming message handler all write simultaneously | Drizzle + better-sqlite3 serializes writes at the driver level; keep the existing `busy_timeout` pragma; use `db.transaction()` for multi-step fire logic |
| node-cron timezone option | `node-cron`'s `timezone` option controls when it fires, but the stored `nextFireAt` must still be computed independently | Use `node-cron` only as the re-arm trigger; compute `nextFireAt` using `date-fns-tz` so DB value is always timezone-correct |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Generating TTS at fire time for multiple simultaneous scheduled messages | ElevenLabs 429; messages delayed or silently dropped | Pre-generate OGG for static text at creation time; stagger fire times by 5–10s if multiple messages are scheduled at the same minute | 3+ messages at identical minute |
| Scanning entire `scheduled_messages` table on every hourly tick without an index | Slow scans as rows accumulate | Index on `(status, nextFireAt)` — same pattern as `idx_reminders_status_fire` already in schema | Low risk but index is zero cost to add at migration time |
| ffmpeg spawn per TTS request at fire time | CPU spike on low-power home server; slow OGG delivery | Pre-generate and cache OGG BLOB at creation time for static messages | Simultaneous fires on underpowered hardware |
| Cancel-window state kept only in a module-scope `Map` | Cancel not honoured after any PM2 reload within the window | Store `cancelRequestedAt` in the DB row | Every PM2 reload during a cancel window |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Dashboard allows scheduling messages to arbitrary JIDs | Attacker with a compromised JWT can send messages from the owner's WhatsApp account to anyone | Validate all target JIDs against the `contacts` table at the API route level; reject unknown JIDs |
| No length limit on `aiInstructions` field for scheduled messages | Large prompts inflate Gemini token cost; may hit quota in a single fire | Enforce max 2000 chars at API route validation (Zod schema) |
| Returning the full scheduled message body in a list API response without auth check | Sensitive scheduled content exposed | All scheduled message endpoints behind existing JWT middleware |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cancel window notification as plain text with no deadline | Owner does not know how long they have to cancel | Include exact wall-clock deadline: "Sending at 09:05 (in 60s) — reply CANCEL to abort" |
| Cancel window always 60s regardless of message importance | Owner asleep during window; message sends without review | Make cancel window duration configurable per scheduled message (0 = fire immediately, up to 300s) |
| Dashboard renders `nextFireAt` as UTC epoch | Owner confused about when message will actually fire | Always display in `Asia/Jerusalem` timezone with explicit "(IST)" label |
| No firing history for recurring schedules | Owner cannot audit what was sent and when | Append each fire as a log row in a `scheduled_message_fires` table or a JSONB column; surface in dashboard |
| Voice message at scheduled time uses stale AI content generated weeks ago | Outdated or wrong information delivered as voice | For AI-written content: always generate at fire time, never pre-cache; accept the latency |

---

## "Looks Done But Isn't" Checklist

- [ ] **Recurring `nextFireAt` is DST-safe:** Unit test `computeNextFireAt()` with `Date.now()` mocked to the exact moment clocks change in March and October in `Asia/Jerusalem`. Assert correct wall-clock time after transition.
- [ ] **Cancel window survives PM2 restart:** Start a cancel window, kill and restart PM2 within the window, send CANCEL — confirm the message is not delivered.
- [ ] **No double-fire on reconnect:** Simulate a Baileys reconnect while a timer is armed within 30s of fire. Assert exactly one message delivered.
- [ ] **TTS timeout handled:** Mock ElevenLabs to stall indefinitely. Assert fire callback resolves within 35s with text-only fallback or `'send_failed'` status.
- [ ] **Gemini timeout handled:** Mock Gemini SDK to hang at TCP level. Assert `Promise.race` fires within 30s and scheduler does not block subsequent timers.
- [ ] **Recurring schedule survives mid-fire crash:** Kill the process with SIGKILL immediately after `status='fired'` is written but before `nextFireAt` is updated. Assert startup recovery re-arms the schedule correctly.
- [ ] **Dashboard cancel works end-to-end:** Create a schedule via dashboard, wait for pre-send notification in WhatsApp, reply CANCEL from WhatsApp — confirm message is not delivered.
- [ ] **`'send_failed'` retries and alerts:** Take Baileys offline, let a timer fire, bring Baileys back — assert retry sends within the next hourly scan; assert owner alert after 3 failures.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-fire delivered to contact | MEDIUM | No unsend in unofficial API; apologise manually; add dedup guard to prevent recurrence |
| Recurring schedule silently dead (`status='fired'`, no `nextFireAt`) | LOW | Manual SQL: `UPDATE scheduled_messages SET status='pending', nextFireAt=<computed> WHERE id=<id>` |
| DST-shifted fire time (off by 1 hour on clock-change day) | LOW | No message lost; fix `computeNextFireAt()` to use IANA-aware library; recompute `nextFireAt` for all pending recurring rows |
| Gemini/ElevenLabs stuck callback blocking process | MEDIUM | PM2 restart clears stuck callbacks; monitor PM2 memory for early warning |
| TTS credits wasted on cancelled schedules | LOW | No reversal; ElevenLabs credits lost; add pre-generation only after schedule is confirmed (not at creation time) |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Double-fire on reconnect | Scheduler core implementation | Integration test: reconnect during active timer window; assert single delivery |
| Recurring `nextFireAt` transaction atomicity | DB schema migration | Chaos test: SIGKILL mid-fire; assert no lost `nextFireAt` on restart |
| Cancel window race | Cancel window + pre-send notification phase | Manual test: reply CANCEL at exactly T+60s; assert no send |
| Baileys stale sock on send | Scheduler fire implementation | Mock stale sock; assert `'send_failed'` status within 15s |
| AI/TTS timeout blocking fire callback | AI + TTS integration phase | Mock infinite-hang on both; assert timeout resolves within 35s |
| DST timezone drift | DB schema design (cron string storage) | Unit test `computeNextFireAt()` at March and October DST transition moments |

---

## Sources

- Baileys RC9 silent disconnect bug: [GitHub issue #2132](https://github.com/WhiskeySockets/Baileys/issues/2132), [issue #2098](https://github.com/WhiskeySockets/Baileys/issues/2098)
- node-cron DST issues: [node-cron/node-cron #157](https://github.com/node-cron/node-cron/issues/157), [kelektiv/node-cron #881](https://github.com/kelektiv/node-cron/issues/881)
- ElevenLabs 429 handling: [prosperasoft.com ElevenLabs rate limit guide](https://prosperasoft.com/blog/voice-synthesis/elevenlabs/elevenlabs-api-rate-limits/), [ElevenLabs help: error 429](https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429)
- Gemini socket stall (2.5-flash): [googleapis/python-genai #1893](https://github.com/googleapis/python-genai/issues/1893), [Google AI Developers Forum — 120s timeout](https://discuss.ai.google.dev/t/gemini-2-5-flash-api-request-timeouting-after-120-seconds/80305)
- SQLite WAL concurrent writes: [SQLite official WAL documentation](https://www.sqlite.org/wal.html), [SkyPilot blog: SQLite concurrency](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/)
- WhatsApp ban risk from automated sends: [whautomate.com ban reasons 2025](https://whautomate.com/top-reasons-why-whatsapp-accounts-get-banned-in-2025-and-how-to-avoid-them/)
- Cron duplicate execution prevention: [cronitor.io guide](https://cronitor.io/guides/how-to-prevent-duplicate-cron-executions), [node-cron PM2 cluster duplicate #159](https://github.com/node-cron/node-cron/issues/159)
- Existing codebase (read directly): `/home/yuval/whatsapp-bot/src/reminders/reminderScheduler.ts`, `reminderService.ts`, `/src/voice/tts.ts`, `/src/db/schema.ts`

---
*Pitfalls research for: scheduled recurring messaging with voice + AI on WhatsApp bot (Baileys v7 RC, Gemini, ElevenLabs, SQLite WAL, PM2)*
*Researched: 2026-03-30*

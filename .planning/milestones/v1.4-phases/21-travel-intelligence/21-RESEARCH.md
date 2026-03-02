# Phase 21: Travel Intelligence - Research

**Researched:** 2026-03-02
**Domain:** Weekly digest extension, proactive message scheduling, in-memory rate limiting, Gemini text generation
**Confidence:** HIGH

## Summary

Phase 21 adds two capabilities to the existing bot: (1) a Trip Status section injected into the weekly digest that shows unresolved open questions from `tripDecisions`, and (2) a proactive suggestion message sent when the tripContextManager first records a `destination` decision for a group. Both features build entirely on infrastructure that already exists — no new tables, no new packages, no new architectural patterns.

The weekly digest lives in `reminderScheduler.ts` as `generateWeeklyDigest()`. This function currently calls Gemini with a formatted prompt and returns a text string. The simplest extension: before calling Gemini (or after, as a concatenation), query `getUnresolvedOpenItems(groupJid)` and format them as a Hebrew bullet list appended after the calendar events section. The locked decision says the trip status section goes AFTER the calendar events section, appears only when items exist, and is always Hebrew.

The proactive suggestion is a fire-and-forget side effect triggered by the tripContextManager. When `processTripContext` detects a new destination decision (one with `type: 'destination'` and `confidence !== 'low'`), it checks an in-memory Set of already-triggered destinations per group. If not already triggered, it schedules a delayed proactive message (5-15 minute random delay) after verifying the group cooldown and daily cap. The Gemini call generates 3-4 activity tips for the confirmed destination using `generateText`.

**Primary recommendation:** Implement Trip Status as a pure text append in `generateWeeklyDigest()` before the Gemini call (inject into the prompt so Gemini formats it), or after (as a raw append). Post-Gemini append is simpler and avoids coupling digest logic — use it. Implement proactive trigger as a new exported function `scheduleTravelSuggestion()` called from `processTripContext()` inside tripContextManager.ts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Digest trip status section
- Placement: after the existing calendar events section in the weekly digest — not before, not separate
- Content: only open items (unresolved questions) — skip confirmed decisions entirely, they're stored but not repeated in digest
- Visibility: section only appears when the group has open items — no empty "No active trips" placeholder
- Language: always Hebrew — matches Phase 19 suggestion messages and all target groups
- Format: simple bullet list of open questions with age indicator (e.g., "❓ האם המקום כשר? (לפני 3 ימים)")

#### Open item resolution
- Detection: automatic re-classification by tripContextManager — when a later message answers a tracked open question, the classifier marks it resolved
- No manual dismiss mechanism — keep it simple, auto-resolution only
- Expiry: 30 days — unresolved items silently removed after 30 days with no response
- Resolution UX: silent — resolved items just disappear from the next digest, no "resolved" notification
- Scope: explicit questions only ("מישהו יודע אם המקום כשר?", "מה עם ההסעות?") — not commitments or vague statements

#### Proactive suggestion content
- Content: 3-4 popular activity tips for the confirmed destination — short, informational list
- Generation: Gemini-generated with destination name as input — one API call per trigger, destination-aware content
- Calendar tie-in: none — proactive suggestions are informational only, no Phase 19 suggest-then-confirm flow
- Transparency: message references what triggered it — "ראיתי שבחרתם אילת! הנה כמה רעיונות:" — gives context for why the message appeared
- Tone: friendly and helpful, not robotic — feels like a travel-savvy friend chiming in

#### Rate limiting and timing
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEM-04 | Open items are surfaced in weekly digest until resolved or manually dismissed | `getUnresolvedOpenItems(groupJid)` already exists in `tripMemory.ts`; inject formatted Hebrew bullet list into digest after calendar events section; 30-day expiry via `createdAt` filter in the query |
| INTL-01 | Bot proactively suggests activities/tips when a destination is confirmed (rate-limited, max once per destination) | New `scheduleTravelSuggestion()` called from `processTripContext()` in `tripContextManager.ts`; in-memory Set<string> per group tracks triggered destinations; `generateText()` for Gemini activity tips |
| INTL-02 | Weekly digest includes trip status section: confirmed decisions, open questions, upcoming activities | Append-only extension of `generateWeeklyDigest()` in `reminderScheduler.ts`; add trip status block after Gemini digest string |
| INTL-03 | Proactive suggestions are relevant and not spammy (cooldown, only on new confirmations) | In-memory Map<groupJid, {lastSentAt: number, dailyCount: number, date: string}> for cooldown/cap tracking; random delay via `setTimeout`; per-destination deduplication via Set |
</phase_requirements>

## Standard Stack

### Core (already installed — no new packages)

| Library | Version | Purpose | How Used |
|---------|---------|---------|----------|
| better-sqlite3 / drizzle-orm | 12.6.2 / 0.45.1 | SQLite queries | `getUnresolvedOpenItems()` already in `tripMemory.ts`; add 30-day filter |
| @google/genai | 1.42.0 | Gemini API | `generateText()` for proactive destination tips; already in provider.ts |
| node-cron | 4.2.1 | Cron scheduling | Used by existing `reminderScheduler.ts`; no new cron jobs needed |
| pino | 10.3.1 | Logging | Same pattern as all existing modules |

**No new packages.** All needed tools are already installed. Per STATE.md: "zero new packages confirmed for Phases 17-20" — this pattern continues.

**Installation:** Nothing to install.

## Architecture Patterns

### Existing Code Map

```
src/groups/
  reminderScheduler.ts       # generateWeeklyDigest() -- ADD trip status section here
  tripContextManager.ts      # processTripContext() -- ADD destination trigger here
src/db/queries/
  tripMemory.ts              # getUnresolvedOpenItems() -- ALREADY EXISTS; add expiry filter
```

### Pattern 1: Trip Status Section — Append After Gemini Digest

**What:** Call `getUnresolvedOpenItems(groupJid)`, filter to items younger than 30 days, format as Hebrew bullets, and append the block to the Gemini-generated digest string.

**When to use:** When the weekly cron fires and `getUnresolvedOpenItems` returns non-empty results.

**Why append-after vs inject-into-prompt:** Appending keeps the digest logic decoupled. Gemini already handles "no travel context" gracefully. Injecting into the prompt risks Gemini reformatting, translating, or dropping the items.

**Example:**
```typescript
// In generateWeeklyDigest(), after Gemini returns the digest string:

function buildTripStatusSection(groupJid: string): string | null {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const openItems = getUnresolvedOpenItems(groupJid).filter(
    (item) => item.createdAt > thirtyDaysAgo,
  );

  if (openItems.length === 0) return null;

  const lines = openItems.map((item) => {
    const ageDays = Math.floor((Date.now() - item.createdAt) / 86400000);
    const ageLabel = ageDays === 0 ? 'היום' : `לפני ${ageDays} יום${ageDays === 1 ? '' : 'ים'}`;
    // Truncate long questions to ~80 chars
    const question = item.value.length > 80 ? item.value.slice(0, 77) + '...' : item.value;
    return `❓ ${question} (${ageLabel})`;
  });

  return `\n\n🧳 שאלות פתוחות לטיול:\n${lines.join('\n')}`;
}

// Usage in generateWeeklyDigest():
const digest = await generateText({ ... });
if (!digest) return null;

const tripStatus = buildTripStatusSection(groupJid);
return tripStatus ? digest + tripStatus : digest;
```

**Source:** Pattern deduced from `reminderScheduler.ts` lines 64-142 (direct codebase read).

### Pattern 2: Open Item Auto-Resolution — Classifier Enhancement

**What:** In `processTripContext()` in `tripContextManager.ts`, after extracting openItems from Gemini, check if any existing unresolved open questions appear to be answered by the current message batch. Mark them resolved by calling `resolveOpenItem(decisionId)`.

**When to use:** On every `processTripContext()` flush, after the classifier runs.

**Current gap:** The classifier schema (`TripClassifierSchema`) currently captures new `openItems` only. It does NOT capture resolved items. The schema needs a `resolvedQuestions` field (or the prompt needs to return question text that matches existing open items so we can string-match resolve them).

**Recommended approach — Add `resolvedQuestions` to classifier schema:**
```typescript
// Extend TripClassifierSchema in tripContextManager.ts
const TripClassifierSchema = z.object({
  decisions: z.array(/* existing */),
  openItems: z.array(/* existing */),
  resolvedQuestions: z
    .array(z.string())
    .describe(
      'Exact text of open questions from context that appear answered in these messages',
    ),
  contextSummary: z.string().nullable(),
});
```

Then in `processTripContext()`:
```typescript
// After classifier returns result:
if (result.resolvedQuestions && result.resolvedQuestions.length > 0) {
  const existing = getUnresolvedOpenItems(groupJid);
  for (const resolvedText of result.resolvedQuestions) {
    const match = existing.find((item) =>
      item.value.toLowerCase().includes(resolvedText.toLowerCase().slice(0, 30)),
    );
    if (match) {
      resolveOpenItem(match.id);
      logger.info({ groupJid, question: resolvedText }, 'Open question auto-resolved');
    }
  }
}
```

**Source:** `resolveOpenItem()` already exists in `tripMemory.ts` line 79-85 (direct codebase read).

### Pattern 3: Proactive Destination Trigger — In-Memory Rate Limiting

**What:** In `processTripContext()`, detect a new destination decision. Check the in-memory rate-limiting state. If allowed, schedule a delayed `setTimeout` to send activity tips.

**Rate-limit state structure:**
```typescript
// Module-level in tripContextManager.ts
interface GroupProactiveState {
  lastSentAt: number;           // Unix ms of last proactive message sent
  dailyCount: number;           // Count sent today
  dailyDate: string;            // YYYY-MM-DD string for reset detection
  triggeredDestinations: Set<string>; // Destinations already triggered
}

const proactiveState = new Map<string, GroupProactiveState>();
```

**Rate-limit check logic:**
```typescript
function canSendProactive(groupJid: string, destination: string): boolean {
  const state = proactiveState.get(groupJid);
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (!state) return true; // First ever for this group

  // One-shot per destination
  if (state.triggeredDestinations.has(destination)) return false;

  // 2-hour cooldown
  if (now - state.lastSentAt < 2 * 60 * 60 * 1000) return false;

  // Daily cap (reset if new day)
  const effectiveCount = state.dailyDate === todayStr ? state.dailyCount : 0;
  if (effectiveCount >= 3) return false;

  return true;
}

function recordProactiveSent(groupJid: string, destination: string): void {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const existing = proactiveState.get(groupJid);

  if (!existing || existing.dailyDate !== todayStr) {
    proactiveState.set(groupJid, {
      lastSentAt: now,
      dailyCount: 1,
      dailyDate: todayStr,
      triggeredDestinations: new Set([destination]),
    });
  } else {
    existing.lastSentAt = now;
    existing.dailyCount++;
    existing.triggeredDestinations.add(destination);
  }
}
```

**Trigger location in `processTripContext()`:**
```typescript
// After upserting tripContext and persisting decisions:
const newDestination = result.decisions.find(
  (d) => d.type === 'destination' && d.confidence !== 'low',
);

if (newDestination && canSendProactive(groupJid, newDestination.value)) {
  const delayMs = (5 + Math.random() * 10) * 60 * 1000; // 5-15 minute random delay
  setTimeout(() => {
    sendProactiveSuggestion(groupJid, newDestination.value).catch((err) => {
      logger.error({ err, groupJid }, 'Error in proactive suggestion');
    });
  }, delayMs);
  // Record immediately (not after send) to prevent double-scheduling on fast successive messages
  recordProactiveSent(groupJid, newDestination.value);
}
```

**Source:** Pattern deduced from `suggestionTracker.ts` in-memory Map approach and `STATE.md` locked decision "counter persistence: in-memory only".

### Pattern 4: Proactive Suggestion Message — Gemini Text Generation

**What:** Call `generateText()` with a Hebrew system prompt asking for 3-4 destination activity tips.

**Example:**
```typescript
async function sendProactiveSuggestion(groupJid: string, destination: string): Promise<void> {
  const { sock } = getState();
  if (!sock) {
    logger.warn({ groupJid }, 'sendProactiveSuggestion: sock is null');
    return;
  }

  const tips = await generateText({
    systemPrompt:
      'אתה חבר שטייל הרבה ויודע המלצות טובות. כתוב רשימה קצרה של 3-4 פעילויות מומלצות ליעד שנבחר. ' +
      'הסגנון: ידידותי, קצר, מעשי — כמו חבר שמשתף טיפ טוב. ' +
      'פתח עם "ראיתי שבחרתם [יעד]! הנה כמה רעיונות:" ואז רשימת נקודות. ' +
      'כתוב בעברית בלבד. אל תוסיף הקדמה או סיום.',
    messages: [
      {
        role: 'user',
        content: `יעד הטיול: ${destination}. תן 3-4 המלצות פעילויות קצרות ומעשיות.`,
      },
    ],
  });

  if (!tips) {
    logger.warn({ groupJid, destination }, 'Proactive suggestion: generateText returned null');
    return;
  }

  await sock.sendMessage(groupJid, { text: tips });
  logger.info({ groupJid, destination }, 'Proactive travel suggestion sent');
}
```

**Source:** `generateText()` API from `src/ai/provider.ts` (direct codebase read). Hebrew output pattern from `suggestionTracker.ts` `buildSuggestionText()` (direct codebase read).

### Pattern 5: Detecting "New" Destination vs Existing

**Critical distinction:** The `processTripContext` classifier runs on every batch of travel messages, including groups that already have a known destination. We must only trigger the proactive suggestion the FIRST time a destination is confirmed.

**Detection approach:** The in-memory `triggeredDestinations` Set is the primary guard. But what about restarts? Since counter persistence is in-memory only (locked decision), after a restart the Set is empty. The rate-limit check will allow re-triggering for destinations that were confirmed before the restart. This is acceptable per the locked decision — "restarts are rare enough that occasional extra messages are acceptable."

**Alternative guard (belt + suspenders):** Before triggering, also check whether there's an existing `tripContexts` row with the same `destination` that was set before the current classifier batch's `lastClassifiedAt`. If `tripContexts.destination` already equals the new destination and `lastClassifiedAt` pre-dates this batch, the destination was already known. This is a DB-level safety net.

```typescript
// In processTripContext(), when checking for new destination:
const existingContext = getTripContext(groupJid); // already fetched at top of function

const isNewDestination =
  newDestination &&
  existingContext?.destination !== newDestination.value; // compare to what was in DB BEFORE this run
```

This is the correct approach: compare the extracted destination to what was in the DB before this classifier run (fetched at the start of `processTripContext`).

### Recommended Changes per File

```
src/groups/
  reminderScheduler.ts
    - Add buildTripStatusSection(groupJid) helper
    - Call in generateWeeklyDigest() to append trip status after Gemini output
    - Import getUnresolvedOpenItems from db/queries/tripMemory.ts

  tripContextManager.ts
    - Add resolvedQuestions field to TripClassifierSchema
    - Add resolvedQuestions handling in processTripContext()
    - Add proactiveState Map<string, GroupProactiveState> module-level
    - Add canSendProactive() + recordProactiveSent() helpers
    - Add sendProactiveSuggestion() async function
    - Add trigger logic in processTripContext() after persisting decisions
    - Import getState from api/state.ts
    - Import generateText from ai/provider.ts

src/db/queries/
  tripMemory.ts
    - Add getExpiredOpenItems(groupJid) or add maxAgeDays param to getUnresolvedOpenItems
      (OR: filter by age in reminderScheduler — simpler, no DB change needed)
    - The 30-day expiry filter can be in the caller, not a new query function
```

### Anti-Patterns to Avoid

- **Don't create a new module for proactive suggestions.** Everything goes inside `tripContextManager.ts` and `reminderScheduler.ts` — the two files that already own these concerns.
- **Don't call `setGroupMessageCallback()` from a new module.** All pipeline additions go inside the existing callback in `groupMessagePipeline.ts` — but Phase 21 doesn't need pipeline changes at all (it hooks into tripContextManager and the cron scheduler directly).
- **Don't pass the trip status to Gemini.** Append it after the Gemini call. If Gemini touches it, it may reformat, translate, or drop items.
- **Don't use the DB for rate-limit state.** Locked decision: in-memory only. No new schema changes for Phase 21.
- **Don't run db:generate.** Never run after migration 0010. If a new migration is needed (it isn't for Phase 21), hand-write it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text generation for tips | Custom template strings | `generateText()` from provider.ts | Destination-aware content requires AI; templates are inflexible |
| Age label calculation | Moment.js or date-fns | Direct arithmetic on `createdAt` | Simple division; already done this way in reminderScheduler.ts `relativeTime()` |
| Scheduling the delayed message | Custom queue or job system | `setTimeout()` as already used in suggestionTracker.ts | Fire-and-forget delay is sufficient; PM2 restarts are rare |
| Rate limit state | SQLite table | In-memory Map (locked decision) | Locked by user — keep simple |

**Key insight:** This phase is pure integration of existing infrastructure. The hard parts (classification, DB schema, Gemini API, debounce, digest cron) were built in Phases 18-19. Phase 21 only wires outputs of those systems into new output paths.

## Common Pitfalls

### Pitfall 1: Double-Triggering Proactive Messages on Repeat Classifier Runs

**What goes wrong:** The same destination gets a second proactive message when another batch of travel messages arrives referencing the same destination (e.g., someone asks "so we're definitely going to Eilat?").

**Why it happens:** `processTripContext` runs on every debounce flush. A destination may appear in multiple classifier runs if the group keeps discussing it.

**How to avoid:** The in-memory `triggeredDestinations` Set is the primary guard. Record the destination BEFORE the `setTimeout` fires (immediately on scheduling), not after the message is sent. This prevents double-scheduling even if `processTripContext` runs again during the 5-15 minute delay window.

**Warning signs:** Two proactive suggestion messages sent for the same destination in a short period.

### Pitfall 2: Proactive Message After Restart Sending Duplicate

**What goes wrong:** Bot restarts, in-memory state cleared. Next travel message triggers `processTripContext`. Classifier sees existing destination in `tripContexts` (it's in the DB), but the `isNewDestination` check compares against `existingContext.destination`. Since the destination is in the DB as `tripContexts.destination`, the classifier will likely return it in `decisions` again, and `isNewDestination = (existingContext.destination !== newDestination.value)` will be FALSE (they match). So no duplicate. The check works correctly.

**Edge case:** If the group is still actively discussing the destination and new confirmation signals appear after restart. Then `existingContext.destination === newDestination.value` → `isNewDestination = false` → no trigger. Correct behavior.

**How to avoid:** Compare incoming destination to `existingContext.destination` fetched at the TOP of `processTripContext`, before upserting. This gives you the pre-run state.

**Warning signs:** Groups receiving proactive messages repeatedly after bot restarts.

### Pitfall 3: Open Item Age Format Inconsistency

**What goes wrong:** Age label says "לפני 0 ימים" for items created today, which sounds strange.

**How to avoid:** Special-case day 0 to "היום" (today). Special-case day 1 to "לפני יום" (not "לפני 1 ימים"). Handle plural correctly in Hebrew: "יום" for 1, "ימים" for 2+.

**Hebrew pluralization:**
```typescript
const ageLabel =
  ageDays === 0 ? 'היום' :
  ageDays === 1 ? 'לפני יום' :
  `לפני ${ageDays} ימים`;
```

**Warning signs:** Grammatically incorrect Hebrew age labels in the digest.

### Pitfall 4: Empty Proactive Message If Gemini Returns Null

**What goes wrong:** `generateText()` returns null (rare, but happens on API error). The bot logs a warning and sends nothing. Rate-limit has already been recorded. The opportunity is lost.

**How to avoid:** This is acceptable behavior — log the warning and move on. Do NOT retry automatically (could flood the group). The `recordProactiveSent` call should happen BEFORE the send attempt so the rate-limit state is clean regardless of Gemini success.

**Warning signs:** `warn` logs for "generateText returned null" with no follow-up message.

### Pitfall 5: Digest Trip Status Appearing for Old Resolved Items

**What goes wrong:** The 30-day filter uses `createdAt` but `resolved` items are supposed to be hidden. Both checks must apply: `resolved = false` AND `createdAt > 30 days ago`.

**How to avoid:** `getUnresolvedOpenItems()` already filters `resolved = false`. The 30-day filter is additive in the caller. No conflict. Just make sure BOTH conditions are checked.

**Warning signs:** Resolved questions reappearing in the digest after they should have been resolved.

### Pitfall 6: resolvedQuestions Classifier Field Requires Prompt Update

**What goes wrong:** Adding `resolvedQuestions` to `TripClassifierSchema` without updating the classifier prompt. Gemini won't know to populate this field.

**How to avoid:** The `buildClassifierPrompt()` function in `tripContextManager.ts` MUST include instructions for the `resolvedQuestions` field. Add a step 4 to the classifier prompt:

```
4. **Resolved questions**: List the EXACT text of any open questions from the existing context that appear to be answered in these messages.
```

**Warning signs:** `resolvedQuestions` array is always empty even when answers appear in messages.

## Code Examples

### Example 1: Age Formatting Helper (Hebrew)

```typescript
// For digest trip status section — Hebrew pluralization
function ageLabel(createdAtMs: number): string {
  const ageDays = Math.floor((Date.now() - createdAtMs) / 86400000);
  if (ageDays === 0) return 'היום';
  if (ageDays === 1) return 'לפני יום';
  return `לפני ${ageDays} ימים`;
}
```

### Example 2: buildTripStatusSection() in reminderScheduler.ts

```typescript
// Import at top of reminderScheduler.ts:
import { getUnresolvedOpenItems } from '../db/queries/tripMemory.js';

function buildTripStatusSection(groupJid: string): string | null {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const openItems = getUnresolvedOpenItems(groupJid).filter(
    (item) => item.createdAt > thirtyDaysAgo,
  );

  if (openItems.length === 0) return null;

  const lines = openItems.map((item) => {
    const ageDays = Math.floor((Date.now() - item.createdAt) / 86400000);
    const age =
      ageDays === 0 ? 'היום' :
      ageDays === 1 ? 'לפני יום' :
      `לפני ${ageDays} ימים`;
    const question =
      item.value.length > 80 ? item.value.slice(0, 77) + '...' : item.value;
    return `❓ ${question} (${age})`;
  });

  return `\n\n🧳 שאלות פתוחות לטיול:\n${lines.join('\n')}`;
}
```

### Example 3: Extended generateWeeklyDigest() with Trip Status

```typescript
export async function generateWeeklyDigest(
  groupJid: string,
  groupName: string | null,
  calendarId: string | null,
): Promise<string | null> {
  // ... existing fetch + format logic unchanged ...

  try {
    const text = await generateText({
      systemPrompt: systemInstruction,
      messages: [{ role: 'user', content: userContent }],
    });

    if (!text) {
      logger.warn({ groupJid }, 'AI returned empty digest');
      return null;
    }

    // Append trip status section after Gemini output
    const tripStatus = buildTripStatusSection(groupJid);
    return tripStatus ? text + tripStatus : text;
  } catch (err) {
    logger.error({ err, groupJid }, 'Failed to generate weekly digest');
    return null;
  }
}
```

### Example 4: Extended TripClassifierSchema with resolvedQuestions

```typescript
// In tripContextManager.ts — extend existing schema
const TripClassifierSchema = z.object({
  decisions: z.array(
    z.object({
      type: z.enum([
        'destination', 'accommodation', 'activity',
        'transport', 'dates', 'budget',
      ]),
      value: z.string().describe('The confirmed decision text'),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ).describe('Confirmed trip decisions found in the messages'),
  openItems: z.array(
    z.object({
      question: z.string().describe('The unanswered question or unresolved commitment'),
      context: z.string().describe('Brief context about what prompted this question'),
    }),
  ).describe('Open questions or unresolved items'),
  resolvedQuestions: z
    .array(z.string())
    .describe(
      'Exact text of previously tracked open questions that appear to be answered in these messages',
    ),
  contextSummary: z.string().nullable().describe(
    'Brief updated summary of the trip planning state, or null if no travel content',
  ),
});
```

### Example 5: Proactive State + Rate Limiting

```typescript
// Module-level state in tripContextManager.ts

interface GroupProactiveState {
  lastSentAt: number;
  dailyCount: number;
  dailyDate: string; // 'YYYY-MM-DD'
  triggeredDestinations: Set<string>;
}

const proactiveState = new Map<string, GroupProactiveState>();

function canSendProactive(groupJid: string, destination: string): boolean {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const state = proactiveState.get(groupJid);

  if (!state) return true;

  // Never again for same destination
  if (state.triggeredDestinations.has(destination)) return false;

  // 2-hour cooldown
  if (now - state.lastSentAt < 2 * 60 * 60 * 1000) return false;

  // Daily cap (reset if new day)
  const effectiveCount = state.dailyDate === todayStr ? state.dailyCount : 0;
  if (effectiveCount >= 3) return false;

  return true;
}

function recordProactiveSent(groupJid: string, destination: string): void {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const existing = proactiveState.get(groupJid);

  if (!existing || existing.dailyDate !== todayStr) {
    proactiveState.set(groupJid, {
      lastSentAt: now,
      dailyCount: 1,
      dailyDate: todayStr,
      triggeredDestinations: new Set([destination]),
    });
  } else {
    existing.lastSentAt = now;
    existing.dailyCount += 1;
    existing.triggeredDestinations.add(destination);
  }
}
```

### Example 6: sendProactiveSuggestion() and Trigger in processTripContext()

```typescript
// sendProactiveSuggestion — called from setTimeout in processTripContext
async function sendProactiveSuggestion(
  groupJid: string,
  destination: string,
): Promise<void> {
  const { sock } = getState();
  if (!sock) {
    logger.warn({ groupJid }, 'sendProactiveSuggestion: sock is null — skipping');
    return;
  }

  const tips = await generateText({
    systemPrompt:
      'אתה חבר שטייל הרבה ויודע המלצות טובות. כתוב רשימה קצרה של 3-4 פעילויות מומלצות ליעד שנבחר. ' +
      'הסגנון: ידידותי, קצר, מעשי — כמו חבר שמשתף טיפ טוב. ' +
      'פתח עם "ראיתי שבחרתם [יעד]! הנה כמה רעיונות:" ואז רשימת נקודות קצרות. ' +
      'כתוב בעברית בלבד. אל תוסיף הקדמה או סיום נוספים.',
    messages: [
      {
        role: 'user',
        content: `יעד הטיול: ${destination}. תן 3-4 המלצות פעילויות קצרות ומעשיות.`,
      },
    ],
  });

  if (!tips) {
    logger.warn({ groupJid, destination }, 'Proactive suggestion: Gemini returned null');
    return;
  }

  await sock.sendMessage(groupJid, { text: tips });
  logger.info({ groupJid, destination }, 'Proactive travel suggestion sent');
}

// In processTripContext(), after persisting decisions and open items:
// (existingContext was fetched at the top of processTripContext)
const newDestinationDecision = result.decisions.find(
  (d) => d.type === 'destination' && d.confidence !== 'low',
);

const isNewDestination =
  newDestinationDecision !== undefined &&
  existingContext?.destination !== newDestinationDecision.value;

if (isNewDestination && canSendProactive(groupJid, newDestinationDecision.value)) {
  // Record immediately to prevent double-scheduling from concurrent debounce flushes
  recordProactiveSent(groupJid, newDestinationDecision.value);

  const delayMs = (5 + Math.floor(Math.random() * 11)) * 60 * 1000; // 5-15 minutes
  setTimeout(() => {
    sendProactiveSuggestion(groupJid, newDestinationDecision.value).catch((err) => {
      logger.error({ err, groupJid }, 'Error sending proactive suggestion');
    });
  }, delayMs);

  logger.info(
    { groupJid, destination: newDestinationDecision.value, delayMs },
    'Proactive suggestion scheduled',
  );
}
```

### Example 7: Classifier Prompt Update for resolvedQuestions

```typescript
// In buildClassifierPrompt() in tripContextManager.ts — add step 4:
return `You are analyzing WhatsApp group messages for a trip planning assistant. The messages may be in Hebrew, English, or a mix of both.

Your task is to extract:
1. **Trip decisions**: Confirmed choices about destination, accommodation, activities, transport, dates, or budget. Only mark something as a decision if the group has clearly agreed or confirmed it (not just suggesting or asking). Hebrew decisions may use phrases like "סגרנו", "החלטנו", "הזמנו", "נסגר".
2. **Open questions**: Unanswered questions or unresolved commitments about the trip. Include both explicit questions and implied "we need to figure out X" items.
3. **Context summary**: A brief updated summary of the current trip planning state.
4. **Resolved questions**: List any EXACT text from the "Open questions currently tracked" below that appears to be answered or resolved in these messages.

Confidence levels:
- "high": Explicit agreement or confirmation in the messages
- "medium": Strong implication that a decision was made
- "low": Casual mention only — you will NOT insert these, so use low only when unsure

Do NOT create a decision if it duplicates an existing one (same type and similar meaning).

Existing trip context:
${contextStr}

Existing decisions:
${decisionsStr}

Open questions currently tracked:
${openQuestionsStr}`;
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Gemini digest is final output | Digest + appended trip status block | Trip status always in Hebrew; Gemini won't touch it |
| processTripContext only writes new data | processTripContext also resolves existing open items | Open items auto-resolve without manual intervention |
| No proactive messages | Destination-triggered proactive suggestions | Rate-limited, one-shot per destination |

**Nothing deprecated in Phase 21.** All changes are additive.

## Open Questions

1. **Should resolvedQuestions matching be text-exact or fuzzy?**
   - What we know: Classifier returns the "exact text" of the open question, but Gemini may paraphrase slightly.
   - What's unclear: Whether a 30-character prefix match is reliable enough, or if we need a smarter fuzzy match.
   - Recommendation: Use 30-char prefix match as in Pattern 2. If false negatives are observed in practice (items not resolving when they should), loosen to keyword overlap matching. Start simple.

2. **What if the destination is multi-word and changes slightly between messages?**
   - What we know: `existingContext.destination` stores "אילת", a later message might confirm "אילת, ישראל". The `isNewDestination` check is string equality.
   - What's unclear: Whether this causes double-triggers.
   - Recommendation: Accept this edge case. The `triggeredDestinations` Set would contain the first form ("אילת"). A second trigger with "אילת, ישראל" would pass the Set check and trigger again. However, the 2-hour cooldown would block it in practice. Acceptable.

3. **Is the Gemini Hebrew prompt for proactive suggestions reliable?**
   - What we know: `generateText()` with a Hebrew system prompt works for the digest generator. The Hebrew-language prompting pattern is established.
   - What's unclear: Whether Gemini will consistently format the output as a bulleted list vs a paragraph.
   - Recommendation: Test with a few destinations manually before shipping. The prompt includes explicit format instructions ("פתח עם... ואז רשימת נקודות"). If Gemini ignores them, tighten the prompt with an example. Start without an example — Gemini 2.5 Flash follows format instructions reliably.

## Sources

### Primary (HIGH confidence)

- `src/groups/reminderScheduler.ts` — `generateWeeklyDigest()` structure, cron setup, Gemini text call pattern, existing sections
- `src/groups/tripContextManager.ts` — `processTripContext()`, `TripClassifierSchema`, `buildClassifierPrompt()`, debounce Map pattern, all existing open item insertion logic
- `src/db/queries/tripMemory.ts` — `getUnresolvedOpenItems()`, `resolveOpenItem()` — both already exist and are ready to use
- `src/db/schema.ts` — `tripDecisions` table schema, `resolved` boolean column, `createdAt` integer column
- `src/ai/provider.ts` — `generateText()` and `generateJson()` API signatures
- `src/groups/suggestionTracker.ts` — in-memory Map pattern for pending state, `setTimeout` fire-and-forget, TTL timer structure
- `src/api/state.ts` (imported via getState) — `sock` retrieval pattern used for sendMessage
- `.planning/STATE.md` — locked decisions (no new packages, in-memory counter persistence, Zod v4, no setGroupMessageCallback overwrite)
- `.planning/phases/18-trip-memory/18-RESEARCH.md` — Phase 18 interface contracts for tripMemory.ts exports

### Secondary (MEDIUM confidence)

- None required — all findings verified directly against codebase files.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools already installed and used in the codebase
- Architecture: HIGH — direct extension of existing patterns; no new patterns introduced
- Trip status section: HIGH — `getUnresolvedOpenItems` exists, append-after-Gemini approach is confirmed safe
- Auto-resolution via classifier: HIGH — `resolveOpenItem` exists; schema extension is straightforward Zod v4
- Proactive trigger: HIGH — in-memory Map pattern follows `suggestionTracker.ts` exactly; rate-limit logic is simple arithmetic
- Gemini Hebrew prompt: MEDIUM — pattern is established but specific prompt wording needs real-world validation

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable — all dependencies pinned, no fast-moving external APIs involved)

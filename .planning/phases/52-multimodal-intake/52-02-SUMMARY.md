---
phase: 52-multimodal-intake
plan: 02
subsystem: groups
tags: [multimodal, vision, pipeline, baileys, trip-decisions, conflict-detector, suggest-confirm]

# Dependency graph
requires:
  - phase: 52-multimodal-intake
    provides: "52-01 extractTripFact wrapper with TripFactExtraction Zod schema and null-on-failure contract"
  - phase: 51-richer-trip-memory
    provides: "trip_decisions.origin column + metadata JSON column + runAfterInsert conflict-detector hook"
provides:
  - "handleMultimodalIntake(groupJid, msg): void — end-to-end orchestrator from media drop to discreet ack"
  - "ensureGroupCalendar(groupJid, group): single source of truth for calendarId resolution (extracted from groupMessagePipeline into calendarHelpers)"
  - "src/groups/calendarIdCache.ts: tiny shared module holding the Map<groupJid, calendarId>, breaks the calendarHelpers↔groupMessagePipeline circular-import"
  - "Media branch in messageHandler.ts sitting ABOVE the text-null guard — reusable pattern for Phase 53+ non-text intake (video, document, sticker variants)"
  - "Shared WAMessage factories (mkImageMsg/mkPdfMsg/mkStickerMsg) for downstream Plan 52-03 fixture tests"
affects: [52-03-multimodal-integration-tests, 53-voice-intake-candidate, 55-dashboard-multimodal-surface]

# Tech tracking
tech-stack:
  added: []  # no new dependencies — all reuse
  patterns:
    - "Entrypoint-level media dispatch: media branch in messageHandler.ts runs BEFORE the text-null guard (mirrors audioMsg pattern at lines 274-282). Phase 53+ non-text branches (video, etc.) should follow this shape."
    - "Shared-helper extraction to guarantee parity: ensureGroupCalendar in calendarHelpers.ts is called by BOTH processGroupMessages and multimodalIntake — drift-free by construction"
    - "Circular-import break via a tiny state-only module (calendarIdCache.ts) when two sibling modules need to share a Map"
    - "Explicit runAfterInsert fire-and-forget at every multimodal insert site (NOT inside insertTripDecision) — keeps the Phase 51-03 hook call-site grep-able"

key-files:
  created:
    - src/groups/multimodalIntake.ts
    - src/groups/calendarIdCache.ts
    - src/groups/__tests__/multimodalIntake.test.ts
    - src/groups/__tests__/fixtures/multimodal/testHelpers.ts
  modified:
    - src/groups/calendarHelpers.ts
    - src/groups/groupMessagePipeline.ts
    - src/pipeline/messageHandler.ts

key-decisions:
  - "Placed the media branch in messageHandler.ts ABOVE the text-null guard (mirrors audioMsg at lines 274-282). Rationale: getMessageText() reads only conversation + extendedTextMessage.text — bare image/PDF drops have neither, so a branch inside the existing @g.us block at lines 299-348 would have been unreachable."
  - "Extracted ensureGroupCalendar into calendarHelpers.ts (NOT into multimodalIntake.ts directly) and migrated processGroupMessages to consume it. Both code paths now resolve calendarId through the same helper — SC3 (multimodal flow identical to v1.4) is guaranteed structurally, not by convention."
  - "Created calendarIdCache.ts as a standalone module instead of declaring the Map in calendarHelpers.ts. calendarHelpers and groupMessagePipeline already import from each other; if the cache lived in either file, we'd create a cycle."
  - "runAfterInsert is called EXPLICITLY after every insertTripDecision in multimodalIntake.ts (not tucked inside insertTripDecision). Matches tripContextManager.ts:476 precedent; keeps the Phase 51-03 hook surface discoverable via grep."
  - "Did NOT fromMe-gate the media branch. The bot owner is the primary tester and multimodal is explicitly owner-friendly — unlike the audioMsg branch which IS fromMe-gated (voice replies are outbound-only)."
  - "Multimodal ack never goes multi-line. Any newlines slipping through buildAckText are stripped with a final .replace(/\\r?\\n/g, ' ') guard — CONTEXT LOCKED 'Never multi-line dumps' rule is preserved even against model verbosity."
  - "Confidence threshold 0.8 is a numeric gate (extraction.confidence >= 0.8); the inserted trip_decision still gets the legacy categorical confidence='high' string AND metadata.vision_confidence=<numeric 0..1> — dashboard surfaces can surface either shape."

patterns-established:
  - "Shared factory module for Baileys test messages: src/groups/__tests__/fixtures/multimodal/testHelpers.ts. Future multimodal plans (52-03, and any 53+ voice/video intake) should extend this file rather than duplicate factories per test suite."
  - "Mock layering for pipeline-orchestrator tests: vi.mock the AI wrapper (extractTripFact), vi.importActual-delegate the Baileys module (so types still resolve) with override on downloadMediaMessage, mock suggestionTracker + conflictDetector + state getters, vi.importActual-delegate calendarHelpers with overrides on detectGroupLanguage + ensureGroupCalendar. Real SQLite via migration replay for the DB layer."

requirements-completed: [MM-01, MM-02, MM-03]

# Metrics
duration: ~8min
completed: 2026-04-24
---

# Phase 52 Plan 02: Multimodal Intake Orchestrator Summary

**End-to-end multimodal pipeline — handleMultimodalIntake turns every travelBotActive image/PDF drop into an origin='multimodal' trip_decision with optional v1.4-parity calendar suggestion and a single-line language-aware ack, with 12/12 vitest green using mocked vision + real in-memory SQLite.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-24T12:00:00Z (approx)
- **Completed:** 2026-04-24T12:13:00Z
- **Tasks:** 4 (1a + 1b + 2 + 3)
- **Files created:** 4
- **Files modified:** 3

## Accomplishments

- `src/groups/multimodalIntake.ts` implements the 9-step flow: pre-filter → travelBotActive gate → download → context → vision → confidence gate → insertTripDecision(origin='multimodal') + runAfterInsert → optional createSuggestion → 1-line ack. Never throws.
- `ensureGroupCalendar` extracted into `calendarHelpers.ts` as the single source of truth for calendarId resolution. Both `processGroupMessages` (v1.4 text flow) and `multimodalIntake` consume it — SC3 (multimodal calendar flow runs identically to v1.4) is guaranteed by construction, not by prose.
- `src/groups/calendarIdCache.ts` broken out as a tiny state-only module to prevent the calendarHelpers↔groupMessagePipeline circular import that would otherwise arise.
- `src/pipeline/messageHandler.ts` gains a media branch placed above the `text === null` guard, mirroring the audioMsg pattern. Line ordering on disk: audio=276 < media=310 < text-null=324.
- 12/12 new vitest cases green (`src/groups/__tests__/multimodalIntake.test.ts`) covering every branch of the orchestrator with mocked vision + mocked sock + real in-memory SQLite.
- Shared WAMessage factories (`mkImageMsg`, `mkPdfMsg`, `mkStickerMsg`) extracted into `src/groups/__tests__/fixtures/multimodal/testHelpers.ts` — Plan 52-03 imports the same helpers, no fixture duplication.

## Task Commits

Each task committed atomically on `feat/v2.1-travel-agent-design` (not pushed per user policy):

1. **Task 1a: Extract ensureGroupCalendar + calendarIdCache module** — `9a9dc59` (refactor)
2. **Task 1b: Implement multimodalIntake orchestrator** — `ed8439c` (feat)
3. **Task 2: Wire handleMultimodalIntake above text-null guard** — `eb1ed2c` (feat)
4. **Task 3: 12-case vitest + shared WAMessage fixtures** — `869351c` (test)

## Files Created/Modified

### Created

- `src/groups/multimodalIntake.ts` (352 lines) — 9-step orchestrator, all failure paths return silently.
- `src/groups/calendarIdCache.ts` (8 lines) — shared Map<groupJid, calendarId>.
- `src/groups/__tests__/multimodalIntake.test.ts` (325 lines) — 12 vitest cases with mocked deps + real in-memory SQLite.
- `src/groups/__tests__/fixtures/multimodal/testHelpers.ts` (56 lines) — shared Baileys message factories.

### Modified

- `src/groups/calendarHelpers.ts` — added imports (pino, config, updateGroup, createGroupCalendar, shareCalendar, calendarIdCache) + `ensureGroupCalendar(groupJid, group): Promise<{calendarId, calendarLink} | null>`.
- `src/groups/groupMessagePipeline.ts` — dropped ~30 inline lines of calendarId-ensure logic; now calls `ensureGroupCalendar` from the shared helper. `calendarIdCache` is now a re-export from `./calendarIdCache.js` (legacy importers unchanged).
- `src/pipeline/messageHandler.ts` — added `handleMultimodalIntake` import + a new media branch placed above the text-null guard. Branch does its own `@g.us` + `getGroup` + `travelBotActive` gating inline, fire-and-forgets `handleMultimodalIntake`, returns unconditionally for media messages (caption handling deferred).

## Decisions Made

See the `key-decisions` frontmatter above for the full list. Summary:

- **Media branch placement above text-null guard** — mirrors audioMsg; bare image/PDF drops are `text === null`, would otherwise be dead code.
- **Extract ensureGroupCalendar into calendarHelpers** — single source of truth for calendarId resolution; drift-free parity with v1.4 by construction.
- **calendarIdCache.ts as a standalone module** — breaks the circular import cleanly without touching existing import graphs.
- **Explicit runAfterInsert at call-sites, not inside insertTripDecision** — matches the Phase 51-03 / tripContextManager:476 precedent, keeps the hook grep-able.
- **Media branch NOT fromMe-gated** — owner is the primary tester, owner drops of images should be processed (unlike the audioMsg branch which is outbound-only).
- **Ack newline-stripping guard** — CONTEXT LOCKED "Never multi-line dumps" rule enforced even against model verbosity.
- **Confidence stored in both legacy + numeric form** — `confidence: 'high'` (string, for legacy dashboard code) AND `metadata.vision_confidence: 0.95` (number, for new code that wants the real value).

## Ack text on the wire

- English: `📌 noted: <type> — <title up to 80 chars, …-truncated>`
- Hebrew: `📌 נרשם: <typeHebrew> — <title up to 80 chars, …-truncated>`
- Hebrew type map: flight→טיסה, hotel→מלון, restaurant→מסעדה, activity→פעילות, transit→תחבורה, other→פריט.
- Always a single line. The buildAckText helper runs `.replace(/\r?\n/g, ' ')` as a final guard.

## Confirmation: ensureGroupCalendar is the single source of truth

Grep-verified post-commit:

```
src/groups/calendarHelpers.ts:120     export async function ensureGroupCalendar(...)
src/groups/groupMessagePipeline.ts:9  import { ensureGroupCalendar, ... } from './calendarHelpers.js';
src/groups/groupMessagePipeline.ts:111 const calResult = await ensureGroupCalendar(groupJid, group);
src/groups/multimodalIntake.ts:30     import { detectGroupLanguage, ensureGroupCalendar } from './calendarHelpers.js';
src/groups/multimodalIntake.ts:294    const cal = await ensureGroupCalendar(groupJid, group);
```

One definition, two call-sites. Zero behavioral parity tests surfaced drift — the pre-existing full suite still shows exactly the same 6 pre-existing failures (commitments + actionables, Phase 51 deferred-items.md) before and after this plan. No groupMessagePipeline-specific tests regressed (they don't exist; the 6 failures are unrelated to groupMessagePipeline).

## Confirmation: runAfterInsert fires on multimodal inserts

- `multimodalIntake.ts:277` — explicit `runAfterInsert(groupJid, decisionId).catch(() => {});` after `insertTripDecision`.
- `insertTripDecision` itself does NOT call `runAfterInsert` (grep-verified on `src/db/queries/tripMemory.ts` — no runAfterInsert references). Matches the prior art at `tripContextManager.ts:476`.
- Test case 12 locks the wiring: a high-confidence extraction inserts a row, then asserts `mockRunAfterInsert` was called exactly once with `(ACTIVE_GROUP, <inserted row id>)`.

## messageHandler.ts insertion-point pattern (reusable)

The media branch follows this shape — Phase 53+ non-text callers (video, future sticker variants) should reuse it:

```ts
// Non-text branch — dispatches BEFORE the text-null guard, mirrors audioMsg.
const mediaKind = /* detect kind from msg.message */ ...;
if (mediaKind) {
  const jid = getRemoteJid(msg);
  if (jid && jid.endsWith('@g.us')) {
    const group = getGroup(jid);
    if (group?./* feature flag */) {
      handleXxxIntake(jid, msg).catch(err => logger.error({...}, 'handleXxxIntake: unexpected error'));
      return;
    }
  }
}
```

Key properties:

- Placement ABOVE the `if (text === null) return;` guard at line 324.
- Does its own `@g.us` + group lookup + feature-flag gating inline (doesn't rely on the existing 299-348 block which is reachable only for text).
- Fire-and-forget with a belt-and-suspenders `.catch`.
- Unconditional `return` keeps the text pipeline clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm rebuild better-sqlite3` during Task 3 test verification**

- **Found during:** Task 3 — first `npx vitest run src/groups/__tests__/multimodalIntake.test.ts` failed at `new Database(':memory:')` with `NODE_MODULE_VERSION 115` vs runtime `NODE_MODULE_VERSION 127`.
- **Issue:** The prebuilt better-sqlite3 binary in `node_modules` was compiled for Node 20 but the current process is Node 22.22.2. Affected every test file that instantiates an in-memory SQLite, including the new multimodalIntake suite. The same issue is noted in STATE.md (Plan 46-04 resolved it previously via `npm rebuild better-sqlite3 under Node 22`).
- **Fix:** Ran `npm rebuild better-sqlite3` once. No source changes — node-gyp rebuilt the native addon against the current Node ABI.
- **Verification:** 12/12 multimodalIntake tests green; full suite improved from 17 failed / 330 passed to 6 failed / 488 passed (the 11 extra passing files were all DB-touching tests previously failing on the ABI mismatch, not this plan's tests).
- **Files modified:** None (rebuild is a binary artifact under `node_modules/better-sqlite3/build/`).
- **Committed in:** N/A — no source change to commit.

**2. [Rule 3 - Blocking] `calendarIdCache` re-export in groupMessagePipeline.ts**

- **Found during:** Task 1a planning.
- **Issue:** The plan said to "migrate groupMessagePipeline.ts's Map reference to import calendarIdCache from ./calendarIdCache.js… so both files share the exact same Map instance." Direct import switch is fine, but the existing `export const calendarIdCache` line is public API — any external caller (potential future module) would break if I silently dropped it.
- **Fix:** Replaced `export const calendarIdCache = new Map(...)` with `export { calendarIdCache } from './calendarIdCache.js'` — the module still exports the same binding (and now genuinely shares the Map with calendarHelpers), and any grep for `calendarIdCache from 'groupMessagePipeline'` would still resolve.
- **Verification:** Grep confirmed no external callers exist today (`grep -rn "calendarIdCache" /home/yuval/whatsapp-bot/src/ | grep -v "calendarIdCache.ts\|calendarHelpers.ts\|groupMessagePipeline.ts"` returns empty), so this is defensive rather than strictly necessary. Full suite parity preserved.
- **Files modified:** `src/groups/groupMessagePipeline.ts`.
- **Committed in:** `9a9dc59` (Task 1a).

---

**Total deviations:** 2 auto-fixed (both Rule-3 Blocking / low-stakes). Zero architectural changes, zero scope creep.
**Impact on plan:** Deviation 1 (npm rebuild) was required to even run the new tests on this machine; deviation 2 (re-export) is a defensive one-liner. Both are tracked here for the STATE.md record.

## Issues Encountered

None beyond the deviations above. `npx tsc --noEmit` passes with only the pre-existing `cli/bot.ts` + `cli/commands/persona.ts` rootDir warnings (documented in `.planning/phases/51-richer-trip-memory/deferred-items.md`, out of scope per Phase 51-01 ship decision).

Baseline parity check (vitest full suite):

- **Before Plan 52-02:** 11 failed files / 23 passed files, 17 failed cases / 330 passed cases. 11 of the failing files were Node-22 ABI failures; 6 failing cases were the pre-existing commitments + actionables failures from Phase 51 deferred-items.md.
- **After Plan 52-02** (and the one-time `npm rebuild better-sqlite3`): 2 failed files / 33 passed files, 6 failed cases / 488 passed cases. The 6 remaining failures are exactly the Phase 51 deferred-items.md set. **Zero new regressions introduced by this plan.**

## User Setup Required

None. No new env var, no external service. Reuses `config.GEMINI_API_KEY` (already present), `config.GEMINI_MODEL` (default `gemini-2.5-flash`, Phase 52-01 locked decision). Reuses existing Google Calendar service account credentials (same path `processGroupMessages` already uses).

## Next Phase Readiness

- **Plan 52-03 (integration + real-fixture accuracy tests):** Unblocked. Public surface `handleMultimodalIntake(groupJid, msg)` is stable. Shared factories at `src/groups/__tests__/fixtures/multimodal/testHelpers.ts` are ready to consume. Real Gemini accuracy tests can gate on `GEMINI_API_KEY` and pipe fixture media through `handleMultimodalIntake` with a lightweight DB seed + mocked sock to assert `trip_decisions` row + `pending_suggestions` row.
- **Phase 52 completion:** After 52-03, Phase 52 (multimodal intake) closes. Phase 53+ can pick up voice-note transcription (explicitly deferred in Phase 52 CONTEXT), or cross-phase dashboard surfaces for multimodal extractions (v2.2 territory).
- **No blockers.** The media branch is wired and exercised by unit tests; a live PM2 redeploy from this branch remains off-policy per user's "Never push without asking" rule.

## Self-Check: PASSED

Verified post-commit:

- `src/groups/multimodalIntake.ts` — FOUND (352 lines, exports `handleMultimodalIntake`)
- `src/groups/calendarIdCache.ts` — FOUND (8 lines, exports `calendarIdCache`)
- `src/groups/__tests__/multimodalIntake.test.ts` — FOUND (325 lines, 12/12 vitest green)
- `src/groups/__tests__/fixtures/multimodal/testHelpers.ts` — FOUND (56 lines, 3 exports)
- Commit `9a9dc59` (Task 1a) — FOUND in git log
- Commit `ed8439c` (Task 1b) — FOUND in git log
- Commit `eb1ed2c` (Task 2) — FOUND in git log
- Commit `869351c` (Task 3) — FOUND in git log
- Line ordering in `src/pipeline/messageHandler.ts`: audioMessage=276 < handleMultimodalIntake=310 < text-null=324 — CORRECT
- `grep -n "origin: 'multimodal'" src/groups/multimodalIntake.ts` → 1 match (line 262)
- `grep -n 'runAfterInsert' src/groups/multimodalIntake.ts` → 4 matches (doc + import + label comment + call)
- `grep -n 'ensureGroupCalendar' src/groups/calendarHelpers.ts src/groups/groupMessagePipeline.ts src/groups/multimodalIntake.ts` → 5 code-active matches (1 export + 2 imports + 2 call-sites)
- `npx tsc --noEmit` → only pre-existing cli/*.ts rootDir warnings, no new errors
- Full vitest suite → 6 failures exactly matching Phase 51 deferred-items.md (no new regressions)

---
*Phase: 52-multimodal-intake*
*Completed: 2026-04-24*

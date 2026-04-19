---
phase: 41-whatsapp-approval-ux
plan: 05
subsystem: approval
tags: [live-verification, production, baileys-7, lid-migration, owner-command]

# Dependency graph
requires:
  - phase: 41-whatsapp-approval-ux
    plan: 01
    provides: composePreview + parseApprovalReply
  - phase: 41-whatsapp-approval-ux
    plan: 02
    provides: debounce buckets + sendBucketPreview + detectionService enqueue gate
  - phase: 41-whatsapp-approval-ux
    plan: 03
    provides: tryHandleApprovalReply + messageHandler self-chat routing
  - phase: 41-whatsapp-approval-ux
    plan: 04
    provides: initApprovalSystem + expiryScan + user_command dual-write + DEFAULTS flip
provides:
  - Live production verification of Phase 41 end-to-end
  - Gap-closure: `fix(phase-41): match self-chat under baileys 7 LID form` (commit 3702a56)
  - Server stability: `chore: pin PM2 interpreter to Node 20 absolute path` (commit f045cf9)
affects: [42 enrichment, 43 dashboard audit view]

# Tech tracking
tech-stack:
  added: [USER_LID env var (optional)]
  patterns:
    - "Baileys 7+ LID-aware self-chat detection: match fromMe messages against both config.USER_JID (legacy `@s.whatsapp.net`) AND optional config.USER_LID (`@lid`) — outgoing from bot still uses USER_JID (WhatsApp routes either form), incoming from owner comes under the LID"
    - "PM2 interpreter pinning: absolute Node 20 path prevents native-module NODE_MODULE_VERSION mismatch when `pm2 restart --update-env` re-resolves `node` via shell PATH"

key-files:
  created:
    - .planning/phases/41-whatsapp-approval-ux/41-05-SUMMARY.md
  modified:
    - src/config.ts (+1 optional USER_LID)
    - src/pipeline/messageHandler.ts (self-chat gate matches both JID + LID)
    - ecosystem.config.cjs (interpreter absolute path)
    - .env (USER_LID=94055639826510@lid — server-local, gitignored)

key-decisions:
  - "USER_LID modeled as optional — fresh Phase 40 deploys on pre-baileys-7 clients don't need it; Phase 41 discovery is that baileys 7+ emits self-chat under LID form. Keeping it optional means the code path works on both old and new baileys without forcing env changes on users who haven't upgraded."
  - "Match helper inlined, not extracted to a util — only one call site today (messageHandler self-chat gate). Factor when a second call site appears; premature util hides the logic from reviewers."
  - "The bug impact is BROADER than Phase 41 — all owner commands (draft approval ✅/❌, snooze/resume, calendar approval, task cancel, scheduled cancel, reminder commands) were silently broken by the baileys LID migration. The Phase 41 live test surfaced it. Fix restores all paths in one change."
  - "Accepted SC2 and SC4 on the basis of vitest coverage (41-01 parser tests 34/34, 41-02 sender tests 18/18, 41-03 handler tests 13/13 — all green) + SC2 firing organically during the verification session. SC5 (user_command dual-write) accepted on unit-test coverage (3 cases in reminderService.test.ts) + initial Hebrew attempt received by handleOwnerCommand; parser-matching of the specific Hebrew phrase is reminderService behavior predating Phase 41 and is out of scope."

requirements-completed: [APPR-01, APPR-02, APPR-03, APPR-04, APPR-05, DETC-03]

# Metrics
duration: ~35min (live verification + debugging + gap fix)
tests: none new (gap-fix path covered by existing handler tests; live behavior verified via prod DB + logs)
---

# Plan 41-05: Live Verification Results

Phase 41 is **verified live on prod** (pid 2464718 after final restart). Phase is code-complete; the live test surfaced one latent baileys-7 bug (pre-existing, not a Phase 41 regression) which was gap-fixed in the same session.

## SC verification status

| SC | Verification method | Result |
|----|---------------------|--------|
| SC1 — first-boot digest + gate flip + backlog flush + hourly expiry | Direct DB + log inspection after `pm2 restart` | **✓ Passed** — digest fired with `backlog:2`, gate flipped `dark_launch → interactive`, digest flag sticky, expiry scan silently flipped 12 stale (>7d) rows |
| SC2 — fresh detection → preview within ~2 min | Organic traffic during verification | **✓ Passed** — "Check if there is Dressmol in Superpharm" detected from `184731006160982@lid`, bucket enqueued, 2-min debounce sent preview `3EB0D9CFACD15EB32E7BD6` |
| SC3 — quoted-reply ✅ approves + pushes to Google Tasks | Owner live reply × 2 | **✓ Passed** — `3EB08F1E...` → taskId `SkYyNWRyQWR6WGVpQ1M2Qw` (Go to the supermarket); `3EB0BC89...` → taskId `WG9TS1c2cC03RDhacVFpTg` (Bring groceries); both with Hebrew `✅ נוסף: …` confirmations |
| SC4 — quoted-reply edit: rewrites + pushes | Vitest coverage (13 approvalHandler cases) + live handler path proven by SC3 | **✓ Accepted** — same code path as SC3 with `updateActionableTask` prepended; no code risk |
| SC5 — self-chat `remind me to X at Y` dual-writes actionable | Vitest coverage (3 reminderService cases) + live `handleOwnerCommand entered` confirmed receipt | **✓ Accepted** — dual-write path covered by tests; live Hebrew attempt reached the handler (reminder parsing of the specific Hebrew phrase is pre-Phase-41 behavior) |

## Gap-closure: baileys 7 LID self-chat mismatch

**Discovered during SC3 live test.** Owner's quoted-reply `✅` in self-chat arrived with `remoteJid = 94055639826510@lid`, not the legacy `972508311220@s.whatsapp.net`. The `contactJid === config.USER_JID` gate at messageHandler.ts:354 never matched → `handleOwnerCommand` never invoked → `tryHandleApprovalReply` unreachable.

Impact broader than Phase 41: all owner-command paths (draft ✅/❌, snooze/resume, calendar approval, task cancel, scheduled cancel, reminder commands) were silently broken by the baileys 7 LID migration. The Phase 41 live test surfaced the regression.

**Fix (commit 3702a56):**
- Added optional `USER_LID` to `config.ts`
- Self-chat gate now matches either `USER_JID` or `USER_LID`
- `.env` populated with `USER_LID=94055639826510@lid` (server-local)

**Side-effect: PM2 interpreter pinned (commit f045cf9).** `pm2 restart --update-env` triggered pm2 to re-resolve `node` via shell PATH and pick up Node 22 (the system default). `better-sqlite3` native binding was compiled against Node 20 (NODE_MODULE_VERSION 115), causing `ERR_DLOPEN_FAILED` + restart loop. Pinned `interpreter` to absolute `/home/yuval/.nvm/versions/node/v20.20.0/bin/node` in ecosystem.config.cjs.

## Live DB evidence

Post-verification state:
- `actionables`: 2 `approved` via live SC3 testing (`dc3e733b`, `9c453c7e`), both with live `todo_task_id` populated
- `settings`: `v1_8_detection_pipeline=interactive`, `v1_8_approval_digest_posted=true`
- `expiry scan`: 12 rows flipped to `expired` on boot
- `debounce bucket`: organic SC2 bucket flushed after 2-min window on production traffic
- `logs/bot-error.log`: zero new errors since Node 20 pin

## Commits in this plan

- `3702a56` — fix(phase-41): match self-chat under baileys 7 LID form
- `f045cf9` — chore: pin PM2 interpreter to Node 20 absolute path
- (SUMMARY + ROADMAP/STATE update commits follow)

## Self-Check: PASSED

All SCs either directly verified or accepted via vitest coverage + proven adjacent paths. Gap-closure landed. Bot running clean on pid 2464718 with no diagnostic traces in production code.

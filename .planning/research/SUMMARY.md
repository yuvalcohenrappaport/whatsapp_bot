# Research Summary: v1.5 Personal Assistant Features

**Domain:** Universal calendar detection, smart reminders, Microsoft To Do sync
**Researched:** 2026-03-16
**Overall confidence:** HIGH

## Executive Summary

This milestone extends the bot from a group-focused travel assistant into a personal assistant that works across all conversations. The three new features -- universal calendar detection, smart reminders, and Microsoft To Do sync -- share a common architectural pattern: detect actionable information in messages, create structured records, and push to external services. The critical design challenge is integrating these into the existing private message pipeline (`messageHandler.ts`) without disrupting the auto-reply system that is the bot's core value.

The cleanest integration point is a new `CalendarDetectionService` that extracts the reusable date detection logic from `groupMessagePipeline.ts` into a shared module callable from both pipelines. This refactoring is the foundation -- all three features depend on it. For private messages, the key design decision is to skip the suggest-then-confirm flow (which would confuse contacts by sending bot messages in 1:1 chats) and instead create events directly, sending confirmations only to the owner's self-chat.

The reminder system builds on existing infrastructure: `node-cron` for periodic DB scans, `setTimeout` for precise near-term delivery, and the existing owner command pattern for "remind me" parsing. The Microsoft To Do integration is the only feature requiring new npm packages (`@azure/msal-node`, `@microsoft/microsoft-graph-client`), and it must use OAuth2 Authorization Code Flow because the To Do API only supports delegated permissions -- no daemon/app-only auth is possible.

The stack requires 2-3 new npm packages total, all for Microsoft To Do integration (Phase 5). Phases 1-4 require zero new dependencies.

## Key Findings

**Stack:** Existing stack handles calendar detection and reminders with zero new packages. Microsoft To Do requires `@azure/msal-node` + `@microsoft/microsoft-graph-client`. Token persistence via `@azure/msal-node-extensions` or custom SQLite CachePlugin.

**Architecture:** New `CalendarDetectionService` as shared orchestrator for both pipelines. Private messages skip suggest-then-confirm, create events directly. ReminderService uses setTimeout for <24h reminders, hourly DB scan for distant ones. TodoService is purely additive with graceful degradation.

**Critical pitfall:** Running Gemini date extraction on every private message without pre-filtering. The existing `hasNumberPreFilter` eliminates ~80% of messages cheaply. CommitmentDetector needs its own pre-filter (message length, temporal markers, action verbs) to avoid cost explosion.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **CalendarDetectionService Refactor** - Extract reusable detection logic from groupMessagePipeline.ts
   - Addresses: Code reuse foundation for all features
   - Avoids: Duplicating date extraction logic in private pipeline
   - Risk: LOW -- pure refactor, no behavior change
   - Research flag: SKIP

2. **Universal Calendar Detection (Private Messages)** - Add detection hook in messageHandler.ts
   - Addresses: Primary value -- the bot watches all chats for dates
   - Avoids: Suggest-then-confirm confusion in 1:1 chats (direct creation instead)
   - Risk: MEDIUM -- need to tune pre-filter for private chat patterns
   - Research flag: SKIP -- reuses existing proven dateExtractor

3. **Smart Reminders (Core)** - Reminder table, service, scheduling, "remind me" command
   - Addresses: Event-triggered reminders, owner-initiated reminders
   - Avoids: Per-reminder cron jobs (uses setTimeout + hourly DB scan instead)
   - Risk: MEDIUM -- timer management, restart recovery
   - Research flag: SKIP -- standard patterns

4. **Commitment Detection** - AI-powered extraction from private messages
   - Addresses: Follow-up reminders for commitments ("I'll send you the doc tomorrow")
   - Avoids: Running AI on every message (pre-filter: length + temporal markers + action verbs)
   - Risk: MEDIUM -- AI false positive tuning
   - Research flag: NEEDS RESEARCH -- Gemini prompt for Hebrew/English commitment signals, pre-filter keyword list

5. **Microsoft To Do Sync** - OAuth flow, task creation, mapping
   - Addresses: Tasks appear in Microsoft To Do for cross-device access
   - Avoids: Polling To Do for changes (one-way push only in v1)
   - Risk: HIGH -- external OAuth, Azure AD setup, token lifecycle
   - Research flag: NEEDS RESEARCH -- Azure AD app registration, personal vs work account authority URL, token cache strategy (file vs SQLite)

**Phase ordering rationale:**
- Phase 1 first: pure refactor, zero risk, enables everything
- Phase 2 before 3: calendar detection is the primary value proposition
- Phase 3 before 4: commitment detection needs reminder service to schedule follow-ups
- Phase 5 last: most external dependencies, purely additive, works without it

**Research flags for phases:**
- Phase 4: Needs commitment detection prompt design for mixed Hebrew/English
- Phase 5: Needs Azure AD app registration setup guide, personal account authority configuration

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Existing stack verified by codebase inspection. Microsoft packages verified via npm and official docs. |
| Features | HIGH | All features grounded in existing patterns (date extraction, owner commands, cron scheduling). |
| Architecture | HIGH | All integration points identified by reading actual source code. Data flows traced through existing pipeline. |
| Pitfalls | MEDIUM-HIGH | Microsoft To Do token lifecycle based on general MS identity docs, not To Do-specific testing. Gemini cost for private messages is modeled, not measured. |

## Gaps to Address

- **CommitmentDetector prompt quality:** The pre-filter and Gemini prompt for detecting commitments in mixed Hebrew/English private messages has not been validated. Need to test against real chat samples during Phase 4 planning.
- **Microsoft To Do personal account specifics:** The authority URL (`/consumers` vs `/common`) and supported account types need verification with actual Azure AD app registration. Personal Microsoft accounts may have different consent screens than work/school accounts.
- **Token cache persistence strategy:** Two valid approaches exist (file-based via `msal-node-extensions` vs custom SQLite CachePlugin). Both work; the choice should be made during Phase 5 implementation based on operational preference.
- **Reminder message formatting:** Hebrew vs English reminder text based on contact/group language. The existing `detectGroupLanguage()` helper only works for groups -- need a per-contact language detection or preference for private reminders.
- **Calendar event deduplication:** When both group pipeline and private pipeline detect the same event (e.g., owner forwards a message from group to private), need dedup logic to avoid double calendar entries.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all relevant source files: `messageHandler.ts`, `groupMessagePipeline.ts`, `calendarService.ts`, `dateExtractor.ts`, `suggestionTracker.ts`, `reminderScheduler.ts`, `schema.ts`, `config.ts`, `provider.ts`, `gemini.ts`, `index.ts`
- [Microsoft Graph To Do API overview](https://learn.microsoft.com/en-us/graph/todo-concept-overview) -- API surface, delegated-only permissions
- [Microsoft Graph To Do REST API](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0) -- endpoints, task schema
- [Microsoft Graph Auth (delegated)](https://learn.microsoft.com/en-us/graph/auth-v2-user) -- authorization code flow, refresh tokens
- [Microsoft Graph Auth Concepts](https://learn.microsoft.com/en-us/graph/auth/auth-concepts) -- delegated vs app-only permissions
- [MSAL Node.js npm](https://www.npmjs.com/package/@azure/msal-node) -- v5.x, token caching
- [@microsoft/microsoft-graph-client npm](https://www.npmjs.com/package/@microsoft/microsoft-graph-client) -- v3.0.7 stable GA
- [Microsoft Graph TypeScript SDK](https://github.com/microsoftgraph/msgraph-sdk-typescript) -- evaluated and noted as preview

### Secondary (MEDIUM confidence)
- [MSAL Node token cache serialization](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) -- cache plugin pattern
- [MSAL refresh token handling discussion](https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/6935) -- auto-persist behavior
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) -- Tasks.ReadWrite scope details

---
*Research completed: 2026-03-16*
*Ready for roadmap: yes*

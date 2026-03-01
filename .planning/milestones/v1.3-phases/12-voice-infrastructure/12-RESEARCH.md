# Phase 12: Voice Infrastructure - Research

**Researched:** 2026-03-01
**Domain:** ElevenLabs SDK setup, ffmpeg-static ESM interop, Drizzle schema migration
**Confidence:** HIGH (SDK/migration patterns verified against official sources and project codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Voice clone setup**
- Use ElevenLabs Instant Voice Cloning (IVC) — upload a few short audio clips, clone ready in seconds
- Recording via Voice Memos on iPhone — quick and convenient, decent quality
- Clone created manually in ElevenLabs web UI — bot only stores and uses the voice ID
- Quality bar: recognizable as Yuval — people who know him would say "that sounds like Yuval"

**Config & credentials**
- API key in `.env` file (same pattern as GEMINI_API_KEY), voice ID also in `.env` as default
- Per-contact voice ID stored in DB (voiceId column on contacts) — allows future flexibility
- Validate ElevenLabs connection at startup — check API key + voice ID are valid, log warning if not
- If ElevenLabs is down or API key invalid, fall back to text replies (transcribe fails → skip voice, TTS fails → send text instead)
- ElevenLabs usage/quota not needed in dashboard — check ElevenLabs dashboard directly if needed

**Contact voice defaults**
- Voice replies default to OFF for new contacts — opt-in per contact
- One global cloned voice used for all contacts (voice ID from config), but per-contact voiceId column exists in DB for future flexibility
- Contacts with voice OFF still get transcribed + text reply (don't ignore voice messages)
- Global voice on/off toggle exists as master switch — can disable all voice replies without changing per-contact settings

### Claude's Discretion
- Exact startup validation implementation (retry logic, timeout)
- ffmpeg-static import approach (CJS vs ESM compatibility)
- Migration naming convention
- Error logging format for ElevenLabs failures

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

## Summary

This phase installs and wires up the two core dependencies for the voice pipeline: `@elevenlabs/elevenlabs-js` (TTS + STT + voice management) and `ffmpeg-static` (bundled ffmpeg binary). It then migrates the DB schema with voice columns on contacts, seeds the global voice toggle into the existing settings table, wires credentials into the existing `config.ts` / Zod schema, and performs a one-shot startup validation of the ElevenLabs API key and voice ID.

The ElevenLabs SDK (v2.37.0 at time of research) is a CJS package with bundled TypeScript types. It imports cleanly in this project's ESM+tsx environment using a standard default import. The startup validator should call `client.voices.get(voiceId)` — a lightweight single-voice fetch that confirms both the API key (auth) and the voice ID (existence). If it throws, log a warning and mark voice as unavailable; do not crash.

`ffmpeg-static` is a CJS package that returns a string (binary path) or null. The project uses `tsx` as runtime (`"type": "module"` in package.json, `moduleResolution: bundler` in tsconfig), which handles CJS interop transparently, but the correct TypeScript import is a default import (`import ffmpegPath from 'ffmpeg-static'`). TypeScript may also require `@types/ffmpeg-static` to avoid a type-error on null-check.

The Drizzle migration workflow is already established (7 prior migrations). Adding two columns to `contacts` is a standard `ALTER TABLE … ADD COLUMN` operation that drizzle-kit generates automatically. The global voice toggle lives in the existing `settings` table as a key-value row (`voice_replies_enabled = 'true'|'false'`), consistent with how `ai_provider` and `global_persona` are stored — no schema change needed for the toggle.

**Primary recommendation:** Follow the existing project patterns exactly — `config.ts` Zod schema for env vars, `getSetting`/`setSetting` for the global toggle, `ALTER TABLE` via drizzle-kit for the contact columns, and a non-blocking async startup validator that logs a warning on failure.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@elevenlabs/elevenlabs-js` | 2.37.0 | ElevenLabs TTS, STT (Scribe), voice management | Official SDK — single API key, Hebrew support in `eleven_multilingual_v2` |
| `ffmpeg-static` | 5.3.0 | Bundled ffmpeg binary — no system dependency | Eliminates host ffmpeg requirement; locked decision |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/ffmpeg-static` | latest | TypeScript types for ffmpeg-static | Required only if TS complains about import type; may already be bundled |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@elevenlabs/elevenlabs-js` | Raw `fetch` against ElevenLabs REST | SDK gives streaming helpers, type safety, retry logic — no reason to use raw fetch |
| `ffmpeg-static` | System ffmpeg | System dependency is fragile on the server — static binary is the locked decision |

**Installation:**

```bash
npm install @elevenlabs/elevenlabs-js ffmpeg-static
```

If TypeScript complains about ffmpeg-static types:

```bash
npm install -D @types/ffmpeg-static
```

---

## Architecture Patterns

### How the Phase Fits the Existing Codebase

```
src/
├── config.ts              # Add ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID (Zod schema)
├── db/
│   ├── schema.ts          # Add voiceReplyEnabled + voiceId columns to contacts table
│   └── queries/
│       └── contacts.ts    # (no changes this phase — column access used in Phase 13+)
├── voice/                 # NEW — create this module stub
│   └── client.ts          # ElevenLabsClient singleton + startup validator
drizzle/
└── 0007_*.sql             # Generated by drizzle-kit generate
```

### Pattern 1: Config via Zod Schema (matches existing `config.ts`)

Add two new required env vars following the exact `GEMINI_API_KEY` pattern:

```typescript
// Source: src/config.ts (existing pattern)
const envSchema = z.object({
  // ... existing fields ...
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string(),
});
```

Both are required (`z.string()` without `.optional()`). If missing, the process exits at startup with a clear error — consistent with how GEMINI_API_KEY works. Add them to `.env` before running.

### Pattern 2: ElevenLabs Client Singleton

```typescript
// Source: github.com/elevenlabs/elevenlabs-js README (HIGH confidence)
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../config.js';

export const elevenLabsClient = new ElevenLabsClient({
  apiKey: config.ELEVENLABS_API_KEY,
});
```

Instantiate once, export. The SDK uses `process.env.ELEVENLABS_API_KEY` by default if no `apiKey` is passed — but explicitly passing from `config` keeps it consistent with project patterns.

### Pattern 3: Startup Validator (non-blocking, warn-only)

```typescript
// voices.get(voiceId) confirms: API key valid (auth) + voice exists (ID check)
// Single request, lightweight, direct confirmation
export async function validateElevenLabsConnection(): Promise<boolean> {
  try {
    await elevenLabsClient.voices.get(config.ELEVENLABS_DEFAULT_VOICE_ID);
    logger.info('ElevenLabs connection validated');
    return true;
  } catch (err) {
    logger.warn({ err }, 'ElevenLabs validation failed — voice replies will be unavailable');
    return false;
  }
}
```

Call this from `main()` in `src/index.ts` after `initDb()`. Do NOT await in a way that blocks startup — a failed ElevenLabs check should not prevent the bot from starting.

**Timeout consideration:** The SDK defaults to 60s timeout with 2 retries. For a startup check, override to a shorter timeout:

```typescript
await elevenLabsClient.voices.get(config.ELEVENLABS_DEFAULT_VOICE_ID, {
  timeoutInSeconds: 5,
  maxRetries: 0,
});
```

This avoids hanging startup for 60+ seconds if ElevenLabs is unreachable.

### Pattern 4: ffmpeg-static Import (ESM + tsx)

The project uses `"type": "module"` + `moduleResolution: bundler` + `tsx` runtime. The `tsx` runtime handles CJS imports transparently. The correct TypeScript import is:

```typescript
// Source: github.com/eugeneware/ffmpeg-static issue #115 (MEDIUM confidence)
import ffmpegPath from 'ffmpeg-static';

// Validate at startup:
if (!ffmpegPath) {
  logger.warn('ffmpeg-static binary not found — audio encoding will fail');
} else {
  logger.info({ ffmpegPath }, 'ffmpeg-static binary resolved');
}
```

If TypeScript raises a type error on the default import, add `"allowSyntheticDefaultImports": true` to tsconfig (already covered by `esModuleInterop: true` in this project).

The `createRequire` workaround is NOT needed here because tsx handles CJS/ESM interop. Only needed if running compiled output with native Node.js ESM loader directly.

### Pattern 5: Drizzle Migration for Contact Voice Columns

Add to `src/db/schema.ts` contacts table:

```typescript
// Follow existing integer boolean pattern from schema.ts (contacts already uses this)
voiceReplyEnabled: integer('voice_reply_enabled', { mode: 'boolean' })
  .notNull()
  .default(false),
voiceId: text('voice_id'),  // nullable, no .notNull()
```

Then run:

```bash
npm run db:generate  # produces drizzle/0007_*.sql with ALTER TABLE contacts ADD COLUMN ...
npm run db:migrate   # applies to ./data/bot.db
```

The generated SQL will look like the existing pattern from `0001_glorious_lenny_balinger.sql`:

```sql
ALTER TABLE `contacts` ADD `voice_reply_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `voice_id` text;
```

SQLite `ALTER TABLE ADD COLUMN` works cleanly for nullable columns and columns with defaults. No table rebuild needed since neither column has a UNIQUE constraint.

### Pattern 6: Global Voice Toggle in Settings Table

The `settings` table (key-value store) already exists. The global toggle is NOT a schema change — it's a seeded default in `DEFAULTS` within `settings.ts`:

```typescript
// Follow existing pattern in src/db/queries/settings.ts
const DEFAULTS: Record<string, string> = {
  ai_provider: 'gemini',
  voice_replies_enabled: 'false',  // Add this line
};
```

`getSetting('voice_replies_enabled')` returns `'true'` or `'false'` (string). Callers check `=== 'true'`. This is consistent with how all settings work in the project.

### Anti-Patterns to Avoid

- **Crashing on ElevenLabs failure:** The startup validator MUST be non-fatal. A warning + graceful degradation is the locked decision.
- **Using `createRequire` for ffmpeg-static:** Not needed with tsx. Would add unnecessary complexity.
- **Adding a separate boolean column for global voice toggle in a new table:** The existing `settings` key-value table handles this cleanly.
- **Using `eleven_v3` model ID at this stage:** The eleven_v3 API is in alpha and "coming soon" to public API. Use `eleven_multilingual_v2` for TTS with cloned voices (29 languages including Hebrew, production-stable).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ElevenLabs API authentication & retry | Custom fetch wrapper | `ElevenLabsClient` from SDK | SDK handles retries, timeouts, streaming, typed responses |
| ffmpeg binary management | Download script or PATH lookup | `ffmpeg-static` | Binary bundled in node_modules, resolves to exact path, no system dependency |
| Migration SQL | Hand-written ALTER TABLE | `npm run db:generate` + `db:migrate` | Drizzle generates correct SQL and updates the journal automatically |
| Boolean in SQLite | Custom 0/1 casting | `integer({ mode: 'boolean' })` | Drizzle handles the cast in both read and write |

---

## Common Pitfalls

### Pitfall 1: `eleven_v3` Not Available in Public API

**What goes wrong:** Specifying `modelId: 'eleven_v3'` in API calls causes a 422 or model-not-found error.
**Why it happens:** eleven_v3 is in alpha; the public API access is marked "coming soon" as of research date.
**How to avoid:** Use `eleven_multilingual_v2` for now. Hebrew support is confirmed. eleven_v3 can be evaluated later.
**Warning signs:** API returns error mentioning invalid model or model not found.

### Pitfall 2: ffmpeg-static Returns null

**What goes wrong:** `ffmpegPath` is `string | null`. Passing it directly as a string path crashes at runtime.
**Why it happens:** On some platforms or if the binary download failed during `npm install`, the path is null.
**How to avoid:** Check `if (!ffmpegPath) { throw ... }` immediately after import, at startup validation. TypeScript enforces this with the correct types.
**Warning signs:** TS type error on `ffmpegPath` usage if null-check is missing.

### Pitfall 3: Startup Validator Blocks Bot Launch

**What goes wrong:** `await validateElevenLabsConnection()` in `main()` hangs for 60+ seconds when ElevenLabs is unreachable (default SDK timeout is 60s × 2 retries = 120s).
**Why it happens:** Default SDK retry + timeout settings are designed for production calls, not health checks.
**How to avoid:** Pass `{ timeoutInSeconds: 5, maxRetries: 0 }` to the `voices.get()` call in the validator.
**Warning signs:** Bot startup takes >10 seconds before logging "Connected".

### Pitfall 4: Drizzle Migration on Column with DEFAULT + NOT NULL

**What goes wrong:** Adding `voiceReplyEnabled` with `.notNull().default(false)` works correctly in Drizzle, but hand-writing the SQL might get the SQLite syntax wrong.
**Why it happens:** SQLite requires `DEFAULT 0` (integer), not `DEFAULT false` (boolean) for BOOLEAN-mode integer columns.
**How to avoid:** Always run `db:generate` to let Drizzle produce the SQL — never hand-write migration SQL for this project.
**Warning signs:** `sqlite: near "false": syntax error` in migration output.

### Pitfall 5: `import * as ffmpegPath from 'ffmpeg-static'` Type Mismatch

**What goes wrong:** The namespace import gives you the module object, not the string path. TypeScript raises a type mismatch.
**Why it happens:** `ffmpeg-static` uses `export default string | null` typing — namespace import (`import *`) doesn't extract the default.
**How to avoid:** Use `import ffmpegPath from 'ffmpeg-static'` (default import).
**Warning signs:** TypeScript error: "Type 'typeof ffmpeg-static' is not assignable to type 'string'".

### Pitfall 6: Zod Schema Makes `ELEVENLABS_API_KEY` Required — Bot Won't Start Without It

**What goes wrong:** After adding `ELEVENLABS_API_KEY: z.string()` to the Zod schema, the bot crashes if the env var is missing.
**Why it happens:** This is intentional (consistent with GEMINI_API_KEY), but if adding the env var to `.env` is forgotten, the bot won't start.
**How to avoid:** Document clearly in the phase plan: add both vars to `.env` BEFORE running the bot. Test `npm run dev` after editing `.env`.
**Warning signs:** `Invalid environment configuration: ELEVENLABS_API_KEY: Required`.

---

## Code Examples

Verified patterns from official sources and project codebase:

### Install Dependencies

```bash
npm install @elevenlabs/elevenlabs-js ffmpeg-static
```

### Config Additions (src/config.ts)

```typescript
// Source: existing src/config.ts pattern — matches GEMINI_API_KEY
const envSchema = z.object({
  // ... all existing fields unchanged ...
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string(),
});
```

### ElevenLabs Client Module (src/voice/client.ts — new file)

```typescript
// Source: github.com/elevenlabs/elevenlabs-js README (HIGH confidence)
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../config.js';

export const elevenLabsClient = new ElevenLabsClient({
  apiKey: config.ELEVENLABS_API_KEY,
});

export async function validateElevenLabsConnection(logger: pino.Logger): Promise<boolean> {
  try {
    await elevenLabsClient.voices.get(config.ELEVENLABS_DEFAULT_VOICE_ID, {
      timeoutInSeconds: 5,
      maxRetries: 0,
    });
    logger.info('ElevenLabs connection validated');
    return true;
  } catch (err) {
    logger.warn({ err }, 'ElevenLabs validation failed — voice replies unavailable');
    return false;
  }
}
```

### ffmpeg-static Import (wherever binary path is needed — Phase 13+, but verify here)

```typescript
// Source: github.com/eugeneware/ffmpeg-static (MEDIUM confidence — verified import syntax)
import ffmpegPath from 'ffmpeg-static';

if (!ffmpegPath) {
  throw new Error('ffmpeg-static binary not found');
}
// ffmpegPath is now typed as string
console.log('ffmpeg binary:', ffmpegPath);
```

### Schema Changes (src/db/schema.ts)

```typescript
// Source: existing schema.ts pattern (contacts table uses integer boolean mode)
export const contacts = sqliteTable('contacts', {
  // ... all existing columns unchanged ...
  voiceReplyEnabled: integer('voice_reply_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  voiceId: text('voice_id'),
});
```

### Settings Default for Global Toggle (src/db/queries/settings.ts)

```typescript
// Source: existing settings.ts pattern
const DEFAULTS: Record<string, string> = {
  ai_provider: 'gemini',
  voice_replies_enabled: 'false',  // add this line
};

// Usage in Phase 13+ pipeline:
const voiceEnabled = getSetting('voice_replies_enabled') === 'true';
```

### Drizzle Migration Commands

```bash
npm run db:generate  # Generates drizzle/0007_*.sql (auto-named by Drizzle)
npm run db:migrate   # Applies migration to ./data/bot.db
```

### ElevenLabs TTS Call (reference for Phase 13, model to use)

```typescript
// Source: github.com/elevenlabs/elevenlabs-js README (HIGH confidence)
// Use eleven_multilingual_v2 — production stable, 29 languages including Hebrew
const audio = await elevenLabsClient.textToSpeech.convert(voiceId, {
  text: 'שלום, מה שלומך?',
  modelId: 'eleven_multilingual_v2',
  outputFormat: 'mp3_44100_128',
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `elevenlabs` (npm) — unofficial packages | `@elevenlabs/elevenlabs-js` — official SDK | ~2023 | Use official package only |
| `eleven_v2` / `eleven_v1` models | `eleven_multilingual_v2` for production, `eleven_v3` in alpha | 2024–2025 | Use v2 for cloned voices now; v3 when GA |
| System ffmpeg required | `ffmpeg-static` bundles binary | Established pattern | No host dependency |
| `require('ffmpeg-static')` | `import ffmpegPath from 'ffmpeg-static'` | ESM adoption | Correct import for TS ESM |

**Deprecated/outdated:**
- `elevenlabs` (npm, unofficial): Superseded by `@elevenlabs/elevenlabs-js`
- `eleven_multilingual_v1`: Replaced by v2; v1 is inferior quality
- `@ffmpeg/ffmpeg` (WASM): Heavier, browser-oriented — `ffmpeg-static` is the right choice for Node.js

---

## Open Questions

1. **Does `eleven_v3` work with Instant Voice Cloning via API at time of implementation?**
   - What we know: eleven_v3 blog post says "public API coming soon" as of research date; eleven_multilingual_v2 is confirmed working
   - What's unclear: Whether v3 API access is gated, available on paid plans, or still blocked
   - Recommendation: Start with `eleven_multilingual_v2` (stable, confirmed Hebrew + cloned voice support); add a config option to swap model later if v3 becomes available

2. **Does `@types/ffmpeg-static` need to be installed separately?**
   - What we know: The `ffmpeg-static` package includes its own `types` directory per README; separate `@types/` package also exists on npm
   - What's unclear: Whether bundled types in v5.3.0 are accurate or require the separate `@types/` package for correct default import typing
   - Recommendation: Attempt import without `@types/`; if TypeScript complains, `npm install -D @types/ffmpeg-static` resolves it

3. **Migration auto-naming: will drizzle-kit use idx 0007?**
   - What we know: Drizzle names migrations sequentially with a random word suffix (e.g., `0007_something_something.sql`); the journal confirms the next index is 7
   - What's unclear: Nothing — this is fully predictable from existing journal
   - Recommendation: Run `db:generate`, verify the file is `0007_*.sql`, then run `db:migrate`

---

## Sources

### Primary (HIGH confidence)

- `github.com/elevenlabs/elevenlabs-js` README — SDK installation, `ElevenLabsClient` init, `textToSpeech.convert`, `voices.search` methods, package version 2.37.0
- `github.com/elevenlabs/elevenlabs-js` package.json — Confirmed CJS main entry, version 2.37.0, bundled types
- `elevenlabs.io/docs/api-reference/introduction` — Authentication pattern, API key via header, SDK initialization
- Project `src/config.ts` — Zod env schema pattern (GEMINI_API_KEY precedent)
- Project `src/db/schema.ts` — `integer({ mode: 'boolean' })` pattern for SQLite boolean columns
- Project `src/db/queries/settings.ts` — Key-value settings pattern with DEFAULTS
- Project `drizzle/0001_glorious_lenny_balinger.sql` — `ALTER TABLE contacts ADD` pattern

### Secondary (MEDIUM confidence)

- `github.com/eugeneware/ffmpeg-static` issue #115 — `import ffmpegPath from 'ffmpeg-static'` as correct TypeScript ESM import (verified against package type declarations)
- `elevenlabs.io/docs/overview/models` (fetched) — Model IDs: `eleven_multilingual_v2`, `eleven_v3`, `scribe_v2`; Hebrew in 29-language list
- ElevenLabs Scribe v2 blog — Hebrew WER 3.1% on FLEURS benchmark; `scribe_v2` model ID confirmed

### Tertiary (LOW confidence)

- WebSearch result: "eleven_v3 public API coming soon" — Not officially verified via docs fetch; treat eleven_multilingual_v2 as the safe default until v3 is confirmed available

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDK version, package names, and installation verified from official GitHub source
- Architecture: HIGH — patterns derived directly from existing project codebase; SDK usage from official README
- Pitfalls: MEDIUM — ffmpeg-static import issue verified from GitHub issue; other pitfalls derived from code analysis + SDK docs
- Model selection: MEDIUM — eleven_multilingual_v2 confirmed stable; eleven_v3 alpha status from blog post, not official API reference

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (ElevenLabs SDK moves fast; recheck if v3 API availability is needed)

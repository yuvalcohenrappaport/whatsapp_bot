# Technology Stack — Travel Agent Milestone

**Project:** WhatsApp Group Bot — Travel Agent Features
**Researched:** 2026-03-02
**Scope:** NEW additions only. Existing validated stack (Baileys v7, Gemini 2.5 Flash, Fastify 5, Drizzle/SQLite, zod v4, node-cron, googleapis, ElevenLabs) is not re-researched.

---

## Decision Map

| Capability | Decision | Library / Pattern |
|---|---|---|
| Trip memory / structured decision storage | Extend Drizzle schema | No new library |
| Chat history full-text search | SQLite FTS5 via raw SQL | Built into `better-sqlite3` |
| Semantic chat history search | Defer; add `sqlite-vec` if FTS insufficient | `sqlite-vec` (defer) |
| Richer place data (ratings, reviews, hours) | Gemini Maps Grounding | No new library — extend existing Gemini call |
| Proactive suggestions | Extend existing Gemini + node-cron pipeline | No new library |
| Activity detection from conversation | Extend existing Gemini prompt pipeline with Zod response schema | No new library |
| Suggest-then-confirm UX in WhatsApp | Baileys reactions + quoted replies | No new library |

**Net result: zero new npm packages required for Phase 1. One optional package (`sqlite-vec`) deferred to a later phase.**

---

## Capability Detail

### 1. Full-Text Search (Chat History)

**Decision: Use SQLite FTS5 via raw SQL. No new library.**

`better-sqlite3` v12.6.2 (already in `package.json`) compiles SQLite with FTS5 enabled by default. Drizzle ORM does not support FTS5 virtual tables natively (GitHub issue #2046, open since March 2024, still unresolved). The workaround is clean: create the FTS5 virtual table via `db.exec()` after Drizzle migrations run, and query it with raw `db.prepare()` statements.

FTS5 supports boolean queries (AND, OR, NOT), phrase queries, and column filtering — sufficient for "find conversations about hotels in Rome" type queries.

```typescript
// One-time setup (called after Drizzle migrations in db/client.ts)
import { getDb } from './client.js';

const db = getDb(); // existing better-sqlite3 instance

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS group_messages_fts
  USING fts5(
    body,
    sender_name,
    content='group_messages',
    content_rowid='rowid'
  );
`);

// Rebuild index (run after bulk inserts or on startup)
db.exec(`INSERT INTO group_messages_fts(group_messages_fts) VALUES('rebuild');`);

// Search
const results = db
  .prepare(`
    SELECT gm.*, rank
    FROM group_messages gm
    JOIN group_messages_fts fts ON gm.rowid = fts.rowid
    WHERE group_messages_fts MATCH ?
    AND gm.group_jid = ?
    ORDER BY rank
    LIMIT 20
  `)
  .all(query, groupJid);
```

**Confidence:** HIGH — FTS5 inclusion in better-sqlite3 is documented on its GitHub. Drizzle FTS5 gap confirmed via GitHub issue. Pattern verified across multiple implementations.

---

### 2. Semantic Search (Deferred)

**Decision: Skip for now. Add `sqlite-vec` + `gemini-embedding-001` only if FTS5 proves insufficient.**

`sqlite-vec` (v0.1.7-alpha.2) is the successor to sqlite-vss and runs as a loadable SQLite extension with no external dependencies. It integrates with `better-sqlite3` via a single `sqliteVec.load(db)` call. The project already uses `@google/genai`, so `gemini-embedding-001` embeddings cost nothing extra (no new SDK).

Concerns that justify deferring:
- sqlite-vec is in alpha. The GitHub repository had no commits for approximately 6 months as of mid-2025 (confirmed via issue #226). Maintenance status is unclear.
- Adding embeddings storage requires a schema migration (new `vec0` virtual table), an embedding generation step on every new group message, and a retrieval path — meaningful scope for Phase 1.
- FTS5 keyword search likely covers 80% of the "find past conversations" use case.

**Embedding model if/when added:** Use `gemini-embedding-001`. Do NOT use `text-embedding-004` — Google deprecated it August 2025. `gemini-embedding-001` is GA, ranks #1 on MTEB Multilingual, supports Hebrew.

```bash
# Install only when semantic search phase begins
npm install sqlite-vec
```

```typescript
import * as sqliteVec from 'sqlite-vec';
import { getDb } from './db/client.js';

const db = getDb();
sqliteVec.load(db); // loads extension into existing connection — no separate DB file

// Generate embedding via existing @google/genai client
const embedding = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: [{ parts: [{ text: messageBody }] }],
});
const vector = embedding.embeddings[0].values; // float32[]
```

**Confidence (sqlite-vec):** MEDIUM — works but alpha + stalled maintenance is a risk. Validate maintenance status before committing.

---

### 3. Richer Place Data (Ratings, Reviews, Hours)

**Decision: Switch from `googleSearch` grounding to `googleMaps` grounding in the existing Gemini call. No new library.**

Gemini Maps Grounding is generally available in 2025, supported on Gemini 2.5 Flash. It provides structured data for 250M+ places: ratings, user reviews, opening hours, addresses, and photos. This replaces the current `googleSearch: {}` tool in `travelSearch.ts` (or runs alongside it as a fallback chain).

The change is localized to `src/groups/travelSearch.ts`. The `geminiGroundedSearch()` function already passes `tools` in the config — swap the tool:

```typescript
// Before (existing)
config: {
  tools: [{ googleSearch: {} }],
}

// After (Maps Grounding)
config: {
  tools: [{ googleMaps: {} }],
  toolConfig: {
    retrievalConfig: {
      // Optional: bias results toward group's home city
      latLng: { latitude: 32.0853, longitude: 34.7818 }, // Tel Aviv
    },
  },
}
```

Maps Grounding returns a `contextToken` that can render an interactive widget client-side, but for WhatsApp text output this is irrelevant — extract the structured data from the model's text response as before.

**Why NOT add `@googlemaps/places`:** Separate API call, separate billing dimension, second API key to manage, added latency (serial: Gemini call + Places API call). Maps Grounding achieves the same within the existing Gemini call. The `@googlemaps/google-maps-services-js` (v3.4.2) or `@googlemaps/places` packages remain a fallback if Maps Grounding proves unreliable in practice.

**Confidence:** MEDIUM — Maps Grounding is newly GA in 2025; Gemini docs confirm the tool config pattern, but real-world reliability vs. the older `googleSearch` grounding is less documented. Plan a fallback path to `googleSearch` grounding.

---

### 4. Trip Memory / Structured Decision Storage

**Decision: Add a `tripPlans` table to the existing Drizzle schema. No new library.**

This is the natural extension of the current `groups` table pattern. Drizzle manages migrations; SQLite WAL mode (already configured) handles concurrent reads during bot operation.

```typescript
// src/db/schema.ts — new table
export const tripPlans = sqliteTable(
  'trip_plans',
  {
    id: text('id').primaryKey(),           // UUID
    groupJid: text('group_jid').notNull(), // FK to groups.id
    destination: text('destination'),       // "Rome, Italy"
    dateFrom: integer('date_from'),         // Unix ms — from existing chrono-node parser
    dateTo: integer('date_to'),             // Unix ms
    budget: text('budget'),                 // "€1500 per person"
    notes: text('notes'),                   // JSON blob for flexible fields
    status: text('status').notNull().default('planning'), // 'planning' | 'confirmed' | 'done'
    createdAt: integer('created_at').$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at').$defaultFn(() => Date.now()),
  },
  (table) => [index('idx_trip_plans_group').on(table.groupJid)],
);

export const tripDecisions = sqliteTable(
  'trip_decisions',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id').notNull(),         // FK to trip_plans.id
    category: text('category').notNull(),       // 'hotel' | 'flight' | 'activity' | 'restaurant'
    name: text('name').notNull(),               // "Hotel Artemide"
    url: text('url'),
    notes: text('notes'),
    decided: integer('decided', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').$defaultFn(() => Date.now()),
  },
  (table) => [index('idx_trip_decisions_trip').on(table.tripId)],
);
```

**Confidence:** HIGH — standard Drizzle/SQLite pattern used throughout the existing codebase.

---

### 5. Suggest-Then-Confirm UX in WhatsApp

**Decision: Use emoji reactions + quoted replies. Do NOT use interactive buttons.**

WhatsApp interactive messages (buttons, list messages) are exclusive to the WhatsApp Business API and require a verified Business Account. They are unavailable on personal accounts and will fail silently or cause account bans when attempted via Baileys on a personal number. This is confirmed: all interactive button documentation (Twilio, WATI, Clickatell, etc.) explicitly requires the Business API.

What works on personal accounts via Baileys:

| Mechanism | Baileys API | Use For |
|---|---|---|
| Emoji reaction | `sock.sendMessage(jid, { react: { text: '✅', key: msgKey } })` | Bot confirms it registered a user's OK |
| Quoted reply | `sock.sendMessage(jid, { text: '...' }, { quoted: msg })` | Bot references the specific suggestion being confirmed |
| Numbered text list | Plain text formatting | "Reply *1* for Hotel Artemide, *2* for Hotel Eden" |
| Reply chain detection | Already in `travelHandler.ts` via `travelResultMessages` Map | Detect user's follow-up as confirmation of a specific option |

No changes to Baileys configuration. The existing reply chain detection in `travelHandler.ts` already handles this pattern — extend it to parse numbered confirmations ("ok take option 2") as structured intents.

**Confidence:** HIGH — Personal account button restriction confirmed across multiple official Business API documentation sources. Baileys reaction API confirmed via GitHub.

---

### 6. Structured Output for Activity Detection

**Decision: Use existing `zod` v4 + Gemini `responseSchema`. No new library. Use `z.toJSONSchema()` NOT `zod-to-json-schema` library.**

The project has `zod` v4.3.6 and `zod-to-json-schema` v3.25.1. The `zod-to-json-schema` library v3.25.x was built for Zod v3 and fails silently with Zod v4 (confirmed by multiple blog posts and GitHub issues). Zod v4 ships a native `z.toJSONSchema()` method — use it directly.

Gemini structured output with `responseSchema` is supported on all Gemini 2.5 models and is the right pattern for activity detection (extracting structured intent from natural conversation).

```typescript
import { z } from 'zod';

const ActivityDetectionSchema = z.object({
  detected: z.boolean(),
  activityType: z.enum(['hotel', 'flight', 'restaurant', 'attraction', 'transport', 'other']).optional(),
  destination: z.string().optional(),
  dateHint: z.string().optional(),   // natural language, feed to existing chrono-node
  confidence: z.enum(['high', 'medium', 'low']),
});

const response = await ai.models.generateContent({
  model: config.GEMINI_MODEL,
  contents: [{ role: 'user', parts: [{ text: conversationChunk }] }],
  config: {
    responseMimeType: 'application/json',
    responseSchema: z.toJSONSchema(ActivityDetectionSchema), // Zod v4 native — NOT zod-to-json-schema
  },
});

const activity = ActivityDetectionSchema.parse(JSON.parse(response.text!));
```

**Confidence:** HIGH — Gemini structured output docs confirm this pattern. Zod v4 `z.toJSONSchema()` availability confirmed via Zod v4 release notes and multiple migration guides.

---

## Installation Summary

```bash
# Phase 1 — nothing new required
# All capabilities use packages already in package.json

# Phase 2 (semantic search, if FTS proves insufficient)
npm install sqlite-vec
```

---

## What NOT to Add

| Do Not Add | Why | Alternative |
|---|---|---|
| `@googlemaps/places` | Extra API key, billing, latency; Maps Grounding does the same inside the existing Gemini call | Gemini `googleMaps` tool |
| `@googlemaps/google-maps-services-js` | Same reasons; added overhead | Gemini `googleMaps` tool (fallback: `googleSearch` already working) |
| WhatsApp interactive buttons library | Doesn't exist for personal accounts — buttons require Business API | Reactions + quoted replies |
| `zod-to-json-schema` (any new usage) | v3.25.x breaks with Zod v4 silently | `z.toJSONSchema()` (built into Zod v4) |
| Pinecone / Weaviate / Qdrant | External vector DB service — overkill for a WhatsApp group bot | `sqlite-vec` if semantic search is ever needed |
| `text-embedding-004` (Gemini model) | Deprecated August 2025 | `gemini-embedding-001` |
| Separate job queue (Bull, BullMQ) | Proactive suggestions are low-frequency; `node-cron` already handles scheduling | `node-cron` (already present) |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Place data enrichment | Gemini Maps Grounding (existing SDK) | `@googlemaps/places` v1 | Extra API key, billing, latency |
| Full-text search | SQLite FTS5 (built-in) | Typesense, Meilisearch | External service, overkill for one group |
| Semantic search | sqlite-vec (deferred) | pgvector, Faiss | External infrastructure; sqlite-vec keeps everything in one SQLite file |
| Embedding model | `gemini-embedding-001` | `text-embedding-004` | Deprecated August 2025 |
| Confirm UX | Reactions + quoted replies | WhatsApp button templates | Business API only; personal account ban risk |
| Structured output | `z.toJSONSchema()` (Zod v4 native) | `zod-to-json-schema` library | v3-only; silently broken with Zod v4 |
| Trip storage | Drizzle schema extension | Redis, MongoDB | No new infrastructure; SQLite WAL handles this volume |

---

## Version Reference

| Item | Version / Status | Notes |
|---|---|---|
| `better-sqlite3` | 12.6.2 (already installed) | FTS5 built-in, no change needed |
| Gemini Maps Grounding | GA as of 2025 (API feature, no npm) | Supports Gemini 2.5 Flash |
| `gemini-embedding-001` | GA (model name, no npm) | Use via existing `@google/genai` |
| `sqlite-vec` | 0.1.7-alpha.2 (defer) | Alpha, maintenance uncertain |
| `z.toJSONSchema()` | Built into `zod` v4.3.6 (already installed) | Use instead of `zod-to-json-schema` |

---

## Sources

- [SQLite FTS5 Extension — official docs](https://www.sqlite.org/fts5.html) — HIGH confidence
- [better-sqlite3 GitHub — FTS5 enabled by default](https://github.com/WiseLibs/better-sqlite3) — HIGH confidence
- [Drizzle ORM FTS5 feature request #2046](https://github.com/drizzle-team/drizzle-orm/issues/2046) — no native support confirmed — HIGH confidence
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) — alpha, maintenance concern (issue #226) — MEDIUM confidence
- [sqlite-vec Node.js usage](https://alexgarcia.xyz/sqlite-vec/js.html) — integration pattern confirmed — MEDIUM confidence
- [Gemini Maps Grounding — official docs](https://ai.google.dev/gemini-api/docs/maps-grounding) — GA, Gemini 2.5 Flash supported — MEDIUM confidence
- [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings) — `gemini-embedding-001` GA; `text-embedding-004` deprecated August 2025 — HIGH confidence
- [Zod v4 + Gemini structured output](https://www.buildwithmatija.com/blog/zod-v4-gemini-fix-structured-output-z-tojsonschema) — `z.toJSONSchema()` vs. broken library — HIGH confidence
- [Gemini structured output docs](https://ai.google.dev/gemini-api/docs/structured-output) — responseSchema pattern confirmed — HIGH confidence
- [WhatsApp Business API buttons — WATI docs](https://www.wati.io/en/blog/whatsapp-business-interactive-message-templates/) — Business API only — HIGH confidence
- [WhatsApp buttons — Twilio docs](https://www.twilio.com/docs/whatsapp/buttons) — Business API only — HIGH confidence
- [Baileys reactions — GitHub issue #1029](https://github.com/WhiskeySockets/Baileys/issues/1029) — `react` payload confirmed — HIGH confidence
- [@googlemaps/places npm](https://www.npmjs.com/package/@googlemaps/places) — considered and rejected — HIGH confidence
- [@googlemaps/google-maps-services-js npm — v3.4.2](https://www.npmjs.com/package/@googlemaps/google-maps-services-js) — considered and rejected — HIGH confidence

---
*Stack research for: WhatsApp Bot — Travel Agent Features*
*Researched: 2026-03-02*

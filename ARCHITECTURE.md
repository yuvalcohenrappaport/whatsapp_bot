```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          WHATSAPP BOT ARCHITECTURE                          │
│                    ~8,700 LOC TypeScript · SQLite · Baileys                  │
└──────────────────────────────────────────────────────────────────────────────┘

                          ┌─────────────────────┐
                          │   WhatsApp Network   │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Baileys Socket v7   │
                          │  connection.ts        │
                          │  reconnect.ts         │
                          │  sender.ts            │
                          └──────────┬──────────┘
                                     │
                        messages.upsert event
                                     │
                          ┌──────────▼──────────┐
                          │   messageHandler.ts   │
                          │   (Main Router)       │
                          └───┬──────────────┬───┘
                              │              │
                   ┌──────────▼──┐    ┌──────▼──────────────┐
                   │  1:1 CHATS  │    │   GROUP MESSAGES     │
                   └──────┬──────┘    └──────────┬──────────┘
                          │                      │
              ┌───────────┼───────────┐          │
              │           │           │          │
     ┌────────▼──┐ ┌──────▼───┐ ┌────▼────┐     │
     │ mode:auto │ │mode:draft│ │  owner  │     │
     │ → Gemini  │ │ → draft  │ │ commands│     │
     │ → send    │ │ → notify │ │ ✅❌snz │     │
     └───────────┘ └──────────┘ └─────────┘     │
                                                │
                          ┌─────────────────────▼───────────────────────┐
                          │         GROUP PIPELINE (callback chain)      │
                          │         groupMessagePipeline.ts              │
                          │                                             │
                          │  ① travelHandler.ts ──→ @mention search    │
                          │     travelParser.ts      (terminal)         │
                          │     travelSearch.ts                         │
                          │     travelFormatter.ts                      │
                          │         │                                   │
                          │  ② keywordHandler.ts ──→ pattern match     │
                          │     fixed text / AI      (non-terminal)     │
                          │         │                                   │
                          │  ③ reply-to-delete ────→ ❌/מחק removes    │
                          │     calendar event       (terminal)         │
                          │         │                                   │
                          │  ④ dateExtractor.ts ───→ 10s debounce      │
                          │     → calendarService    batch extract      │
                          │     → create events      → notify group     │
                          └─────────────────────────────────────────────┘
                                                │
                          ┌─────────────────────▼───────┐
                          │  reminderScheduler.ts        │
                          │  node-cron per group         │
                          │  weekly digest → Gemini → send│
                          └─────────────────────────────┘


         ┌─────────────────────────────────────────────────────┐
         │                    AI ENGINE                         │
         │                    gemini.ts                         │
         │                                                     │
         │  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
         │  │ 1:1 Replies│  │  Date    │  │Travel Intent   │  │
         │  │ style +    │  │Extraction│  │Zod schema      │  │
         │  │ few-shot   │  │high-conf │  │search query    │  │
         │  └────────────┘  └──────────┘  └────────────────┘  │
         │  ┌────────────┐  ┌──────────────────────────────┐  │
         │  │ Style      │  │ Keyword AI / Weekly Digest   │  │
         │  │ Summary    │  │ custom instructions prompt   │  │
         │  └────────────┘  └──────────────────────────────┘  │
         └─────────────────────────────────────────────────────┘


         ┌─────────────────────────────────────────────────────┐
         │                 DATABASE (SQLite + Drizzle)          │
         │                                                     │
         │  messages ─── contacts ─── drafts                   │
         │  groups ───── groupMessages                         │
         │  calendarEvents ── keywordRules                     │
         │                                                     │
         │  queries/  contacts · messages · drafts · groups    │
         │            groupMessages · calendarEvents            │
         │            keywordRules                              │
         └─────────────────────────────────────────────────────┘


         ┌─────────────────────────────────────────────────────┐
         │               FASTIFY API SERVER                     │
         │               server.ts · state.ts                   │
         │                                                     │
         │  plugins/  cors · jwt · static (SPA)                │
         │                                                     │
         │  routes/                                             │
         │  ├─ auth.ts ─────── POST /api/auth/login            │
         │  ├─ status.ts ───── GET  /api/status                │
         │  │                  GET  /api/status/stream (SSE)    │
         │  ├─ contacts.ts ─── CRUD /api/contacts              │
         │  ├─ drafts.ts ───── GET + approve/reject            │
         │  ├─ groups.ts ───── CRUD /api/groups                │
         │  │                  GET  /api/groups/participating   │
         │  └─ keywordRules.ts CRUD /api/.../keyword-rules     │
         └───────────────────────────┬─────────────────────────┘
                                     │
                              serves static
                                     │
         ┌───────────────────────────▼─────────────────────────┐
         │              REACT DASHBOARD (Vite + shadcn/ui)      │
         │                                                     │
         │  pages/                                              │
         │  ├─ Login.tsx ──────── password → JWT                │
         │  ├─ Overview.tsx ───── connection + stats            │
         │  ├─ Contacts.tsx ───── mode toggle, snooze, AI cfg  │
         │  ├─ Drafts.tsx ─────── approve / reject drafts      │
         │  └─ Groups.tsx ─────── search, add, configure       │
         │                                                     │
         │  components/                                         │
         │  ├─ status/  ConnectionBadge · DisconnectBanner · QR│
         │  ├─ contacts/ ContactCard · ContactPanel            │
         │  ├─ groups/  GroupCard · GroupPanel                  │
         │  │           KeywordRuleFormDialog · KeywordRuleList │
         │  ├─ drafts/  DraftRow                               │
         │  └─ ui/      shadcn primitives                      │
         │                                                     │
         │  hooks/  useConnectionStatus · useContacts           │
         │          useDrafts · useGroups · useKeywordRules     │
         │                                                     │
         │  api/client.ts ── apiFetch<T>() + JWT bearer        │
         └─────────────────────────────────────────────────────┘
```

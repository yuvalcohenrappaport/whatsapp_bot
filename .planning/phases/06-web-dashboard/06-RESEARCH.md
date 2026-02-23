# Phase 6: Web Dashboard - Research

**Researched:** 2026-02-23
**Domain:** Fastify REST API + React SPA dashboard for WhatsApp bot management
**Confidence:** HIGH (verified via official docs and Context7 targets)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dashboard layout:**
- Overview page is the landing page — shows pending drafts count, active contacts count, tracked groups count
- No recent activity timeline on overview (keep it clean)
- Fixed sidebar navigation with pages: Overview, Contacts, Drafts, Groups
- Spacious layout — large cards, breathing room, not cramped
- Always dark mode (no toggle, no system preference)

**Draft approval flow:**
- Drafts page shows a list with preview: contact name, their message snippet, bot's draft reply, actions on the right
- Inline editing — click the draft text to edit in place, then approve
- After approve: toast notification "Sent!" + draft removed from list
- No keyboard shortcuts — mouse/click only
- No chat-style thread view — just the flat list with previews

**Contact & group management:**
- Contacts page uses card layout — each contact is a card (name, mode, last message, status)
- Add contact by picking from recent chats (contacts the bot has received messages from)
- Click a contact card to open a side panel on the right for configuration (mode, custom instructions, relationship context)
- Groups page follows the same card + side panel style as contacts
- Group side panel includes group-specific fields: member emails, reminder day, calendar link

**Status & connection:**
- Connection status badge in the top bar — always visible on every page
- On disconnect: red banner across the top ("Bot disconnected — Reconnecting...") with QR re-auth button if session expired
- QR re-auth: click button opens a modal with live QR code, scan from phone, modal auto-closes on success

### Claude's Discretion
- Exact card design, spacing, and typography
- Sidebar width and page transition animations
- Empty states for each page (no contacts yet, no drafts, no groups)
- Error handling and loading states
- Toast notification styling and duration
- API authentication approach (JWT, session, etc.)
- Exact overview page card/widget layout

### Deferred Ideas (OUT OF SCOPE)
None specified in CONTEXT.md.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | User can view active conversations the bot is handling | Drizzle queries for messages+contacts; GET /api/contacts with recent messages join |
| DASH-02 | User can approve, edit, or reject draft replies from the dashboard | PATCH /api/drafts/:id endpoint; react-textarea-autosize for inline edit; useMutation + invalidate; Sonner toast |
| DASH-03 | User can manage the contact whitelist from the dashboard (add/remove/configure) | GET/PATCH /api/contacts; Sheet side panel for config; contacts from recent messages as "available to add" |
| DASH-04 | User can see bot connection status (connected/disconnected/reconnecting) | SSE endpoint /api/status/stream; shared in-process state; Fastify @fastify/sse or raw SSE |
| DASH-05 | User can manage tracked groups from the dashboard (add/remove/configure) | groups table needs adding to schema; GET/PATCH /api/groups; Sheet side panel |
| DASH-06 | User can trigger QR re-auth from the browser | QR string emitted via SSE/polling; qrcode.react in Dialog; Baileys onQR callback bridged to API layer |
</phase_requirements>

---

## Summary

This phase adds a Fastify 5 REST API server and a React 19 SPA dashboard to the existing whatsapp-bot Node.js process. The bot and API server run in the same Node.js process, sharing in-memory connection state (connection status, QR code strings) directly — no IPC, no separate process needed. The React build is served as static files by Fastify, so there is one PM2 process, one port, and no CORS complications.

The technology choices are well-established and fully compatible. Vite 7 (released June 2025) + React 19 + shadcn/ui + Tailwind 4 is the current canonical stack for React dashboards. shadcn/ui has full Tailwind v4 and React 19 support as of 2025. TanStack Query v5 is the standard server-state library for this stack. Fastify 5 is the locked backend framework with first-class TypeScript/ESM support.

The key architectural insight is that connection status and QR codes must flow from the Baileys event system (inside the bot) to the browser. The cleanest approach is Server-Sent Events (SSE): the Fastify API registers an SSE endpoint that reads from a shared in-process state object, pushed to whenever Baileys fires connection.update. This avoids WebSocket complexity and is one-directional (server to browser), which is all that is needed.

**Primary recommendation:** Co-locate the Fastify API server inside the existing bot process. Use SSE for live connection status. Serve the React build as static files from Fastify. Keep the DB access layer identical (same Drizzle `db` instance, no separate connection).

---

## Standard Stack

### Backend (API Server)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.x | HTTP server and routing | Locked decision; first-class TS/ESM, fastest Node.js HTTP framework |
| @fastify/static | ^8.x | Serve Vite build output | Official Fastify plugin; handles index.html fallback for SPA routing |
| @fastify/jwt | ^9.x | JWT auth for API routes | Official plugin; v9+ required for Fastify 5 compatibility |
| @fastify/cors | ^10.x | CORS headers | Official plugin; needed during dev (Vite dev server on different port) |
| @fastify/sse (or raw SSE) | - | Server-Sent Events for connection status | Lightweight unidirectional push; simpler than WebSockets for status |
| @sinclair/typebox | ^0.34.x | Runtime schema validation + TypeScript types | Standard Fastify pair; one schema = types + validation |
| fastify-plugin | ^5.x | Plugin encapsulation utility | Required to share decorators across plugin scopes |

### Frontend (React SPA)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | ^7.x | Build tool and dev server | Locked; released June 2025; requires Node 20.19+ (satisfied) |
| @vitejs/plugin-react | ^4.x | React JSX transform with SWC | Standard Vite React plugin; SWC is faster than Babel |
| react + react-dom | ^19.x | UI framework | Locked |
| tailwindcss + @tailwindcss/vite | ^4.x | CSS utility framework | Locked; v4 uses CSS-first config (no tailwind.config.js) |
| shadcn/ui | latest | Component library (Radix primitives + Tailwind) | Locked; fully compatible with Tailwind 4 + React 19 as of 2025 |
| @tanstack/react-query | ^5.x | Server state / data fetching | Locked; v5 supports React 19; object API only (no overloads) |
| react-router-dom | ^6.x | Client-side routing | Simpler than TanStack Router for 4-page SPA with no type-safe params needed |
| qrcode.react | ^4.x | QR code display in browser | Standard React QR library; exports QRCodeSVG component |
| react-textarea-autosize | ^8.x | Auto-growing textarea for inline draft edit | Battle-tested; 1500+ npm dependents; drop-in textarea replacement |
| sonner | ^1.x | Toast notifications | Shadcn's official/recommended toast; deprecates the old shadcn toast component |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query-devtools | ^5.x | Query debugging in dev | Dev only; shows cache state and query status |
| tw-animate-css | latest | CSS animations (replaces tailwindcss-animate) | shadcn/ui v4 projects use this instead of tailwindcss-animate |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-router-dom | TanStack Router | TanStack Router has better type safety but steeper learning curve; 4-page SPA doesn't need it |
| @fastify/sse / raw SSE | @fastify/websocket | WebSocket is bidirectional; SSE is simpler and sufficient for one-directional status push |
| @fastify/jwt | Session cookie | JWT is stateless; simpler for single-user Tailscale-only access; cookie sessions need storage |
| qrcode.react | react-qr-code | Both work; qrcode.react has more customization options |

**Installation (backend additions to existing project):**
```bash
npm install fastify @fastify/static @fastify/jwt @fastify/cors fastify-plugin @sinclair/typebox
```

**Installation (frontend — separate directory e.g. `dashboard/`):**
```bash
npm create vite@latest dashboard -- --template react-ts
cd dashboard && npm install
npm install @tanstack/react-query react-router-dom qrcode.react react-textarea-autosize sonner tw-animate-css
npm install -D @tanstack/react-query-devtools @tailwindcss/vite
npx shadcn@latest init
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── api/                    # Fastify server (new)
│   ├── server.ts           # Fastify instance factory
│   ├── state.ts            # Shared in-process bot state (connection, QR)
│   ├── routes/
│   │   ├── contacts.ts     # GET/PATCH /api/contacts
│   │   ├── drafts.ts       # GET/PATCH/DELETE /api/drafts
│   │   ├── groups.ts       # GET/POST/PATCH/DELETE /api/groups
│   │   ├── status.ts       # GET /api/status, SSE /api/status/stream
│   │   └── auth.ts         # POST /api/auth/login
│   └── plugins/
│       ├── jwt.ts          # @fastify/jwt registration + authenticate decorator
│       ├── cors.ts         # @fastify/cors (dev only or always)
│       └── static.ts       # @fastify/static serving dashboard/dist
├── db/
│   ├── schema.ts           # Add groups table here
│   └── queries/
│       └── groups.ts       # New queries for groups table
├── whatsapp/
│   └── reconnect.ts        # onQR/onOpen/etc callbacks → update api/state.ts
└── index.ts                # Wire bot + api server together

dashboard/                  # Separate Vite project
├── src/
│   ├── main.tsx            # QueryClientProvider + RouterProvider + Sonner
│   ├── router.tsx          # React Router routes definition
│   ├── api/
│   │   └── client.ts       # fetch wrapper with JWT header injection
│   ├── pages/
│   │   ├── Overview.tsx
│   │   ├── Contacts.tsx
│   │   ├── Drafts.tsx
│   │   └── Groups.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx   # Sidebar + topbar shell
│   │   │   ├── Sidebar.tsx     # shadcn Sidebar component
│   │   │   └── Topbar.tsx      # Connection badge + disconnect banner
│   │   ├── contacts/
│   │   │   ├── ContactCard.tsx
│   │   │   └── ContactPanel.tsx  # shadcn Sheet side panel
│   │   ├── drafts/
│   │   │   └── DraftRow.tsx    # Inline edit + approve/reject
│   │   ├── groups/
│   │   │   ├── GroupCard.tsx
│   │   │   └── GroupPanel.tsx
│   │   └── status/
│   │       └── QRModal.tsx     # Dialog with QRCodeSVG
│   └── hooks/
│       ├── useConnectionStatus.ts  # SSE subscription hook
│       └── useContacts.ts          # useQuery/useMutation wrappers
├── index.html
├── vite.config.ts
└── package.json
```

### Pattern 1: Shared In-Process State

The bot and API server run in the same Node.js process. Use a simple module-level state object — no pub/sub, no Redis, no IPC needed.

```typescript
// src/api/state.ts
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'qr_pending';

interface BotState {
  connection: ConnectionStatus;
  qr: string | null;
  listeners: Set<(state: BotState) => void>;
}

const state: BotState = {
  connection: 'disconnected',
  qr: null,
  listeners: new Set(),
};

export function updateState(patch: Partial<Omit<BotState, 'listeners'>>): void {
  Object.assign(state, patch);
  state.listeners.forEach((fn) => fn(state));
}

export function subscribe(fn: (state: BotState) => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn); // unsubscribe
}

export function getState() {
  return { connection: state.connection, qr: state.qr };
}
```

Wire into `index.ts`: call `updateState()` inside the `onQR`, `onOpen`, `onReconnect`, `onLoggedOut` callbacks.

### Pattern 2: SSE for Live Connection Status

Use a raw SSE response (no plugin needed for simple use cases). Fastify handles streaming replies natively.

```typescript
// src/api/routes/status.ts
// Source: Fastify docs + @fastify/sse patterns
fastify.get('/api/status/stream', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const send = (data: object) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send current state immediately on connect
  send(getState());

  const unsub = subscribe((state) => {
    send({ connection: state.connection, qr: state.qr });
  });

  request.raw.on('close', unsub);
});
```

On the React side:

```typescript
// src/hooks/useConnectionStatus.ts
export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/status/stream', {
      // Include credentials if using cookie auth; for JWT pass token in URL param
    });
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setStatus(data.connection);
      setQr(data.qr);
    };
    return () => es.close();
  }, []);

  return { status, qr };
}
```

**Note:** `EventSource` doesn't support custom headers. For JWT auth on SSE, pass token as a URL query param: `/api/status/stream?token=<jwt>` and verify it in the route handler.

### Pattern 3: Fastify Plugin Registration Order

Loading order matters — auth plugin must be registered before routes that use it.

```typescript
// src/api/server.ts
import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import jwtPlugin from './plugins/jwt.js';
import corsPlugin from './plugins/cors.js';
import contactRoutes from './routes/contacts.js';
import draftRoutes from './routes/drafts.js';
import groupRoutes from './routes/groups.js';
import statusRoutes from './routes/status.js';
import authRoutes from './routes/auth.js';

export async function createServer() {
  const fastify = Fastify({ logger: true });

  // 1. CORS (dev only — omit in production or lock origin to Tailscale IP)
  await fastify.register(corsPlugin);

  // 2. JWT plugin — adds fastify.authenticate decorator
  await fastify.register(jwtPlugin);

  // 3. Auth routes (login) — no auth guard on these
  await fastify.register(authRoutes);

  // 4. Protected API routes
  await fastify.register(contactRoutes, { prefix: '/api' });
  await fastify.register(draftRoutes, { prefix: '/api' });
  await fastify.register(groupRoutes, { prefix: '/api' });
  await fastify.register(statusRoutes, { prefix: '/api' });

  // 5. Static file serving (last — catch-all)
  await fastify.register(staticPlugin, {
    root: import.meta.dirname + '/../../dashboard/dist',
    prefix: '/',
  });
  fastify.setNotFoundHandler((_, reply) => reply.sendFile('index.html'));

  return fastify;
}
```

### Pattern 4: TanStack Query v5 Data Fetching

```typescript
// src/api/client.ts — API fetch wrapper with JWT injection
function getToken() { return localStorage.getItem('jwt') ?? ''; }

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// useQuery pattern (v5 object syntax — no overloads)
const { data: contacts, isLoading } = useQuery({
  queryKey: ['contacts'],
  queryFn: () => apiFetch<Contact[]>('/api/contacts'),
});

// useMutation + invalidate pattern
const queryClient = useQueryClient();
const approveDraft = useMutation({
  mutationFn: ({ id, body }: { id: string; body: string }) =>
    apiFetch(`/api/drafts/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['drafts'] });
    toast.success('Sent!');
  },
});
```

### Pattern 5: Always-Dark Mode

Do not use next-themes or any theme provider. Simply add `class="dark"` statically to the `<html>` element. Tailwind 4 dark mode reads the `dark` class on the root element — hardcoding it means permanent dark mode with zero overhead.

```html
<!-- dashboard/index.html -->
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>...</head>
  <body>...</body>
</html>
```

shadcn/ui components automatically use `dark:` variants when the `dark` class is on the root. No `ThemeProvider`, no `localStorage`, no system preference check needed.

### Pattern 6: shadcn Sheet for Contact/Group Side Panels

```tsx
// ContactCard.tsx + ContactPanel.tsx pattern
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export function ContactCard({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="cursor-pointer" onClick={() => setOpen(true)}>
        {/* card content */}
      </Card>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-96">
          <SheetHeader>
            <SheetTitle>{contact.name}</SheetTitle>
          </SheetHeader>
          <ContactPanel contact={contact} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### Pattern 7: Fastify JWT Plugin Setup

```typescript
// src/api/plugins/jwt.ts
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

export default fp(async (fastify) => {
  fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'change-me-in-production',
  });

  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });
}, { name: 'jwt-plugin', fastify: '5.x' });

// Extend FastifyInstance type
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
```

Login route issues a token for a hardcoded password (single user — no user DB needed):

```typescript
fastify.post('/api/auth/login', async (request, reply) => {
  const { password } = request.body as { password: string };
  if (password !== process.env.DASHBOARD_PASSWORD) {
    return reply.status(401).send({ error: 'Invalid password' });
  }
  const token = fastify.jwt.sign({ user: 'yuval' }, { expiresIn: '30d' });
  return { token };
});
```

### Anti-Patterns to Avoid

- **Separate process for the API server:** The bot and API share the connection state object. Putting them in separate processes requires IPC or a database field for connection status — unnecessary complexity.
- **useEffect for data fetching:** Use TanStack Query. Never fetch in useEffect for server data — no caching, no deduplication, no loading states.
- **Polling for connection status:** Use SSE instead. Polling every N seconds creates latency spikes; SSE pushes immediately when status changes.
- **Running `npm install` inside the bot's package.json for frontend deps:** Keep `dashboard/` as a separate Vite project with its own `package.json`. Frontend deps (React, shadcn, Vite) don't belong in the Node.js bot's dependency tree.
- **Serving the React app before the bot starts:** Register static file serving last in Fastify — after all API routes — so API routes take priority.
- **Forgetting `setNotFoundHandler` for SPA routing:** Without it, refreshing `/contacts` returns 404 because Fastify tries to match the path as a file. `reply.sendFile('index.html')` is required as the not-found handler.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT sign/verify | Custom crypto | @fastify/jwt | Handles algorithms, expiry, error cases, TypeScript types |
| Toast notifications | Custom state + CSS | Sonner | Accessibility, stacking, auto-dismiss, positioning — dozens of edge cases |
| Static file serving with mime types | fs.readFile in route | @fastify/static | Handles ETags, If-Modified-Since, range requests, compression |
| QR code rendering | Canvas drawing | qrcode.react (QRCodeSVG) | Error correction levels, quiet zone, accessibility |
| Auto-sizing textarea | scrollHeight resize logic | react-textarea-autosize | Handles edge cases: SSR, initial render, controlled/uncontrolled |
| SSE reconnection on client | Manual retry logic | Native EventSource API | Browser reconnects automatically with Last-Event-ID; built-in backoff |
| Dark mode forcing | JS theme detection | Static `class="dark"` on `<html>` | Zero JS, no flash of unstyled content, permanent |

**Key insight:** The shadcn/ui ecosystem components (Sheet, Dialog, Card, Badge, Sidebar) handle all accessibility concerns (focus trapping, ARIA roles, keyboard navigation). Never build custom modal or drawer components — Radix UI primitives underneath handle this correctly.

---

## Common Pitfalls

### Pitfall 1: Groups Table Doesn't Exist Yet

**What goes wrong:** The phase context mentions Groups management (DASH-05), but the current `schema.ts` has only `messages`, `contacts`, and `drafts`. There is no `groups` table. Implementation will fail at first query.

**Why it happens:** Groups are a new feature introduced in this phase, not carried over from prior phases.

**How to avoid:** The first task of this phase (or a schema migration task) must add the `groups` table to `schema.ts` and run `drizzle-kit generate && drizzle-kit migrate` before any group API routes are written.

**Suggested schema:**
```typescript
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(), // WhatsApp group JID
  name: text('name'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  reminderDay: text('reminder_day'), // 'monday' | 'tuesday' | etc.
  calendarLink: text('calendar_link'),
  memberEmails: text('member_emails'), // JSON array stored as text
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
});
```

**Warning signs:** TypeScript errors on `db.select().from(groups)` if the table isn't added to the schema.

### Pitfall 2: SQLite Concurrent Write Contention Between Bot and API

**What goes wrong:** The bot writes to SQLite (inserting messages, drafts, updating contacts) while the API server handles concurrent PATCH requests. SQLite allows only one writer at a time. Without `busy_timeout`, write contention returns `SQLITE_BUSY` errors immediately.

**Why it happens:** Both bot pipeline and API routes share the same `db` instance. WAL mode allows concurrent reads and one write, but if two writes hit simultaneously, the second fails instantly without a timeout.

**How to avoid:** Add `busy_timeout` pragma to the existing `db/client.ts`:
```typescript
sqlite.pragma('journal_mode = WAL');       // Already set
sqlite.pragma('busy_timeout = 5000');      // Add this — wait up to 5s on lock
```

**Warning signs:** Intermittent 500 errors from API during periods of high bot activity (message bursts).

### Pitfall 3: EventSource Cannot Send Authorization Headers

**What goes wrong:** The SSE endpoint at `/api/status/stream` requires JWT authentication. `EventSource` in browsers does not support custom headers — you cannot pass `Authorization: Bearer <token>`.

**Why it happens:** The EventSource API is a browser standard that only supports cookies and URL parameters, not custom request headers.

**How to avoid:** Pass the JWT as a URL query parameter: `/api/status/stream?token=<jwt>`. Verify it manually in the route handler (not via `onRequest: [fastify.authenticate]`):
```typescript
fastify.get('/api/status/stream', async (request, reply) => {
  const { token } = request.query as { token?: string };
  try {
    fastify.jwt.verify(token ?? '');
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  // ... SSE setup
});
```

**Warning signs:** 401 errors on SSE connection even when the user is logged in.

### Pitfall 4: SPA Routing 404s After Fastify Static Setup

**What goes wrong:** Navigating to `/contacts` directly (or refreshing the page) returns Fastify's 404 error JSON because no file named `contacts` exists in `dashboard/dist`.

**Why it happens:** `@fastify/static` serves files by path. `/contacts` doesn't exist as a file. React Router handles this client-side — but only if the browser receives `index.html` first.

**How to avoid:** Always add the not-found handler after registering `@fastify/static`:
```typescript
fastify.setNotFoundHandler((_, reply) => reply.sendFile('index.html'));
```

**Warning signs:** Direct URL navigation and browser refresh on sub-pages return JSON 404.

### Pitfall 5: Tailwind 4 Config Is CSS-First — No tailwind.config.js

**What goes wrong:** Copying Tailwind v3 patterns (tailwind.config.js, content array, theme.extend) fails silently or produces no styles.

**Why it happens:** Tailwind 4 completely removed `tailwind.config.js`. All configuration happens in `src/index.css` via `@theme` directive.

**How to avoid:** Use the shadcn/ui Vite setup guide for Tailwind 4 exactly as documented. `index.css` should start with `@import "tailwindcss";`. All custom colors go in `@theme { }` blocks. The Vite config uses `@tailwindcss/vite` plugin — not PostCSS.

**Warning signs:** No Tailwind classes applying; shadcn components render unstyled.

### Pitfall 6: @fastify/static and API Routes Order Collision

**What goes wrong:** If `@fastify/static` is registered with `wildcard: true` (default) before API routes, it intercepts `/api/*` requests and returns 404 file-not-found instead of routing to the API handlers.

**Why it happens:** The wildcard route in `@fastify/static` matches everything.

**How to avoid:** Register all API routes before `@fastify/static`. The static plugin MUST be the last registration. Alternatively, use a `prefix: '/app'` for static files and keep `/api` separate — but simpler to just register last.

**Warning signs:** API calls return HTML (the index.html) or 404 with no JSON body.

### Pitfall 7: Vite Dev Server Proxy Needed During Development

**What goes wrong:** During development, the React Vite dev server runs on port 5173 and the Fastify API runs on port 3000. API calls from React fail due to CORS.

**Why it happens:** Different origins (localhost:5173 vs localhost:3000).

**How to avoid:** Add a proxy in `dashboard/vite.config.ts`:
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3000',
  },
},
```
This also handles SSE proxying correctly. Register `@fastify/cors` in dev mode only (or configure it to allow `localhost:5173`). In production, React is served from the same origin as the API, so no CORS needed.

**Warning signs:** `CORS policy` errors in browser console during local development.

---

## Code Examples

Verified patterns from official sources:

### Fastify TypeScript + TypeBox Route

```typescript
// Source: https://fastify.dev/docs/latest/Reference/TypeScript/
import { Type, Static } from '@sinclair/typebox';

const ContactPatchBody = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal('off'), Type.Literal('draft'), Type.Literal('auto')])),
  relationship: Type.Optional(Type.String()),
  customInstructions: Type.Optional(Type.String()),
});

fastify.patch<{ Params: { jid: string }; Body: Static<typeof ContactPatchBody> }>(
  '/contacts/:jid',
  {
    onRequest: [fastify.authenticate],
    schema: { body: ContactPatchBody },
  },
  async (request, reply) => {
    const { jid } = request.params;
    // update contact in DB via Drizzle
    return { ok: true };
  }
);
```

### shadcn/ui Vite Init (Tailwind 4)

```bash
# Source: https://ui.shadcn.com/docs/installation/vite
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm add tailwindcss @tailwindcss/vite
# Replace src/index.css content with: @import "tailwindcss";
# Update vite.config.ts to add tailwindcss() plugin
npx shadcn@latest init
# Answer prompts: style=default, base color=neutral
npx shadcn@latest add button card sheet dialog badge sidebar sonner
```

### TanStack Query v5 Setup

```tsx
// dashboard/src/main.tsx
// Source: https://tanstack.com/query/v5/docs/framework/react/overview
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000, // 10 seconds — dashboard data doesn't need instant freshness
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    <Toaster position="bottom-right" theme="dark" richColors />
  </QueryClientProvider>
);
```

### @fastify/static SPA Fallback

```typescript
// Source: https://github.com/fastify/fastify-static
await fastify.register(staticPlugin, {
  root: new URL('../../dashboard/dist', import.meta.url).pathname,
  prefix: '/',
  wildcard: false,  // Disable wildcard to avoid blocking API routes
});
fastify.setNotFoundHandler((_, reply) => reply.sendFile('index.html'));
```

### Draft Inline Edit with Auto-Resize

```tsx
// Inline edit textarea that expands as the user types
import TextareaAutosize from 'react-textarea-autosize';

function DraftRow({ draft }: { draft: Draft }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const approve = useApproveDraft();

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-border">
      <div className="flex-1 space-y-2">
        <p className="text-sm text-muted-foreground">{draft.inboundMessage}</p>
        {editing ? (
          <TextareaAutosize
            className="w-full resize-none bg-muted rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
            minRows={2}
          />
        ) : (
          <p
            className="text-sm cursor-pointer hover:bg-muted rounded p-2"
            onClick={() => setEditing(true)}
          >
            {body}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => approve.mutate({ id: draft.id, body })} size="sm">
          Approve
        </Button>
        <Button variant="outline" size="sm" onClick={() => rejectDraft(draft.id)}>
          Reject
        </Button>
      </div>
    </div>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js | CSS-first `@import "tailwindcss"` in index.css | Tailwind v4 (Jan 2025) | Config file gone; must use `@theme` directive |
| tailwindcss-animate | tw-animate-css | shadcn/ui v4 migration (2025) | Drop-in replacement; different import |
| shadcn toast component | Sonner | shadcn/ui updated (2025) | Old toast deprecated; Sonner is the current recommended |
| `useQuery(key, fn, opts)` | `useQuery({ queryKey, queryFn, ...opts })` | TanStack Query v5 | Object-only API; no overloads |
| `__dirname` in ESM | `import.meta.dirname` | Node.js 20.11+ | No fileURLToPath boilerplate needed |
| Create React App | Vite | Deprecated 2023 | CRA is dead; Vite is the standard |
| Vite default target `modules` | `baseline-widely-available` | Vite 7 (June 2025) | Slightly higher minimum browser versions; affects no modern browser |

**Deprecated/outdated:**
- `fastify-static` (old unscoped package): use `@fastify/static`
- `fastify-jwt` (old unscoped): use `@fastify/jwt` v9+
- `tailwindcss-animate`: replaced by `tw-animate-css` in shadcn/ui Tailwind 4 projects
- `forwardRef` in shadcn components: removed in 2025 update; components now use `data-slot` attributes

---

## Open Questions

1. **Draft approval flow triggers WhatsApp send — but how?**
   - What we know: The API server and bot share the same process. `sender.ts` exists in whatsapp/.
   - What's unclear: PATCH /api/drafts/:id/approve needs to call the Baileys `sock.sendMessage()` — but `sock` is created in `index.ts` and not currently accessible to API routes. The shared state module (`api/state.ts`) could also hold a reference to the current active `sock`.
   - Recommendation: Extend `api/state.ts` to hold `{ sock: WASocket | null }` and update it when the socket is created/replaced. The drafts route imports from state and calls `state.sock?.sendMessage(...)`.

2. **QR code re-auth flow from the browser**
   - What we know: `onLoggedOut` currently calls `process.exit(1)` and PM2 restarts. The QR code string comes from `onQR` callback.
   - What's unclear: When the user clicks "Re-auth" in the dashboard, should it: (a) trigger `startSocket()` to re-initiate the connection (if the current session just expired and onLoggedOut hasn't fired yet), or (b) require the bot to restart first?
   - Recommendation: Emit QR via SSE as soon as `onQR` fires (already natural). The "Re-auth" button in the dashboard is for when status is `qr_pending` — it just opens the modal; no button press needed to trigger QR generation. QR generation is automatic from the Baileys reconnect cycle.

3. **JWT secret management**
   - What we know: The existing project uses `.env` with `dotenv` and Zod validation.
   - What's unclear: Whether to add `JWT_SECRET` and `DASHBOARD_PASSWORD` to the existing `config.ts` env schema or keep them separate.
   - Recommendation: Add both to `config.ts` with Zod validation. `JWT_SECRET` should be a required string; `DASHBOARD_PASSWORD` is a required string for the single-user login.

---

## Sources

### Primary (HIGH confidence)
- [Fastify TypeScript docs](https://fastify.dev/docs/latest/Reference/TypeScript/) — TypeScript plugin patterns, TypeBox integration
- [Fastify Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/) — plugin loading order, route registration
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) — Tailwind 4 migration, CSS-first config, data-slot, tw-animate-css
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) — exact setup commands for Vite + Tailwind 4
- [shadcn/ui Sidebar component](https://ui.shadcn.com/docs/components/radix/sidebar) — SidebarProvider, SidebarMenu, SidebarMenuButton
- [shadcn/ui Sheet component](https://ui.shadcn.com/docs/components/radix/sheet) — side panel patterns
- [TanStack Query v5 overview](https://tanstack.com/query/v5/docs/framework/react/overview) — QueryClient, useQuery, useMutation
- [TanStack Query v5 migration](https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5) — breaking changes, object API
- [@fastify/jwt GitHub](https://github.com/fastify/fastify-jwt) — v9 for Fastify 5, authenticate decorator pattern
- [@fastify/static GitHub](https://github.com/fastify/fastify-static) — SPA wildcard and sendFile patterns
- [Vite 7 announcement](https://vite.dev/blog/announcing-vite7) — release notes, Node 20.19+ requirement, baseline-widely-available target

### Secondary (MEDIUM confidence)
- [Sonner + shadcn/ui](https://ui.shadcn.com/docs/components/radix/sonner) — verified as official recommended toast replacement
- [react-textarea-autosize npm](https://www.npmjs.com/package/react-textarea-autosize) — verified as active, widely used
- [qrcode.react npm](https://www.npmjs.com/package/qrcode.react) — verified as standard React QR library
- better-sqlite3 `busy_timeout` — verified via SQLite official docs and better-sqlite3 performance guide

### Tertiary (LOW confidence — flag for validation)
- SSE token-in-URL pattern for EventSource auth: multiple community sources confirm it; no single official spec page confirmed during research. Pattern is widely used in practice.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via official docs or shadcn/ui official pages
- Architecture: HIGH — patterns derived from official Fastify and TanStack Query docs; in-process state sharing is a well-understood Node.js pattern
- Pitfalls: HIGH — groups table gap verified against actual codebase schema.ts; busy_timeout and SSE header limitations are documented SQLite/browser specs
- Open questions: MEDIUM — implementation details require planning decisions, not additional research

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (30 days — Tailwind/shadcn ecosystem is fast-moving but stabilized on v4)

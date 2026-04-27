---
created: 2026-04-27T09:51:36.325Z
title: Scoped trip-dashboard share links for non-owner members
area: ui+api
files:
  - dashboard/src/pages/TripView.tsx
  - dashboard/src/hooks/useTrip.ts
  - src/api/routes/trips.ts
  - src/api/plugins/auth.ts
---

## Problem

Trip dashboards today are gated behind a single admin JWT (`DASHBOARD_PASSWORD` → `/api/auth/login` → 30-day token covering ALL `/api/*` routes). The owner can see every trip, every group, every admin surface. There is no way to share a single trip's view with a travel companion without handing them the full admin token, which would let them browse other trips, toggle archive flags, manage groups, see the persona/voice data, etc.

This blocks the very natural use case for v2.2: "send my husband a link so he can see what we've planned for Paris," "let mum check the Sainte-Chapelle time without WhatsApp," etc. Companions of trip groups are the obvious recipients of the trip dashboard work — phases 55-57 built the dashboard precisely for this audience but only the owner can reach it.

Discovered after Phase 57 ship while owner was UAT'ing the drop-a-pin picker — natural follow-on to the v2.2 trip-dashboard polish track.

## Solution

Per-trip signed share token generated from the owner's dashboard, scoped to a single `groupJid` + permission level (`viewer` / `commenter`). Separate dashboard route `/trip-share/:token` renders TripView in a slimmed-down read-mostly layout that hides admin chrome, the trips list, and the cross-trip nav. Backend issues a JWT with claims `{ groupJid, scope: 'trip-share', perm: 'viewer'|'commenter', exp }` validated by a new auth plugin variant that ONLY allows `/api/trips/:groupJid/*` routes for the matching `groupJid` (and rejects with 403 on any other route).

### Open questions (capture before planning)

- **Token revocation UX**: do we list active share tokens in the owner's TripView with a "revoke" button? Need to persist tokens in DB to enumerate (vs stateless JWT). Probably a `trip_shares` table with `(token_id, group_jid, perm, created_at, revoked_at, last_seen_at)`.
- **Identity claim upgrade**: should commenters be able to claim a Google account so their comments carry a real identity, or stay anonymous (`commenter#abc123`)? Anonymous is simpler for v1; Google-claim is a larger phase. Lean anonymous for the MVP.
- **Comment storage**: pile into `trip_decisions.metadata.comments[]` (cheap, no migration) vs new `trip_comments` table (cleaner, supports threading + revocation). Lean: new table — comments will outlive the rows they comment on (deletion / restoration / archive interactions).
- **D14 composition**: how does this compose with archived-trip read-only enforcement? `viewer`/`commenter` should both flip to view-only on archived trips, AND the existing 403 messages from Phase 57 stay distinct. Review.
- **SSE auth for unauthenticated tokens**: existing `/api/trips/:groupJid/stream` SSE route uses the same JWT plugin. Either extend it to accept share-scope tokens (cheaper) or carve out a separate `/api/trip-share/:token/stream` (cleaner boundary, no risk of widening admin SSE auth).
- **Pin picker visibility for commenters**: probably hide entirely (no Places API quota for non-owners). Viewers also hidden. Only owner JWT enables the pin button.
- **Bundle leak**: the slimmed-down `/trip-share/:token` route MUST NOT lazy-load admin components (groups page, persona page, ExportButton OAuth flow). Bundle splitting / route-level code-split needed so the share dashboard ships ~30% of the admin one.
- **Token format**: short-lived (e.g., 30-day default + owner-renewable) signed JWT in URL path is OK for low-stakes view-only; longer-lived needs DB-backed opaque token + lookup. Start with JWT-in-path, add DB row for revocation tracking only.
- **Welcome-message integration**: Phase 59 is "Welcome Message Refresh" — natural fit to include the share link there (auto-generated when a group is registered as a trip).

### Likely scope

Probably 4-5 plans: (a) DB schema for `trip_shares` + token mint/revoke helpers, (b) JWT scope variant + scoped auth plugin, (c) dashboard route `/trip-share/:token` + slimmed TripView layout, (d) owner-side share/revoke UI in TripView, (e) optional: comment system on top.

This naturally slots after Phase 58 (Group↔Trip Linking) — that phase establishes which group each trip is bound to, which the share token claims need to know. So this is candidate Phase 60+ in v2.2 (or its own milestone if v2.2 closes first).

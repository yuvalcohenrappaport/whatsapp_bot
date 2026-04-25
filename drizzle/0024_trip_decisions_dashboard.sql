-- Phase 55 v2.1 — Dashboard schema delta for trip_decisions.
-- Adds soft-delete status column and lat/lng coordinates for the Leaflet map.
--
-- status: NOT NULL DEFAULT 'active' backfills all existing rows atomically.
-- lat/lng: nullable — Phase 51/52 decisions have no coordinates yet.
--
-- Hand-written ALTER TABLE (drizzle-kit generate is unsafe after FTS5 migration
-- 0010 — see project memory and 0022/0023 precedents).

ALTER TABLE trip_decisions ADD COLUMN status text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE trip_decisions ADD COLUMN lat real;
--> statement-breakpoint
ALTER TABLE trip_decisions ADD COLUMN lng real;
--> statement-breakpoint

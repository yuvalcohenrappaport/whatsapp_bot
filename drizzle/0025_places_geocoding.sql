-- Phase 56 v2.2 — Google Places geocoding columns for trip_decisions.
-- Adds place_id, canonical_address, lookup_status, and place_metadata.
--
-- NOTE: lat and lng already exist from migration 0024 (Phase 55 dashboard).
-- Do NOT re-add those columns here.
--
-- lookup_status: NOT NULL DEFAULT 'pending' backfills all existing rows atomically.
-- place_id / canonical_address / place_metadata: nullable — populated by
-- the Places geocoding hook and backfill route (Phase 56 Plans 02-04).
--
-- Hand-written ALTER TABLE (drizzle-kit generate is unsafe after FTS5 migration
-- 0010 — see project memory and 0022/0023/0024 precedents).

ALTER TABLE `trip_decisions` ADD COLUMN `place_id` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `canonical_address` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `lookup_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `place_metadata` text;

-- Phase 54 v2.1 — Proactive day-of intelligence.
-- Adds a free-form metadata JSON text column to trip_contexts so the briefing
-- cron can store last_briefing_date, cached IANA tz, resolved OpenWeather
-- coords, and similar per-trip soft state without another schema change.
--
-- Mirrors migration 0022's `trip_decisions.metadata` column exactly:
-- nullable text, no DEFAULT, no NOT NULL. Kept as one statement-breakpoint
-- block per repo convention (hand-written ALTER TABLE ADD COLUMN).

ALTER TABLE `trip_contexts` ADD `metadata` text;

-- Phase 51 v2.1 — Richer trip memory.
-- Adds structured per-category/per-person/per-cost columns to trip_decisions,
-- trip-lifecycle columns (dates, budget, status, briefing_time) to trip_contexts,
-- and a sibling trip_archive table that the daily auto-archive cron moves
-- expired trip_contexts rows into (end_date + 3 days).
--
-- Decision-archival strategy: boolean `archived` flag on trip_decisions
-- (see 51-01-PLAN.md <decision_rationale>) — no FK, no sibling decisions table.
--
-- Idempotence: drizzle-kit journal (meta/_journal.json) guards against
-- double-application at the migration-runner level. Do NOT add IF NOT EXISTS
-- guards here — the repo convention is hand-written ALTER TABLE ADD COLUMN
-- per column, one breakpoint line between each (see 0021 for a precedent).

-- ─── trip_decisions additions ────────────────────────────────────────────────

ALTER TABLE `trip_decisions` ADD COLUMN `proposed_by` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `category` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `cost_amount` real;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `cost_currency` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `conflicts_with` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `origin` text DEFAULT 'inferred' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `metadata` text;
--> statement-breakpoint
ALTER TABLE `trip_decisions` ADD COLUMN `archived` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- ─── trip_contexts additions ────────────────────────────────────────────────

ALTER TABLE `trip_contexts` ADD COLUMN `start_date` text;
--> statement-breakpoint
ALTER TABLE `trip_contexts` ADD COLUMN `end_date` text;
--> statement-breakpoint
ALTER TABLE `trip_contexts` ADD COLUMN `budget_by_category` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trip_contexts` ADD COLUMN `calendar_id` text;
--> statement-breakpoint
ALTER TABLE `trip_contexts` ADD COLUMN `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trip_contexts` ADD COLUMN `briefing_time` text;
--> statement-breakpoint

-- ─── trip_archive table ─────────────────────────────────────────────────────

CREATE TABLE `trip_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`destination` text,
	`dates` text,
	`context_summary` text,
	`last_classified_at` integer,
	`updated_at` integer NOT NULL,
	`start_date` text,
	`end_date` text,
	`budget_by_category` text DEFAULT '{}' NOT NULL,
	`calendar_id` text,
	`status` text NOT NULL,
	`briefing_time` text,
	`archived_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trip_archive_group` ON `trip_archive` (`group_jid`);
--> statement-breakpoint
CREATE INDEX `idx_trip_archive_end_date` ON `trip_archive` (`end_date`);

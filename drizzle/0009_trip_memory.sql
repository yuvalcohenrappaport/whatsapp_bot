CREATE TABLE `trip_contexts` (
	`group_jid` text PRIMARY KEY NOT NULL,
	`destination` text,
	`dates` text,
	`context_summary` text,
	`last_classified_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trip_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`confidence` text DEFAULT 'high' NOT NULL,
	`source_message_id` text,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trip_decisions_group` ON `trip_decisions` (`group_jid`);--> statement-breakpoint
CREATE INDEX `idx_trip_decisions_type` ON `trip_decisions` (`group_jid`,`type`);
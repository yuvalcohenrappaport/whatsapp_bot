CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`fire_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`calendar_event_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_status_fire` ON `reminders` (`status`,`fire_at`);

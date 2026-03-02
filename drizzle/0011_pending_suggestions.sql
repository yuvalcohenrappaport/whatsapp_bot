CREATE TABLE `pending_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`suggestion_msg_id` text NOT NULL,
	`title` text NOT NULL,
	`event_date` integer NOT NULL,
	`location` text,
	`description` text,
	`url` text,
	`calendar_id` text NOT NULL,
	`calendar_link` text NOT NULL,
	`source_message_id` text NOT NULL,
	`sender_name` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pending_suggestions_msg_id` ON `pending_suggestions` (`suggestion_msg_id`);
--> statement-breakpoint
CREATE INDEX `idx_pending_suggestions_group` ON `pending_suggestions` (`group_jid`);
--> statement-breakpoint
CREATE INDEX `idx_pending_suggestions_expiry` ON `pending_suggestions` (`expires_at`);

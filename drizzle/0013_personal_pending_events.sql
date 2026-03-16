CREATE TABLE `personal_pending_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_chat_jid` text NOT NULL,
	`source_chat_name` text,
	`sender_jid` text NOT NULL,
	`sender_name` text,
	`source_message_id` text NOT NULL,
	`source_message_text` text NOT NULL,
	`title` text NOT NULL,
	`event_date` integer NOT NULL,
	`location` text,
	`description` text,
	`url` text,
	`status` text NOT NULL DEFAULT 'pending',
	`notification_msg_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_personal_pending_status` ON `personal_pending_events` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_personal_pending_notification` ON `personal_pending_events` (`notification_msg_id`);

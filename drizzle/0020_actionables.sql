CREATE TABLE IF NOT EXISTS `actionables` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_contact_jid` text NOT NULL,
	`source_contact_name` text,
	`source_message_id` text,
	`source_message_text` text DEFAULT '' NOT NULL,
	`detected_language` text DEFAULT 'en' NOT NULL,
	`original_detected_task` text NOT NULL,
	`task` text NOT NULL,
	`status` text DEFAULT 'pending_approval' NOT NULL,
	`detected_at` integer NOT NULL,
	`fire_at` integer,
	`enriched_title` text,
	`enriched_note` text,
	`todo_task_id` text,
	`todo_list_id` text,
	`approval_preview_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_actionables_status_detected` ON `actionables` (`status`, `detected_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_actionables_preview_msg` ON `actionables` (`approval_preview_message_id`);

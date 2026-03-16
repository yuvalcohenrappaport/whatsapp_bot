CREATE TABLE `todo_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`contact_jid` text NOT NULL,
	`contact_name` text,
	`original_text` text,
	`todo_task_id` text,
	`todo_list_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`notification_msg_id` text,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`created_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_todo_tasks_status` ON `todo_tasks` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_todo_tasks_notification` ON `todo_tasks` (`notification_msg_id`);

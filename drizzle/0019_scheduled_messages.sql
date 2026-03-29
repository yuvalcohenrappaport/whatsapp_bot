CREATE TABLE `scheduled_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_at` integer NOT NULL,
	`cron_expression` text,
	`notification_msg_id` text,
	`cancel_requested_at` integer,
	`sent_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_messages_status_at` ON `scheduled_messages` (`status`, `scheduled_at`);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_messages_notification` ON `scheduled_messages` (`notification_msg_id`);
--> statement-breakpoint
CREATE TABLE `scheduled_message_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_message_id` text NOT NULL,
	`recipient_jid` text NOT NULL,
	`recipient_type` text DEFAULT 'contact' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_content` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_smr_message_id` ON `scheduled_message_recipients` (`scheduled_message_id`);
--> statement-breakpoint
CREATE INDEX `idx_smr_status` ON `scheduled_message_recipients` (`status`);

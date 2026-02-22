CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_jid` text NOT NULL,
	`in_reply_to_message_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`actioned_at` integer
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `relationship` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `custom_instructions` text;
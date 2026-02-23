CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`message_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`calendar_event_id` text NOT NULL,
	`confirmation_msg_id` text,
	`title` text NOT NULL,
	`event_date` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_confirmation` ON `calendar_events` (`confirmation_msg_id`);--> statement-breakpoint
CREATE INDEX `idx_calendar_events_group` ON `calendar_events` (`group_jid`);--> statement-breakpoint
CREATE TABLE `group_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`sender_jid` text NOT NULL,
	`sender_name` text,
	`from_me` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_group_messages_group_ts` ON `group_messages` (`group_jid`,`timestamp`);--> statement-breakpoint
ALTER TABLE `groups` ADD `reminder_hour` integer DEFAULT 9;
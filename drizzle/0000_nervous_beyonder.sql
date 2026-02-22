CREATE TABLE `contacts` (
	`jid` text PRIMARY KEY NOT NULL,
	`name` text,
	`mode` text DEFAULT 'off' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_jid` text NOT NULL,
	`from_me` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`timestamp` integer NOT NULL,
	`processed` integer DEFAULT false,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_contact_ts` ON `messages` (`contact_jid`,`timestamp`);
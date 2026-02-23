CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`active` integer DEFAULT true NOT NULL,
	`reminder_day` text,
	`calendar_link` text,
	`member_emails` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

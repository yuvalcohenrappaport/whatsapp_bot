ALTER TABLE `contacts` ADD `style_summary` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `snooze_until` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `consecutive_auto_count` integer DEFAULT 0;
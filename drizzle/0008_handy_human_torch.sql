PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`jid` text PRIMARY KEY NOT NULL,
	`name` text,
	`mode` text DEFAULT 'off' NOT NULL,
	`relationship` text,
	`custom_instructions` text,
	`style_summary` text,
	`snooze_until` integer,
	`consecutive_auto_count` integer DEFAULT 0,
	`voice_reply_enabled` integer DEFAULT true NOT NULL,
	`voice_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("jid", "name", "mode", "relationship", "custom_instructions", "style_summary", "snooze_until", "consecutive_auto_count", "voice_reply_enabled", "voice_id", "created_at", "updated_at") SELECT "jid", "name", "mode", "relationship", "custom_instructions", "style_summary", "snooze_until", "consecutive_auto_count", "voice_reply_enabled", "voice_id", "created_at", "updated_at" FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `drafts` ADD `is_voice` integer DEFAULT false NOT NULL;
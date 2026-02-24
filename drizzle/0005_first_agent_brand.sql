CREATE TABLE `keyword_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`group_jid` text NOT NULL,
	`name` text NOT NULL,
	`pattern` text NOT NULL,
	`is_regex` integer DEFAULT false NOT NULL,
	`response_type` text NOT NULL,
	`response_text` text,
	`ai_instructions` text,
	`enabled` integer DEFAULT true NOT NULL,
	`cooldown_ms` integer DEFAULT 60000 NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`last_triggered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_keyword_rules_group` ON `keyword_rules` (`group_jid`);
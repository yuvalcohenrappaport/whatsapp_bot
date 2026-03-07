ALTER TABLE groups ADD COLUMN travel_bot_active integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE groups ADD COLUMN keyword_rules_active integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE groups SET travel_bot_active = active, keyword_rules_active = active;
--> statement-breakpoint
ALTER TABLE groups DROP COLUMN active;

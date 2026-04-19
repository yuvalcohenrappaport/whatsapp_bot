-- Phase 39 backfill — migrate in-flight rows from reminders + todo_tasks
-- into the unified actionables table per .planning/phases/39-actionables-data-model/39-CONTEXT.md.
-- Every INSERT is guarded by `WHERE NOT EXISTS (... WHERE a.id = legacy.id)` so re-runs are no-ops.
-- Legacy tables are left in place — formal DROP deferred to a later milestone.

-- ─── reminders(source='commitment') → actionables ────────────────────────────

-- pending → approved (grandfather: already pushed to Google Tasks)
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'commitment', COALESCE(r.source_contact_jid, 'unknown'), NULL,
	NULL, '', 'en',
	r.task, r.task, 'approved',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE r.source = 'commitment' AND r.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- fired → fired
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'commitment', COALESCE(r.source_contact_jid, 'unknown'), NULL,
	NULL, '', 'en',
	r.task, r.task, 'fired',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE r.source = 'commitment' AND r.status = 'fired'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- cancelled → rejected
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'commitment', COALESCE(r.source_contact_jid, 'unknown'), NULL,
	NULL, '', 'en',
	r.task, r.task, 'rejected',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE r.source = 'commitment' AND r.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- skipped → expired
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'commitment', COALESCE(r.source_contact_jid, 'unknown'), NULL,
	NULL, '', 'en',
	r.task, r.task, 'expired',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE r.source = 'commitment' AND r.status = 'skipped'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- ─── reminders(source='user' or NULL) → actionables (self-chat commands) ─────
-- Uses 'USER_JID_PLACEHOLDER' for source_contact_jid; a startup fixup in
-- src/db/client.ts rewrites this to config.USER_JID on first boot.

-- pending → approved (user-initiated, already acted on)
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'user_command', 'USER_JID_PLACEHOLDER', 'Self',
	NULL, '', 'en',
	r.task, r.task, 'approved',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE (r.source = 'user' OR r.source IS NULL) AND r.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- fired → fired
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'user_command', 'USER_JID_PLACEHOLDER', 'Self',
	NULL, '', 'en',
	r.task, r.task, 'fired',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE (r.source = 'user' OR r.source IS NULL) AND r.status = 'fired'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- cancelled → rejected
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'user_command', 'USER_JID_PLACEHOLDER', 'Self',
	NULL, '', 'en',
	r.task, r.task, 'rejected',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE (r.source = 'user' OR r.source IS NULL) AND r.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- skipped → expired
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	r.id, 'user_command', 'USER_JID_PLACEHOLDER', 'Self',
	NULL, '', 'en',
	r.task, r.task, 'expired',
	r.created_at, r.fire_at,
	NULL, NULL,
	r.todo_task_id, r.todo_list_id,
	NULL,
	r.created_at, r.updated_at
FROM `reminders` r
WHERE (r.source = 'user' OR r.source IS NULL) AND r.status = 'skipped'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = r.id);
--> statement-breakpoint

-- ─── todo_tasks → actionables ────────────────────────────────────────────────

-- synced → approved (already in Google Tasks)
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	t.id, 'task', t.contact_jid, t.contact_name,
	NULL, COALESCE(t.original_text, ''), 'en',
	t.task, t.task, 'approved',
	t.created_at, NULL,
	NULL, NULL,
	t.todo_task_id, t.todo_list_id,
	t.notification_msg_id,
	t.created_at, COALESCE(t.synced_at, t.created_at)
FROM `todo_tasks` t
WHERE t.status = 'synced'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = t.id);
--> statement-breakpoint

-- pending → pending_approval (re-gate: never synced, run through new gate)
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	t.id, 'task', t.contact_jid, t.contact_name,
	NULL, COALESCE(t.original_text, ''), 'en',
	t.task, t.task, 'pending_approval',
	t.created_at, NULL,
	NULL, NULL,
	t.todo_task_id, t.todo_list_id,
	t.notification_msg_id,
	t.created_at, t.created_at
FROM `todo_tasks` t
WHERE t.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = t.id);
--> statement-breakpoint

-- failed → pending_approval (same re-gate as pending)
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	t.id, 'task', t.contact_jid, t.contact_name,
	NULL, COALESCE(t.original_text, ''), 'en',
	t.task, t.task, 'pending_approval',
	t.created_at, NULL,
	NULL, NULL,
	t.todo_task_id, t.todo_list_id,
	t.notification_msg_id,
	t.created_at, t.created_at
FROM `todo_tasks` t
WHERE t.status = 'failed'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = t.id);
--> statement-breakpoint

-- cancelled → rejected
INSERT INTO `actionables` (
	id, source_type, source_contact_jid, source_contact_name,
	source_message_id, source_message_text, detected_language,
	original_detected_task, task, status,
	detected_at, fire_at,
	enriched_title, enriched_note,
	todo_task_id, todo_list_id,
	approval_preview_message_id,
	created_at, updated_at
)
SELECT
	t.id, 'task', t.contact_jid, t.contact_name,
	NULL, COALESCE(t.original_text, ''), 'en',
	t.task, t.task, 'rejected',
	t.created_at, NULL,
	NULL, NULL,
	t.todo_task_id, t.todo_list_id,
	t.notification_msg_id,
	t.created_at, t.created_at
FROM `todo_tasks` t
WHERE t.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM `actionables` a WHERE a.id = t.id);

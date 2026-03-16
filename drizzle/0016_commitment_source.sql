ALTER TABLE reminders ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE reminders ADD COLUMN source_contact_jid TEXT;

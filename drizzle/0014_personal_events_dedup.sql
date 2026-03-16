ALTER TABLE personal_pending_events ADD COLUMN content_hash TEXT;
ALTER TABLE personal_pending_events ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_personal_pending_content_hash ON personal_pending_events(content_hash);

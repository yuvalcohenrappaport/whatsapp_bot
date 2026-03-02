CREATE VIRTUAL TABLE IF NOT EXISTS group_messages_fts USING fts5(body, content='group_messages', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_ai AFTER INSERT ON group_messages BEGIN
  INSERT INTO group_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_ad AFTER DELETE ON group_messages BEGIN
  INSERT INTO group_messages_fts(group_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS group_messages_fts_au AFTER UPDATE ON group_messages BEGIN
  INSERT INTO group_messages_fts(group_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO group_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
INSERT INTO group_messages_fts(group_messages_fts) VALUES('rebuild');

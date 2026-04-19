import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

// The backfill test operates at raw-SQL level against a fresh in-memory DB.
// It asserts the 9 row mappings from 39-CONTEXT.md produce the expected
// actionables rows with correct status + Google Tasks id preservation,
// and that re-running the backfill is a no-op.

function loadSQL(path: string): string[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function createLegacyTables(db: Database.Database) {
  // Minimal schema for reminders + todo_tasks, matching the production DDL.
  db.exec(`
    CREATE TABLE reminders (
      id TEXT PRIMARY KEY NOT NULL,
      task TEXT NOT NULL,
      fire_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      calendar_event_id TEXT,
      todo_task_id TEXT,
      todo_list_id TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      source_contact_jid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE todo_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      task TEXT NOT NULL,
      contact_jid TEXT NOT NULL,
      contact_name TEXT,
      original_text TEXT,
      todo_task_id TEXT,
      todo_list_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      notification_msg_id TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    );
  `);
}

function insertReminder(
  db: Database.Database,
  row: {
    id: string;
    task: string;
    fireAt: number;
    status: string;
    source: string | null;
    sourceContactJid?: string | null;
    todoTaskId?: string | null;
    todoListId?: string | null;
  },
) {
  const now = Date.now();
  db.prepare(
    'INSERT INTO reminders (id, task, fire_at, status, source, source_contact_jid, todo_task_id, todo_list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.id,
    row.task,
    row.fireAt,
    row.status,
    row.source,
    row.sourceContactJid ?? null,
    row.todoTaskId ?? null,
    row.todoListId ?? null,
    now,
    now,
  );
}

function insertTodoTask(
  db: Database.Database,
  row: {
    id: string;
    task: string;
    contactJid: string;
    contactName?: string | null;
    originalText?: string | null;
    status: string;
    todoTaskId?: string | null;
    todoListId?: string | null;
    notificationMsgId?: string | null;
  },
) {
  const now = Date.now();
  db.prepare(
    'INSERT INTO todo_tasks (id, task, contact_jid, contact_name, original_text, todo_task_id, todo_list_id, status, notification_msg_id, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.id,
    row.task,
    row.contactJid,
    row.contactName ?? null,
    row.originalText ?? null,
    row.todoTaskId ?? null,
    row.todoListId ?? null,
    row.status,
    row.notificationMsgId ?? null,
    now,
    row.status === 'synced' ? now : null,
  );
}

function fetchActionable(db: Database.Database, id: string) {
  return db.prepare('SELECT * FROM actionables WHERE id = ?').get(id) as
    | {
        id: string;
        source_type: string;
        source_contact_jid: string;
        source_contact_name: string | null;
        source_message_text: string;
        detected_language: string;
        original_detected_task: string;
        task: string;
        status: string;
        todo_task_id: string | null;
        todo_list_id: string | null;
      }
    | undefined;
}

describe('actionables backfill', () => {
  const createActionables = loadSQL('drizzle/0020_actionables.sql');
  const backfill = loadSQL('drizzle/0021_actionables_backfill.sql');

  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createLegacyTables(db);
    for (const stmt of createActionables) db.exec(stmt);
  });

  it('maps pending commitment reminders → approved with Google Tasks ids preserved', () => {
    insertReminder(db, {
      id: 'R1',
      task: 'send the report',
      fireAt: 9999,
      status: 'pending',
      source: 'commitment',
      sourceContactJid: 'lee@s.whatsapp.net',
      todoTaskId: 'TASK_X',
      todoListId: 'LIST_X',
    });
    for (const stmt of backfill) db.exec(stmt);

    const row = fetchActionable(db, 'R1');
    expect(row).toBeDefined();
    expect(row!.source_type).toBe('commitment');
    expect(row!.status).toBe('approved');
    expect(row!.source_contact_jid).toBe('lee@s.whatsapp.net');
    expect(row!.todo_task_id).toBe('TASK_X');
    expect(row!.todo_list_id).toBe('LIST_X');
    expect(row!.task).toBe('send the report');
    expect(row!.original_detected_task).toBe('send the report');
  });

  it('maps fired commitment reminders → fired terminal', () => {
    insertReminder(db, {
      id: 'R2',
      task: 't',
      fireAt: 1,
      status: 'fired',
      source: 'commitment',
      sourceContactJid: 'x@s.whatsapp.net',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'R2')?.status).toBe('fired');
  });

  it('maps cancelled commitment reminders → rejected', () => {
    insertReminder(db, {
      id: 'R3',
      task: 't',
      fireAt: 1,
      status: 'cancelled',
      source: 'commitment',
      sourceContactJid: 'x@s.whatsapp.net',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'R3')?.status).toBe('rejected');
  });

  it('maps skipped commitment reminders → expired', () => {
    insertReminder(db, {
      id: 'R4',
      task: 't',
      fireAt: 1,
      status: 'skipped',
      source: 'commitment',
      sourceContactJid: 'x@s.whatsapp.net',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'R4')?.status).toBe('expired');
  });

  it('maps pending user reminders → approved + user_command + USER_JID_PLACEHOLDER', () => {
    insertReminder(db, {
      id: 'R5',
      task: 'call mom at 6pm',
      fireAt: 9999,
      status: 'pending',
      source: 'user',
      todoTaskId: 'UT1',
      todoListId: 'UL1',
    });
    for (const stmt of backfill) db.exec(stmt);

    const row = fetchActionable(db, 'R5');
    expect(row!.source_type).toBe('user_command');
    expect(row!.status).toBe('approved');
    expect(row!.source_contact_jid).toBe('USER_JID_PLACEHOLDER');
    expect(row!.source_contact_name).toBe('Self');
    expect(row!.todo_task_id).toBe('UT1');
    expect(row!.todo_list_id).toBe('UL1');
  });

  it('maps synced todoTasks → approved with Google Tasks ids preserved', () => {
    insertTodoTask(db, {
      id: 'T1',
      task: 'buy milk',
      contactJid: 'shared@g.us',
      contactName: 'House chat',
      originalText: 'need to buy milk later',
      status: 'synced',
      todoTaskId: 'GT_TASK',
      todoListId: 'GT_LIST',
      notificationMsgId: 'NOTIF_1',
    });
    for (const stmt of backfill) db.exec(stmt);

    const row = fetchActionable(db, 'T1');
    expect(row!.source_type).toBe('task');
    expect(row!.status).toBe('approved');
    expect(row!.source_contact_jid).toBe('shared@g.us');
    expect(row!.source_contact_name).toBe('House chat');
    expect(row!.todo_task_id).toBe('GT_TASK');
    expect(row!.todo_list_id).toBe('GT_LIST');
    expect(row!.source_message_text).toBe('need to buy milk later');
  });

  it('maps pending todoTasks → pending_approval (re-gated)', () => {
    insertTodoTask(db, {
      id: 'T2',
      task: 'fix the door',
      contactJid: 'alice@s.whatsapp.net',
      status: 'pending',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'T2')?.status).toBe('pending_approval');
  });

  it('maps failed todoTasks → pending_approval', () => {
    insertTodoTask(db, {
      id: 'T3',
      task: 'x',
      contactJid: 'a@s.whatsapp.net',
      status: 'failed',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'T3')?.status).toBe('pending_approval');
  });

  it('maps cancelled todoTasks → rejected', () => {
    insertTodoTask(db, {
      id: 'T4',
      task: 'x',
      contactJid: 'a@s.whatsapp.net',
      status: 'cancelled',
    });
    for (const stmt of backfill) db.exec(stmt);
    expect(fetchActionable(db, 'T4')?.status).toBe('rejected');
  });

  it('is idempotent on re-run', () => {
    insertReminder(db, {
      id: 'R_IDEM',
      task: 't',
      fireAt: 1,
      status: 'pending',
      source: 'commitment',
      sourceContactJid: 'x@s.whatsapp.net',
    });
    insertTodoTask(db, {
      id: 'T_IDEM',
      task: 't',
      contactJid: 'a@s.whatsapp.net',
      status: 'synced',
      todoTaskId: 'G1',
      todoListId: 'L1',
    });
    for (const stmt of backfill) db.exec(stmt);
    const firstCount = (
      db.prepare('SELECT COUNT(*) as c FROM actionables').get() as { c: number }
    ).c;
    // Second pass
    for (const stmt of backfill) db.exec(stmt);
    const secondCount = (
      db.prepare('SELECT COUNT(*) as c FROM actionables').get() as { c: number }
    ).c;
    expect(secondCount).toBe(firstCount);
    expect(firstCount).toBe(2);
  });

  it('covers every source × status combination from the mapping table', () => {
    // One row per mapping (9 mappings from 39-CONTEXT.md)
    const seeds = [
      // commitment source
      { kind: 'reminder', id: 'C_P', source: 'commitment', status: 'pending' },
      { kind: 'reminder', id: 'C_F', source: 'commitment', status: 'fired' },
      {
        kind: 'reminder',
        id: 'C_C',
        source: 'commitment',
        status: 'cancelled',
      },
      { kind: 'reminder', id: 'C_S', source: 'commitment', status: 'skipped' },
      // user source
      { kind: 'reminder', id: 'U_P', source: 'user', status: 'pending' },
      { kind: 'reminder', id: 'U_F', source: 'user', status: 'fired' },
      { kind: 'reminder', id: 'U_C', source: 'user', status: 'cancelled' },
      { kind: 'reminder', id: 'U_S', source: 'user', status: 'skipped' },
      // todo_tasks
      { kind: 'todo', id: 'TT_S', status: 'synced' },
      { kind: 'todo', id: 'TT_P', status: 'pending' },
      { kind: 'todo', id: 'TT_F', status: 'failed' },
      { kind: 'todo', id: 'TT_C', status: 'cancelled' },
    ];
    for (const s of seeds) {
      if (s.kind === 'reminder') {
        insertReminder(db, {
          id: s.id,
          task: 't',
          fireAt: 1,
          status: s.status,
          source: s.source as string,
          sourceContactJid: 'x@s.whatsapp.net',
        });
      } else {
        insertTodoTask(db, {
          id: s.id,
          task: 't',
          contactJid: 'a@s.whatsapp.net',
          status: s.status,
        });
      }
    }
    for (const stmt of backfill) db.exec(stmt);

    const expectedMap: Record<string, string> = {
      C_P: 'approved',
      C_F: 'fired',
      C_C: 'rejected',
      C_S: 'expired',
      U_P: 'approved',
      U_F: 'fired',
      U_C: 'rejected',
      U_S: 'expired',
      TT_S: 'approved',
      TT_P: 'pending_approval',
      TT_F: 'pending_approval',
      TT_C: 'rejected',
    };
    for (const [id, expected] of Object.entries(expectedMap)) {
      const row = fetchActionable(db, id);
      expect(row, `missing backfilled row for ${id}`).toBeDefined();
      expect(row!.status, `wrong status for ${id}`).toBe(expected);
    }
  });
});

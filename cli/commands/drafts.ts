import { Command } from 'commander';
import React from 'react';
import { renderToString } from 'ink';
import { eq, desc, sql, and } from 'drizzle-orm';
import { db } from '../db.js';
import { drafts, contacts, messages } from '../../src/db/schema.js';
import { Table, formatDate } from '../ui/Table.js';

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

export function addDraftsCommand(program: Command): void {
  const draftsCmd = new Command('drafts').description('Manage draft replies');

  draftsCmd
    .command('list')
    .description('List pending drafts')
    .action(() => {
      const pendingDrafts = db
        .select()
        .from(drafts)
        .where(eq(drafts.status, 'pending'))
        .orderBy(desc(drafts.createdAt))
        .all();

      if (pendingDrafts.length === 0) {
        process.stdout.write('No pending drafts\n');
        return;
      }

      const rows = pendingDrafts.map((draft) => {
        const contact = db
          .select({ name: contacts.name })
          .from(contacts)
          .where(eq(contacts.jid, draft.contactJid))
          .get();

        const message = db
          .select({ body: messages.body })
          .from(messages)
          .where(eq(messages.id, draft.inReplyToMessageId))
          .get();

        return [
          draft.id.substring(0, 8),
          truncate(contact?.name || draft.contactJid, 16),
          truncate(message?.body || '(unknown)', 28),
          truncate(draft.body, 28),
          formatDate(draft.createdAt),
        ];
      });

      const output = renderToString(
        React.createElement(Table, {
          headers: ['ID', 'Contact', 'Their Message', 'Draft Reply', 'Created'],
          rows,
          widths: [10, 18, 30, 30, 18],
        }),
      );
      process.stdout.write(output + '\n');
    });

  draftsCmd
    .command('approve <id>')
    .description('Approve a pending draft (marks as sent in DB)')
    .action((id: string) => {
      // Find matching drafts by partial ID
      const matching = db
        .select()
        .from(drafts)
        .where(sql`${drafts.id} LIKE ${id + '%'} AND ${drafts.status} = 'pending'`)
        .all();

      if (matching.length === 0) {
        process.stderr.write(`No pending draft matching "${id}"\n`);
        process.exit(1);
      }

      if (matching.length > 1) {
        process.stderr.write(
          `Ambiguous ID "${id}" matches ${matching.length} drafts. Be more specific:\n`,
        );
        for (const m of matching) {
          process.stderr.write(`  ${m.id.substring(0, 12)}  ${truncate(m.body, 40)}\n`);
        }
        process.exit(1);
      }

      const draft = matching[0];
      db.update(drafts)
        .set({ status: 'sent', actionedAt: Date.now() })
        .where(and(eq(drafts.id, draft.id), eq(drafts.status, 'pending')))
        .run();

      process.stdout.write(
        `Draft ${draft.id.substring(0, 8)} approved (marked as sent).\n` +
          `Note: message was marked in DB but not sent via WhatsApp.\n` +
          `Use the web dashboard's approve button to send directly.\n`,
      );
    });

  draftsCmd
    .command('reject <id>')
    .description('Reject a pending draft')
    .action((id: string) => {
      // Find matching drafts by partial ID
      const matching = db
        .select()
        .from(drafts)
        .where(sql`${drafts.id} LIKE ${id + '%'} AND ${drafts.status} = 'pending'`)
        .all();

      if (matching.length === 0) {
        process.stderr.write(`No pending draft matching "${id}"\n`);
        process.exit(1);
      }

      if (matching.length > 1) {
        process.stderr.write(
          `Ambiguous ID "${id}" matches ${matching.length} drafts. Be more specific:\n`,
        );
        for (const m of matching) {
          process.stderr.write(`  ${m.id.substring(0, 12)}  ${truncate(m.body, 40)}\n`);
        }
        process.exit(1);
      }

      const draft = matching[0];
      const result = db
        .update(drafts)
        .set({ status: 'rejected', actionedAt: Date.now() })
        .where(and(eq(drafts.id, draft.id), eq(drafts.status, 'pending')))
        .run();

      if (result.changes === 0) {
        process.stderr.write(`Draft not found or not pending\n`);
        process.exit(1);
      }

      process.stdout.write(`Draft ${draft.id.substring(0, 8)} rejected\n`);
    });

  program.addCommand(draftsCmd);
}

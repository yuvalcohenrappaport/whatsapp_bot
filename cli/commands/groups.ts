import type { Command } from 'commander';
import React from 'react';
import { Text } from 'ink';
import { renderToString } from 'ink';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { groups } from '../../src/db/schema.js';
import { Table } from '../ui/Table.js';

const VALID_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

function normalizeGroupJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@g.us`;
}

function stripGroupJid(jid: string): string {
  return jid.replace(/@g\.us$/, '');
}

export function addGroupsCommand(program: Command): void {
  const cmd = program
    .command('groups')
    .description('Manage tracked groups');

  cmd
    .command('list')
    .description('List all tracked groups')
    .action(() => {
      const allGroups = db.select().from(groups).all();

      const rows = allGroups.map((g) => {
        const activeText = g.active
          ? renderToString(React.createElement(Text, { color: 'green' }, 'yes'))
          : renderToString(React.createElement(Text, { color: 'red' }, 'no'));

        return [
          stripGroupJid(g.id),
          g.name ?? '—',
          activeText,
          g.reminderDay ?? '—',
        ];
      });

      const output = renderToString(
        React.createElement(Table, {
          headers: ['JID', 'Name', 'Active', 'Reminder Day'],
          rows,
          widths: [30, 25, 8, 14],
        }),
      );

      process.stdout.write(output + '\n');
    });

  cmd
    .command('add <jid>')
    .description('Add a new tracked group')
    .option('-n, --name <name>', 'Group name')
    .action((jid: string, opts: { name?: string }) => {
      const normalizedJid = normalizeGroupJid(jid);

      db.insert(groups)
        .values({ id: normalizedJid, name: opts.name ?? null })
        .run();

      console.log(`Added group: ${normalizedJid}`);
    });

  cmd
    .command('remove <jid>')
    .description('Remove a tracked group')
    .action((jid: string) => {
      const normalizedJid = normalizeGroupJid(jid);

      db.delete(groups)
        .where(eq(groups.id, normalizedJid))
        .run();

      console.log(`Removed group: ${normalizedJid}`);
    });

  cmd
    .command('set-reminder <jid> <day>')
    .description('Set the weekly reminder day for a group')
    .action((jid: string, day: string) => {
      const normalizedDay = day.toLowerCase();

      if (!VALID_DAYS.includes(normalizedDay as (typeof VALID_DAYS)[number])) {
        console.error(
          `Invalid day: "${day}". Must be one of: ${VALID_DAYS.join(', ')}`,
        );
        process.exit(1);
      }

      const normalizedJid = normalizeGroupJid(jid);

      db.update(groups)
        .set({ reminderDay: normalizedDay, updatedAt: Date.now() })
        .where(eq(groups.id, normalizedJid))
        .run();

      console.log(`Set reminder day for ${normalizedJid} to ${normalizedDay}`);
    });
}

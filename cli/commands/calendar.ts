import { Command } from 'commander';
import React from 'react';
import { renderToString, Text, Box } from 'ink';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { groups } from '../../src/db/schema.js';

function normalizeJid(jid: string): string {
  if (!jid.includes('@')) return jid + '@g.us';
  return jid;
}

export function addCalendarCommand(program: Command): void {
  const calendarCmd = new Command('calendar').description('Calendar management');
  const membersCmd = new Command('members').description('Manage group member emails');

  membersCmd
    .command('list')
    .description('List member emails for a group')
    .requiredOption('-g, --group <jid>', 'Group JID')
    .action((opts: { group: string }) => {
      const jid = normalizeJid(opts.group);
      const group = db.select().from(groups).where(eq(groups.id, jid)).get();

      if (!group) {
        process.stderr.write(`Group ${jid} not found\n`);
        process.exit(1);
      }

      const emails: string[] = JSON.parse(group.memberEmails || '[]');
      const displayName = group.name || jid;

      if (emails.length === 0) {
        process.stdout.write(`No member emails configured for ${displayName}\n`);
        return;
      }

      const items = emails.map((email, i) =>
        React.createElement(
          Box,
          { key: i },
          React.createElement(Text, null, `  ${i + 1}. ${email}`),
        ),
      );

      const output = renderToString(
        React.createElement(
          Box,
          { flexDirection: 'column' },
          React.createElement(
            Text,
            { bold: true },
            `Member emails for ${displayName} (${jid}):`,
          ),
          ...items,
        ),
      );
      process.stdout.write(output + '\n');
    });

  membersCmd
    .command('add <email>')
    .description('Add a member email to a group')
    .requiredOption('-g, --group <jid>', 'Group JID')
    .action((email: string, opts: { group: string }) => {
      const jid = normalizeJid(opts.group);
      const group = db.select().from(groups).where(eq(groups.id, jid)).get();

      if (!group) {
        process.stderr.write(`Group ${jid} not found\n`);
        process.exit(1);
      }

      const emails: string[] = JSON.parse(group.memberEmails || '[]');

      // Case-insensitive duplicate check
      if (emails.some((e) => e.toLowerCase() === email.toLowerCase())) {
        process.stdout.write('Email already in list\n');
        return;
      }

      emails.push(email);
      const serialized = JSON.stringify(emails);

      db.update(groups)
        .set({ memberEmails: serialized, updatedAt: Date.now() })
        .where(eq(groups.id, jid))
        .run();

      const displayName = group.name || jid;
      process.stdout.write(
        `Added ${email} to group ${displayName} (now ${emails.length} members)\n`,
      );
    });

  membersCmd
    .command('remove <email>')
    .description('Remove a member email from a group')
    .requiredOption('-g, --group <jid>', 'Group JID')
    .action((email: string, opts: { group: string }) => {
      const jid = normalizeJid(opts.group);
      const group = db.select().from(groups).where(eq(groups.id, jid)).get();

      if (!group) {
        process.stderr.write(`Group ${jid} not found\n`);
        process.exit(1);
      }

      const emails: string[] = JSON.parse(group.memberEmails || '[]');
      const filtered = emails.filter(
        (e) => e.toLowerCase() !== email.toLowerCase(),
      );

      if (filtered.length === emails.length) {
        process.stdout.write('Email not found in list\n');
        return;
      }

      const serialized = JSON.stringify(filtered);

      db.update(groups)
        .set({ memberEmails: serialized, updatedAt: Date.now() })
        .where(eq(groups.id, jid))
        .run();

      const displayName = group.name || jid;
      process.stdout.write(
        `Removed ${email} from group ${displayName} (now ${filtered.length} members)\n`,
      );
    });

  calendarCmd.addCommand(membersCmd);
  program.addCommand(calendarCmd);
}

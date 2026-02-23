import type { Command } from 'commander';
import React from 'react';
import { Text } from 'ink';
import { renderToString } from 'ink';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { contacts, messages } from '../../src/db/schema.js';
import { Table } from '../ui/Table.js';

function normalizeJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

function stripJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '');
}

function modeColor(mode: string): string {
  if (mode === 'auto') return 'green';
  if (mode === 'draft') return 'yellow';
  return 'gray';
}

export function addContactsCommand(program: Command): void {
  const cmd = program
    .command('contacts')
    .description('Manage contacts');

  cmd
    .command('list')
    .description('List all contacts')
    .action(() => {
      const allContacts = db.select().from(contacts).all();

      const rows = allContacts.map((c) => {
        // Get latest inbound message for this contact
        const lastMsg = db
          .select({ body: messages.body, timestamp: messages.timestamp })
          .from(messages)
          .where(
            and(
              eq(messages.contactJid, c.jid),
              eq(messages.fromMe, false),
            ),
          )
          .orderBy(desc(messages.timestamp))
          .limit(1)
          .get();

        const preview = lastMsg
          ? lastMsg.body.length > 40
            ? lastMsg.body.slice(0, 37) + '...'
            : lastMsg.body
          : '—';

        const modeElement = renderToString(
          React.createElement(Text, { color: modeColor(c.mode) }, c.mode),
        );

        return [stripJid(c.jid), c.name ?? '—', modeElement, preview];
      });

      const output = renderToString(
        React.createElement(Table, {
          headers: ['JID', 'Name', 'Mode', 'Last Message'],
          rows,
          widths: [30, 18, 8, 44],
        }),
      );

      process.stdout.write(output + '\n');
    });

  cmd
    .command('add <jid>')
    .description('Add a new contact')
    .option('-n, --name <name>', 'Display name')
    .option('-m, --mode <mode>', 'Contact mode (off|draft|auto)', 'draft')
    .action((jid: string, opts: { name?: string; mode?: string }) => {
      const normalizedJid = normalizeJid(jid);
      const mode = opts.mode ?? 'draft';

      db.insert(contacts)
        .values({ jid: normalizedJid, name: opts.name ?? null })
        .onConflictDoNothing()
        .run();

      db.update(contacts)
        .set({ mode, updatedAt: Date.now() })
        .where(eq(contacts.jid, normalizedJid))
        .run();

      console.log(`Added contact: ${normalizedJid} (mode: ${mode})`);
    });

  cmd
    .command('remove <jid>')
    .description('Soft-delete a contact (set mode to off)')
    .action((jid: string) => {
      const normalizedJid = normalizeJid(jid);

      db.update(contacts)
        .set({ mode: 'off', updatedAt: Date.now() })
        .where(eq(contacts.jid, normalizedJid))
        .run();

      console.log(`Removed contact: ${normalizedJid} (set to off)`);
    });

  cmd
    .command('configure <jid>')
    .description('Update contact settings')
    .option('-m, --mode <mode>', 'Contact mode (off|draft|auto)')
    .option('-r, --relationship <text>', 'Relationship description')
    .option('-i, --instructions <text>', 'Custom instructions')
    .action(
      (
        jid: string,
        opts: { mode?: string; relationship?: string; instructions?: string },
      ) => {
        const normalizedJid = normalizeJid(jid);

        const updates: Record<string, unknown> = { updatedAt: Date.now() };
        const changed: string[] = [];

        if (opts.mode !== undefined) {
          updates.mode = opts.mode;
          changed.push(`mode=${opts.mode}`);
        }
        if (opts.relationship !== undefined) {
          updates.relationship = opts.relationship;
          changed.push(`relationship="${opts.relationship}"`);
        }
        if (opts.instructions !== undefined) {
          updates.customInstructions = opts.instructions;
          changed.push(`instructions="${opts.instructions}"`);
        }

        if (changed.length === 0) {
          console.log('No options provided. Use --mode, --relationship, or --instructions.');
          return;
        }

        db.update(contacts)
          .set(updates)
          .where(eq(contacts.jid, normalizedJid))
          .run();

        console.log(`Updated contact: ${normalizedJid}`);
        for (const c of changed) {
          console.log(`  ${c}`);
        }
      },
    );
}

#!/usr/bin/env tsx
import { Command } from 'commander';
import { addStatusCommand } from './commands/status.js';
import { addContactsCommand } from './commands/contacts.js';
import { addGroupsCommand } from './commands/groups.js';
import { addImportCommand } from './commands/import.js';
import { addDraftsCommand } from './commands/drafts.js';
import { addCalendarCommand } from './commands/calendar.js';

const program = new Command()
  .name('bot')
  .description('WhatsApp bot management CLI')
  .version('1.0.0');

addStatusCommand(program);
addContactsCommand(program);
addGroupsCommand(program);
addImportCommand(program);
addDraftsCommand(program);
addCalendarCommand(program);

await program.parseAsync(process.argv);

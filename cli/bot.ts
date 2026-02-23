#!/usr/bin/env tsx
import { Command } from 'commander';
import { addStatusCommand } from './commands/status.js';

const program = new Command()
  .name('bot')
  .description('WhatsApp bot management CLI')
  .version('1.0.0');

addStatusCommand(program);

await program.parseAsync(process.argv);

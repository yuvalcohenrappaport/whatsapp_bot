import type { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function normalizeJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

export function addImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import WhatsApp .txt chat history')
    .requiredOption('--contact <jid>', 'Contact JID')
    .action(async (file: string, opts: { contact: string }) => {
      // Resolve file path relative to cwd
      const filePath = path.resolve(file);

      // Verify file exists
      try {
        await fs.access(filePath);
      } catch {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      // Normalize JID
      const jid = normalizeJid(opts.contact);
      const phone = jid.split('@')[0];
      const destFilename = `${phone}.txt`;

      // Load .env before importing src/ modules (which depend on config.ts Zod validation)
      dotenvConfig({ path: path.join(PROJECT_ROOT, '.env') });

      // Read config values with defaults matching src/config.ts
      const importDir = path.resolve(
        PROJECT_ROOT,
        process.env.IMPORT_DIR ?? './data/imports',
      );
      const processedDir = path.resolve(
        PROJECT_ROOT,
        process.env.PROCESSED_DIR ?? './data/processed',
      );
      const ownerExportName = process.env.OWNER_EXPORT_NAME;

      if (!ownerExportName) {
        console.error(
          'Error: OWNER_EXPORT_NAME env var is required for import ' +
            '(your name as it appears in WhatsApp exports)',
        );
        process.exit(1);
      }

      // Ensure import dir exists
      await fs.mkdir(importDir, { recursive: true });

      // Copy file to import dir with JID-derived filename
      const destPath = path.join(importDir, destFilename);
      await fs.copyFile(filePath, destPath);

      console.log(`Importing ${destFilename} for contact ${jid}...`);

      // Dynamic import to ensure .env is loaded before src/config.ts evaluates
      const { importChats } = await import(
        '../../src/importer/importChats.js'
      );

      try {
        await importChats(importDir, processedDir, ownerExportName);
        console.log('Import complete!');
      } catch (err) {
        console.error('Import failed:', err);
        process.exit(1);
      }

      // Force clean exit (importChats may leave Gemini handles open)
      process.exit(0);
    });
}

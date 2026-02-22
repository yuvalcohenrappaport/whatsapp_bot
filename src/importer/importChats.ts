import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { upsertContact } from '../db/queries/contacts.js';
import { setStyleSummary } from '../db/queries/contacts.js';
import { db } from '../db/client.js';
import { messages as messagesTable } from '../db/schema.js';
import { generateStyleSummary } from '../ai/gemini.js';

const logger = pino({ name: 'importer' });

/**
 * Parses a WhatsApp .txt export and returns only the owner's messages.
 *
 * Expected line format: `D/M/YY, HH:MM - Author: Message`
 * Continuation lines (no timestamp prefix) are folded into the previous message.
 */
export function parseMyMessages(text: string, ownerName: string): string[] {
  const lines = text.split('\n');
  const MSG_REGEX = /^(\d{1,2}\/\d{1,2}\/\d{2,4},\s\d{1,2}:\d{2})\s-\s(.+?):\s(.*)$/;

  const results: string[] = [];
  let currentAuthor: string | null = null;
  let currentBody: string | null = null;

  for (const line of lines) {
    const match = MSG_REGEX.exec(line);
    if (match) {
      // Save the previous message if it was from the owner
      if (currentAuthor === ownerName && currentBody !== null) {
        const trimmed = currentBody.trim();
        if (trimmed && trimmed !== '<Media omitted>') {
          results.push(trimmed);
        }
      }
      currentAuthor = match[2].trim();
      currentBody = match[3];
    } else {
      // Continuation line — fold into current message body
      if (currentBody !== null) {
        currentBody += '\n' + line;
      }
    }
  }

  // Handle final message
  if (currentAuthor === ownerName && currentBody !== null) {
    const trimmed = currentBody.trim();
    if (trimmed && trimmed !== '<Media omitted>') {
      results.push(trimmed);
    }
  }

  return results;
}

/**
 * Scans the import directory for .txt WhatsApp export files, parses them,
 * seeds the DB with the owner's messages, generates a style summary via Gemini,
 * and moves processed files to the processed directory.
 *
 * File naming convention: `<phone_number>.txt` (e.g., `972501234567.txt`)
 * The phone number becomes the contact JID: `972501234567@s.whatsapp.net`
 */
export async function importChats(
  importDir: string,
  processedDir: string,
  ownerName: string,
): Promise<void> {
  await fs.mkdir(importDir, { recursive: true });
  await fs.mkdir(processedDir, { recursive: true });

  let entries: string[];
  try {
    entries = await fs.readdir(importDir);
  } catch {
    logger.warn({ importDir }, 'Could not read import directory');
    return;
  }

  const txtFiles = entries.filter((f) => f.endsWith('.txt'));

  if (txtFiles.length === 0) {
    logger.debug('No .txt export files found in import directory');
    return;
  }

  logger.info({ count: txtFiles.length }, 'Found chat export files to import');

  for (const filename of txtFiles) {
    const filePath = path.join(importDir, filename);
    const identifier = path.basename(filename, '.txt');
    const jid = identifier.includes('@') ? identifier : `${identifier}@s.whatsapp.net`;

    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const parsed = parseMyMessages(text, ownerName);

      if (parsed.length === 0) {
        logger.warn({ filename, jid }, 'No owner messages found in export — skipping style import but moving file');
      } else {
        // Ensure contact exists in DB
        upsertContact(jid, null).run();

        // Bulk insert messages with synthetic IDs for dedup
        const rows = parsed.map((body, index) => ({
          id: `import-${jid}-${index}`,
          contactJid: jid,
          fromMe: true as const,
          body,
          timestamp: 0,
        }));

        db.insert(messagesTable).values(rows).onConflictDoNothing().run();

        // Generate style summary if enough messages
        if (parsed.length >= 10) {
          try {
            const summary = await generateStyleSummary(jid, parsed);
            setStyleSummary(jid, summary).run();
            logger.info({ filename, jid, messageCount: parsed.length }, 'Import complete — style summary generated');
          } catch (err) {
            logger.error({ err, jid }, 'Failed to generate style summary — messages stored as few-shot examples only');
          }
        } else {
          logger.warn(
            { filename, jid, messageCount: parsed.length },
            'Import complete — style sample too small for summary (< 10 messages), stored as few-shot examples only',
          );
        }
      }
    } catch (err) {
      logger.error({ err, filename }, 'Failed to parse or import chat file — skipping');
      continue;
    }

    // Move file to processed directory
    const destPath = path.join(processedDir, filename);
    try {
      await fs.rename(filePath, destPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EXDEV') {
        // Cross-filesystem: copy then delete
        await fs.copyFile(filePath, destPath);
        await fs.unlink(filePath);
      } else {
        logger.error({ err, filename }, 'Failed to move processed file');
      }
    }
  }
}

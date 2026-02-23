import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import pm2 from 'pm2';
import { sql, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { contacts, groups, drafts } from '../../src/db/schema.js';
import { StatusView } from '../ui/StatusView.js';

interface BotStatus {
  status: string;
  uptime: number | null;
  memory: number | null;
}

function getBotStatus(): Promise<BotStatus> {
  return new Promise((resolve) => {
    pm2.connect(true, (connectErr) => {
      if (connectErr) {
        resolve({ status: 'pm2_unavailable', uptime: null, memory: null });
        return;
      }
      pm2.describe('whatsapp-bot', (descErr, procList) => {
        pm2.disconnect();
        if (descErr || !procList || procList.length === 0) {
          resolve({ status: 'stopped', uptime: null, memory: null });
          return;
        }
        const proc = procList[0];
        const pmEnv = proc.pm2_env as Record<string, unknown> | undefined;
        const status = (pmEnv?.status as string) ?? 'unknown';
        const pmUptime = pmEnv?.pm_uptime as number | undefined;
        const uptime = pmUptime ? Date.now() - pmUptime : null;
        const memory = (proc.monit?.memory as number) ?? null;
        resolve({ status, uptime, memory });
      });
    });
  });
}

export function addStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show bot status, uptime, and counts')
    .action(async () => {
      // Query DB counts synchronously
      const contactResult = db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(sql`mode != 'off'`)
        .get();
      const contactCount = contactResult?.count ?? 0;

      const groupResult = db
        .select({ count: sql<number>`count(*)` })
        .from(groups)
        .where(eq(groups.active, true))
        .get();
      const groupCount = groupResult?.count ?? 0;

      const draftResult = db
        .select({ count: sql<number>`count(*)` })
        .from(drafts)
        .where(eq(drafts.status, 'pending'))
        .get();
      const draftCount = draftResult?.count ?? 0;

      // Query PM2 status
      const botStatus = await getBotStatus();

      // Render and exit
      const { waitUntilExit } = render(
        React.createElement(StatusView, {
          pm2Status: botStatus.status,
          uptime: botStatus.uptime,
          memory: botStatus.memory,
          contactCount,
          groupCount,
          draftCount,
        }),
      );

      await waitUntilExit();
    });
}

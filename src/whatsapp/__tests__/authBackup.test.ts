import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  KEEP_BACKUPS,
  backupAndClearAuth,
  formatBackupStamp,
} from '../authBackup.js';

let tmp: string;
let authDir: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-auth-'));
  authDir = path.join(tmp, 'auth');
  await fs.mkdir(authDir);
  await fs.writeFile(path.join(authDir, 'creds.json'), '{"registered":true}');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('formatBackupStamp', () => {
  it('matches the YYYYMMDD-HHMMSS convention', () => {
    expect(formatBackupStamp(new Date(2026, 3, 23, 21, 23, 22))).toBe(
      '20260423-212322',
    );
  });
});

describe('backupAndClearAuth', () => {
  it('moves the auth dir aside instead of deleting, preserving creds', async () => {
    const backup = await backupAndClearAuth(authDir, new Date(2026, 4, 31, 9, 32, 1));

    expect(backup).toBe(`${authDir}.bak-20260531-093201`);
    // original gone → next useMultiFileAuthState recreates empty (QR mode)
    await expect(fs.access(authDir)).rejects.toThrow();
    // creds survive in the backup, recoverable without a QR scan
    const saved = await fs.readFile(path.join(backup!, 'creds.json'), 'utf8');
    expect(saved).toContain('registered');
  });

  it('returns null when there is nothing to back up', async () => {
    await fs.rm(authDir, { recursive: true, force: true });
    expect(await backupAndClearAuth(authDir)).toBeNull();
  });

  it(`prunes to the newest ${KEEP_BACKUPS} backups`, async () => {
    // Pre-seed 4 stale backups with older stamps than the one we create.
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000', '20260104-000000']) {
      await fs.mkdir(`${authDir}.bak-${stamp}`);
    }
    await backupAndClearAuth(authDir, new Date(2026, 4, 31, 9, 32, 1));

    const remaining = (await fs.readdir(tmp))
      .filter((e) => e.startsWith('auth.bak-'))
      .sort();
    expect(remaining).toHaveLength(KEEP_BACKUPS);
    // newest kept, oldest pruned
    expect(remaining).toContain('auth.bak-20260531-093201');
    expect(remaining).not.toContain('auth.bak-20260101-000000');
  });
});

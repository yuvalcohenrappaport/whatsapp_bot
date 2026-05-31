import fs from 'node:fs/promises';
import path from 'node:path';

/** How many timestamped auth backups to retain. */
export const KEEP_BACKUPS = 3;

/**
 * Compact timestamp matching the existing `auth.bak-YYYYMMDD-HHMMSS` convention,
 * so backups sort chronologically by name.
 */
export function formatBackupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Move the auth dir aside to `${authDir}.bak-<stamp>` instead of deleting it, so
 * a WhatsApp 401 logout (which may occasionally be spurious) is recoverable
 * without a QR re-scan. The original path is left absent, so the next
 * `useMultiFileAuthState` recreates it empty → QR mode, same as before.
 *
 * Best-effort: never throws. Prunes to the newest {@link KEEP_BACKUPS} backups.
 *
 * @returns the backup path, or null if there was nothing to back up.
 */
export async function backupAndClearAuth(
  authDir: string,
  now: Date = new Date(),
): Promise<string | null> {
  const backupPath = `${authDir}.bak-${formatBackupStamp(now)}`;
  try {
    await fs.rename(authDir, backupPath);
  } catch (err) {
    // Dir already gone — nothing to preserve.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    // Rename failed for another reason (e.g. cross-device) — fall back to the
    // old destructive behaviour so we still end up in a clean QR state.
    await fs.rm(authDir, { recursive: true, force: true });
    return null;
  }
  await pruneBackups(authDir);
  return backupPath;
}

async function pruneBackups(authDir: string): Promise<void> {
  try {
    const dir = path.dirname(authDir);
    const prefix = `${path.basename(authDir)}.bak-`;
    const entries = await fs.readdir(dir);
    const backups = entries.filter((e) => e.startsWith(prefix)).sort(); // name sort == chronological
    const stale = backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS));
    await Promise.all(
      stale.map((name) =>
        fs.rm(path.join(dir, name), { recursive: true, force: true }),
      ),
    );
  } catch {
    /* pruning is best-effort — a failure here must not block re-auth */
  }
}

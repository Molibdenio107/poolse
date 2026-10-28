import { readFileSync } from 'node:fs';
import { DEFAULT_MAX_AGE_HOURS, backupBucket, env } from './backup-lib.js';
import { fetchBackup, restoreInto } from './restore.js';
import { startScratchPostgres } from './scratch-postgres.js';
import { verifyRestore } from './verify-restore.js';

/**
 * The restore drill — POOLSE-89. One command, on Rui's machine.
 *
 * Downloads the newest backup, opens it with the age key, restores it into a
 * stock Postgres in a throwaway container, runs the five proofs and the
 * freshness check, and removes the container. It runs here rather than in
 * GitHub (Rui, 28-10-2026) because opening a backup takes the age key and
 * `SENSITIVE_DATA_KEY`, and neither is ever in GitHub: a stolen GitHub account
 * or bucket must open nothing. GitHub's nightly `check-backups` proves what can
 * be proved without a key; this proves the rest.
 *
 *   BACKUP_S3_*                      the production backups bucket (read is enough)
 *   BACKUP_AGE_IDENTITY              the age secret key — or
 *   BACKUP_AGE_IDENTITY_FILE         a file holding it (kept out of the shell history)
 *   SENSITIVE_DATA_KEY               production's medical-notes key
 *   PG_TOOLS=docker                  on a machine with no Postgres client
 *
 * Run: pnpm --filter @poolse/db restore-drill
 */

function identity(): string {
  const file = (process.env['BACKUP_AGE_IDENTITY_FILE'] ?? '').trim();
  if (file !== '') {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith('AGE-SECRET-KEY-1'));
    if (line === undefined) throw new Error(`${file} holds no AGE-SECRET-KEY-1… line`);
    return line.trim();
  }
  return env('BACKUP_AGE_IDENTITY');
}

async function main(): Promise<void> {
  const bucket = backupBucket();
  console.log(`Fetching the newest backup from ${bucket.name}/${bucket.prefix}/…`);
  const fetched = await fetchBackup(bucket, identity());
  console.log(`  ${fetched.manifest.dumpKey}, taken ${fetched.manifest.createdAt}`);

  const postgres = await startScratchPostgres();
  try {
    const target = await postgres.database('poolse_drill');
    console.log('Restoring into a stock Postgres…');
    await restoreInto(target, fetched.dump);
    const result = await verifyRestore({
      targetUrl: target,
      manifest: fetched.manifest,
      maxAgeHours: Number(env('BACKUP_MAX_AGE_HOURS', String(DEFAULT_MAX_AGE_HOURS))),
    });
    for (const proof of result.proofs) console.log(`${proof.ok ? 'PASS' : 'FAIL'}  ${proof.name}: ${proof.detail}`);
    if (!result.ok) {
      console.error('\nThe drill FAILED. This backup could not bring the club back as it was. See docs/deploy.md.');
      process.exitCode = 1;
      return;
    }
    console.log('\nThe drill passed: the newest backup restores, and the club comes back as it was.');
  } finally {
    postgres.stop();
  }
}

main().catch((error: unknown) => {
  console.error(`The drill FAILED: ${(error as Error).message}`);
  process.exit(1);
});

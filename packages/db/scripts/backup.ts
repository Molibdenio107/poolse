import pg from 'pg';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_RETENTION_DAYS,
  DUMP_NAME,
  MANIFEST_NAME,
  backupBucket,
  describeDatabase,
  encryptTo,
  ensureBucket,
  env,
  listBackups,
  looksLikeDump,
  put,
  remove,
  runPgTool,
  sha256,
  stampOf,
  toolUrl,
  type Bucket,
  type Manifest,
} from './backup-lib.js';

/**
 * The nightly backup — POOLSE-89.
 *
 *   1. Open a read-only transaction and export its snapshot.
 *   2. Inside it, record what the database says about itself: the migrations
 *      applied, every table's row count, which tables have RLS, and the app
 *      logins' grants. This is the manifest the drill checks the restore by.
 *   3. `pg_dump --snapshot` the same snapshot, custom format (compressed), as the
 *      owner login. The dump and the counts therefore describe the same instant.
 *   4. Encrypt it to the age public key. The plaintext never touches a disk.
 *   5. Upload the encrypted dump and the manifest to `<prefix>/<stamp>/`.
 *   6. Delete backups older than the retention (30 days, Rui 21-10-2026).
 *
 * The manifest is not encrypted: it holds table names, counts and grants, and
 * the drill must be able to say what a backup *should* hold before anybody has
 * the key. It holds no row of anybody's data.
 *
 *   BACKUP_SOURCE_URL     the owner connection (default DATABASE_URL)
 *   BACKUP_AGE_RECIPIENT  the age public key, age1…
 *   BACKUP_S3_*           the backups' own bucket and token
 *   BACKUP_RETENTION_DAYS 30 unless set
 *
 * Run: pnpm --filter @poolse/db backup
 */

export interface BackupResult {
  stamp: string;
  manifest: Manifest;
  pruned: string[];
}

export async function runBackup(options: {
  sourceUrl: string;
  recipient: string;
  bucket: Bucket;
  retentionDays?: number;
  now?: Date;
}): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const stamp = stampOf(now);
  const client = new pg.Client({ connectionString: options.sourceUrl });
  await client.connect();

  let dump: Buffer;
  let described: Awaited<ReturnType<typeof describeDatabase>>;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot');
    described = await describeDatabase(client);
    // The exporting transaction stays open until the dump has read everything.
    dump = await runPgTool('pg_dump', [
      '--format=custom',
      `--snapshot=${rows[0]!.snapshot}`,
      `--dbname=${toolUrl(options.sourceUrl)}`,
    ]);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }

  if (!looksLikeDump(dump)) {
    throw new Error(`pg_dump returned ${dump.length} bytes that are not a custom-format dump`);
  }

  const encrypted = await encryptTo(options.recipient, dump);
  const dumpKey = `${options.bucket.prefix}/${stamp}/${DUMP_NAME}`;
  const manifest: Manifest = {
    version: 1,
    createdAt: now.toISOString(),
    dumpKey,
    ...described,
    dumpBytes: dump.length,
    encryptedBytes: encrypted.length,
    sha256: sha256(encrypted),
  };

  // The dump before its manifest: a manifest naming an object that never
  // arrived would send the drill looking for nothing.
  await put(options.bucket, dumpKey, encrypted, 'application/octet-stream');
  await put(
    options.bucket,
    `${options.bucket.prefix}/${stamp}/${MANIFEST_NAME}`,
    Buffer.from(JSON.stringify(manifest, null, 2)),
    'application/json',
  );

  // Retention: everything older than the window goes, this night's never.
  const cutoff = now.getTime() - (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000;
  const pruned: string[] = [];
  for (const backup of await listBackups(options.bucket)) {
    if (backup.stamp === stamp || backup.takenAt.getTime() >= cutoff) continue;
    for (const key of backup.keys) await remove(options.bucket, key);
    pruned.push(backup.stamp);
  }

  return { stamp, manifest, pruned };
}

async function main(): Promise<void> {
  const bucket = backupBucket();
  if (env('BACKUP_S3_CREATE_BUCKET', 'false') === 'true') await ensureBucket(bucket);
  const result = await runBackup({
    sourceUrl: env('BACKUP_SOURCE_URL', process.env['DATABASE_URL']),
    recipient: env('BACKUP_AGE_RECIPIENT'),
    bucket,
    retentionDays: Number(env('BACKUP_RETENTION_DAYS', String(DEFAULT_RETENTION_DAYS))),
  });
  const tables = Object.keys(result.manifest.rowCounts).length;
  const rows = Object.values(result.manifest.rowCounts).reduce((sum, n) => sum + n, 0);
  console.log(`Backup ${result.stamp}: ${tables} tables, ${rows} rows, ${result.manifest.migrations.length} migrations.`);
  console.log(`  dump ${result.manifest.dumpBytes} bytes, encrypted ${result.manifest.encryptedBytes} bytes → ${result.manifest.dumpKey}`);
  console.log(result.pruned.length === 0 ? '  nothing past the retention' : `  pruned: ${result.pruned.join(', ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Backup FAILED: ${(error as Error).message}`);
    process.exit(1);
  });
}

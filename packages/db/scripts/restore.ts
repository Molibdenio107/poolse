import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  APP_ROLES,
  MANIFEST_NAME,
  backupBucket,
  decryptWith,
  env,
  get,
  listBackups,
  looksLikeDump,
  quoteIdent,
  runPgTool,
  sha256,
  toolUrl,
  type Bucket,
  type Manifest,
} from './backup-lib.js';

/**
 * Restoring a backup into an EMPTY database — POOLSE-89.
 *
 *   1. Pick the backup: the newest, or the stamp given.
 *   2. Download the manifest and the encrypted dump; check the dump's sha256
 *      against the manifest before decrypting anything.
 *   3. Decrypt with the age identity (`BACKUP_AGE_IDENTITY`, AGE-SECRET-KEY-1…),
 *      which a person hands in: it is never stored with the backup.
 *   4. Create `poolse_app` and `poolse_platform` — a per-database dump carries
 *      no roles — with LOGIN and no password. Passwords are set afterwards by
 *      `pnpm db:bootstrap` and the runbook, so none ever passes through here.
 *   5. `pg_restore --no-owner --exit-on-error`: the restoring login owns the
 *      tables, and the grants to the two app logins come back as they were.
 *
 * It refuses a target that already holds tables. Restoring is a deliberate act
 * into a new database; this script must never be the way production gets
 * overwritten.
 *
 *   RESTORE_TARGET_URL     the empty database, as a login that may create roles
 *   BACKUP_AGE_IDENTITY    the age secret key
 *   BACKUP_S3_*            the backups' bucket
 *   RESTORE_MANIFEST_OUT   where to write the manifest for verify (restore-manifest.json)
 *
 * Run: pnpm --filter @poolse/db restore [stamp]
 */

export interface Fetched {
  manifest: Manifest;
  dump: Uint8Array;
}

/** Download and open one backup. Nothing is written anywhere. */
export async function fetchBackup(bucket: Bucket, identity: string, stamp?: string): Promise<Fetched> {
  const backups = await listBackups(bucket);
  const chosen = stamp === undefined ? backups[0] : backups.find((backup) => backup.stamp === stamp);
  if (chosen === undefined) {
    throw new Error(stamp === undefined ? `No backup under ${bucket.prefix}/ at all` : `No backup ${stamp}`);
  }
  const manifestKey = chosen.keys.find((key) => key.endsWith(`/${MANIFEST_NAME}`));
  if (manifestKey === undefined) throw new Error(`Backup ${chosen.stamp} has no manifest — it did not finish`);
  const manifest = JSON.parse(Buffer.from(await get(bucket, manifestKey)).toString('utf8')) as Manifest;

  const encrypted = await get(bucket, manifest.dumpKey);
  if (sha256(encrypted) !== manifest.sha256) {
    throw new Error(`Backup ${chosen.stamp}: the dump does not match its manifest's checksum — damaged or replaced`);
  }
  const dump = await decryptWith(identity, encrypted);
  if (!looksLikeDump(dump)) throw new Error(`Backup ${chosen.stamp}: the decrypted file is not a pg_dump archive`);
  return { manifest, dump };
}

/** Restore a dump into an empty database, creating the app logins first. */
export async function restoreInto(targetUrl: string, dump: Uint8Array): Promise<void> {
  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    if (rows[0]!.n > 0) {
      throw new Error(`The target database already has ${rows[0]!.n} tables. Restore only into a new, empty database.`);
    }
    for (const role of APP_ROLES) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      // LOGIN with no password: unusable until the runbook sets one, and never
      // SUPERUSER or BYPASSRLS, which would quietly switch tenant isolation off.
      if (rowCount === 0) await client.query(`CREATE ROLE ${quoteIdent(role)} LOGIN NOSUPERUSER NOBYPASSRLS`);
    }
  } finally {
    await client.end();
  }

  await runPgTool(
    'pg_restore',
    ['--no-owner', '--exit-on-error', '--single-transaction', `--dbname=${toolUrl(targetUrl)}`],
    dump,
  );
}

async function main(): Promise<void> {
  const stamp = process.argv[2];
  const fetched = await fetchBackup(backupBucket(), env('BACKUP_AGE_IDENTITY'), stamp);
  console.log(`Restoring ${fetched.manifest.dumpKey} (taken ${fetched.manifest.createdAt})…`);
  await restoreInto(env('RESTORE_TARGET_URL'), fetched.dump);
  const out = env('RESTORE_MANIFEST_OUT', 'restore-manifest.json');
  writeFileSync(out, JSON.stringify(fetched.manifest, null, 2));
  console.log(`Restored. Manifest written to ${out}; run verify-restore next.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Restore FAILED: ${(error as Error).message}`);
    process.exit(1);
  });
}

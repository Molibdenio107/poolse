import { pathToFileURL } from 'node:url';
import {
  DEFAULT_MAX_AGE_HOURS,
  MANIFEST_NAME,
  backupBucket,
  env,
  get,
  listBackups,
  sha256,
  type Bucket,
  type Manifest,
} from './backup-lib.js';

/**
 * What can be proved about the backups without a key — POOLSE-89.
 *
 * Runs in GitHub every day, apart from the backup itself, so a backup job
 * that has silently stopped — failing, disabled, or never scheduled again — is
 * an alert the next day rather than a discovery on the day it is needed:
 *
 *   - the newest backup is younger than 36 hours ("no backup since <date>");
 *   - it has a manifest, and its dump's sha256 matches the manifest's — the file
 *     in the bucket is the file that was written, whole;
 *   - the manifest describes a database: migrations, tables, and at least one
 *     organization.
 *
 * Whether the backup *restores* takes the age key, which is never in GitHub:
 * that is `restore-drill.ts`, on Rui's machine.
 *
 * Run: pnpm --filter @poolse/db check-backups
 */

export async function checkBackups(
  bucket: Bucket,
  options: { maxAgeHours?: number; now?: Date } = {},
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const backups = await listBackups(bucket);
  const newest = backups[0];
  if (newest === undefined) return { ok: false, lines: [`No backup at all under ${bucket.prefix}/`] };

  const ageHours = (now.getTime() - newest.takenAt.getTime()) / 3_600_000;
  let ok = true;
  if (ageHours > maxAgeHours) {
    ok = false;
    lines.push(`No backup since ${newest.takenAt.toISOString()} (${ageHours.toFixed(0)} h; the limit is ${maxAgeHours} h)`);
  } else {
    lines.push(`Newest backup ${newest.stamp}, ${ageHours.toFixed(1)} h old`);
  }

  const manifestKey = newest.keys.find((key) => key.endsWith(`/${MANIFEST_NAME}`));
  if (manifestKey === undefined) return { ok: false, lines: [...lines, `${newest.stamp} has no manifest — it did not finish`] };
  const manifest = JSON.parse(Buffer.from(await get(bucket, manifestKey)).toString('utf8')) as Manifest;

  const encrypted = await get(bucket, manifest.dumpKey);
  if (encrypted.length !== manifest.encryptedBytes || sha256(encrypted) !== manifest.sha256) {
    ok = false;
    lines.push(`${manifest.dumpKey} does not match its manifest (${encrypted.length} bytes, expected ${manifest.encryptedBytes})`);
  } else {
    lines.push(`Dump intact: ${manifest.encryptedBytes} bytes, checksum matches`);
  }

  const tables = Object.keys(manifest.rowCounts).length;
  const organizations = manifest.rowCounts['organization'] ?? 0;
  if (manifest.migrations.length === 0 || tables === 0 || organizations === 0) {
    ok = false;
    lines.push(`The manifest describes an empty database: ${manifest.migrations.length} migrations, ${tables} tables, ${organizations} organizations`);
  } else {
    lines.push(`${manifest.migrations.length} migrations, ${tables} tables, ${organizations} organizations`);
  }
  return { ok, lines };
}

async function main(): Promise<void> {
  const result = await checkBackups(backupBucket(), {
    maxAgeHours: Number(env('BACKUP_MAX_AGE_HOURS', String(DEFAULT_MAX_AGE_HOURS))),
  });
  for (const line of result.lines) console.log(line);
  if (!result.ok) {
    console.error('Backup check FAILED.');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Backup check FAILED: ${(error as Error).message}`);
    process.exit(1);
  });
}

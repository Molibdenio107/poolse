import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import {
  MANIFEST_NAME,
  decryptWith,
  ensureBucket,
  get,
  listBackups,
  looksLikeDump,
  put,
  remove,
  stampOf,
  type Bucket,
  type Manifest,
} from './backup-lib.js';
import { runBackup, type BackupResult } from './backup.js';
import { fetchBackup, restoreInto } from './restore.js';
import { tenantTablesFromHarness, verifyRestore } from './verify-restore.js';
import { checkBackups } from './check-backups.js';
import { startScratchPostgres, type ScratchPostgres } from './scratch-postgres.js';
import { S3Client } from '@aws-sdk/client-s3';

/**
 * POOLSE-89, QA 1–6 — the backup and the drill, run for real.
 *
 * The dev database is backed up into S3Mock (a bucket of the test's own), a
 * stock `postgres:16` container is started as the empty target, and the restore
 * is proved — then each way it must fail is shown to fail. QA 7 (the token
 * cannot touch the uploads bucket) is a property of R2's token, which S3Mock
 * does not enforce; it is a line in the runbook, checked by hand.
 *
 * Needs Docker (pnpm db:up, and the storage container). Locally the Postgres
 * tools run in Docker too: `PG_TOOLS=docker` is set here unless the caller set
 * `PG_TOOLS` already.
 *
 * Run: pnpm --filter @poolse/db backup:test
 */

process.env['PG_TOOLS'] ??= 'docker';

const bucket: Bucket = {
  client: new S3Client({
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9090',
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  }),
  name: 'poolse-backups-test',
  prefix: `drill-${randomBytes(3).toString('hex')}`,
};

let identity = '';
let backup: BackupResult;
let restored = '';
let postgres: ScratchPostgres;

before(async () => {
  await ensureBucket(bucket);
  identity = await generateIdentity();
  postgres = await startScratchPostgres();
});

after(async () => {
  postgres?.stop();
  for (const found of await listBackups(bucket)) for (const key of found.keys) await remove(bucket, key);
});

test('QA 1 — a backup is an encrypted dump and its manifest, and it opens with its key only', async () => {
  // A backup from 40 days ago, which this night's run must prune.
  const old = stampOf(new Date(Date.now() - 40 * 86_400_000));
  await put(bucket, `${bucket.prefix}/${old}/${MANIFEST_NAME}`, Buffer.from('{}'), 'application/json');

  backup = await runBackup({
    sourceUrl: process.env['DATABASE_URL']!,
    recipient: await identityToRecipient(identity),
    bucket,
  });

  const listed = await listBackups(bucket);
  assert.deepEqual(listed.map((found) => found.stamp), [backup.stamp], 'the old one was pruned');
  assert.deepEqual(backup.pruned, [old]);
  assert.equal(listed[0]!.keys.length, 2);

  const encrypted = await get(bucket, backup.manifest.dumpKey);
  assert.equal(looksLikeDump(encrypted), false, 'the stored object is not a readable dump');
  await assert.rejects(decryptWith(await generateIdentity(), encrypted), /does not open with this key/);
  assert.equal(looksLikeDump(await decryptWith(identity, encrypted)), true);

  assert.ok(backup.manifest.migrations.length > 100);
  assert.ok((backup.manifest.rowCounts['organization'] ?? 0) > 0);
  assert.ok(backup.manifest.rlsTables.includes('student'));
  assert.ok(backup.manifest.grants.some((grant) => grant.startsWith('poolse_platform|')));
});

test('QA 2 — the newest backup restores into a stock Postgres and all five proofs pass', async () => {
  const fetched = await fetchBackup(bucket, identity);
  assert.equal(fetched.manifest.dumpKey, backup.manifest.dumpKey);
  restored = await postgres.database('drill_ok');
  await restoreInto(restored, fetched.dump);

  const result = await verifyRestore({ targetUrl: restored, manifest: fetched.manifest, maxAgeHours: 36 });
  assert.equal(result.ok, true, result.proofs.map((p) => `${p.name}: ${p.detail}`).join('\n'));
  assert.deepEqual(
    result.proofs.map((proof) => proof.name),
    ['migrations', 'row counts', 'row-level security', 'app grants', 'medical notes decrypt', 'freshness'],
  );

  // And the restore refuses a database that is not empty — it never overwrites.
  await assert.rejects(restoreInto(restored, fetched.dump), /already has \d+ tables/);
});

test('QA 3 — a truncated dump fails the restore and says why', async () => {
  const fetched = await fetchBackup(bucket, identity);
  const cut = fetched.dump.subarray(0, Math.floor(fetched.dump.length / 2));
  const target = await postgres.database('drill_cut');
  await assert.rejects(restoreInto(target, cut), /pg_restore exited with \d+:[\s\S]+/);
});

test('QA 4 — a tenant table missing from the restore fails the RLS proof by name', async () => {
  const result = await verifyRestore({
    targetUrl: restored,
    manifest: backup.manifest,
    tenantTables: [...tenantTablesFromHarness(), 'meet_results_inbox_that_never_was'],
  });
  const rls = result.proofs.find((proof) => proof.name === 'row-level security')!;
  assert.equal(result.ok, false);
  assert.equal(rls.ok, false);
  assert.match(rls.detail, /meet_results_inbox_that_never_was/);
});

test('QA 5 — the wrong SENSITIVE_DATA_KEY fails the decryption proof', async () => {
  const saved = process.env['SENSITIVE_DATA_KEY'];
  process.env['SENSITIVE_DATA_KEY'] = randomBytes(32).toString('base64');
  try {
    const result = await verifyRestore({ targetUrl: restored, manifest: backup.manifest });
    const decrypt = result.proofs.find((proof) => proof.name === 'medical notes decrypt')!;
    assert.equal(result.ok, false);
    assert.equal(decrypt.ok, false);
    assert.match(decrypt.detail, /does not open with SENSITIVE_DATA_KEY/);
  } finally {
    process.env['SENSITIVE_DATA_KEY'] = saved;
  }
});

test('QA 6 — a backup older than 36 hours fails with the date of the last one', async () => {
  const manifest: Manifest = { ...backup.manifest };
  const now = new Date(new Date(manifest.createdAt).getTime() + 40 * 3_600_000);
  const result = await verifyRestore({ targetUrl: restored, manifest, maxAgeHours: 36, now });
  const fresh = result.proofs.find((proof) => proof.name === 'freshness')!;
  assert.equal(result.ok, false);
  assert.match(fresh.detail, new RegExp(`no backup since ${manifest.createdAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the keyless daily check: intact and fresh passes; stale says since when', async () => {
  const fresh = await checkBackups(bucket);
  assert.equal(fresh.ok, true, fresh.lines.join('\n'));
  const later = new Date(new Date(backup.manifest.createdAt).getTime() + 40 * 3_600_000);
  const stale = await checkBackups(bucket, { now: later });
  assert.equal(stale.ok, false);
  assert.match(stale.lines[0]!, /^No backup since /);
});

test('a damaged object is refused before anything is decrypted', async () => {
  const encrypted = await get(bucket, backup.manifest.dumpKey);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0xff;
  await put(bucket, backup.manifest.dumpKey, damaged, 'application/octet-stream');
  await assert.rejects(fetchBackup(bucket, identity), /does not match its manifest's checksum/);
  const checked = await checkBackups(bucket);
  assert.equal(checked.ok, false, 'the keyless check sees the damage too');
});

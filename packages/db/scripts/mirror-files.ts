import { pathToFileURL } from 'node:url';
import { GetObjectCommand, ListObjectsV2Command, S3Client, type _Object } from '@aws-sdk/client-s3';
import { backupBucket, env, put, remove, type Bucket } from './backup-lib.js';

/**
 * The uploaded files, mirrored into the backups bucket — go-live review
 * 10-11-2026, moved from the GitHub workflow's bash to here when the nightly
 * backup moved to Railway (17-11-2026).
 *
 * The rules are the workflow's, unchanged:
 *
 *   - **Two tokens, never one for both.** The uploads are read with a token that
 *     may only read the uploads bucket; the copy is written with the backups
 *     token, which cannot see the uploads bucket (deploy.md QA 7).
 *   - **Into `files/`** of the backups bucket, beside the nightly dumps.
 *   - **Deletions are mirrored.** The only thing the app deletes from the bucket
 *     is a plaintext ID photo the re-seal replaced, and a copy that kept it
 *     would keep what the re-seal exists to remove.
 *   - **A source that suddenly holds far fewer files is refused, not mirrored**
 *     — over 10% fewer than a copy of more than 20 — so an emptied bucket never
 *     empties its backup the same night. Nothing is copied or deleted then.
 *   - A file is copied when the copy lacks it, its size differs, or the source
 *     is newer (`aws s3 sync`'s test).
 *
 * Health files are ciphertext already; the rest stays private to the bucket.
 *
 *   FILES_S3_BUCKET / FILES_S3_ACCESS_KEY_ID / FILES_S3_SECRET_ACCESS_KEY
 *                         the uploads bucket and its read-only token
 *   FILES_S3_ENDPOINT     defaults to BACKUP_S3_ENDPOINT (one R2 account)
 *   BACKUP_S3_*           the backups bucket and its token
 *
 * Run: pnpm --filter @poolse/db mirror-files
 */

export const FILES_PREFIX = 'files';
/** A copy this small is not judged: a young club deleting three files is not an emptied bucket. */
export const SHRINK_GUARD_MIN = 20;

export interface MirrorResult {
  source: number;
  copied: number;
  deleted: number;
  mirrored: number;
}

async function listAll(client: S3Client, bucket: string, prefix: string): Promise<_Object[]> {
  const items: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix === '' ? undefined : prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) if (item.Key !== undefined && !item.Key.endsWith('/')) items.push(item);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return items;
}

export async function runMirror(options: {
  /** The uploads: read only. */
  source: { client: S3Client; name: string };
  /** The backups bucket: its `files/` is written. */
  copy: Bucket;
}): Promise<MirrorResult> {
  const { source, copy } = options;
  const copyPrefix = `${FILES_PREFIX}/`;

  const sourceItems = await listAll(source.client, source.name, '');
  const copyItems = await listAll(copy.client, copy.name, copyPrefix);

  if (copyItems.length > SHRINK_GUARD_MIN && sourceItems.length * 10 < copyItems.length * 9) {
    throw new Error(
      `The uploads bucket holds ${sourceItems.length} file(s) against ${copyItems.length} in its copy — over 10% fewer. ` +
        'Not mirroring; check the bucket.',
    );
  }

  const copied = new Map(copyItems.map((item) => [item.Key!.slice(copyPrefix.length), item]));
  let copiedCount = 0;
  let addedCount = 0;
  for (const item of sourceItems) {
    const key = item.Key!;
    const existing = copied.get(key);
    const stale =
      existing === undefined ||
      existing.Size !== item.Size ||
      (item.LastModified !== undefined &&
        existing.LastModified !== undefined &&
        item.LastModified.getTime() > existing.LastModified.getTime());
    if (!stale) continue;
    const object = await source.client.send(new GetObjectCommand({ Bucket: source.name, Key: key }));
    if (object.Body === undefined) throw new Error(`${key} has no body`);
    await put(copy, `${copyPrefix}${key}`, await object.Body.transformToByteArray(), object.ContentType ?? 'application/octet-stream');
    copiedCount += 1;
    if (existing === undefined) addedCount += 1;
  }

  const live = new Set(sourceItems.map((item) => item.Key!));
  let deletedCount = 0;
  for (const [key] of copied) {
    if (live.has(key)) continue;
    await remove(copy, `${copyPrefix}${key}`);
    deletedCount += 1;
  }

  return {
    source: sourceItems.length,
    copied: copiedCount,
    deleted: deletedCount,
    mirrored: copyItems.length + addedCount - deletedCount,
  };
}

async function main(): Promise<void> {
  const bucketName = (process.env['FILES_S3_BUCKET'] ?? '').trim();
  const keyId = (process.env['FILES_S3_ACCESS_KEY_ID'] ?? '').trim();
  if (bucketName === '' || keyId === '') {
    // Said, and failed: a backup of the database alone must not look like a whole backup.
    throw new Error('FILES_S3_BUCKET or its read token is not set: uploaded files are not being backed up.');
  }
  const source = {
    client: new S3Client({
      endpoint: env('FILES_S3_ENDPOINT', process.env['BACKUP_S3_ENDPOINT']),
      region: env('BACKUP_S3_REGION', 'auto'),
      forcePathStyle: env('BACKUP_S3_FORCE_PATH_STYLE', 'false').toLowerCase() === 'true',
      credentials: { accessKeyId: keyId, secretAccessKey: env('FILES_S3_SECRET_ACCESS_KEY') },
    }),
    name: bucketName,
  };
  const result = await runMirror({ source, copy: backupBucket() });
  console.log(
    `Files: ${result.source} in the uploads; ${result.copied} copied, ${result.deleted} deleted; ${result.mirrored} in files/.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Files mirror FAILED: ${(error as Error).message}`);
    process.exit(1);
  });
}

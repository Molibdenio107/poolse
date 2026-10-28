import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Decrypter, Encrypter } from 'age-encryption';
import type pg from 'pg';

/**
 * Backups — POOLSE-89. What `backup.ts`, `restore.ts` and `verify-restore.ts`
 * share, so the nightly job, the weekly drill and a person restoring production
 * at midnight run exactly the same code.
 *
 * **The Postgres tools.** `pg_dump` and `pg_restore` run natively where they are
 * installed (GitHub Actions installs the client matching production's major
 * version). With `PG_TOOLS=docker` they run inside `PG_TOOLS_IMAGE`
 * (`postgres:16` by default) instead, and a URL pointing at `localhost` is
 * pointed at `host.docker.internal` — which is how a laptop with no Postgres
 * client runs the same scripts against the Docker database.
 *
 * **The bucket** is the backups' own, never the uploads bucket, with its own
 * token (`BACKUP_S3_*`). S3-compatible, so R2 in production and S3Mock here.
 *
 * **Encryption is age**, to a public key (`BACKUP_AGE_RECIPIENT`, `age1…`). The
 * identity that opens it (`AGE-SECRET-KEY-1…`) is never in the bucket, the repo
 * or GitHub: it lives with Rui offline and is handed to a restore by hand.
 */

export const DUMP_NAME = 'poolse.dump.age';
export const MANIFEST_NAME = 'manifest.json';
/** Rui, 21-10-2026: thirty daily copies and nothing older. */
export const DEFAULT_RETENTION_DAYS = 30;
/** The drill fails when the newest backup is older than this. One missed night is allowed for. */
export const DEFAULT_MAX_AGE_HOURS = 36;
/** The two logins the schema grants to. A per-database dump does not carry roles. */
export const APP_ROLES = ['poolse_app', 'poolse_platform'] as const;

export function env(name: string, fallback?: string): string {
  const value = (process.env[name] ?? '').trim();
  if (value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

// ---------------------------------------------------------------------------
// pg_dump and pg_restore
// ---------------------------------------------------------------------------

function dockerised(): boolean {
  return (process.env['PG_TOOLS'] ?? '').trim().toLowerCase() === 'docker';
}

/** The URL as the tool will see it: from inside a container, the host's localhost is host.docker.internal. */
export function toolUrl(url: string): string {
  if (!dockerised()) return url;
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') parsed.hostname = 'host.docker.internal';
  return parsed.toString();
}

/**
 * Runs `pg_dump` or `pg_restore`, feeding `stdin` and returning stdout. A non-zero
 * exit is an error carrying the tool's own stderr, because "pg_restore failed"
 * with nothing after it is the sentence that wastes an hour at midnight.
 */
export function runPgTool(tool: 'pg_dump' | 'pg_restore', args: string[], stdin?: Uint8Array): Promise<Buffer> {
  const [command, fullArgs] = dockerised()
    ? [
        'docker',
        [
          'run',
          '--rm',
          '-i',
          '--add-host=host.docker.internal:host-gateway',
          env('PG_TOOLS_IMAGE', 'postgres:16'),
          tool,
          ...args,
        ],
      ]
    : [tool, args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, fullArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${tool} exited with ${code}${stderr === '' ? '' : `:\n${stderr}`}`));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** A custom-format dump starts with these five bytes; anything else is not one. */
export function looksLikeDump(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === 'PGDMP';
}

// ---------------------------------------------------------------------------
// The manifest — what the source database said about itself at the snapshot
// ---------------------------------------------------------------------------

export interface Manifest {
  version: 1;
  /** ISO instant the snapshot was taken. */
  createdAt: string;
  /** The object key of the encrypted dump beside this manifest. */
  dumpKey: string;
  serverVersion: string;
  /** Every migration recorded as applied, by file name. */
  migrations: string[];
  /** Row count of every table in `public`, from the dump's own snapshot. */
  rowCounts: Record<string, number>;
  /** Tables with row-level security enabled. */
  rlsTables: string[];
  /** The app logins' privileges, as `role|object|privilege` strings, sorted. */
  grants: string[];
  dumpBytes: number;
  encryptedBytes: number;
  /** sha256 of the encrypted object, checked before anything is decrypted. */
  sha256: string;
}

/**
 * What the database says about itself, read inside the transaction whose
 * snapshot the dump uses — so a row written during the dump is in neither, and
 * the counts are the dump's counts exactly, not "roughly at the same time".
 */
export async function describeDatabase(
  client: pg.ClientBase,
): Promise<Pick<Manifest, 'serverVersion' | 'migrations' | 'rowCounts' | 'rlsTables' | 'grants'>> {
  const { rows: version } = await client.query<{ v: string }>('SHOW server_version');
  const { rows: migrations } = await client.query<{ name: string }>(
    'SELECT name FROM schema_migration ORDER BY name',
  );
  const { rows: tables } = await client.query<{ name: string; rls: boolean }>(
    `SELECT c.relname AS name, c.relrowsecurity AS rls
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
  );
  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quoteIdent(table.name)}`);
    rowCounts[table.name] = Number(rows[0]!.n);
  }
  return {
    serverVersion: version[0]!.v,
    migrations: migrations.map((row) => row.name),
    rowCounts,
    rlsTables: tables.filter((table) => table.rls).map((table) => table.name),
    grants: await readGrants(client),
  };
}

/**
 * The app logins' privileges on tables, columns, sequences and functions in
 * `public`. Compared as a set after the restore: `--no-owner` changes who
 * granted them, never what was granted to whom.
 */
export async function readGrants(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ grant: string }>(
    `WITH roles AS (SELECT oid, rolname FROM pg_roles WHERE rolname = ANY ($1::text[]))
     SELECT r.rolname || '|' || c.relname || '|' || a.privilege_type AS grant
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       CROSS JOIN LATERAL aclexplode(c.relacl) a
       JOIN roles r ON r.oid = a.grantee
     UNION
     SELECT r.rolname || '|' || c.relname || '.' || att.attname || '|' || a.privilege_type
       FROM pg_attribute att
       JOIN pg_class c ON c.oid = att.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       CROSS JOIN LATERAL aclexplode(att.attacl) a
       JOIN roles r ON r.oid = a.grantee
      WHERE att.attacl IS NOT NULL AND NOT att.attisdropped
     UNION
     SELECT r.rolname || '|' || p.oid::regprocedure::text || '|' || a.privilege_type
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
       CROSS JOIN LATERAL aclexplode(p.proacl) a
       JOIN roles r ON r.oid = a.grantee
     ORDER BY 1`,
    [[...APP_ROLES]],
  );
  return rows.map((row) => row.grant);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// age
// ---------------------------------------------------------------------------

export async function encryptTo(recipient: string, plaintext: Uint8Array): Promise<Uint8Array> {
  if (!recipient.startsWith('age1')) throw new Error('BACKUP_AGE_RECIPIENT must be an age public key (age1…)');
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(plaintext);
}

export async function decryptWith(identity: string, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (!identity.startsWith('AGE-SECRET-KEY-1')) {
    throw new Error('The age identity must be a secret key (AGE-SECRET-KEY-1…)');
  }
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  try {
    return await decrypter.decrypt(ciphertext);
  } catch (error) {
    throw new Error(`The backup does not open with this key: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// The bucket
// ---------------------------------------------------------------------------

export interface Bucket {
  client: S3Client;
  name: string;
  prefix: string;
}

export function backupBucket(): Bucket {
  return {
    client: new S3Client({
      endpoint: env('BACKUP_S3_ENDPOINT'),
      region: env('BACKUP_S3_REGION', 'auto'),
      forcePathStyle: env('BACKUP_S3_FORCE_PATH_STYLE', 'false').toLowerCase() === 'true',
      credentials: {
        accessKeyId: env('BACKUP_S3_ACCESS_KEY_ID'),
        secretAccessKey: env('BACKUP_S3_SECRET_ACCESS_KEY'),
      },
    }),
    name: env('BACKUP_S3_BUCKET'),
    prefix: env('BACKUP_PREFIX', 'nightly').replace(/\/+$/, ''),
  };
}

/** Only where a test or a dev machine asks: the production token may not create buckets. */
export async function ensureBucket(bucket: Bucket): Promise<void> {
  try {
    await bucket.client.send(new HeadBucketCommand({ Bucket: bucket.name }));
  } catch {
    await bucket.client.send(new CreateBucketCommand({ Bucket: bucket.name }));
  }
}

export async function put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
  await bucket.client.send(new PutObjectCommand({ Bucket: bucket.name, Key: key, Body: body, ContentType: contentType }));
}

export async function get(bucket: Bucket, key: string): Promise<Uint8Array> {
  const result = await bucket.client.send(new GetObjectCommand({ Bucket: bucket.name, Key: key }));
  if (result.Body === undefined) throw new Error(`${key} has no body`);
  return result.Body.transformToByteArray();
}

export async function remove(bucket: Bucket, key: string): Promise<void> {
  await bucket.client.send(new DeleteObjectCommand({ Bucket: bucket.name, Key: key }));
}

/** Every backup under the prefix, newest first, by its folder: `<prefix>/<stamp>/`. */
export async function listBackups(bucket: Bucket): Promise<{ stamp: string; takenAt: Date; keys: string[] }[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await bucket.client.send(
      new ListObjectsV2Command({ Bucket: bucket.name, Prefix: `${bucket.prefix}/`, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token !== undefined);

  const byStamp = new Map<string, string[]>();
  for (const key of keys) {
    const stamp = key.slice(bucket.prefix.length + 1).split('/')[0] ?? '';
    const takenAt = parseStamp(stamp);
    if (takenAt === null) continue;
    byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), key]);
  }
  return [...byStamp.entries()]
    .map(([stamp, items]) => ({ stamp, takenAt: parseStamp(stamp)!, keys: items }))
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
}

/** `2026-10-28T031500Z` — sortable, and a valid S3 key segment. */
export function stampOf(date: Date): string {
  return date.toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function parseStamp(stamp: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (match === null) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

/**
 * The file bucket — 12 October 2026.
 *
 * S3-compatible on purpose: Cloudflare R2 in production, S3Mock in development
 * (docker-compose), AWS S3 or anything else that speaks the protocol later — a
 * change of environment variables, never of code. Absent configuration means
 * storage is off, and every upload control says so, exactly as a missing Stripe
 * key leaves the subscription page saying so (the state of a fresh dev machine).
 *
 *   S3_ENDPOINT            https://<account>.r2.cloudflarestorage.com, or http://localhost:9090
 *   S3_BUCKET              the bucket, one per environment
 *   S3_ACCESS_KEY_ID       \ credentials; S3Mock accepts any
 *   S3_SECRET_ACCESS_KEY   /
 *   S3_REGION              'auto' for R2 (the default)
 *   S3_FORCE_PATH_STYLE    'true' for S3Mock
 */

let client: S3Client | null = null;

export function storageConfigured(): boolean {
  return (
    (process.env['S3_ENDPOINT'] ?? '').trim() !== '' &&
    (process.env['S3_BUCKET'] ?? '').trim() !== '' &&
    (process.env['S3_ACCESS_KEY_ID'] ?? '').trim() !== '' &&
    (process.env['S3_SECRET_ACCESS_KEY'] ?? '').trim() !== ''
  );
}

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env['S3_ENDPOINT'] ?? '',
    region: process.env['S3_REGION'] ?? 'auto',
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? '').toLowerCase() === 'true',
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
    },
  });
  return client;
}

function bucket(): string {
  return process.env['S3_BUCKET'] ?? '';
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<Readable> {
  const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return result.Body as Readable;
}

/** The whole object in memory — for a sealed file, which is opened before it is served (10 MB at most). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObject(key)) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * What a file really is, from its first bytes — never from its name or the
 * browser's claim. A PDF named `foto.jpg` is a PDF; an executable named
 * `apolice.pdf` is refused. The four types `stored_file` allows, and nothing
 * else.
 */
export function sniffType(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // A Word document is a ZIP whose parts include `word/document.xml` — POOLSE-105.
  // A spreadsheet or a deck is also a ZIP, with `xl/` or `ppt/` instead, and is
  // refused: the name inside the archive says what it is, not the file's own.
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 && bytes.includes('word/document.xml', 0, 'latin1')) {
    return WORD;
  }
  return null;
}

/** A Word document's type — a contract may be one (POOLSE-105), nothing else may. */
export const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  [WORD]: 'docx',
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

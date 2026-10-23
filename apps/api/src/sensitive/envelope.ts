import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { derivedKey } from './cipher.js';

/**
 * Envelope encryption for files of special-category data — POOLSE-109.
 *
 * The atestado on a medical leave is the first caller; POOLSE-70's incident
 * attachments and POOLSE-100 switch on by naming their purpose in
 * `SEALED_PURPOSES` (files.repository.ts) and in the `stored_file_sealed` CHECK.
 *
 * **Why an envelope rather than `encryptSensitive` over the bytes.** Each file
 * gets its own random data key; only that key, wrapped by a key derived from
 * SENSITIVE_DATA_KEY, is stored on the file's row. Two properties follow:
 *
 * - **Destroying one file is destroying 60 bytes in SQL.** Retention clears a
 *   file's `wrapped_key` and its bytes in the bucket are unreadable for ever —
 *   which `apply_retention()` can do, while deleting a bucket object from inside
 *   a database function cannot.
 * - **Rotating the master key re-wraps keys, never files.**
 *
 * Both layers are AES-256-GCM with a fresh IV. Both bind `context` — the club
 * and the file id — as additional authenticated data, so neither a wrapped key
 * nor a body can be moved onto another row and still open.
 *
 * The body is `iv (12) ‖ tag (16) ‖ ciphertext`; the wrapped key is
 * `v1.<iv>.<tag>.<ciphertext>`, base64url, the shape `cipher.ts` uses.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function wrappingKey(): Buffer {
  return derivedKey('file-envelope');
}

export interface Sealed {
  /** What goes in the bucket. */
  body: Buffer;
  /** What goes on the `stored_file` row. */
  wrappedKey: string;
}

/** Seals a file's bytes under a key of its own. Throws without SENSITIVE_DATA_KEY — never stores plaintext. */
export function sealFile(plaintext: Buffer, context: string): Sealed {
  const kek = wrappingKey();
  const dataKey = randomBytes(KEY_BYTES);
  const aad = Buffer.from(context, 'utf8');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  const keyIv = randomBytes(IV_BYTES);
  const wrap = createCipheriv('aes-256-gcm', kek, keyIv);
  wrap.setAAD(aad);
  const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]);
  const wrappedKey = [
    VERSION,
    keyIv.toString('base64url'),
    wrap.getAuthTag().toString('base64url'),
    wrapped.toString('base64url'),
  ].join('.');

  return { body, wrappedKey };
}

/** Opens a sealed body. Throws on a wrong key, a wrong context or any tampering — never returns rubbish. */
export function openSealedFile(body: Buffer, wrappedKey: string, context: string): Buffer {
  const [version, keyIv, keyTag, wrapped] = wrappedKey.split('.');
  if (version !== VERSION || !keyIv || !keyTag || !wrapped) {
    throw new Error(`Unrecognised wrapped key format (${version ?? 'empty'})`);
  }
  const aad = Buffer.from(context, 'utf8');

  const unwrap = createDecipheriv('aes-256-gcm', wrappingKey(), Buffer.from(keyIv, 'base64url'));
  unwrap.setAAD(aad);
  unwrap.setAuthTag(Buffer.from(keyTag, 'base64url'));
  const dataKey = Buffer.concat([unwrap.update(Buffer.from(wrapped, 'base64url')), unwrap.final()]);

  if (body.length < IV_BYTES + TAG_BYTES) throw new Error('A sealed body is shorter than its header');
  const decipher = createDecipheriv('aes-256-gcm', dataKey, body.subarray(0, IV_BYTES));
  decipher.setAAD(aad);
  decipher.setAuthTag(body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** The context a stored file is sealed under: its club and its id. */
export function fileContext(organizationId: string, fileId: string): string {
  return `stored_file:${organizationId}:${fileId}`;
}

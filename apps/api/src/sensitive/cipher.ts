import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption for special-category data, done in the application rather than the
 * database.
 *
 * The alternative was pgcrypto, and it is worse here for one specific reason:
 * `pgp_sym_encrypt(notes, key)` puts the key in the SQL statement, which means
 * it lands in `pg_stat_statements`, in the slow-query log, and in any error
 * message that echoes the failing query. Encrypting before the value leaves this
 * process means Postgres only ever holds ciphertext, and a database dump, a
 * backup restored onto a laptop, or a support engineer with a psql prompt does
 * not have children's medical records.
 *
 * AES-256-GCM: authenticated, so a modified ciphertext fails to decrypt rather
 * than returning plausible rubbish. A fresh random IV per encryption, because
 * reusing one with GCM is catastrophic rather than merely weak.
 *
 * Stored as `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix
 * costs three characters and is what makes key rotation possible later without
 * having to guess what an old value was encrypted with.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class MissingKeyError extends Error {}

/**
 * Fails rather than falling back to plaintext.
 *
 * A missing key must never mean "store it unencrypted this time" — that is how a
 * feature designed around encryption ends up with half its rows readable, and
 * nobody notices until the row that matters is one of them.
 */
function key(): Buffer {
  const configured = process.env['SENSITIVE_DATA_KEY'];
  if (!configured) {
    throw new MissingKeyError(
      'SENSITIVE_DATA_KEY is not set. Medical notes cannot be read or written without it. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  const decoded = Buffer.from(configured, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new MissingKeyError(
      `SENSITIVE_DATA_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}. ` +
        'It should be base64 of 32 random bytes.',
    );
  }
  return decoded;
}

/** Null in, null out: "no medical notes" is a state, not an empty string. */
export function encryptSensitive(plaintext: string | null): string | null {
  if (plaintext === null || plaintext.trim().length === 0) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Throws on tampering, deliberately.
 *
 * A ciphertext that fails its authentication tag has been altered or was
 * encrypted under a different key. Returning null there would present a child
 * with no medical notes as a child with no medical conditions, which is the
 * single most dangerous thing this module could do.
 */
export function decryptSensitive(stored: string | null): string | null {
  if (stored === null || stored.length === 0) return null;

  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error(`Unrecognised sensitive value format (${version ?? 'empty'})`);
  }

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** For the startup check: is the key present and the right shape? */
export function sensitiveKeyIsUsable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

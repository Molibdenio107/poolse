import { createHash, randomBytes } from 'node:crypto';

/** Seven days. Long enough to survive a weekend, short enough that a stray link dies. */
export const INVITATION_TTL_DAYS = 7;

/** 256 bits, base64url so it survives being pasted into a URL, a chat, an email. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Goes in the link. Never stored, never logged. */
  token: string;
  /** Goes in the database. */
  tokenHash: string;
}

/**
 * Invitation tokens are bearer credentials: whoever holds one can join an
 * organization with the roles it names. Two consequences shape this file.
 *
 * They are generated with a CSPRNG, not a uuid — `gen_random_uuid()` is fine for
 * an identifier that gets published and useless as a secret.
 *
 * And only their hash is stored. A token is worth guarding for the same reason a
 * password is: the database holds many of them at once, and a dump, a backup on
 * a laptop, or a log line that captured a row would otherwise be a set of working
 * keys into customer organizations. SHA-256 with no salt is right here and would
 * be wrong for a password — the input is 256 bits of entropy we generated, so
 * there is no dictionary to attack and nothing for a salt to defeat.
 */
export function issueToken(): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function invitationExpiry(from: Date = new Date()): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + INVITATION_TTL_DAYS);
  return expires;
}

/**
 * Deliberately loose. Address validation that tries to be clever rejects real
 * addresses, and the only thing that actually proves an address works is sending
 * to it — which slice 3.0 will do. This catches the typo that is obviously a
 * typo and nothing else.
 */
export function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

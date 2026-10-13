import { createHmac, timingSafeEqual } from 'node:crypto';
import { derivedKey } from '../sensitive/cipher.js';

/**
 * "This form was rendered recently" — POOLSE-69's third abuse check.
 *
 * The form's GET hands out `<issuedAtMs>.<hmac(slug, issuedAtMs)>`; the POST
 * hands it back. A script that posts without ever loading the page has no
 * stamp; one replaying an old stamp is past its age; one that fills the form in
 * under a few seconds is not a parent. Nothing is stored — the stamp proves
 * itself — so there is no table to clean and no per-visitor state.
 *
 * Bound to the slug, so a stamp from one club's page does not open another's.
 */

/** Faster than this is a script, not a parent typing a child's name. */
export const STAMP_MIN_AGE_MS = 3_000;
/**
 * A form opened at lunch and sent in the evening still works — 13-10-2026
 * sweep. Four hours dropped that parent silently while telling them it was
 * received; a day is long for a script and short enough to retire a page.
 */
export const STAMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sign(slug: string, issuedAt: number): string {
  return createHmac('sha256', derivedKey('lead-form-stamp'))
    .update(`${slug}\n${issuedAt}`)
    .digest('base64url');
}

export function issueStamp(slug: string, now: Date = new Date()): string {
  const issuedAt = now.getTime();
  return `${issuedAt}.${sign(slug, issuedAt)}`;
}

export function stampIsFresh(slug: string, stamp: unknown, now: Date = new Date()): boolean {
  if (typeof stamp !== 'string') return false;
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(stamp);
  if (match === null) return false;

  const issuedAt = Number(match[1]);
  const age = now.getTime() - issuedAt;
  if (age < STAMP_MIN_AGE_MS || age > STAMP_MAX_AGE_MS) return false;

  const expected = Buffer.from(sign(slug, issuedAt));
  const given = Buffer.from(match[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

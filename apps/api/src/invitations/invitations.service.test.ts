import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, invitationExpiry, issueToken, INVITATION_TTL_HOURS } from './invitations.service.js';

/**
 * How long an invitation lives — round 5, ticket 7.
 *
 * The window was seven days and is now twenty-four hours. Nothing asserted the
 * old number, which is why it could be changed by editing one constant — so this
 * pins the new one, because the next person to widen it should have to mean it.
 *
 * An invitation is a bearer credential: whoever holds the link joins the club
 * with the roles it names. A week-long window is a week in which a forwarded
 * email or a screenshot in a group chat is a working key.
 *
 * `invitations.sql` test 5 proves the refusal itself, against the database.
 * This is the arithmetic in front of it.
 *
 * Run: pnpm api:test
 */

test('an invitation is good for a day, not a week', () => {
  assert.equal(INVITATION_TTL_HOURS, 24);

  const issued = new Date('2026-09-05T14:30:00.000Z');
  assert.equal(invitationExpiry(issued).toISOString(), '2026-09-06T14:30:00.000Z');
});

test('the window crosses a month, a year and a leap day without arithmetic of its own', () => {
  // `setUTCHours` rolls the date for us. Asserted because the previous version
  // used `setUTCDate`, and hand-rolled date maths is where off-by-one lives.
  assert.equal(
    invitationExpiry(new Date('2026-12-31T23:00:00.000Z')).toISOString(),
    '2027-01-01T23:00:00.000Z',
  );
  assert.equal(
    invitationExpiry(new Date('2028-02-28T09:00:00.000Z')).toISOString(),
    '2028-02-29T09:00:00.000Z',
    '2028 is a leap year',
  );
});

test('the caller is not mutated', () => {
  // `invitationExpiry` copies before adding. Without the copy it would move the
  // `now` its caller is also using to stamp `created_at`.
  const issued = new Date('2026-09-05T14:30:00.000Z');
  invitationExpiry(issued);
  assert.equal(issued.toISOString(), '2026-09-05T14:30:00.000Z');
});

test('a token is 256 bits, and only its hash is worth storing', () => {
  const { token, tokenHash } = issueToken();

  // base64url of 32 bytes, unpadded.
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenHash, hashToken(token));
  assert.match(tokenHash, /^[0-9a-f]{64}$/);

  // Two invitations issued in the same millisecond are still different links.
  assert.notEqual(issueToken().token, issueToken().token);
});

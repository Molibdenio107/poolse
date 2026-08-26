import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { decryptSensitive, encryptSensitive, MissingKeyError } from './cipher.js';

/**
 * The first unit test in the repository, and it is here rather than anywhere
 * else on purpose.
 *
 * Everything else is proven by the SQL suites, because everything else is a
 * property of the database. This is not: it is pure computation that the
 * database cannot see into by design, and it is the one piece of code where
 * being subtly wrong is silent. Encryption that does not round-trip loses a
 * child's medical notes; encryption that does not detect tampering hands back
 * plausible rubbish; a missing key that falls back to plaintext defeats the
 * entire slice without a single error.
 *
 * Run: pnpm --filter @poolse/api test
 */
describe('sensitive data cipher', () => {
  const original = process.env['SENSITIVE_DATA_KEY'];

  before(() => {
    process.env['SENSITIVE_DATA_KEY'] = randomBytes(32).toString('base64');
  });

  after(() => {
    if (original === undefined) delete process.env['SENSITIVE_DATA_KEY'];
    else process.env['SENSITIVE_DATA_KEY'] = original;
  });

  it('round-trips text, accents and all', () => {
    const notes = 'Asma. Usa inalador antes da aula. Alergia a amendoim — grave.';
    const stored = encryptSensitive(notes);

    assert.notEqual(stored, null);
    assert.equal(decryptSensitive(stored), notes);
  });

  it('stores nothing readable', () => {
    const stored = encryptSensitive('epilepsia');

    assert.ok(stored !== null);
    assert.ok(!stored.includes('epilepsia'), 'plaintext leaked into the stored value');
    assert.match(stored, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per encryption. Reusing one under GCM is catastrophic rather
    // than merely weak, and identical ciphertexts would be the visible symptom.
    const first = encryptSensitive('same text');
    const second = encryptSensitive('same text');

    assert.notEqual(first, second);
    assert.equal(decryptSensitive(first), 'same text');
    assert.equal(decryptSensitive(second), 'same text');
  });

  it('treats absent notes as absent, not as an empty string', () => {
    assert.equal(encryptSensitive(null), null);
    assert.equal(encryptSensitive(''), null);
    assert.equal(encryptSensitive('   '), null);
    assert.equal(decryptSensitive(null), null);
  });

  it('refuses a tampered ciphertext rather than returning rubbish', () => {
    const stored = encryptSensitive('Alergia a amendoim');
    assert.ok(stored !== null);

    const [version, iv, tag, ciphertext] = stored.split('.');
    // Flip the payload, keep the tag. GCM must notice.
    const altered = [version, iv, tag, `${ciphertext?.slice(0, -2)}AA`].join('.');

    assert.throws(() => decryptSensitive(altered));
  });

  it('refuses a value encrypted under a different key', () => {
    const stored = encryptSensitive('Diabetes tipo 1');
    process.env['SENSITIVE_DATA_KEY'] = randomBytes(32).toString('base64');

    // Not a silent null: a child with unreadable notes must not present as a
    // child with no medical conditions.
    assert.throws(() => decryptSensitive(stored));
  });

  it('refuses to work at all without a key', () => {
    const saved = process.env['SENSITIVE_DATA_KEY'];
    delete process.env['SENSITIVE_DATA_KEY'];

    assert.throws(() => encryptSensitive('anything'), MissingKeyError);
    assert.throws(() => decryptSensitive('v1.a.b.c'), MissingKeyError);

    process.env['SENSITIVE_DATA_KEY'] = saved;
  });

  it('refuses a key of the wrong length', () => {
    const saved = process.env['SENSITIVE_DATA_KEY'];
    process.env['SENSITIVE_DATA_KEY'] = randomBytes(16).toString('base64');

    assert.throws(() => encryptSensitive('anything'), MissingKeyError);

    process.env['SENSITIVE_DATA_KEY'] = saved;
  });
});

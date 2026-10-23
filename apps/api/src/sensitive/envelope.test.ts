import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { MissingKeyError } from './cipher.js';
import { fileContext, openSealedFile, sealFile } from './envelope.js';

/**
 * The file envelope — POOLSE-109. Pure computation the database cannot see
 * into, so it is proven here: a round trip, nothing readable at rest, a fresh
 * key per file, and every way of opening the wrong thing failing loudly.
 *
 * Run: pnpm --filter @poolse/api test
 */
describe('file envelope', () => {
  const original = process.env['SENSITIVE_DATA_KEY'];
  const context = fileContext('org-1', 'file-1');
  const pdf = Buffer.from('%PDF-1.4\nAtestado médico: dispensado da natação até 15-11-2026.\n%%EOF\n', 'utf8');

  before(() => {
    process.env['SENSITIVE_DATA_KEY'] = randomBytes(32).toString('base64');
  });

  after(() => {
    if (original === undefined) delete process.env['SENSITIVE_DATA_KEY'];
    else process.env['SENSITIVE_DATA_KEY'] = original;
  });

  it('round-trips the bytes', () => {
    const sealed = sealFile(pdf, context);
    assert.deepEqual(openSealedFile(sealed.body, sealed.wrappedKey, context), pdf);
  });

  it('stores nothing readable, in the body or the key', () => {
    const sealed = sealFile(pdf, context);
    assert.equal(sealed.body.includes('Atestado', 0, 'utf8'), false);
    assert.equal(sealed.body.includes('%PDF', 0, 'latin1'), false);
    assert.match(sealed.wrappedKey, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('gives every file its own key', () => {
    const one = sealFile(pdf, context);
    const two = sealFile(pdf, context);
    assert.notEqual(one.wrappedKey, two.wrappedKey);
    assert.notDeepEqual(one.body, two.body);
    assert.throws(() => openSealedFile(one.body, two.wrappedKey, context));
  });

  it('refuses a body or key moved onto another file', () => {
    const sealed = sealFile(pdf, context);
    assert.throws(() => openSealedFile(sealed.body, sealed.wrappedKey, fileContext('org-1', 'file-2')));
    assert.throws(() => openSealedFile(sealed.body, sealed.wrappedKey, fileContext('org-2', 'file-1')));
  });

  it('refuses a tampered body', () => {
    const sealed = sealFile(pdf, context);
    const body = Buffer.from(sealed.body);
    body[body.length - 1] = body[body.length - 1]! ^ 0x01;
    assert.throws(() => openSealedFile(body, sealed.wrappedKey, context));
  });

  it('refuses under another master key', () => {
    const sealed = sealFile(pdf, context);
    process.env['SENSITIVE_DATA_KEY'] = randomBytes(32).toString('base64');
    assert.throws(() => openSealedFile(sealed.body, sealed.wrappedKey, context));
  });

  it('never seals without the key', () => {
    const saved = process.env['SENSITIVE_DATA_KEY'];
    delete process.env['SENSITIVE_DATA_KEY'];
    try {
      assert.throws(() => sealFile(pdf, context), MissingKeyError);
    } finally {
      process.env['SENSITIVE_DATA_KEY'] = saved;
    }
  });
});

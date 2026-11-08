import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * POOLSE-201: *Extratos* carry the payer's NIF and address, and the pages say
 * `no-store`. A service worker with a fetch handler could keep them on a shared
 * phone anyway, so the worker stays push-only. Adding caching is a decision,
 * and this test is where it gets made.
 */
test('the service worker has no fetch handler, so it caches no page', () => {
  const worker = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
  const code = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /addEventListener\(\s*['"]fetch['"]/);
  assert.doesNotMatch(code, /\bonfetch\s*=/);
  assert.doesNotMatch(code, /caches\.open/);
});

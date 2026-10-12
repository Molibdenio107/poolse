import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveRefusal } from './archive-refusal.ts';

/**
 * A refused restore becomes a key and its figures — POOLSE-78. Read against the
 * real catalogue, so a key this produces that does not exist fails here rather
 * than rendering raw on the one refusal somebody needed explained.
 */

const catalogue = JSON.parse(
  readFileSync(new URL('../messages/pt-PT.json', import.meta.url), 'utf-8'),
) as Record<string, unknown>;

function lookup(key: string): string {
  let node: unknown = catalogue;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) {
      throw new Error(`missing key ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`not a leaf: ${key}`);
  return node;
}

test('a name clash names the kind in words and keeps the club’s spelling', () => {
  const refusal = archiveRefusal(
    { code: 'restore_conflict', entityType: 'pool', field: 'name', value: 'Piscina 1' },
    lookup,
  );
  assert.deepEqual(refusal, {
    errorKey: 'archive.refusal.conflict.name',
    values: { value: 'Piscina 1', kind: 'Tanque' },
  });
  lookup(refusal!.errorKey);
});

test('a fee line clash translates the kind it clashed on', () => {
  const refusal = archiveRefusal(
    { code: 'restore_conflict', entityType: 'student_fee', field: 'kind', value: 'seguro' },
    lookup,
  );
  assert.equal(refusal?.values?.['value'], 'Seguro');
});

test('an archived parent carries the entry that would restore it', () => {
  const refusal = archiveRefusal(
    { code: 'parent_archived', parentKind: 'facility', parentName: 'Sede', parentEntryId: 'e1' },
    lookup,
  );
  assert.equal(refusal?.parentEntryId, 'e1');
  assert.deepEqual(refusal?.values, { name: 'Sede', kind: 'Instalação' });
});

test('every code this knows resolves to a key that exists', () => {
  for (const code of [
    'already_restored',
    'parent_archived',
    'restore_conflict',
    'licence_exceeded',
    'pool_full',
    'class_full',
  ]) {
    const refusal = archiveRefusal({ code }, lookup);
    assert.ok(refusal, code);
    assert.doesNotThrow(() => lookup(refusal.errorKey), code);
  }
  for (const field of ['taxNumber', 'socioNumber', 'kind', 'name']) {
    const refusal = archiveRefusal({ code: 'restore_conflict', field }, lookup);
    assert.doesNotThrow(() => lookup(refusal!.errorKey), field);
  }
});

test('a body that is not ours is null, never a sentence with holes', () => {
  assert.equal(archiveRefusal(null, lookup), null);
  assert.equal(archiveRefusal('Conflict', lookup), null);
  assert.equal(archiveRefusal({ code: 'pool_name_uq' }, lookup), null);
});

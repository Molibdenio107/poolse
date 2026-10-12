import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTORABLE, assertRestorableIsSound, type RestorableKind } from './restorable.js';

/**
 * The registry refuses the mistakes that would restore half of something and
 * report success — POOLSE-78 AC 5. No database: these are shapes.
 */

test('the registry as shipped is sound', () => {
  assert.doesNotThrow(() => assertRestorableIsSound());
});

test('the nine kinds Rui chose, and no staff or season', () => {
  assert.deepEqual(RESTORABLE.map((one) => one.kind).sort(), [
    'class_group',
    'facility',
    'inventory_item',
    'maintenance_task',
    'partner',
    'pool',
    'space',
    'student',
    'student_fee',
  ]);
});

const base = RESTORABLE.find((one) => one.kind === 'pool')!;
const variant = (patch: Partial<RestorableKind>): RestorableKind[] => [
  ...RESTORABLE.filter((one) => one.kind !== 'pool'),
  { ...base, ...patch },
];

test('a duplicated action is refused', () => {
  assert.throws(() => assertRestorableIsSound(variant({ action: 'student.archived' })), /twice/);
});

test('a parent that is not restorable is refused', () => {
  assert.throws(
    () => assertRestorableIsSound(variant({ parents: [{ kind: 'season' as never, column: 'x' }] })),
    /not restorable/,
  );
});

test('reopening fee lines without their enrolments is refused', () => {
  assert.throws(
    () => assertRestorableIsSound(variant({ cascades: ['student_fee.ends_on'] })),
    /without their enrolments/,
  );
});

test('a label that does not alias the row as t is refused', () => {
  assert.throws(
    () => assertRestorableIsSound(variant({ label: { from: 'pool p', name: 'p.name' } })),
    /alias/,
  );
});

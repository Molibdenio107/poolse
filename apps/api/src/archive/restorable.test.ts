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

// The nine Rui chose on 12-10-2026, and a meet with its results (POOLSE-81).
test('the twenty-two restorable kinds, and no staff or season', () => {
  assert.deepEqual(RESTORABLE.map((one) => one.kind).sort(), [
    'aviso',
    'calendar_replaced',
    'class_group',
    'energy_invoice',
    'energy_invoices',
    'energy_readings',
    'facility',
    'inventory_item',
    'lesson_feedback',
    'maintenance_task',
    'partner',
    'pool',
    'pool_analysis',
    'pool_analysis_alert',
    'space',
    'staff_note',
    'student',
    'student_fee',
    'swim_meet',
    'timetable_import',
    'water_alerts',
    'water_history',
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseColumnForField, chooseFieldForColumn, fieldAtColumn } from './column-mapping.ts';

/** The one mapping rule every importer applies (Rui, 11-11-2026). */

const FIELDS = ['firstName', 'lastName', 'maritalStatus', 'nationality'] as const;
type Field = (typeof FIELDS)[number];
const guessed: Record<Field, number | null> = { firstName: 0, lastName: 1, maritalStatus: 6, nationality: 5 };

test('Não importar on a guessed column clears it — the bug: it used to snap back to the guess', () => {
  const next = chooseFieldForColumn(guessed, FIELDS, 6, null);
  assert.equal(fieldAtColumn(next, FIELDS, 6), null);
  assert.equal(next.maritalStatus, null);
  assert.deepEqual({ ...next, maritalStatus: 6 }, guessed, 'nothing else moved');
});

test('a column given another field leaves its old field empty, and the field leaves its old column', () => {
  const moved = chooseFieldForColumn(guessed, FIELDS, 6, 'nationality');
  assert.equal(moved.nationality, 6);
  assert.equal(moved.maritalStatus, null, 'column 6 feeds one field');
  assert.equal(fieldAtColumn(moved, FIELDS, 5), null, 'the field took one column, so 5 is free');
  // And back to Não importar from there.
  assert.equal(fieldAtColumn(chooseFieldForColumn(moved, FIELDS, 6, null), FIELDS, 6), null);
});

test('the field view frees the column from whichever field had it, and none clears the field', () => {
  const taken = chooseColumnForField(guessed, FIELDS, 'nationality', 6);
  assert.equal(taken.nationality, 6);
  assert.equal(taken.maritalStatus, null);
  assert.equal(chooseColumnForField(taken, FIELDS, 'nationality', null).nationality, null);
});

test('the input mapping is never changed in place', () => {
  const before = { ...guessed };
  chooseFieldForColumn(guessed, FIELDS, 6, null);
  chooseColumnForField(guessed, FIELDS, 'firstName', 1);
  assert.deepEqual(guessed, before);
});

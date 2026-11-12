import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getImportPreview, previewBookings, previewCounts, setImportPreview, type ImportPreview } from './import-preview.ts';

/** POOLSE-224 — the import waiting for Confirmar, as the bar counts it and the calendar draws it. */

const row = (index: number, over: Partial<ImportPreview['rows'][number]> = {}): ImportPreview['rows'][number] => ({
  index,
  name: 'Hidroginástica',
  kind: 'turma',
  turmaKey: 't18',
  weekday: 1,
  startMinutes: 18 * 60,
  durationMinutes: 45,
  laneIds: ['l1'],
  poolId: 'p1',
  instructorId: null,
  instructorName: null,
  importable: true,
  ...over,
});

const preview: ImportPreview = {
  facilityId: 'f1',
  poolId: 'p1',
  rowsJson: '[]',
  drop: [3],
  fileName: 'horario.pdf', replace: null, replacedPoolIds: [],
  rows: [
    row(0),
    row(1, { weekday: 3 }),
    row(2, { kind: 'free_swim', turmaKey: null, name: 'Natação Livre' }),
    row(3, { turmaKey: 'tb', name: 'Bebés' }),
    row(4, { importable: false, turmaKey: 'tx', name: 'Recusada' }),
  ],
  turmas: [
    { key: 't18', name: 'Hidroginástica · 18:00', poolId: 'p1', existingId: null, slots: [0, 1] },
    { key: 'tb', name: 'Bebés', poolId: 'p1', existingId: null, slots: [3] },
    { key: 'tx', name: 'Recusada', poolId: 'p1', existingId: null, slots: [4] },
  ],
};

test('the bar counts the rows that will be written and the turmas that are new', () => {
  // Row 3 was left out, row 4 cannot be written: neither counts, nor do their turmas.
  assert.deepEqual(previewCounts(preview), { classes: 3, newTurmas: 1 });
});

test('an existing turma taking slots is not counted as new', () => {
  const adding = { ...preview, turmas: preview.turmas.map((turma) => ({ ...turma, existingId: 'cg-1' })) };
  assert.equal(previewCounts(adding).newTurmas, 0);
});

test('the calendar draws the kept rows as preview blocks under their turma’s name', () => {
  const blocks = previewBookings(preview);
  assert.deepEqual(
    blocks.map((block) => [block.id, block.name, block.subjectType, block.startTime, block.preview]),
    [
      ['preview:0', 'Hidroginástica · 18:00', 'turma', '18:00:00', true],
      ['preview:1', 'Hidroginástica · 18:00', 'turma', '18:00:00', true],
      ['preview:2', 'Natação Livre', 'free_swim', '18:00:00', true],
    ],
  );
});

test('the store holds one preview and forgets it', () => {
  setImportPreview(preview);
  assert.equal(getImportPreview()?.fileName, 'horario.pdf');
  setImportPreview(null);
  assert.equal(getImportPreview(), null);
});

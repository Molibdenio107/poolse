import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRows, outline, suggestKind, suggestPools } from './timetable-mapping.ts';
import type { TimetableReadRow, TimetableReading } from './timetable-reading.ts';

/** POOLSE-223 rule 4 — the mapping step between the reading and the preview. */

const at = (over: Partial<TimetableReadRow>): TimetableReadRow => ({
  sourcePool: 'Piscina de 25 m',
  weekday: 1,
  start: '07:00',
  end: '08:00',
  activity: 'Hidroginástica',
  lanes: 3,
  laneNames: [],
  closed: false,
  line: 1,
  ...over,
});

const reading: TimetableReading = {
  validity: null,
  rows: [
    at({}),
    at({ activity: 'Natação Livre' }),
    at({ start: '10:00', end: '13:00', activity: 'Natação Livre', lanes: 6, line: 2 }),
    at({ start: '13:00', end: '14:00', activity: '', lanes: null, closed: true, line: 3 }),
    at({ sourcePool: 'Piscina de Aprendizagem', activity: 'Bebés', lanes: null, line: 4 }),
  ],
};

const SITE = [
  { id: 'main', name: 'Piscina principal' },
  { id: 'learner', name: 'Piscina de aprendizagem' },
];

test('the step lists the pools, the activities with their rows, and the closed count', () => {
  assert.deepEqual(outline(reading), {
    sourcePools: ['Piscina de 25 m', 'Piscina de Aprendizagem'],
    activities: [
      { name: 'Hidroginástica', rows: 1 },
      { name: 'Natação Livre', rows: 2 },
      { name: 'Bebés', rows: 1 },
    ],
    closed: 1,
  });
});

test('pools are preselected by name, and the one left over pairs with the one left (QA 1)', () => {
  assert.deepEqual(suggestPools(['Piscina de 25 m', 'Piscina de Aprendizagem'], SITE), {
    'Piscina de 25 m': 'main',
    'Piscina de Aprendizagem': 'learner',
  });
});

test('two unknown pools are never both put in one tank: they must be chosen', () => {
  assert.deepEqual(suggestPools(['Tanque A', 'Tanque B'], SITE), { 'Tanque A': '', 'Tanque B': '' });
});

test('free swim is suggested only for its own names; the rest are turmas', () => {
  assert.equal(suggestKind('Natação Livre'), 'free_swim');
  assert.equal(suggestKind('Nado livre'), 'free_swim');
  assert.equal(suggestKind('LIVRE'), 'free_swim');
  assert.equal(suggestKind('Hidroginástica livre'), 'turma');
  assert.equal(suggestKind('Escola de Natação'), 'turma', 'every other class is a turma (POOLSE-224)');
});

test('mapped rows carry pool, kind and count; closed and Não importar stay out', () => {
  const rows = mapRows(
    reading,
    { 'Piscina de 25 m': 'main', 'Piscina de Aprendizagem': 'skip' },
    { 'Hidroginástica': 'evento', 'Natação Livre': 'free_swim', 'Bebés': 'evento' },
    'default',
  );
  assert.deepEqual(rows, [
    { weekday: 1, startTime: '07:00', durationMinutes: 60, name: 'Hidroginástica', laneNames: [], laneCount: 3, poolId: 'main', kind: 'evento', line: 1 },
    { weekday: 1, startTime: '07:00', durationMinutes: 60, name: 'Natação Livre', laneNames: [], laneCount: 3, poolId: 'main', kind: 'free_swim', line: 1 },
    { weekday: 1, startTime: '10:00', durationMinutes: 180, name: 'Natação Livre', laneNames: [], laneCount: 6, poolId: 'main', kind: 'free_swim', line: 2 },
  ]);
});

test('an activity set to Não importar is left out (QA 6 for activities)', () => {
  const rows = mapRows(reading, { 'Piscina de 25 m': 'main', 'Piscina de Aprendizagem': 'learner' }, { 'Natação Livre': 'skip' }, null);
  assert.deepEqual(rows?.map((row) => row.name), ['Hidroginástica', 'Bebés']);
});

test('nothing is sent while a named pool is unchosen', () => {
  assert.equal(mapRows(reading, { 'Piscina de 25 m': 'main', 'Piscina de Aprendizagem': '' }, {}, null), null);
});

test('a reading that names no pool uses the step-zero pool', () => {
  const plain: TimetableReading = { validity: null, rows: [at({ sourcePool: '', laneNames: ['1-3'], lanes: null })] };
  const rows = mapRows(plain, {}, {}, 'chosen');
  assert.equal(rows?.[0]?.poolId, 'chosen');
  assert.deepEqual(rows?.[0]?.laneNames, ['1-3']);
  assert.equal(rows?.[0]?.laneCount, null);
});

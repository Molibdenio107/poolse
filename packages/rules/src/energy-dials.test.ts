import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALS_OF, dialProblem, dialTotal } from './energy-dials.js';

test('each tariff option carries its own dials', () => {
  assert.deepEqual(DIALS_OF.single, []);
  assert.deepEqual(DIALS_OF.bi, ['vazio', 'fora_vazio']);
  assert.deepEqual(DIALS_OF.tri, ['vazio', 'cheias', 'ponta']);
  assert.deepEqual(DIALS_OF.tetra, ['super_vazio', 'vazio', 'cheias', 'ponta']);
});

test('a reading must carry every dial of its set, and no other', () => {
  assert.equal(dialProblem('tri', { vazio: 1, cheias: 2, ponta: 3 }), null);
  assert.deepEqual(dialProblem('tri', { vazio: 1, cheias: 2 }), { dial: 'ponta', problem: 'missing' });
  assert.deepEqual(dialProblem('bi', { vazio: 1, fora_vazio: 2, ponta: 3 }), { dial: 'ponta', problem: 'foreign' });
  assert.equal(dialProblem('single', {}), null);
});

test('the total is the dials summed, to the column precision', () => {
  assert.equal(dialTotal({ vazio: 300000.1, cheias: 200000.2, ponta: 100000.3 }), 600000.6);
});

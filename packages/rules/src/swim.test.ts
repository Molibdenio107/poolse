import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGap, formatSwimTime, fpnAgeGroups, parseSwimTime } from './swim.js';

/** POOLSE-85 — what a coach types into the entry-times grid. */

test('reads m:ss.hh and ss.hh, with a point or a comma', () => {
  assert.equal(parseSwimTime('1:05.00'), 65000);
  assert.equal(parseSwimTime('1:05,34'), 65340);
  assert.equal(parseSwimTime('28.91'), 28910);
  assert.equal(parseSwimTime(' 16:59.99 '), 1019990);
});

test('an empty cell is empty, not zero', () => {
  assert.equal(parseSwimTime(''), '');
  assert.equal(parseSwimTime('   '), '');
});

test('refuses the ambiguous shapes rather than guessing', () => {
  for (const bad of ['1.05.00', '65', '1:5.00', '1:65.00', '1:05.0', '1:05.000', 'abc', '0.00']) {
    assert.equal(parseSwimTime(bad), null, bad);
  }
});

test('formats back to the shape it reads', () => {
  for (const ms of [28910, 65000, 65340, 1019990]) {
    assert.equal(parseSwimTime(formatSwimTime(ms)), ms);
  }
  assert.equal(formatGap(1240), '+1.24');
  assert.equal(formatGap(-800), '−0.80');
  assert.equal(formatGap(0), '±0.00');
});

test('the FPN groups for 2025/2026 are the birth years FPN Comunicado 26/25 gives — POOLSE-111', () => {
  const groups = Object.fromEntries(fpnAgeGroups(2026).map((g) => [g.name, [g.bornFrom, g.bornTo]]));
  assert.deepEqual(groups['Cadetes A'], [2014, 2014]);
  assert.deepEqual(groups['Juniores'], [2008, 2009]);
  assert.deepEqual(groups['Seniores'], [null, 2007], 'born 2007 and earlier');
  assert.deepEqual(groups['Cadetes C'], [2017, null], 'nine and under');
  assert.deepEqual(groups['Cadetes B'], [2015, 2016]);
  assert.equal(Object.keys(groups).length, 9);
});

test('the ladder leaves no birth year out and none twice', () => {
  const groups = fpnAgeGroups(2027);
  for (let year = 1990; year <= 2025; year += 1) {
    const holding = groups.filter((g) => (g.bornFrom === null || year >= g.bornFrom) && (g.bornTo === null || year <= g.bornTo));
    assert.equal(holding.length, 1, `born ${year}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAthlete, skipReason, type IncomingAthlete, type IncomingResult } from './meet-import.js';

/** POOLSE-81 — what is written, what is skipped, and who an athlete is. */

const swim = (over: Partial<IncomingResult> = {}): IncomingResult => ({
  eventNumber: 1,
  round: 'TIM',
  stroke: 'freestyle',
  distanceM: 100,
  relayCount: 1,
  course: 'lcm',
  rawCourse: 'LCM',
  swumOn: '2026-12-12',
  timeMs: 62340,
  status: '',
  ...over,
});

test('QA 5 — a relay, a DSQ, a DNS, a DNF, a WDR, an NT and yards are each skipped and named', () => {
  assert.equal(skipReason(swim()), null);
  assert.equal(skipReason(swim({ relayCount: 4 })), 'relay');
  assert.equal(skipReason(swim({ status: 'DSQ' })), 'dsq', 'a disqualified time is not a result');
  assert.equal(skipReason(swim({ status: 'DNS', timeMs: null })), 'dns');
  assert.equal(skipReason(swim({ status: 'DNF' })), 'dnf');
  assert.equal(skipReason(swim({ status: 'WDR' })), 'wdr');
  assert.equal(skipReason(swim({ timeMs: null })), 'noTime');
  assert.equal(skipReason(swim({ course: null, rawCourse: 'SCY' })), 'yards');
  assert.equal(skipReason(swim({ stroke: null })), 'stroke');
});

const athlete = (over: Partial<IncomingAthlete> = {}): IncomingAthlete => ({
  key: 'CST:1',
  clubCode: 'CST',
  firstName: 'Inês',
  lastName: 'Sousa',
  birthDate: '2012-04-03',
  licence: null,
  results: [],
  ...over,
});

const students = [
  { id: 'a', firstName: 'Ines', lastName: 'SOUSA', birthDate: '2012-04-03', licence: null },
  { id: 'b', firstName: 'João', lastName: 'Silva', birthDate: '2011-01-01', licence: '204117' },
];

test('QA 2–3 — licence matches; else name and birth date propose; a different birth date is nobody', () => {
  assert.deepEqual(matchAthlete(athlete({ licence: '204117', firstName: 'X' }), students), {
    kind: 'licence',
    studentId: 'b',
  });
  assert.deepEqual(matchAthlete(athlete(), students), { kind: 'proposed', studentId: 'a' }, 'accents and case fold');
  assert.deepEqual(matchAthlete(athlete({ birthDate: '2012-04-04' }), students), { kind: 'none' });
  assert.deepEqual(matchAthlete(athlete({ birthDate: null }), students), { kind: 'none' });
});

test('two students who both fit are nobody, never a guess', () => {
  const twins = [
    { id: 'x', firstName: 'João', lastName: 'Silva', birthDate: '2011-01-01', licence: null },
    { id: 'y', firstName: 'Joao', lastName: 'Silva', birthDate: '2011-01-01', licence: null },
  ];
  assert.deepEqual(
    matchAthlete(athlete({ firstName: 'João', lastName: 'Silva', birthDate: '2011-01-01' }), twins),
    { kind: 'none' },
  );
});

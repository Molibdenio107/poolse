import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOLETIM_FIELDS, boletimValue, parseBoletimPlacement, type BoletimData } from './boletim.js';

/** POOLSE-142 — what a club's own boletim writes on each line. */

const DATA: BoletimData = {
  name: 'Rui Fonseca',
  parentOneName: null,
  parentTwoName: '',
  birthDate: '1990-09-24',
  maritalStatus: 'Solteiro(a)',
  profession: null,
  education: null,
  birthplace: null,
  nationality: 'Portugal',
  addressLine: 'Rua Pedro Álvares Cabral',
  locality: 'Santo Tirso',
  postalCode: '4780-518',
  phone: '967250355',
  email: 'socio@example.pt',
  taxNumber: null,
  idDocumentNumber: '13818775',
  snsNumber: null,
  socioNumber: '412',
  socioSince: '2026-11-01',
  guardian: null,
};

test('a paper form writes a date split into day, month in words and year', () => {
  assert.equal(boletimValue('birth_day', DATA, '2026-11-01'), '24');
  assert.equal(boletimValue('birth_month', DATA, '2026-11-01'), 'setembro');
  assert.equal(boletimValue('birth_year', DATA, '2026-11-01'), '1990');
  assert.equal(boletimValue('birth_date', DATA, '2026-11-01'), '24-09-1990');
  assert.equal(boletimValue('today_day', DATA, '2026-11-01'), '1');
  assert.equal(boletimValue('today_month', DATA, '2026-11-01'), 'novembro');
  assert.equal(boletimValue('today_year_short', DATA, '2026-11-01'), '26', 'after a printed "20"');
  assert.equal(boletimValue('socio_since', DATA, '2026-11-01'), '01-11-2026');
});

test('a blank prints nothing, and an adult has no guardian lines', () => {
  assert.equal(boletimValue('parent_one_name', DATA, '2026-11-01'), null);
  assert.equal(boletimValue('parent_two_name', DATA, '2026-11-01'), null, 'an empty string is a blank');
  assert.equal(boletimValue('guardian_name', DATA, '2026-11-01'), null);
  assert.equal(boletimValue('birth_day', { ...DATA, birthDate: null }, '2026-11-01'), null);
});

test('every field has a value path', () => {
  for (const field of BOLETIM_FIELDS) boletimValue(field, DATA, '2026-11-01');
});

test('a placement must be a known field on the page at a readable size', () => {
  assert.deepEqual(parseBoletimPlacement({ field: 'name', x: 0.123456, y: 0.5 }), { field: 'name', x: 0.1235, y: 0.5, sizePt: 11 });
  assert.equal(parseBoletimPlacement({ field: 'name', x: 1.2, y: 0.5 }), null);
  assert.equal(parseBoletimPlacement({ field: 'curling', x: 0.1, y: 0.5 }), null);
  assert.equal(parseBoletimPlacement({ field: 'name', x: 0.1, y: 0.5, sizePt: 50 }), null);
  assert.equal(parseBoletimPlacement({ field: 'name', x: '0.1', y: 0.5 }), null);
});

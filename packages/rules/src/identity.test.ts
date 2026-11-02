import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIdDocumentType, isValidCcNumber, isValidNiss, normalizeCcNumber, normalizeNiss } from './identity.js';

/** The check digit that makes `first11` a valid CC number — the rule run forwards. */
function withCheck(first11: string): string {
  for (let digit = 0; digit <= 9; digit += 1) {
    if (isValidCcNumber(`${first11}${digit}`)) return `${first11}${digit}`;
  }
  throw new Error('no check digit fits');
}

test('a CC number with the right check digit is valid, however it is spaced or cased', () => {
  const valid = withCheck('123456789ZZ');
  assert.equal(isValidCcNumber(valid), true);
  assert.equal(isValidCcNumber(`${valid.slice(0, 8)} ${valid[8]} ${valid.slice(9, 11).toLowerCase()}${valid[11]}`), true);
  assert.equal(normalizeCcNumber(' 12345678-9 zz1 '), '123456789ZZ1');
});

test('the published sample number checks out: 00000000 0 ZZ4', () => {
  assert.equal(isValidCcNumber('00000000 0 ZZ4'), true);
  assert.equal(isValidCcNumber('00000000 0 ZZ5'), false);
});

test('a wrong check digit, a wrong length or a letter in the wrong place is refused', () => {
  const valid = withCheck('123456789ZZ');
  const wrong = `${valid.slice(0, 11)}${(Number(valid[11]) + 1) % 10}`;
  assert.equal(isValidCcNumber(wrong), false, 'check digit off by one');
  assert.equal(isValidCcNumber(valid.slice(0, 11)), false, 'one character short');
  assert.equal(isValidCcNumber('A23456789ZZ1'), false, 'a letter in the civil number');
  assert.equal(isValidCcNumber(''), false);
});

test('exactly one check digit fits each number', () => {
  const fits = [...Array(10).keys()].filter((digit) => isValidCcNumber(`000000000ZZ${digit}`));
  assert.equal(fits.length, 1);
});

test('the document types are the four the schema allows', () => {
  for (const type of ['cc', 'passport', 'residence_permit', 'other']) assert.equal(isIdDocumentType(type), true);
  assert.equal(isIdDocumentType('nif'), false);
});

test('a NISS passes its check digit and nothing else does', () => {
  assert.equal(isValidNiss('12345678902'), true);
  assert.equal(isValidNiss('123 456 789 02'), true, 'spaces as printed');
  assert.equal(isValidNiss('20999999998'), true, 'an employer');
  assert.equal(isValidNiss('12345678903'), false, 'check digit off by one');
  assert.equal(isValidNiss('32345678902'), false, 'must start 1 or 2');
  assert.equal(isValidNiss('1234567890'), false, 'ten digits');
  assert.equal(isValidNiss(''), false);
  assert.equal(normalizeNiss('123.456.789-02'), '12345678902');
});

test('exactly one check digit fits each NISS', () => {
  const fits = [...Array(10).keys()].filter((digit) => isValidNiss(`1000000000${digit}`));
  assert.equal(fits.length, 1);
});

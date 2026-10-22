import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIban,
  formatMbwayPhone,
  ibanChecksumOk,
  normalizeIban,
  normalizeMbwayPhone,
} from './payment.js';

/** POOLSE-94 — what a club types under *Como pagar*. */

const VALID = 'PT50000201231234567890154';

test('an IBAN is read with spaces and in any case, and stored compact', () => {
  assert.equal(normalizeIban('PT50 0002 0123 1234 5678 9015 4'), VALID);
  assert.equal(normalizeIban('pt50000201231234567890154'), VALID);
  // Not a Portuguese IBAN at all: another country, a digit short, letters inside.
  assert.equal(normalizeIban('ES9121000418450200051332'), null);
  assert.equal(normalizeIban('PT5000020123123456789015'), null);
  assert.equal(normalizeIban('PT50 0002 0123 1234 5678 901A 4'), null);
  assert.equal(normalizeIban(''), null);
});

test('the checksum catches one wrong digit and two swapped', () => {
  assert.equal(ibanChecksumOk(VALID), true);
  assert.equal(ibanChecksumOk('PT50000201231234567890155'), false, 'last digit off by one');
  assert.equal(ibanChecksumOk('PT50000201231234567809154'), false, 'two digits swapped');
});

test('an IBAN is shown in groups of four', () => {
  assert.equal(formatIban(VALID), 'PT50 0002 0123 1234 5678 9015 4');
});

test('an MB WAY number is a Portuguese mobile, however it was typed', () => {
  for (const typed of ['912345678', '912 345 678', '+351912345678', '+351 912 345 678', '00351912345678']) {
    assert.equal(normalizeMbwayPhone(typed), '+351912345678', typed);
  }
  // A landline, a foreign number and a short one are not MB WAY numbers.
  assert.equal(normalizeMbwayPhone('213456789'), null);
  assert.equal(normalizeMbwayPhone('+34612345678'), null);
  assert.equal(normalizeMbwayPhone('91234567'), null);
  assert.equal(formatMbwayPhone('+351912345678'), '+351 912 345 678');
});

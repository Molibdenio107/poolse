import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centsToInput, formatCents, monthlyEquivalentCents, parseCents } from './money.ts';

/**
 * Money on screen — POOLSE-42, QA 42.12.
 *
 * The formatting test is the one that earns its place. pt-PT and en disagree
 * about the separator, the symbol and which side the symbol goes on, and the
 * only way to get all three right is to let the locale decide. A test that
 * asserted "starts with €" would pass in English and be wrong in Portuguese,
 * which is exactly the bug the convention forbids.
 *
 * Run: pnpm web:test
 */

test('an amount is written the way its locale writes it', () => {
  // The exact strings QA 42.12 names. Note the pt-PT space before the symbol is
  // a narrow no-break space, not an ordinary one — Intl's, not ours.
  assert.equal(formatCents('pt-PT', 3500).replace(/ | /g, ' '), '35,00 €');
  assert.equal(formatCents('pt-PT', 9975).replace(/ | /g, ' '), '99,75 €');

  assert.equal(formatCents('en', 3500), '€35.00');
  assert.equal(formatCents('en', 9975), '€99.75');
});

test('zero and a whole number of euros still carry both decimals', () => {
  assert.equal(formatCents('en', 0), '€0.00');
  assert.equal(formatCents('en', 4000), '€40.00');
});

test('the monthly equivalent comes from the total, so it includes the discount', () => {
  // 99,75 over three months is 33,25 — which is *less* than the 35,00 plan
  // amount, and that difference is the entire reason to offer the periodicity.
  assert.equal(monthlyEquivalentCents(9975, 3), 3325);
  assert.equal(monthlyEquivalentCents(3500, 1), 3500);

  // Not rounded to a cent: it is a comparison, not a price anybody is charged.
  assert.equal(monthlyEquivalentCents(10000, 3), 10000 / 3);

  // A nonsense period does not divide by zero.
  assert.equal(monthlyEquivalentCents(3500, 0), 3500);
});

test('a typed amount is read with either separator', () => {
  assert.equal(parseCents('35'), 3500);
  assert.equal(parseCents('35,50'), 3550);
  assert.equal(parseCents('35.50'), 3550);
  assert.equal(parseCents('  35,5 '), 3550);
  assert.equal(parseCents('0'), 0);

  // The binary-floating-point case: 35.35 * 100 is 3534.9999999999995.
  assert.equal(parseCents('35,35'), 3535);
});

test('what is not an amount is refused rather than becoming NaN', () => {
  assert.equal(parseCents(''), null);
  assert.equal(parseCents('trinta e cinco'), null);
  assert.equal(parseCents('35,555'), null, 'three decimals is not a price');
  assert.equal(parseCents('-35'), null);
  assert.equal(parseCents('35 €'), null);
});

test('an input box round-trips', () => {
  assert.equal(centsToInput(3500), '35.00');
  assert.equal(parseCents(centsToInput(9975)), 9975);
});

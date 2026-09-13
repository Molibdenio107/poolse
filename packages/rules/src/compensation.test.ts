import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  annualisedMonthlyCents,
  hourlyCents,
  hourlyForRow,
  monthlyForRow,
  isMoneyProvenance,
  rollup,
  thisMonthCents,
  weakestProvenance,
  type Compensation,
} from './compensation.js';

const monthly = (amountCents: number, weeklyHours: number | null, periods = 14): Compensation => ({
  kind: 'monthly',
  amountCents,
  weeklyHours,
  payPeriodsPerYear: periods,
});

const hourly = (amountCents: number, weeklyHours: number | null): Compensation => ({
  kind: 'hourly',
  amountCents,
  weeklyHours,
  payPeriodsPerYear: 14,
});

test('a 14-period salary costs more per month than it pays', () => {
  const c = monthly(100_000, 40);
  assert.equal(thisMonthCents(c), 100_000);
  assert.equal(annualisedMonthlyCents(c), 116_667);
});

test('a 12-period salary pays what it costs', () => {
  const c = monthly(100_000, 40, 12);
  assert.equal(thisMonthCents(c), 100_000);
  assert.equal(annualisedMonthlyCents(c), 100_000);
});

test('the hourly rate implied by a salary follows the periods', () => {
  // 40h × 52 ÷ 12 = 173.33 h/month. €1,166.67 ÷ 173.33 = €6.73/h.
  assert.equal(hourlyCents(monthly(100_000, 40)), 673);
  assert.equal(hourlyCents(monthly(100_000, 40, 12)), 577);
});

test('an hourly contract states its own rate and derives its month', () => {
  const c = hourly(715, 20);
  assert.equal(hourlyCents(c), 715);
  // 20 × 52 ÷ 12 = 86.67 h. × €7.15 = €619.67.
  assert.equal(thisMonthCents(c), 61_967);
  // Subsídios are not implied by an hourly contract: the two figures agree.
  assert.equal(annualisedMonthlyCents(c), 61_967);
});

test('unknown hours produce null, never zero', () => {
  const c = hourly(715, null);
  assert.equal(thisMonthCents(c), null);
  assert.equal(annualisedMonthlyCents(c), null);
  assert.equal(hourlyCents(monthly(100_000, null)), null);
  // A monthly contract still knows its own monthly figures.
  assert.equal(thisMonthCents(monthly(100_000, null)), 100_000);
});

test('zero or negative hours are treated as not measured, not as a divisor', () => {
  assert.equal(thisMonthCents(hourly(715, 0)), null);
  assert.equal(hourlyCents(monthly(100_000, 0)), null);
});

test('a row says which of its two figures was derived', () => {
  assert.deepEqual(monthlyForRow(monthly(100_000, 40)), { cents: 100_000, derived: false });
  assert.deepEqual(hourlyForRow(monthly(100_000, 40)), { cents: 673, derived: true });
  assert.deepEqual(monthlyForRow(hourly(715, 20)), { cents: 61_967, derived: true });
  assert.deepEqual(hourlyForRow(hourly(715, 20)), { cents: 715, derived: false });
});

test('the roll-up carries two figures and the split', () => {
  const r = rollup([monthly(100_000, 40), monthly(120_000, 40, 12), hourly(715, 20)], 2);

  assert.equal(r.thisMonthCents, 100_000 + 120_000 + 61_967);
  assert.equal(r.annualisedMonthlyCents, 116_667 + 120_000 + 61_967);
  assert.equal(r.monthlyContractCents, 220_000);
  assert.equal(r.hourlyContractCents, 61_967);
  assert.equal(r.monthlyContractCount, 2);
  assert.equal(r.hourlyContractCount, 1);
  assert.equal(r.hoursUnknownCount, 0);
  assert.equal(r.noRateCount, 2);
});

test('a contract with unknown hours is counted, never summed at zero', () => {
  const r = rollup([monthly(100_000, 40), hourly(715, null)], 0);

  assert.equal(r.thisMonthCents, 100_000);
  assert.equal(r.annualisedMonthlyCents, 116_667);
  assert.equal(r.hourlyContractCount, 1);
  assert.equal(r.hourlyContractCents, 0);
  assert.equal(r.hoursUnknownCount, 1);
});

test('an empty club rolls up to zero rather than to NaN', () => {
  const r = rollup([], 7);
  assert.equal(r.thisMonthCents, 0);
  assert.equal(r.annualisedMonthlyCents, 0);
  assert.equal(r.noRateCount, 7);
});

test('the roll-up reports coverage rather than treating nothing as zero', () => {
  // docs/financials.md §6: an unqualified total over partial data is worse than
  // showing nothing, because it is the same shape as a complete answer.
  const r = rollup([monthly(100_000, 40), hourly(715, 20)], 3);

  assert.deepEqual(r.coverage, { withRate: 2, total: 5 });
  assert.equal(r.complete, false);
  assert.equal(rollup([monthly(100_000, 40)], 0).complete, true);
});

test('a total is labelled with the weakest provenance it summed', () => {
  // §2: never one unlabelled figure across provenances.
  assert.equal(rollup([monthly(100_000, 40)], 0).provenance, 'contracted');

  const mixed = rollup(
    [monthly(100_000, 40), { ...monthly(80_000, 40), provenance: 'assumed' }],
    0,
  );
  assert.equal(mixed.provenance, 'assumed');
  assert.deepEqual(mixed.byProvenance, {
    actual: 0,
    contracted: 100_000,
    estimated: 0,
    assumed: 80_000,
  });

  // An empty club doubts nothing, and says so rather than claiming a guess.
  assert.equal(rollup([], 4).provenance, 'actual');
});

test('a contract whose hours are unknown is in no provenance bucket', () => {
  // It contributes to no total, so putting it in a bucket would make the split
  // disagree with the figure it is splitting.
  const r = rollup([{ ...hourly(715, null), provenance: 'assumed' }], 0);

  assert.equal(r.thisMonthCents, 0);
  assert.equal(r.byProvenance.assumed, 0);
  assert.equal(r.hoursUnknownCount, 1);
  // The label still says what it *would* have summed: the club has a guess on
  // its books, and the reader should know before trusting the zero.
  assert.equal(r.provenance, 'assumed');
});

test('the weakest of a set is found by strength, not by order', () => {
  assert.equal(weakestProvenance(['assumed', 'actual']), 'assumed');
  assert.equal(weakestProvenance(['actual', 'contracted']), 'contracted');
  assert.equal(weakestProvenance(['estimated', 'assumed', 'contracted']), 'assumed');
  assert.equal(weakestProvenance([]), 'actual');
  assert.equal(isMoneyProvenance('assumed'), true);
  assert.equal(isMoneyProvenance('guessed'), false);
});

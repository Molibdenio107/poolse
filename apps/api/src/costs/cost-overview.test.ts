import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareWindows,
  estimatedMonths,
  groupOf,
  monthsInWindow,
  monthsOf,
  partOfMonth,
  windowTable,
  windowTotals,
} from './cost-overview.js';
import type { CostBasis, CostKind, LedgerMonth } from './costs.repository.js';

function row(month: string, kind: CostKind, basis: CostBasis, netCents: number, vatCents = 0): LedgerMonth {
  return { month, kind, basis, facilityId: null, netCents, vatCents };
}

test('183 — a ninth kind folds into Fixos e outros', () => {
  assert.equal(groupOf('other'), 'fixed');
  assert.equal(groupOf('fixed'), 'fixed');
  assert.equal(groupOf('salary'), 'salary');
});

test('183 — months cross a year, and a cut month counts by its days', () => {
  assert.deepEqual(monthsOf('2025-11-20', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(partOfMonth('2026-09', '2026-09-16', '2027-07-31'), 0.5);
  assert.equal(partOfMonth('2026-08', '2026-09-16', '2027-07-31'), 0);
  assert.equal(monthsInWindow('2026-01-01', '2026-12-31'), 12);
});

test('183 — a table cut by an época sums to its tiles to the cent (QA 7)', () => {
  // 100,00 € a month over a third of three months at a time: thirds that round.
  const rows = [row('2026-09', 'gas', 'invoice', 3333), row('2026-10', 'gas', 'invoice', 3333), row('2026-11', 'gas', 'invoice', 3334)];
  const table = windowTable(rows, '2026-09-16', '2026-11-30', false);
  const cells = table.map((month) => month.groups.gas!.invoicedCents);
  assert.deepEqual(cells, [1667, 3333, 3334]);
  const [total] = windowTotals(table);
  assert.equal(total!.invoicedCents, cells.reduce((a, b) => a + b, 0));
  assert.equal(table[0]!.partial, true);
  assert.equal(table[1]!.partial, false);
});

test('183 — com IVA adds the VAT, sem IVA leaves it out', () => {
  const rows = [row('2026-03', 'electricity', 'invoice', 10_000, 2_300)];
  assert.equal(windowTotals(windowTable(rows, '2026-03-01', '2026-03-31', false))[0]!.invoicedCents, 10_000);
  assert.equal(windowTotals(windowTable(rows, '2026-03-01', '2026-03-31', true))[0]!.invoicedCents, 12_300);
});

test('183 — invoices and estimates stay apart, and pay alone does not read as an estimated month', () => {
  const rows = [
    row('2026-01', 'salary', 'estimate', 100_000),
    row('2026-02', 'salary', 'estimate', 100_000),
    row('2026-03', 'salary', 'estimate', 100_000),
    row('2026-03', 'gas', 'estimate', 5_000),
    row('2026-03', 'gas', 'invoice', 7_000),
  ];
  const table = windowTable(rows, '2026-01-01', '2026-03-31', false);
  assert.equal(estimatedMonths(table), 1);
  const gas = windowTotals(table).find((total) => total.group === 'gas')!;
  assert.deepEqual([gas.invoicedCents, gas.estimatedCents], [7_000, 5_000]);
});

const yearOf = (year: number, cents: number, months = 12): LedgerMonth[] =>
  Array.from({ length: months }, (_, index) => row(`${year}-${String(index + 1).padStart(2, '0')}`, 'gas', 'invoice', cents));

test('183 — a comparison covers only months with both sides, and never a running month', () => {
  const rows = [...yearOf(2025, 100), ...yearOf(2026, 150, 11)];
  const result = compareWindows(
    rows,
    { from: '2026-01-01', to: '2026-11-06' },
    { from: '2025-01-01', to: '2025-12-31' },
    '2026-11-06',
    false,
  );
  assert.ok(result.groups !== null);
  // November is running, December has not happened: ten months, both sides.
  assert.equal(result.months, 10);
  assert.equal(result.currentCents, 1_500);
  assert.equal(result.previousCents, 1_000);
});

test('183 — fewer than six months compared is no comparison, and says how many', () => {
  const rows = [...yearOf(2025, 100, 5), ...yearOf(2026, 150)];
  const result = compareWindows(
    rows,
    { from: '2026-01-01', to: '2026-12-31' },
    { from: '2025-01-01', to: '2025-12-31' },
    '2027-02-01',
    false,
  );
  assert.equal(result.groups, null);
  assert.equal(result.months, 5);
});

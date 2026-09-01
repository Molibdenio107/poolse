import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInventoryRows,
  type InventoryImportContext,
  type RawInventoryRow,
} from './inventory.js';

/**
 * What an imported kit list means — round 6.
 *
 * The module is pure, so these are the rules themselves rather than a database
 * round trip. Every case here is something a club's real spreadsheet does: a
 * count written "24 un", a blank count column, a tank named in words that do not
 * match any tank, and the same pile of pranchas listed on three rows because the
 * file was pasted together from a tab per pool.
 */

const POOLS = [
  { id: 'pool-grande', name: 'Tanque Grande' },
  { id: 'pool-aprendizagem', name: 'Tanque de Aprendizagem' },
];

function contextWith(existing: InventoryImportContext['existing'] = []): InventoryImportContext {
  return { pools: POOLS, existing };
}

function run(rows: RawInventoryRow[], existing?: InventoryImportContext['existing']) {
  return validateInventoryRows(rows, contextWith(existing));
}

test('a name and a count is enough, and the line number is the spreadsheet line', () => {
  const { rows, summary } = run([{ name: 'Flutuadores', quantity: '24' }]);

  assert.equal(rows[0]?.name, 'Flutuadores');
  assert.equal(rows[0]?.quantity, 24);
  // The header is line 1, so the first data row is line 2 — the number down the
  // side of the operator's own file.
  assert.equal(rows[0]?.line, 2);
  assert.equal(rows[0]?.importable, true);
  assert.equal(summary.toCreate, 1);
});

test('a row with no name is refused, and nothing else about it matters', () => {
  const { rows, summary } = run([{ quantity: '24', notes: 'no armário' }]);

  assert.equal(rows[0]?.importable, false);
  assert.deepEqual(
    rows[0]?.problems.map((problem) => problem.code),
    ['nameRequired'],
  );
  assert.equal(summary.refused, 1);
});

test('the count is read the way a spreadsheet writes one', () => {
  const { rows } = run([
    { name: 'A', quantity: '24 un' },
    { name: 'B', quantity: ' 18 ' },
    { name: 'C', quantity: '1,0' },
    // Half a prancha is not a thing anybody owns; the whole part is taken and
    // the operator sees the number that will be written.
    { name: 'D', quantity: '2.7' },
  ]);

  assert.deepEqual(
    rows.map((row) => row.quantity),
    [24, 18, 1, 2],
  );
});

test('a blank count is zero and says so; a count that is not a number is refused', () => {
  const { rows } = run([{ name: 'Arcos' }, { name: 'Halteres', quantity: 'muitos' }]);

  assert.equal(rows[0]?.quantity, 0);
  assert.equal(rows[0]?.importable, true);
  assert.deepEqual(
    rows[0]?.warnings.map((warning) => warning.code),
    ['quantityMissing'],
  );

  assert.equal(rows[1]?.importable, false);
  assert.deepEqual(
    rows[1]?.problems.map((problem) => problem.code),
    ['badQuantity'],
  );
});

test('a blank pools column means the building, which is the commonest answer', () => {
  const { rows } = run([{ name: 'Desfibrilhador', quantity: '1' }]);

  assert.equal(rows[0]?.scope, 'facility');
  assert.deepEqual(rows[0]?.poolIds, []);
});

test('tanks are matched by name, ignoring case and accents, however the cell splits', () => {
  const { rows } = run([
    { name: 'Cordas', quantity: '4', pools: 'tanque grande; Tanque de Aprendizagem' },
  ]);

  assert.equal(rows[0]?.scope, 'pools');
  assert.deepEqual(rows[0]?.poolIds, ['pool-grande', 'pool-aprendizagem']);
});

test('a word meaning "all" is a scope, not a tank named "all"', () => {
  for (const cell of ['todas', 'Todas as piscinas', 'ALL']) {
    const { rows } = run([{ name: 'Pranchas', quantity: '30', pools: cell }]);
    assert.equal(rows[0]?.scope, 'all_pools', `"${cell}" should mean every tank`);
    assert.deepEqual(rows[0]?.poolIds, []);
  }
});

test('a tank the site does not have is named, never silently dropped', () => {
  const { rows } = run([
    { name: 'Boias', quantity: '10', pools: 'Tanque Grande, Piscina Olímpica' },
  ]);

  // The item still lands with the tank that did match — but the one that did not
  // is reported, because an inventory quietly covering the wrong water is worse
  // than a gap somebody can see.
  assert.equal(rows[0]?.scope, 'pools');
  assert.deepEqual(rows[0]?.poolIds, ['pool-grande']);
  assert.deepEqual(
    rows[0]?.warnings.map((warning) => warning.code),
    ['poolNotFound'],
  );
});

test('a pools cell that matches nothing falls back to the building, loudly', () => {
  const { rows } = run([{ name: 'Boias', quantity: '10', pools: 'Piscina Olímpica' }]);

  assert.equal(rows[0]?.scope, 'facility');
  assert.deepEqual(
    rows[0]?.warnings.map((warning) => warning.code),
    ['poolNotFound', 'noPoolsMatched'],
  );
});

test('the same pile listed twice in one file points at the earlier line', () => {
  const { rows, summary } = run([
    { name: 'Pranchas', quantity: '10' },
    { name: 'pranchás', quantity: '14' },
  ]);

  assert.equal(rows[1]?.duplicate?.kind, 'file');
  assert.equal(rows[1]?.duplicate?.line, 2);
  // Still importable: the tick is what decides, and the commit skips a file
  // duplicate because the earlier row is the one that acts.
  assert.equal(rows[1]?.importable, true);
  assert.equal(summary.duplicates, 1);
});

test('a stocktake shows the count it would replace', () => {
  const { rows, summary } = run(
    [{ name: 'Pranchas', quantity: '24', unit: 'un' }],
    [
      {
        id: 'item-1',
        name: 'Pranchas',
        quantity: 18,
        unit: null,
        notes: 'Armário 2',
        scope: 'facility',
        poolIds: [],
      },
    ],
  );

  assert.equal(rows[0]?.duplicate?.kind, 'store');
  assert.equal(rows[0]?.duplicate?.itemId, 'item-1');
  assert.deepEqual(rows[0]?.updates, [
    { field: 'quantity', before: '18', after: '24' },
    { field: 'unit', before: '', after: 'un' },
  ]);
  assert.equal(summary.toUpdate, 1);
  assert.equal(summary.toCreate, 0);
});

test('a blank cell never overwrites something already recorded', () => {
  /*
   * Re-importing last year's list with no notes column has to be harmless — it
   * is the commonest thing a club will really do with this feature — so a field
   * the file does not carry produces no update at all.
   */
  const { rows } = run(
    [{ name: 'Pranchas', quantity: '18' }],
    [
      {
        id: 'item-1',
        name: 'Pranchas',
        quantity: 18,
        unit: 'un',
        notes: 'Armário 2',
        scope: 'all_pools',
        poolIds: [],
      },
    ],
  );

  assert.deepEqual(rows[0]?.updates, []);
  assert.equal(rows[0]?.duplicate?.kind, 'store');
});

test('an unmapped pools column leaves the scope alone on a row that already exists', () => {
  // The row resolves to `facility` because the sheet said nothing — and saying
  // nothing must not move an item off the two tanks it serves.
  const { rows } = run(
    [{ name: 'Cordas', quantity: '4' }],
    [
      {
        id: 'item-1',
        name: 'Cordas',
        quantity: 4,
        unit: null,
        notes: null,
        scope: 'pools',
        poolIds: ['pool-grande'],
      },
    ],
  );

  assert.deepEqual(rows[0]?.updates, []);
});

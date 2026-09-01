import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyInventoryMapping,
  hasItemName,
  matchInventoryColumns,
  EMPTY_INVENTORY_MAPPING,
  INVENTORY_EXPORT_FIELDS,
} from './inventory-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * Round 6 — reading a club's kit list.
 *
 * Every case here came from what a swimming club's inventory file actually
 * looks like rather than from what a spreadsheet specification says: a column
 * headed "Material", a count under "Qtd", and a "Piscina" column naming tanks in
 * whatever words the person who typed it used.
 *
 * The last of the tests is the one that matters most. The export's header row is
 * `inventory.field.*` out of the catalogue — the same labels the mapping step
 * puts above its dropdowns — so a club can export the list, walk the store room
 * correcting counts in Excel, and import the result without touching a column.
 * That claim is the whole reason the export was rebuilt, and this is what keeps
 * it true when somebody rewords a label months from now.
 */

test('a Portuguese kit list maps itself', () => {
  const sheet = parseCsv(
    ['Material;Qtd;Unidade;Piscina;Observações', 'Flutuadores;24;;Tanque Grande;Armário 2'].join(
      '\n',
    ),
  );

  const { mapping } = matchInventoryColumns(sheet);

  assert.equal(mapping.name, 0);
  assert.equal(mapping.quantity, 1);
  assert.equal(mapping.unit, 2);
  assert.equal(mapping.pools, 3);
  assert.equal(mapping.notes, 4);
});

test('an abbreviated count column is still found', () => {
  // "Qt", "Qtde", "N." — a club's own shorthand, which is what the abbreviation
  // rule in `sheet.ts` exists for.
  for (const header of ['Qt', 'Qtde', 'Quantidade']) {
    const sheet = parseCsv([`Artigo;${header}`, 'Pranchas;18'].join('\n'));
    const { mapping } = matchInventoryColumns(sheet);
    assert.equal(mapping.quantity, 1, `"${header}" should be the count column`);
  }
});

test('the plural is a count and the singular is a measure', () => {
  /*
   * The one genuine ambiguity in this vocabulary. "Unidades" over numbers is how
   * a great many club sheets write the quantity; "Unidade" over words is pares
   * and caixas. Getting it backwards imports a whole store room with every count
   * at zero, and nothing on the preview would look wrong — so it is pinned here.
   */
  const plural = matchInventoryColumns(
    parseCsv(['Material;Unidades', 'Esparguetes;40'].join('\n')),
  ).mapping;
  assert.equal(plural.quantity, 1);
  assert.equal(plural.unit, null);

  const singular = matchInventoryColumns(
    parseCsv(['Material;Qtd;Unidade', 'Cordas;3;metros'].join('\n')),
  ).mapping;
  assert.equal(singular.quantity, 1);
  assert.equal(singular.unit, 2);
});

test('a column holding words is not accepted as the count', () => {
  /*
   * A sheet whose headers have shifted by one: "Qtd" over a column of item
   * names. The shape check drops the match into the band the screen asks about
   * rather than silently importing every count as zero.
   */
  const sheet = parseCsv(
    ['Qtd;Material', 'Pranchas azuis;18', 'Flutuadores;24', 'Halteres;12'].join('\n'),
  );

  const { mapping, matches } = matchInventoryColumns(sheet);
  const guess = matches.find((match) => match.field === 'quantity');

  assert.ok(
    mapping.quantity !== 0 || guess?.confidence === 'unsure',
    'a "Qtd" column full of words should not be a confident count',
  );
});

test('a mapped row carries only what was mapped and only what was filled in', () => {
  const mapping = { ...EMPTY_INVENTORY_MAPPING, name: 0, quantity: 1, pools: 2 };

  assert.deepEqual(applyInventoryMapping(['Pranchas', '18', ''], mapping), {
    name: 'Pranchas',
    quantity: '18',
  });
});

test('a mapping with no item column is not enough to import anything', () => {
  assert.equal(hasItemName(EMPTY_INVENTORY_MAPPING), false);
  assert.equal(hasItemName({ ...EMPTY_INVENTORY_MAPPING, name: 0 }), true);
});

/**
 * What the exporter writes, the importer reads.
 *
 * Reads the real catalogues rather than a fixture, deliberately. The failure
 * being guarded against is somebody rewording a label months from now —
 * "Artigo" becoming "Nome do artigo", say — which breaks the round trip
 * silently and nowhere near this file. A fixture would keep passing while the
 * product broke.
 */
function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as never;
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} inventory maps itself when it comes back`, () => {
    const field = catalogue(locale)['inventory']?.['field'] as unknown as Record<string, string>;

    const headers = INVENTORY_EXPORT_FIELDS.map((name) => {
      const label = field[name];
      assert.ok(label !== undefined, `inventory.field.${name} is missing from ${locale}`);
      return label;
    });

    const { mapping } = matchInventoryColumns({ headers, rows: [] });

    INVENTORY_EXPORT_FIELDS.forEach((name, column) => {
      assert.equal(
        mapping[name],
        column,
        `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`,
      );
    });
  });
}

test('every exported column is one the importer knows about', () => {
  // Belt and braces on the contract: a field added to the export that the
  // import has never heard of would be dropped by the API without a word.
  for (const name of INVENTORY_EXPORT_FIELDS) {
    assert.ok(name in EMPTY_INVENTORY_MAPPING, `${name} is not an import field`);
  }
});

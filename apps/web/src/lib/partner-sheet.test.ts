import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyPartnerMapping,
  EMPTY_PARTNER_MAPPING,
  hasPartnerAndGroup,
  matchPartnerColumns,
  PARTNER_EXPORT_FIELDS,
  PARTNER_FIELDS,
  type PartnerField,
} from './partner-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * The partnerships round trip — POOLSE-48, criterion 10.
 *
 * A club exports its partner list in August, corrects the headcounts the schools
 * sent late, and imports the file back. That only works if the header row the
 * export writes is a header row `matchPartnerColumns` recognises, which is why
 * the labels are `partners.field.*` from the catalogue and not prose invented
 * for the file.
 *
 * **The catalogues are read from disk, deliberately.** The failure being guarded
 * against is somebody rewording a label a year from now — "Grupo" becoming "Nome
 * do grupo", say — which breaks the round trip silently and nowhere near this
 * file. A fixture would go on passing while the product broke, which is exactly
 * what `sheet.test.ts` says about the register's own version of this.
 *
 * Run: pnpm web:test
 */
function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as never;
}

function headersFor(locale: string): string[] {
  const field = catalogue(locale)['partners']?.['field'] as unknown as Record<string, string>;

  return PARTNER_EXPORT_FIELDS.map((name) => {
    const label = field[name];
    assert.ok(label !== undefined, `partners.field.${name} is missing from ${locale}`);
    return label;
  });
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} partner list maps itself when it comes back`, () => {
    const headers = headersFor(locale);

    /*
     * Through a real sheet, not the header array alone. The matcher weighs a
     * column's *values* as well as its heading — that is how it tells a
     * headcount from any other number, and how an address column claims
     * `contactEmail` whatever it is called — so a test that skipped the rows
     * would be testing half the mechanism.
     *
     * Two schools and three groups, with the school's name repeating: the shape
     * the export actually writes.
     */
    const sheet = parseCsv(
      [
        headers.join(';'),
        'ES D. Dinis;escola;6A;24;;Desporto escolar;Prof. Silva;Ana Matos;ana@esdinis.pt;253 000 111;Entra pela rampa',
        'ES D. Dinis;escola;6B;22;;Desporto escolar;Prof. Silva;Ana Matos;ana@esdinis.pt;253 000 111;',
        'JI O Barquinho;jardim_infancia;Sala Azul;18;Adaptação;;Educadora Rita;Rita Nunes;rita@barquinho.pt;253 000 222;',
      ].join('\n'),
    );

    const { mapping } = matchPartnerColumns(sheet);

    PARTNER_EXPORT_FIELDS.forEach((name, column) => {
      assert.equal(
        mapping[name],
        column,
        `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`,
      );
    });
  });

  test(`the exported ${locale} header row is enough to import at all`, () => {
    // Criterion 7's other half: partner and group are the two required fields,
    // and a round trip that mapped every column but one of those would still be
    // an import nobody can run.
    const sheet = parseCsv(
      [headersFor(locale).join(';'), 'ES D. Dinis;escola;6A;24;;;;;;;'].join('\n'),
    );

    assert.equal(hasPartnerAndGroup(matchPartnerColumns(sheet).mapping), true);
  });
}

test('every exported column is one the vocabulary knows about', () => {
  // Belt and braces on the contract: a field added to the export that the
  // mapping has never heard of would be a column nothing could ever claim.
  for (const name of PARTNER_EXPORT_FIELDS) {
    assert.ok(
      (PARTNER_FIELDS as readonly string[]).includes(name),
      `${name} is exported but is not a partner field`,
    );
  }

  // And the other direction, which is the one that rots: a field added to the
  // importer and forgotten in the export writes a file that cannot round-trip
  // that column, silently.
  for (const name of PARTNER_FIELDS) {
    assert.ok(
      PARTNER_EXPORT_FIELDS.includes(name),
      `${name} is a partner field but is never exported`,
    );
  }
});

test('the two name columns are not read as each other', () => {
  /*
   * The one mistake this vocabulary exists to prevent — and the reason
   * `contactName` is labelled "Contacto" rather than the partner screens' own
   * "Nome". A sheet with a bare "Nome" beside a headcount is a list of *whose*
   * classes these are, so `partnerName` claims it; if the contact's label were
   * "Nome" too, the export would hand the entity's column to the contact.
   */
  const sheet = parseCsv(
    ['Nome;Turma;Alunos', 'ES D. Dinis;6A;24', 'ES D. Dinis;6B;22'].join('\n'),
  );

  const { mapping } = matchPartnerColumns(sheet);
  assert.equal(mapping.partnerName, 0);
  assert.equal(mapping.groupName, 1);
  assert.equal(mapping.participantCount, 2);
  assert.equal(mapping.contactName, null);
});

test('a mapped row carries only the columns that were mapped', () => {
  const mapping = { ...EMPTY_PARTNER_MAPPING, partnerName: 0, groupName: 1 };
  const mapped = applyPartnerMapping(['ES D. Dinis', '6A', '24'], mapping);

  assert.deepEqual(mapped, { partnerName: 'ES D. Dinis', groupName: '6A' });
});

test('a blank cell is absent rather than empty', () => {
  // The API reads a missing field as "the file did not say" and an empty string
  // as a value. Sending `''` for an unfilled Notas column would clear a note the
  // club already had.
  const mapping = { ...EMPTY_PARTNER_MAPPING, partnerName: 0, groupName: 1, notes: 2 };
  const mapped = applyPartnerMapping(['ES D. Dinis', '6A', '   '], mapping);

  assert.equal('notes' in mapped, false);
});

test('a field with no column is simply not sent', () => {
  const fields: PartnerField[] = ['partnerName', 'groupName'];
  const mapped = applyPartnerMapping(['ES D. Dinis', '6A'], {
    ...EMPTY_PARTNER_MAPPING,
    partnerName: 0,
    groupName: 1,
  });

  assert.deepEqual(Object.keys(mapped).sort(), [...fields].sort());
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySalaryMapping,
  EMPTY_SALARY_MAPPING,
  hasKeyAndAmount,
  matchSalaryColumns,
  SALARY_EXPORT_FIELDS,
  SALARY_FIELDS,
} from './salary-sheet.ts';
import { parseCsv } from './sheet.ts';

/**
 * The salaries round trip — POOLSE-59.
 *
 * A club exports the pay list in December, applies the year's rise in the column
 * it already has, and imports the file back. That only works if the header row
 * the export writes is a header row `matchSalaryColumns` recognises, which is
 * why the labels are `salaries.field.*` from the catalogue and not prose
 * invented for the file.
 *
 * **The catalogues are read from disk, deliberately.** The failure guarded
 * against is somebody rewording a label a year from now — "Valor bruto" becoming
 * "Vencimento mensal", say — which breaks the round trip silently and nowhere
 * near this file. A fixture would go on passing while the product broke.
 *
 * Run: pnpm web:test
 */
function catalogue(locale: string): Record<string, Record<string, Record<string, string>>> {
  const path = new URL(`../messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as never;
}

function headersFor(locale: string): string[] {
  const field = catalogue(locale)['salaries']?.['field'] as unknown as Record<string, string>;

  return SALARY_EXPORT_FIELDS.map((name) => {
    const label = field[name];
    assert.ok(label !== undefined, `salaries.field.${name} is missing from ${locale}`);
    return label;
  });
}

for (const locale of ['pt-PT', 'en']) {
  test(`an exported ${locale} pay list maps itself when it comes back`, () => {
    const headers = headersFor(locale);

    /*
     * Through a real sheet, not the header array alone. The matcher weighs a
     * column's *values* as well as its heading — that is how it tells an amount
     * from a count of hours when the headings are unhelpful, and how an address
     * column claims `email` whatever it is called — so a test that skipped the
     * rows would be testing half the mechanism.
     *
     * The shape the export actually writes: the type as its enum spelling, the
     * date as ISO, the amount as a plain decimal, and one row with no hours at
     * all because that is an ordinary contract.
     */
    const sheet = parseCsv(
      [
        headers.join(';'),
        'Ana Ferreira;ana@clube.pt;123456789;monthly;1200.00;40;14;2026-09-01;',
        'Bruno Lopes;bruno@clube.pt;;hourly;7.15;12;14;2026-09-01;Part-time',
        'Rita Nunes;rita@clube.pt;;hourly;8.00;;14;2026-01-15;',
      ].join('\n'),
    );

    const { mapping } = matchSalaryColumns(sheet);

    SALARY_EXPORT_FIELDS.forEach((name, column) => {
      assert.equal(
        mapping[name],
        column,
        `"${headers[column]}" should map to ${name}, not ${String(mapping[name])}`,
      );
    });
  });

  test(`the exported ${locale} header row is enough to import at all`, () => {
    const sheet = parseCsv(
      [headersFor(locale).join(';'), 'Ana Ferreira;ana@clube.pt;123456789;monthly;1200.00;40;14;2026-09-01;'].join('\n'),
    );

    assert.equal(hasKeyAndAmount(matchSalaryColumns(sheet).mapping), true);
  });
}

test('every exported column is one the vocabulary knows about', () => {
  for (const name of SALARY_EXPORT_FIELDS) {
    assert.ok(
      (SALARY_FIELDS as readonly string[]).includes(name),
      `${name} is exported but is not a salary field`,
    );
  }

  // The direction that rots: a field added to the importer and forgotten in the
  // export writes a file that cannot round-trip that column, silently.
  for (const name of SALARY_FIELDS) {
    assert.ok(
      SALARY_EXPORT_FIELDS.includes(name),
      `${name} is a salary field but is never exported`,
    );
  }
});

test('the three numeric columns are not read as each other', () => {
  /*
   * The mistake this vocabulary exists to prevent. An amount, a count of hours
   * and a count of months are all digits; getting them the wrong way round
   * writes a wage of €14 and a contract of 1,200 hours a week, and nothing
   * downstream would think to question either.
   */
  const sheet = parseCsv(
    [
      'Nome;Email;Vencimento;Horas;Meses',
      'Ana Ferreira;ana@clube.pt;1200,00;40;14',
      'Bruno Lopes;bruno@clube.pt;980,00;35;14',
    ].join('\n'),
  );

  const { mapping } = matchSalaryColumns(sheet);
  assert.equal(mapping.name, 0);
  assert.equal(mapping.email, 1);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.weeklyHours, 3);
  assert.equal(mapping.payPeriods, 4);
});

test('a NIF column is claimed by its heading, never by its shape', () => {
  /*
   * Nine digits is also what a Portuguese telephone number looks like. A shape
   * rule for `taxNumber` would claim the phone column on a sheet that has one
   * and no NIF — and matching people by a phone number read as a NIF would
   * attach a rate to the wrong person rather than to nobody.
   */
  const sheet = parseCsv(
    ['Nome;Telemóvel;Valor', 'Ana Ferreira;912345678;1200,00'].join('\n'),
  );

  assert.equal(matchSalaryColumns(sheet).mapping.taxNumber, null);
});

test('an address column claims the email field whatever it is called', () => {
  const sheet = parseCsv(
    ['Nome;Coluna B;Valor', 'Ana Ferreira;ana@clube.pt;1200,00', 'Bruno Lopes;bruno@clube.pt;980,00'].join('\n'),
  );

  assert.equal(matchSalaryColumns(sheet).mapping.email, 1);
});

test('a sheet with a name and an amount but no key cannot be imported', () => {
  // Deliberate: there is nobody to pay. The wizard says so at the mapping step
  // rather than letting somebody reach a preview of forty identical refusals.
  const sheet = parseCsv(['Nome;Valor', 'Ana Ferreira;1200,00'].join('\n'));

  assert.equal(hasKeyAndAmount(matchSalaryColumns(sheet).mapping), false);
});

test('a mapped row carries only the columns that were mapped', () => {
  const mapping = { ...EMPTY_SALARY_MAPPING, email: 0, amount: 1 };
  const mapped = applySalaryMapping(['ana@clube.pt', '1200,00', '40'], mapping);

  assert.deepEqual(mapped, { email: 'ana@clube.pt', amount: '1200,00' });
});

test('a blank cell is absent rather than empty', () => {
  // The API reads a missing field as "the file did not say" and an empty string
  // as a value. Sending `''` for an unfilled Horas column would be indis-
  // tinguishable from somebody clearing the contracted hours on purpose.
  const mapping = { ...EMPTY_SALARY_MAPPING, email: 0, amount: 1, weeklyHours: 2 };
  const mapped = applySalaryMapping(['ana@clube.pt', '1200,00', '   '], mapping);

  assert.equal('weeklyHours' in mapped, false);
});

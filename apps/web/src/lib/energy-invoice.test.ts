import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  centsToText,
  draftToBody,
  emptyInvoiceDraft,
  parseDate,
  parseDecimal,
  readInvoiceDraft,
  toCents,
} from './energy-invoice.ts';

/**
 * Faturas — slice 5.3. What comes back from reading a bill, and what goes out.
 *
 * The model call is not tested here, deliberately: it needs a key, costs money
 * and is not deterministic. What is worth testing is the layer that decides
 * how much of its answer to believe, and the one place a Portuguese "15,41 €"
 * becomes a number — because both stand between a document and a cost record.
 *
 * The fixture is the first EDP sample's *structure* with an invented identity.
 * The real documents live under `test-fixtures/energy/private/`, gitignored.
 *
 * Run: pnpm web:test
 */

test('a Portuguese bill\'s numbers parse one way', () => {
  assert.equal(parseDecimal('15,41 €'), 15.41);
  assert.equal(parseDecimal('1 541,00'), 1541);
  assert.equal(parseDecimal('1.541,00'), 1541);
  assert.equal(parseDecimal('-0,62 €'), -0.62);
  assert.equal(parseDecimal('0,1675'), 0.1675);
  assert.equal(parseDecimal('0.1675'), 0.1675, 'an English keyboard');
  assert.equal(parseDecimal('1.541'), 1541, 'a lone point with three digits is thousands');
  assert.equal(parseDecimal('170 kWh'), 170);
  assert.equal(parseDecimal('31 dias'), 31);
  assert.equal(parseDecimal('4,6 kVA'), 4.6);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('abc'), null);

  assert.equal(toCents('46,23 €'), 4623);
  assert.equal(toCents('-5,72'), -572);
  assert.equal(toCents('0,005'), 1, 'half a cent rounds away from zero');
  assert.equal(centsToText(4136), '41,36');
  assert.equal(centsToText(-572), '-5,72');
  assert.equal(centsToText(7), '0,07');
});

test('a Portuguese bill\'s dates parse one way', () => {
  assert.equal(parseDate('26/10/2025'), '2025-10-26');
  assert.equal(parseDate('2025-10-26'), '2025-10-26');
  assert.equal(parseDate('28 de novembro 2025'), '2025-11-28');
  assert.equal(parseDate('28 de novembro de 2025'), '2025-11-28');
  assert.equal(parseDate('23 dez 2025'), '2025-12-23');
  assert.equal(parseDate('26 de outubro a 25 de novembro 2025'), '2025-10-26', 'the first date of a range');
  assert.equal(parseDate('31/02/2025'), null);
  assert.equal(parseDate('ontem'), null);
});

/** A model's answer for a bill shaped like the first EDP sample, identity invented. */
const ANSWER = {
  supplier: 'EDP Comercial',
  invoiceNumber: 'FT2025 K3425/340099999999',
  atcud: 'JJB9YGZ2-340099999999',
  documentReference: 'C801178099999999',
  issuedOn: '28 de novembro 2025',
  periodStart: '26 de outubro 2025',
  periodEnd: '25 de novembro 2025',
  dueOn: '23 dez 2025',
  contractedPowerKva: '4,6',
  tariff: 'Simples',
  cycle: 'Sem ciclo',
  readingQuality: 'real',
  cpe: 'PT 0002 000 099 999 999 ZZ',
  meterSerial: '28202100999999',
  subtotal: '41,36',
  vat: '4,87',
  total: '46,23 €',
  otherCharges: '20,41',
  documentTotal: '66,64 €',
  networkAccess: '16,76 €',
  regulatedDifference: '-5,72 €',
  registers: [
    { register: 'vazio', previousIndex: '968', currentIndex: '1033', kwh: '65' },
    { register: 'ponta', previousIndex: '439', currentIndex: '472', kwh: '33' },
    { register: 'cheias', previousIndex: '1113', currentIndex: '1185', kwh: '72' },
    { register: 'bogus', kwh: '1' },
  ],
  lines: [
    { kind: 'energy', description: 'Consumo real Simples', period: 'simples', fromOn: '26 out 2025', toOn: '11 nov 2025', quantity: '92 kWh', unit: 'kWh', unitPrice: '0,1675 €', amount: '15,41 €', discount: '0,62 €', total: '14,79 €', vatRate: '6' },
    { kind: 'energy', description: 'Consumo real Simples', period: 'simples', fromOn: '12 nov 2025', toOn: '25 nov 2025', quantity: '78 kWh', unit: 'kWh', unitPrice: '0,1675 €', amount: '13,07 €', discount: '0,52 €', total: '12,55 €', vatRate: '6' },
    { kind: 'power', description: 'Potência (4,6 kVA)', fromOn: '26 out 2025', toOn: '25 nov 2025', quantity: '31 dias', unit: 'dias', unitPrice: '0,4631 €', amount: '14,35 €', discount: '0,57 €', total: '13,78 €', vatRate: '23' },
    { kind: 'tax', description: 'DGEG', quantity: '1 mês', unit: 'mês', unitPrice: '0,07 €', amount: '0,07 €', total: '0,07 €', vatRate: '23' },
    { kind: 'tax', description: 'IEC', quantity: '170 kWh', unit: 'kWh', unitPrice: '0,001 €', amount: '0,17 €', total: '0,17 €', vatRate: '23' },
    { kind: 'nonsense', description: 'dropped' },
  ],
  somethingElse: 'ignored',
};

test('a bill reads back as a draft, believed only as far as it can be checked', () => {
  const draft = readInvoiceDraft(ANSWER);
  assert.ok(draft);

  assert.equal(draft.supplier, 'EDP Comercial');
  assert.equal(draft.issuedOn, '2025-11-28', 'dates normalised for the form');
  assert.equal(draft.dueOn, '2025-12-23');
  assert.equal(draft.total, '46,23 €', 'money stays as written until draftToBody');
  assert.equal(draft.registers.length, 3, 'an unknown register is dropped');
  assert.equal(draft.lines.length, 5, 'an unknown kind is dropped');
  assert.equal(draft.lines[0]?.fromOn, '2025-10-26');
  assert.equal(readInvoiceDraft({ analyses: [] }), null, 'nothing recognisable is nothing');
});

test('the draft becomes the API body in one place — cents, numbers, ISO dates', () => {
  const draft = readInvoiceDraft(ANSWER);
  assert.ok(draft);

  const { body, fields } = draftToBody(draft, { source: 'import', sourceFileName: 'fatura.pdf', commit: true });
  assert.deepEqual(fields, {});

  assert.equal(body['subtotalCents'], 4136);
  assert.equal(body['vatCents'], 487);
  assert.equal(body['totalCents'], 4623);
  assert.equal(body['otherChargesCents'], 2041);
  assert.equal(body['documentTotalCents'], 6664);
  assert.equal(body['regulatedDifferenceCents'], -572);
  assert.equal(body['contractedPowerKva'], 4.6);
  assert.equal(body['issuedOn'], '2025-11-28');
  assert.equal(body['cpe'], 'PT 0002 000 099 999 999 ZZ', 'the API compacts it');
  assert.equal(body['commit'], true);

  const lines = body['lines'] as Record<string, unknown>[];
  assert.equal(lines.length, 5);
  assert.deepEqual(
    [lines[0]?.['quantity'], lines[0]?.['unitPrice'], lines[0]?.['amountCents'], lines[0]?.['discountCents'], lines[0]?.['totalCents'], lines[0]?.['vatRate']],
    [92, 0.1675, 1541, 62, 1479, 6],
  );
  assert.equal(lines[2]?.['unit'], 'dias');
  // The lines sum to the subtotal, which is the test the API's preview makes.
  const sum = lines.reduce((acc, l) => acc + (l['totalCents'] as number), 0);
  assert.equal(sum, body['subtotalCents']);

  const registers = body['registers'] as Record<string, unknown>[];
  assert.deepEqual(registers.map((r) => r['kwh']), [65, 33, 72]);
});

test('a typed bill fills what the bill computes: a line total from amount less discount, a document total from the parts', () => {
  const draft = emptyInvoiceDraft();
  draft.supplier = 'Galp';
  draft.invoiceNumber = 'FT 1';
  draft.issuedOn = '2026-02-01';
  draft.periodStart = '2026-01-01';
  draft.periodEnd = '2026-01-31';
  draft.subtotal = '100';
  draft.vat = '23';
  draft.total = '123';
  draft.registers = [{ register: 'total', previousIndex: '1000', currentIndex: '1400', kwh: '' }];
  draft.lines = [{ ...draft.lines[0]!, description: 'Energia', quantity: '400', amount: '110,00', discount: '10,00', total: '', vatRate: '23' }];

  const { body, fields } = draftToBody(draft, { source: 'manual' });
  assert.deepEqual(fields, {});
  assert.equal(body['documentTotalCents'], 12300, 'no other charges: the electricity total');
  assert.equal((body['registers'] as Record<string, unknown>[])[0]?.['kwh'], 400, 'the difference of the indexes');
  assert.equal((body['lines'] as Record<string, unknown>[])[0]?.['totalCents'], 10000);

  draft.total = 'abc';
  draft.periodEnd = '';
  const again = draftToBody(draft, { source: 'manual' });
  assert.equal(again.fields['total'], 'energy.invoice.notANumber');
  assert.equal(again.fields['periodEnd'], 'energy.invoice.required');
});

/**
 * Every key the API or `draftToBody` can put beside a field or in a warning
 * exists in both catalogues. `tsc` cannot check a string; this can.
 */
test('every refusal and warning key the bill can raise is in both catalogues', () => {
  const keys = [
    'required', 'notANumber', 'notADate', 'fieldInvalid',
    'totalMismatch', 'documentMismatch', 'periodOrder', 'dueBeforeIssued', 'registerBackwards',
    'noMeter', 'duplicate', 'linesDisagree', 'registersDisagree', 'cpeMismatch', 'serialMismatch', 'periodOverlap',
    'chooseAFile', 'nothingFound', 'unreadable', 'saveFailed',
  ];
  for (const locale of ['pt-PT', 'en']) {
    const path = new URL(`../messages/${locale}.json`, import.meta.url);
    const catalogue = JSON.parse(readFileSync(path, 'utf8')) as { energy: { invoice: Record<string, unknown> } };
    for (const key of keys) {
      assert.equal(typeof catalogue.energy.invoice[key], 'string', `energy.invoice.${key} missing from ${locale}`);
    }
  }
});

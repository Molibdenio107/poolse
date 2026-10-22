import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euros, invoiceReminderEmail } from './invoice-reminder-email.js';

/** POOLSE-86 3.0b — what a reminder says; POOLSE-94 — where it says to pay. */

const DOCS = [
  { documentNo: 'FT 2026/14', issuedOn: '2026-10-01', dueOn: '2026-10-08', outstandingCents: 4500 },
  { documentNo: 'FT 2026/31', issuedOn: '2026-11-01', dueOn: '2026-11-08', outstandingCents: 123450 },
];

test('euros in each language', () => {
  assert.equal(euros(4500, 'pt-PT'), '45,00 €');
  assert.equal(euros(123450, 'pt-PT'), '1 234,50 €');
  assert.equal(euros(123450, 'en'), '€1,234.50');
});

test('lists every document with dd-MM-yyyy dates and the total', () => {
  const email = invoiceReminderEmail({
    to: 'a@b.pt', organizationName: 'Clube Azul', payerName: 'Ana', documents: DOCS,
    payment: { iban: null, accountHolder: null, mbwayPhone: null, instructions: 'Na receção, das 9h às 18h' },
    locale: 'pt-PT',
  });
  assert.match(email.subject, /^Clube Azul — Lembrete de pagamento$/);
  assert.match(email.text, /FT 2026\/14, de 01-10-2026, com vencimento a 08-10-2026: 45,00 €/);
  assert.match(email.text, /Total em atraso: 1 279,50 €/);
  assert.match(email.text, /Como pagar:\nNa receção, das 9h às 18h/);
});

test('with nowhere to pay it says to contact the club, and escapes HTML', () => {
  const email = invoiceReminderEmail({
    to: 'a@b.pt', organizationName: 'Clube <Azul>', payerName: 'Ana', documents: DOCS.slice(0, 1),
    payment: null, locale: 'en',
  });
  assert.match(email.text, /please contact the club/);
  assert.doesNotMatch(email.html, /<Azul>/);
});

test('POOLSE-94 QA 6 — the transfer and MB WAY first, the reference, then the club’s own words', () => {
  const email = invoiceReminderEmail({
    to: 'a@b.pt', organizationName: 'Clube Azul', payerName: 'Ana', documents: DOCS,
    payment: {
      iban: 'PT50000201231234567890154',
      accountHolder: 'Clube Azul, Lda.',
      mbwayPhone: '+351912345678',
      instructions: 'Também em numerário, na receção.',
    },
    locale: 'pt-PT',
  });
  const block = email.text.slice(email.text.indexOf('Como pagar:'));
  assert.deepEqual(block.split('\n').slice(0, 5), [
    'Como pagar:',
    'Transferência bancária: PT50 0002 0123 1234 5678 9015 4 (titular: Clube Azul, Lda.)',
    'MB WAY: +351 912 345 678',
    'Indique como referência: FT 2026/14, FT 2026/31',
    'Também em numerário, na receção.',
  ]);
  assert.match(email.html, /MB WAY: \+351 912 345 678<br>/);
});

test('POOLSE-94 QA 3 — only MB WAY filled is only MB WAY', () => {
  const email = invoiceReminderEmail({
    to: 'a@b.pt', organizationName: 'Clube Azul', payerName: 'Ana', documents: DOCS.slice(0, 1),
    payment: { iban: null, accountHolder: null, mbwayPhone: '+351912345678', instructions: null },
    locale: 'en',
  });
  const block = email.text.slice(email.text.indexOf('How to pay:'));
  assert.deepEqual(block.split('\n').slice(0, 3), [
    'How to pay:',
    'MB WAY: +351 912 345 678',
    'Give as the reference: FT 2026/14',
  ]);
  assert.doesNotMatch(email.text, /Bank transfer/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euros, invoiceReminderEmail } from './invoice-reminder-email.js';

/** POOLSE-86 3.0b — what a reminder says. */

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
    paymentInstructions: 'IBAN PT50 1234', locale: 'pt-PT',
  });
  assert.match(email.subject, /^Clube Azul — Lembrete de pagamento$/);
  assert.match(email.text, /FT 2026\/14, de 01-10-2026, com vencimento a 08-10-2026: 45,00 €/);
  assert.match(email.text, /Total em atraso: 1 279,50 €/);
  assert.match(email.text, /Como pagar:\nIBAN PT50 1234/);
});

test('with no Como pagar it says to contact the club, and escapes HTML', () => {
  const email = invoiceReminderEmail({
    to: 'a@b.pt', organizationName: 'Clube <Azul>', payerName: 'Ana', documents: DOCS.slice(0, 1),
    paymentInstructions: null, locale: 'en',
  });
  assert.match(email.text, /please contact the club/);
  assert.doesNotMatch(email.html, /<Azul>/);
});

import type { Email } from './notifier.js';

export interface InvoiceReminderEmailInput {
  to: string;
  organizationName: string;
  payerName: string;
  documents: { documentNo: string; issuedOn: string; dueOn: string; outstandingCents: number }[];
  /** The club's own words, verbatim; null says to contact the club. */
  paymentInstructions: string | null;
  locale: string;
}

/**
 * A reminder of what is overdue — POOLSE-86, 3.0b.
 *
 * Plain and courteous: what is owed, document by document, the total, and how
 * to pay in the club's own words. It is sent because a person at the club chose
 * to send it, and it says so. These are the club's internal records, not legal
 * faturas, so it names "documentos", never "faturas".
 */
const COPY = {
  'pt-PT': {
    subject: 'Lembrete de pagamento',
    greeting: (name: string) => `Olá, ${name}.`,
    intro: (club: string) => `${club} pede-lhe que regularize os seguintes valores em atraso:`,
    line: (no: string, issued: string, due: string, amount: string) =>
      `${no}, de ${issued}, com vencimento a ${due}: ${amount}`,
    total: (amount: string) => `Total em atraso: ${amount}`,
    howToPay: 'Como pagar:',
    noInstructions: 'Para saber como pagar, contacte o clube.',
    paid: 'Se já pagou, agradecemos e pedimos que ignore esta mensagem.',
    signature: (club: string) =>
      `Enviado pelo Poolse a pedido de ${club}. As respostas a este email não chegam ao clube.`,
  },
  en: {
    subject: 'Payment reminder',
    greeting: (name: string) => `Hello ${name},`,
    intro: (club: string) => `${club} asks you to settle the following overdue amounts:`,
    line: (no: string, issued: string, due: string, amount: string) =>
      `${no}, issued ${issued}, due ${due}: ${amount}`,
    total: (amount: string) => `Total overdue: ${amount}`,
    howToPay: 'How to pay:',
    noInstructions: 'To find out how to pay, please contact the club.',
    paid: 'If you have already paid, thank you, and please ignore this message.',
    signature: (club: string) =>
      `Sent by Poolse on behalf of ${club}. Replies to this email do not reach the club.`,
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `YYYY-MM-DD` → `dd-MM-yyyy`, the one date shape Poolse writes. */
function day(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** Cents as euros: "1 234,50 €" in Portuguese, "€1,234.50" in English. */
export function euros(cents: number, locale: string): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = `${Math.abs(cents) % 100}`.padStart(2, '0');
  const sign = cents < 0 ? '-' : '';
  if (locale.startsWith('en')) {
    return `${sign}€${whole.toLocaleString('en-GB')}.${fraction}`;
  }
  const grouped = `${whole}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped},${fraction} €`;
}

export function invoiceReminderEmail(input: InvoiceReminderEmailInput): Email {
  const en = input.locale.startsWith('en');
  const copy = en ? COPY.en : COPY['pt-PT'];
  const money = (cents: number): string => euros(cents, input.locale);
  const lines = input.documents.map((d) =>
    copy.line(d.documentNo, day(d.issuedOn), day(d.dueOn), money(d.outstandingCents)),
  );
  const total = copy.total(money(input.documents.reduce((sum, d) => sum + d.outstandingCents, 0)));
  const instructions = input.paymentInstructions?.trim() ?? '';

  const text = [
    copy.greeting(input.payerName),
    '',
    copy.intro(input.organizationName),
    ...lines.map((line) => `- ${line}`),
    '',
    total,
    '',
    ...(instructions === '' ? [copy.noInstructions] : [copy.howToPay, instructions]),
    '',
    copy.paid,
    '',
    copy.signature(input.organizationName),
  ].join('\n');

  const html = [
    `<p>${escapeHtml(copy.greeting(input.payerName))}</p>`,
    `<p>${escapeHtml(copy.intro(input.organizationName))}</p>`,
    `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    `<p><strong>${escapeHtml(total)}</strong></p>`,
    instructions === ''
      ? `<p>${escapeHtml(copy.noInstructions)}</p>`
      : `<p>${escapeHtml(copy.howToPay)}<br>${escapeHtml(instructions).replace(/\n/g, '<br>')}</p>`,
    `<p>${escapeHtml(copy.paid)}</p>`,
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature(input.organizationName))}</p>`,
  ].join('\n');

  return { to: input.to, subject: `${input.organizationName} — ${copy.subject}`, text, html };
}

import type { Email } from './notifier.js';

/**
 * "The club's IBAN was changed" — to every Owner, after the commit — POOLSE-94.
 *
 * A changed IBAN is the classic fraud vector: somebody with admin access, or
 * with an admin's password, points the families' transfers at another account.
 * So every owner hears about every change, with who made it and when. The
 * account is named by its last four digits only — enough to recognise, not
 * enough to use — and the full values are in the club's Atividade.
 */
export interface PaymentChangeEmailInput {
  to: string;
  organizationName: string;
  changedBy: string;
  /** `dd-MM-yyyy HH:mm` on the club's clock, already formatted. */
  changedAt: string;
  oldEnd: string | null;
  newEnd: string | null;
  locale: string;
}

const COPY = {
  'pt-PT': {
    subject: (club: string) => `${club} — o IBAN do clube foi alterado`,
    body: (who: string, when: string) => `${who} alterou o IBAN para onde as famílias pagam, a ${when}.`,
    was: (end: string | null) => (end === null ? 'Antes: nenhum IBAN.' : `Antes: terminado em ${end}.`),
    now: (end: string | null) => (end === null ? 'Agora: nenhum IBAN.' : `Agora: terminado em ${end}.`),
    check: 'Se não reconhece esta alteração, confirme em Dados do clube e reveja quem tem acesso de administrador.',
    why: 'Recebe este email por ser proprietário do clube. Uma alteração de IBAN é sempre comunicada.',
  },
  en: {
    subject: (club: string) => `${club} — the club's IBAN was changed`,
    body: (who: string, when: string) => `${who} changed the IBAN families pay into, on ${when}.`,
    was: (end: string | null) => (end === null ? 'Before: no IBAN.' : `Before: ending ${end}.`),
    now: (end: string | null) => (end === null ? 'Now: no IBAN.' : `Now: ending ${end}.`),
    check: "If you do not recognise this change, check it in the club's details and review who has admin access.",
    why: 'You receive this email as an owner of the club. An IBAN change is always reported.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function paymentChangeEmail(input: PaymentChangeEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const lines = [
    copy.body(input.changedBy, input.changedAt),
    copy.was(input.oldEnd),
    copy.now(input.newEnd),
    '',
    copy.check,
    '',
    copy.why,
  ];
  return {
    to: input.to,
    subject: copy.subject(input.organizationName),
    text: lines.join('\n'),
    html: lines
      .filter((line) => line !== '')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n'),
  };
}

import type { Email } from './notifier.js';

export interface QualificationAlertEmailInput {
  to: string;
  organizationName: string;
  personName: string;
  typeName: string;
  /** Already `dd-MM-yyyy`, from the database. */
  expiresOn: string;
  threshold: 'amber' | 'red';
  locale: string;
}

/**
 * "X's TPTD expires on 13-01-2027" — POOLSE-27, 7b.2.
 *
 * In the organization's language, as every email sent from a path with no
 * reader session is. The type's name is the club's own and is not translated.
 * The email reports and does not decide: whether somebody keeps teaching is the
 * club's call, and the staff record is where it is made.
 */
const COPY = {
  'pt-PT': {
    amberSubject: (person: string, type: string) => `${person}: ${type} perto de expirar`,
    redSubject: (person: string, type: string) => `${person}: ${type} expirou`,
    amber: (person: string, type: string, date: string) =>
      `A qualificação ${type} de ${person} expira a ${date}. Convém tratar da renovação.`,
    red: (person: string, type: string, date: string) =>
      `A qualificação ${type} de ${person} expirou a ${date}.`,
    closing: 'Os registos estão na ficha da pessoa, em Equipa, no Poolse.',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse.',
  },
  en: {
    amberSubject: (person: string, type: string) => `${person}: ${type} expiring soon`,
    redSubject: (person: string, type: string) => `${person}: ${type} has expired`,
    amber: (person: string, type: string, date: string) =>
      `${person}'s ${type} expires on ${date}. It is worth arranging the renewal.`,
    red: (person: string, type: string, date: string) =>
      `${person}'s ${type} expired on ${date}.`,
    closing: "The records are on the person's page, under Staff, in Poolse.",
    signature: 'This message was sent automatically by Poolse.',
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function qualificationAlertEmail(input: QualificationAlertEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const red = input.threshold === 'red';
  const line = (red ? copy.red : copy.amber)(input.personName, input.typeName, input.expiresOn);

  return {
    to: input.to,
    subject: `${input.organizationName} — ${(red ? copy.redSubject : copy.amberSubject)(
      input.personName,
      input.typeName,
    )}`,
    text: [line, '', copy.closing, '', copy.signature].join('\n'),
    html: [
      `<p>${escapeHtml(line)}</p>`,
      `<p>${escapeHtml(copy.closing)}</p>`,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature)}</p>`,
    ].join('\n'),
  };
}

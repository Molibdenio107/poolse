import type { Email } from './notifier.js';

export interface VacationDecisionInput {
  to: string;
  personName: string | null;
  organizationName: string;
  approved: boolean;
  /** ISO dates, ascending. */
  days: string[];
  note: string | null;
  locale: string;
}

/**
 * "Your leave was approved" / "…was not approved" — backlog round 3, story 7.
 *
 * Email, because that is the transport that exists. Slice 3.0 builds the full
 * notification subsystem — records, preferences, push — on the same `sendEmail`
 * seam, and this becomes one channel of it rather than being rewritten.
 *
 * In the organization's language, not the recipient's, for the same reason the
 * invitation email is: the reader's locale lives on `app_user` and this is sent
 * from a background path that has no session. A club that runs in Portuguese
 * telling its own instructor about leave is overwhelmingly likely to be writing
 * to a Portuguese speaker.
 *
 * The days are listed in full rather than summarised as a range. Somebody who
 * asked for the Monday and the Friday needs to see both, and "3 days approved"
 * is precisely the message that starts the phone call this email exists to
 * prevent.
 */
interface Copy {
  approvedSubject: (org: string) => string;
  rejectedSubject: (org: string) => string;
  greeting: (name: string | null) => string;
  approved: string;
  rejected: string;
  noteLabel: string;
  signature: string;
}

const COPY: Record<'pt-PT' | 'en', Copy> = {
  'pt-PT': {
    approvedSubject: (org: string) => `${org} — férias aprovadas`,
    rejectedSubject: (org: string) => `${org} — férias não aprovadas`,
    greeting: (name: string | null) => (name === null ? 'Olá,' : `Olá ${name},`),
    approved: 'O seu pedido de férias foi aprovado para os seguintes dias:',
    rejected: 'O seu pedido de férias não foi aprovado para os seguintes dias:',
    noteLabel: 'Motivo',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse.',
  },
  en: {
    approvedSubject: (org: string) => `${org} — leave approved`,
    rejectedSubject: (org: string) => `${org} — leave not approved`,
    greeting: (name: string | null) => (name === null ? 'Hello,' : `Hello ${name},`),
    approved: 'Your leave request has been approved for these days:',
    rejected: 'Your leave request was not approved for these days:',
    noteLabel: 'Reason',
    signature: 'This message was sent automatically by Poolse.',
  },
};

function copyFor(locale: string): Copy {
  return locale === 'en' ? COPY.en : COPY['pt-PT'];
}

/** Escaped, because a decision note is free text somebody typed. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

export function vacationDecisionEmail(input: VacationDecisionInput): Email {
  const copy = copyFor(input.locale);
  const days = input.days.map((day) => formatDay(day, input.locale));

  const subject = input.approved
    ? copy.approvedSubject(input.organizationName)
    : copy.rejectedSubject(input.organizationName);

  const lead = input.approved ? copy.approved : copy.rejected;

  const textLines = [
    copy.greeting(input.personName),
    '',
    lead,
    ...days.map((day) => `  - ${day}`),
  ];

  if (input.note !== null) {
    textLines.push('', `${copy.noteLabel}: ${input.note}`);
  }

  textLines.push('', copy.signature);

  // Text and HTML both: a text/plain alternative is what stops a transactional
  // message being scored as bulk mail.
  const html = [
    `<p>${escapeHtml(copy.greeting(input.personName))}</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<ul>${days.map((day) => `<li>${escapeHtml(day)}</li>`).join('')}</ul>`,
    input.note === null
      ? ''
      : `<p><strong>${escapeHtml(copy.noteLabel)}:</strong> ${escapeHtml(input.note)}</p>`,
    `<p style="color:#5a6770;font-size:13px">${escapeHtml(copy.signature)}</p>`,
  ].join('');

  return { to: input.to, subject, text: textLines.join('\n'), html };
}

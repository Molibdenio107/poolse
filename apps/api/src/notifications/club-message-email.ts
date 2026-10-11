import type { Email } from './notifier.js';

export interface ClubMessageEmailInput {
  to: string;
  organizationName: string;
  subject: string;
  body: string;
  locale: string;
}

/**
 * A club writing to its families — POOLSE-67.
 *
 * **The club's own words, verbatim.** Subject and body are exactly what the
 * operator typed; nothing is translated or wrapped in a template that speaks for
 * them. The one line Poolse adds is the footer, which says who sent it and that
 * a reply does not reach the club — there is no inbox behind this (phase 3.0).
 *
 * **In the organization's language**, as the invitation, leave and water emails
 * are: this is sent from a path with no reader session, and the families of a
 * club that runs in Portuguese read Portuguese.
 *
 * Plain text is escaped into the HTML part line by line, so a `<` in a message
 * about the pool's opening hours is a character and not markup.
 */
const FOOTER: Record<'pt-PT' | 'en', (club: string) => string> = {
  'pt-PT': (club) =>
    `Mensagem enviada por ${club} através do Poolse. As respostas a este email não chegam ao clube.`,
  en: (club) => `Message sent by ${club} through Poolse. Replies to this email do not reach the club.`,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clubMessageEmail(input: ClubMessageEmailInput): Email {
  const footer = (input.locale.startsWith('en') ? FOOTER.en : FOOTER['pt-PT'])(
    input.organizationName,
  );

  const paragraphs = input.body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.split('\n').map(escapeHtml).join('<br>')}</p>`);

  return {
    to: input.to,
    subject: `${input.organizationName}: ${input.subject}`,
    text: [input.body, '', '—', footer].join('\n'),
    html: [
      ...paragraphs,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}

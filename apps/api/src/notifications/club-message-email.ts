import type { Email } from './notifier.js';

export interface ClubMessageEmailInput {
  to: string;
  organizationName: string;
  subject: string;
  body: string;
  locale: string;
  /**
   * The link that stops this club's general messages to this address — POOLSE-86.
   * Null on a closure warning, which always goes.
   */
  optOutLink?: string | null;
}

/**
 * A club writing to its families — POOLSE-67.
 *
 * **The club's own words, verbatim.** Subject and body are exactly what the
 * operator typed; nothing is translated or wrapped in a template that speaks for
 * them. What Poolse adds is the footer, which says who sent it and that a reply
 * does not reach the club — there is no inbox behind this (phase 3.0) — and,
 * since POOLSE-86, on a general message, the link that stops them.
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

const OPT_OUT: Record<'pt-PT' | 'en', { text: (club: string) => string; link: string }> = {
  'pt-PT': {
    text: (club) => `Para deixar de receber as mensagens gerais de ${club}:`,
    link: 'deixar de receber',
  },
  en: {
    text: (club) => `To stop receiving general messages from ${club}:`,
    link: 'unsubscribe',
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clubMessageEmail(input: ClubMessageEmailInput): Email {
  const en = input.locale.startsWith('en');
  const footer = (en ? FOOTER.en : FOOTER['pt-PT'])(input.organizationName);
  const optOut = en ? OPT_OUT.en : OPT_OUT['pt-PT'];
  const link = input.optOutLink ?? null;

  const paragraphs = input.body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.split('\n').map(escapeHtml).join('<br>')}</p>`);

  return {
    to: input.to,
    subject: `${input.organizationName}: ${input.subject}`,
    text: [
      input.body,
      '',
      '—',
      footer,
      ...(link === null ? [] : [`${optOut.text(input.organizationName)} ${link}`]),
    ].join('\n'),
    html: [
      ...paragraphs,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`,
      ...(link === null
        ? []
        : [
            `<p style="color:#6b7280;font-size:12px">${escapeHtml(optOut.text(input.organizationName))} ` +
              `<a href="${escapeHtml(link)}">${escapeHtml(optOut.link)}</a></p>`,
          ]),
    ].join('\n'),
  };
}

import type { Email } from './notifier.js';

/**
 * "We found no LENEX file in that message" — POOLSE-114 BA 3.
 *
 * Sent once, to a sender the club knows (owner, admin or instructor), when the
 * message they forwarded carried nothing the import can read. A stranger is
 * never answered: that would be backscatter. Not retried — it is a courtesy
 * about an email they just sent, and the next one they send is the retry.
 */
export interface NoLenexReplyInput {
  to: string;
  organizationName: string;
  locale: string;
}

const COPY = {
  'pt-PT': {
    subject: (club: string) => `${club} — resultados não recebidos`,
    lines: [
      'Não encontrámos nenhum ficheiro LENEX (.lef/.lxf) nesta mensagem.',
      'Reencaminhe o email que traz o ficheiro de resultados da prova em anexo, ou largue o ficheiro na página Competição → Provas.',
    ],
  },
  en: {
    subject: (club: string) => `${club} — results not received`,
    lines: [
      'We found no LENEX file (.lef/.lxf) in this message.',
      "Forward the email that carries the meet's results file as an attachment, or drop the file on the Competition → Meets page.",
    ],
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function noLenexReply(input: NoLenexReplyInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  return {
    to: input.to,
    subject: copy.subject(input.organizationName),
    text: copy.lines.join('\n\n'),
    html: copy.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}

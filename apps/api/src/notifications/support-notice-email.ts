import type { Email } from './notifier.js';

export interface SupportNoticeEmailInput {
  to: string;
  organizationName: string;
  /** The operator's reason, verbatim — the Owner is owed exactly what was typed. */
  reason: string;
  /** Already `dd-MM-yyyy HH:mm`, Lisbon. */
  startsAt: string;
  expiresAt: string;
  link: string;
  locale: string;
}

/**
 * Poolse support entered the club without the Owner's grant — POOLSE-79, sent
 * since POOLSE-86. Said plainly: who, why (verbatim), for how long, and where
 * the Owner sees it and ends it.
 */
const COPY = {
  'pt-PT': {
    subject: 'O suporte Poolse entrou no clube sem pedido',
    body: (start: string, end: string) =>
      `O suporte Poolse abriu um acesso de emergência a {club} às ${start}, válido até às ${end}. Tudo o que fizer fica registado em seu nome na Atividade do clube.`,
    reason: 'Motivo indicado:',
    action: 'Ver e terminar o acesso',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse a quem é dono do clube.',
  },
  en: {
    subject: 'Poolse support entered the club without a request',
    body: (start: string, end: string) =>
      `Poolse support opened emergency access to {club} at ${start}, valid until ${end}. Everything they do is recorded under their name in the club's Activity.`,
    reason: 'Reason given:',
    action: 'See and end the access',
    signature: 'This message was sent automatically by Poolse to the owners of the club.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function supportNoticeEmail(input: SupportNoticeEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const line = copy.body(input.startsAt, input.expiresAt).replace('{club}', input.organizationName);
  return {
    to: input.to,
    subject: `${input.organizationName} — ${copy.subject}`,
    text: [line, '', copy.reason, input.reason, '', `${copy.action}: ${input.link}`, '', copy.signature].join('\n'),
    html: [
      `<p>${escapeHtml(line)}</p>`,
      `<p>${escapeHtml(copy.reason)}<br>${escapeHtml(input.reason)}</p>`,
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(copy.action)}</a></p>`,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature)}</p>`,
    ].join('\n'),
  };
}

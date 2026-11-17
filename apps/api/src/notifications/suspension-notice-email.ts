import type { Email } from './notifier.js';

export interface SuspensionNoticeEmailInput {
  to: string;
  kind: 'suspended' | 'restored';
  organizationName: string;
  /** The operator's reason, verbatim. Null on a restore, which asks for none. */
  reason: string | null;
  /** Already `dd-MM-yyyy HH:mm`, Lisbon. */
  occurredAt: string;
  /** Poolse's support address; never empty (the suspended screen's fallback). */
  supportEmail: string;
  link: string;
  locale: string;
}

/**
 * The platform shut a club, or opened it again — POOLSE-225.
 *
 * Said plainly: what happened, from when, the operator's sentence exactly as it
 * was typed, that nothing was deleted, and who to write to. The reason is the
 * Owner's to read in full, so it is escaped in the HTML part and untouched in the
 * text part, never trimmed or reworded.
 */
const COPY = {
  'pt-PT': {
    suspended: {
      subject: 'Acesso ao clube suspenso',
      body: (at: string) =>
        `O acesso a {club} no Poolse foi suspenso a ${at}. Ninguém do clube consegue entrar até o acesso ser reposto. Nada foi apagado: os dados do clube ficam guardados.`,
    },
    restored: {
      subject: 'Acesso ao clube reposto',
      body: (at: string) =>
        `O acesso a {club} no Poolse foi reposto a ${at}. Já é possível entrar e trabalhar como antes. Nada foi apagado.`,
    },
    reason: 'Motivo indicado:',
    contact: (email: string) => `Dúvidas? Escreva ao suporte Poolse: ${email}`,
    action: 'Abrir o Poolse',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse a quem é dono do clube.',
  },
  en: {
    suspended: {
      subject: 'Access to the club suspended',
      body: (at: string) =>
        `Access to {club} on Poolse was suspended on ${at}. Nobody at the club can sign in until access is restored. Nothing was deleted: the club's data is kept.`,
    },
    restored: {
      subject: 'Access to the club restored',
      body: (at: string) =>
        `Access to {club} on Poolse was restored on ${at}. You can sign in and work as before. Nothing was deleted.`,
    },
    reason: 'Reason given:',
    contact: (email: string) => `Questions? Write to Poolse support: ${email}`,
    action: 'Open Poolse',
    signature: 'This message was sent automatically by Poolse to the owners of the club.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function suspensionNoticeEmail(input: SuspensionNoticeEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const kind = copy[input.kind];
  const line = kind.body(input.occurredAt).replace('{club}', input.organizationName);
  const contact = copy.contact(input.supportEmail);
  const reason = input.kind === 'suspended' && input.reason !== null ? input.reason : null;

  return {
    to: input.to,
    subject: `${input.organizationName} — ${kind.subject}`,
    text: [
      line,
      ...(reason === null ? [] : ['', copy.reason, reason]),
      '',
      contact,
      '',
      `${copy.action}: ${input.link}`,
      '',
      copy.signature,
    ].join('\n'),
    html: [
      `<p>${escapeHtml(line)}</p>`,
      ...(reason === null
        ? []
        : [`<p>${escapeHtml(copy.reason)}<br><span style="white-space:pre-wrap">${escapeHtml(reason)}</span></p>`]),
      `<p>${escapeHtml(copy.contact('')).trimEnd()} <a href="mailto:${escapeHtml(input.supportEmail)}">${escapeHtml(input.supportEmail)}</a></p>`,
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(copy.action)}</a></p>`,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature)}</p>`,
    ].join('\n'),
  };
}

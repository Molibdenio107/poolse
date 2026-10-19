import type { Email } from './notifier.js';

export type TrialNoticeKind =
  | 'trial_ending_soon'
  | 'trial_last_day'
  | 'trial_ended'
  | 'access_closing_soon'
  | 'access_closed'
  | 'deletion_soon'
  | 'payment_overdue'
  | 'payment_read_only';

export interface TrialNoticeEmailInput {
  to: string;
  kind: TrialNoticeKind;
  organizationName: string;
  /** The one date this notice is about, already `dd-MM-yyyy` — see `DATE_OF` in trial-notices.ts. */
  date: string;
  /** Where the owner pays or sees the subscription. */
  link: string;
  locale: string;
}

/**
 * What the trial clock owes a club's owners — POOLSE-61, sent since POOLSE-86.
 *
 * One sentence of fact, one of consequence, and where to act. In the club's
 * language, as every email from a path with no reader session is. Nothing here
 * threatens: the data is kept, every export still works, and paying lifts it.
 */
const COPY = {
  'pt-PT': {
    subject: {
      trial_ending_soon: 'O período de avaliação termina em breve',
      trial_last_day: 'Último dia do período de avaliação',
      trial_ended: 'O período de avaliação terminou',
      access_closing_soon: 'O acesso fecha em breve',
      access_closed: 'O acesso foi fechado',
      deletion_soon: 'O clube vai ser arquivado',
      payment_overdue: 'Pagamento da subscrição em atraso',
      payment_read_only: 'Subscrição em atraso: modo de leitura',
    },
    body: {
      trial_ending_soon: (date: string) =>
        `O período de avaliação de {club} termina a ${date}. Para continuar a usar o Poolse sem interrupções, ative a subscrição antes dessa data.`,
      trial_last_day: (date: string) =>
        `O período de avaliação de {club} termina a ${date}. A partir daí, o Poolse fica em modo de leitura até a subscrição ser ativada.`,
      trial_ended: (date: string) =>
        `O período de avaliação de {club} terminou. O Poolse está em modo de leitura: os dados continuam todos disponíveis e podem ser exportados. Se a subscrição não for ativada, o acesso fecha a ${date}.`,
      access_closing_soon: (date: string) =>
        `O acesso a {club} fecha a ${date}. Ative a subscrição até lá para continuar a usar o Poolse.`,
      access_closed: (date: string) =>
        `O acesso a {club} foi fechado porque a subscrição não foi ativada. Os dados ficam guardados até ${date}; ativar a subscrição reabre tudo.`,
      deletion_soon: (date: string) =>
        `{club} vai ser arquivado a ${date}. Até lá, ativar a subscrição reabre o acesso com todos os dados.`,
      payment_overdue: (date: string) =>
        `A subscrição de {club} estava paga até ${date} e ainda não recebemos o pagamento seguinte. O Poolse continua a funcionar normalmente durante o período de tolerância.`,
      payment_read_only: (date: string) =>
        `Como o pagamento da subscrição de {club} continua em atraso, o Poolse está em modo de leitura desde ${date}. Os dados estão todos disponíveis; registar o pagamento reativa a escrita.`,
    },
    action: 'Ver a subscrição',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse a quem é dono do clube.',
  },
  en: {
    subject: {
      trial_ending_soon: 'Your trial ends soon',
      trial_last_day: 'Last day of your trial',
      trial_ended: 'Your trial has ended',
      access_closing_soon: 'Access closes soon',
      access_closed: 'Access has been closed',
      deletion_soon: 'Your club will be archived',
      payment_overdue: 'Subscription payment overdue',
      payment_read_only: 'Subscription overdue: read-only',
    },
    body: {
      trial_ending_soon: (date: string) =>
        `The trial for {club} ends on ${date}. To keep using Poolse without interruption, activate the subscription before then.`,
      trial_last_day: (date: string) =>
        `The trial for {club} ends on ${date}. After that, Poolse is read-only until the subscription is activated.`,
      trial_ended: (date: string) =>
        `The trial for {club} has ended. Poolse is now read-only: all the data is still there and can be exported. If the subscription is not activated, access closes on ${date}.`,
      access_closing_soon: (date: string) =>
        `Access to {club} closes on ${date}. Activate the subscription before then to keep using Poolse.`,
      access_closed: (date: string) =>
        `Access to {club} has been closed because the subscription was not activated. The data is kept until ${date}; activating the subscription reopens everything.`,
      deletion_soon: (date: string) =>
        `{club} will be archived on ${date}. Until then, activating the subscription reopens access with all the data.`,
      payment_overdue: (date: string) =>
        `The subscription for {club} was paid up to ${date} and the next payment has not arrived yet. Poolse keeps working normally during the grace period.`,
      payment_read_only: (date: string) =>
        `As the subscription payment for {club} is still overdue, Poolse has been read-only since ${date}. All the data is available; recording the payment turns writing back on.`,
    },
    action: 'See the subscription',
    signature: 'This message was sent automatically by Poolse to the owners of the club.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function trialNoticeEmail(input: TrialNoticeEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const line = copy.body[input.kind](input.date).replace('{club}', input.organizationName);

  return {
    to: input.to,
    subject: `${input.organizationName} — ${copy.subject[input.kind]}`,
    text: [line, '', `${copy.action}: ${input.link}`, '', copy.signature].join('\n'),
    html: [
      `<p>${escapeHtml(line)}</p>`,
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(copy.action)}</a></p>`,
      `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature)}</p>`,
    ].join('\n'),
  };
}

import type { Excursion, PoolMetric } from '@poolse/rules';
import type { Email } from './notifier.js';

export interface WaterAlertEmailInput {
  to: string;
  organizationName: string;
  facilityName: string;
  poolName: string;
  takenAt: Date;
  /**
   * The facility's timezone, because that is where the sample was taken.
   *
   * Stored UTC and displayed in the facility's zone, as every instant in this
   * schema is. Formatted here rather than by the caller so the wording and the
   * clock come from one place — `invitation-email.ts` does the same, though it
   * hardcodes Europe/Lisbon because an invitation belongs to no site.
   */
  timezone: string;
  excursions: Excursion[];
  locale: string;
}

/**
 * "The water at <pool> is outside the recommended range" — slice 4.2.
 *
 * Email, because that is the transport that exists. Slice 3.0 builds the full
 * notification subsystem — records, preferences, push — on the same `sendEmail`
 * seam, and this becomes one channel of it rather than being rewritten. The
 * roadmap says so explicitly: 4.2 was the one slice that looked like it depended
 * on phase 3, and it does not.
 *
 * **In the organization's language, not the recipient's**, exactly as the
 * invitation and leave emails are. The reader's locale lives on `app_user` and
 * this is sent from a path that has no session — and a club that runs in
 * Portuguese writing to its own maintenance contact is overwhelmingly likely to
 * be writing to a Portuguese speaker.
 *
 * **Every number is in the message.** A subject line saying something is wrong
 * and a body saying "log in to see" is an email that costs somebody a journey to
 * a laptop before they know whether to drive to the pool. So each failed reading
 * arrives as its value, its unit, and the band it missed — which is also exactly
 * what the pool's own page says, because both are built from the same
 * `Excursion` list.
 *
 * **It does not tell anybody to close the pool.** The screen offers that and
 * only the operator knows whether a crossed band means "dose it and retest in an
 * hour" or "nobody swims today". The email reports; the decision stays where the
 * closure form is.
 *
 * The metric names are here rather than in the i18n catalogue for the reason
 * `vacation-email.ts` gives about its own copy: this file runs in the API, which
 * has no `next-intl` and no request locale. Two sets of Portuguese in the repo is
 * the cost of an email being sendable from a background path.
 */
interface Copy {
  subject: (pool: string) => string;
  intro: (facility: string, pool: string) => string;
  sampledAt: string;
  /** Both bounds are judged, so the sentence can name the whole range. */
  aboveRange: (from: number, to: number) => string;
  belowRange: (from: number, to: number) => string;
  /**
   * Only the bound that was crossed is judged — a pool with a ceiling and no
   * floor, which `pool_metric_range` allows and a real outdoor tank wants.
   * Naming a range here would mean inventing the other end.
   */
  aboveLimit: (to: number) => string;
  belowLimit: (from: number) => string;
  closing: string;
  signature: string;
  metric: Record<PoolMetric, string>;
}

const COPY: Record<'pt-PT' | 'en', Copy> = {
  'pt-PT': {
    subject: (pool: string) => `${pool}: água fora dos parâmetros`,
    intro: (facility: string, pool: string) =>
      `Uma análise à água registada em ${facility} indica que ${pool} está fora do intervalo recomendado:`,
    sampledAt: 'Amostra recolhida',
    aboveRange: (from: number, to: number) => `acima do intervalo ${from}–${to}`,
    belowRange: (from: number, to: number) => `abaixo do intervalo ${from}–${to}`,
    aboveLimit: (to: number) => `acima do máximo de ${to}`,
    belowLimit: (from: number) => `abaixo do mínimo de ${from}`,
    closing:
      'Confirme a leitura na página da piscina. O Poolse não fecha piscinas automaticamente — essa decisão é sua.',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse.',
    metric: {
      ph: 'pH',
      temperature: 'Temperatura',
      free_chlorine: 'Cloro livre',
      combined_chlorine: 'Cloro combinado',
      total_alkalinity: 'Alcalinidade total',
      calcium_hardness: 'Dureza cálcica',
      cyanuric_acid: 'Ácido cianúrico',
      turbidity: 'Turvação',
      salt: 'Sal',
    },
  },
  en: {
    subject: (pool: string) => `${pool}: water outside the recommended range`,
    intro: (facility: string, pool: string) =>
      `A water analysis recorded at ${facility} puts ${pool} outside the recommended range:`,
    sampledAt: 'Sample taken',
    aboveRange: (from: number, to: number) => `above the ${from}–${to} range`,
    belowRange: (from: number, to: number) => `below the ${from}–${to} range`,
    aboveLimit: (to: number) => `above the ${to} maximum`,
    belowLimit: (from: number) => `below the ${from} minimum`,
    closing:
      "Check the reading on the pool's page. Poolse never closes a pool by itself — that decision is yours.",
    signature: 'This message was sent automatically by Poolse.',
    metric: {
      ph: 'pH',
      temperature: 'Temperature',
      free_chlorine: 'Free chlorine',
      combined_chlorine: 'Combined chlorine',
      total_alkalinity: 'Total alkalinity',
      calcium_hardness: 'Calcium hardness',
      cyanuric_acid: 'Cyanuric acid',
      turbidity: 'Turbidity',
      salt: 'Salt',
    },
  },
};

function copyFor(locale: string): Copy {
  // Same fallback as the other two: anything that is not `en` is treated as the
  // default language rather than as an error, because a locale nobody
  // configured must not stop an alert from going out.
  return locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function waterAlertEmail(input: WaterAlertEmailInput): Email {
  const copy = copyFor(input.locale);

  const takenAt = new Intl.DateTimeFormat(
    input.locale.startsWith('en') ? 'en-GB' : 'pt-PT',
    { dateStyle: 'long', timeStyle: 'short', timeZone: input.timezone },
  ).format(input.takenAt);

  const line = (excursion: Excursion): string => {
    // The whole range where both ends are judged, the crossed bound alone where
    // they are not. `limit` is always a number — a reading cannot be above a
    // ceiling that does not exist — which is what keeps this a choice of
    // sentence rather than a null check.
    const bothJudged = excursion.from !== null && excursion.to !== null;

    const side =
      excursion.direction === 'high'
        ? bothJudged
          ? copy.aboveRange(excursion.from as number, excursion.limit)
          : copy.aboveLimit(excursion.limit)
        : bothJudged
          ? copy.belowRange(excursion.limit, excursion.to as number)
          : copy.belowLimit(excursion.limit);

    // pH is measured in pH. Printing both would read "pH: 8.4 pH", so the unit
    // is dropped where it is the name of the thing.
    const name = copy.metric[excursion.metric];
    const reading =
      excursion.unit === name ? `${excursion.value}` : `${excursion.value} ${excursion.unit}`;

    return `${name}: ${reading} — ${side}`;
  };

  const lines = input.excursions.map(line);

  const text = [
    copy.intro(input.facilityName, input.poolName),
    '',
    ...lines.map((one) => `• ${one}`),
    '',
    `${copy.sampledAt}: ${takenAt}`,
    '',
    copy.closing,
    '',
    copy.signature,
  ].join('\n');

  const html = [
    `<p>${escapeHtml(copy.intro(input.facilityName, input.poolName))}</p>`,
    '<ul>',
    ...lines.map((one) => `<li>${escapeHtml(one)}</li>`),
    '</ul>',
    `<p>${escapeHtml(copy.sampledAt)}: ${escapeHtml(takenAt)}</p>`,
    `<p>${escapeHtml(copy.closing)}</p>`,
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(copy.signature)}</p>`,
  ].join('\n');

  return {
    to: input.to,
    // One dash and then a colon: two em dashes in one subject line reads as a
    // mistake, and the club's name is the part a reader scans for first.
    subject: `${input.organizationName} — ${copy.subject(input.poolName)}`,
    text,
    html,
  };
}

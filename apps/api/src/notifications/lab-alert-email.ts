import type { LabFailure, Organism, PoolMetric } from '@poolse/rules';
import type { Email } from './notifier.js';

export interface LabAlertEmailInput {
  to: string;
  organizationName: string;
  facilityName: string;
  poolName: string;
  sampledAt: Date;
  /** The facility's timezone: the sample was taken there. */
  timezone: string;
  laboratory: string | null;
  failures: LabFailure[];
  locale: string;
}

/**
 * "The laboratory graded <pool> não conforme" — POOLSE-72.
 *
 * The same shape and the same rules as `water-alert-email.ts`: the club's
 * language, every number in the message, and no instruction to close the
 * pool — NP 4542 leaves that to the health authority and the operator, and the
 * email reports. Only the limit failures are listed: they are what made the
 * grade, and a recommended value exceeded alongside them is on the pool's page.
 *
 * The copy lives here rather than in the catalogue for the reason the water
 * alert gives: the API has no next-intl and this is sent with no session.
 */
interface Copy {
  subject: (pool: string) => string;
  intro: (facility: string, pool: string) => string;
  sampledAt: string;
  laboratory: string;
  above: (limit: number) => string;
  below: (limit: number) => string;
  closing: string;
  signature: string;
  parameter: Record<Organism | PoolMetric, string>;
}

const COPY: Record<'pt-PT' | 'en', Copy> = {
  'pt-PT': {
    subject: (pool) => `${pool}: análise laboratorial não conforme`,
    intro: (facility, pool) =>
      `Uma análise laboratorial registada em ${facility} classifica a água de ${pool} como não conforme (NP 4542:2017):`,
    sampledAt: 'Amostra recolhida',
    laboratory: 'Laboratório',
    above: (limit) => `acima do valor limite de ${limit}`,
    below: (limit) => `abaixo do valor limite de ${limit}`,
    closing:
      'Confirme o resultado na página da piscina. O Poolse não fecha piscinas automaticamente — essa decisão é sua e da autoridade de saúde.',
    signature: 'Esta mensagem foi enviada automaticamente pelo Poolse.',
    parameter: {
      colonies_37c: 'Colónias a 37 °C',
      total_coliforms: 'Bactérias coliformes',
      e_coli: 'Escherichia coli',
      enterococci: 'Enterococos',
      pseudomonas_aeruginosa: 'Pseudomonas aeruginosa',
      staphylococcus_coagulase_positive: 'Estafilococos produtores de coagulase',
      staphylococcus_total: 'Estafilococos totais',
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
    subject: (pool) => `${pool}: laboratory result not compliant`,
    intro: (facility, pool) =>
      `A laboratory result recorded at ${facility} grades the water in ${pool} as not compliant (NP 4542:2017):`,
    sampledAt: 'Sample taken',
    laboratory: 'Laboratory',
    above: (limit) => `above the limit of ${limit}`,
    below: (limit) => `below the limit of ${limit}`,
    closing:
      "Check the result on the pool's page. Poolse never closes a pool by itself — that decision is yours and the health authority's.",
    signature: 'This message was sent automatically by Poolse.',
    parameter: {
      colonies_37c: 'Colonies at 37 °C',
      total_coliforms: 'Coliform bacteria',
      e_coli: 'Escherichia coli',
      enterococci: 'Enterococci',
      pseudomonas_aeruginosa: 'Pseudomonas aeruginosa',
      staphylococcus_coagulase_positive: 'Coagulase-positive staphylococci',
      staphylococcus_total: 'Total staphylococci',
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** dd-MM-yyyy HH:mm in the facility's zone — the one date shape Poolse writes. */
function stamp(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts['day']}-${parts['month']}-${parts['year']} ${parts['hour']}:${parts['minute']}`;
}

export function labAlertEmail(input: LabAlertEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const when = stamp(input.sampledAt, input.timezone);
  const lines = input.failures
    .filter((failure) => failure.kind === 'limit')
    .map((failure) => {
      const bound = failure.direction === 'high' ? copy.above(failure.limit) : copy.below(failure.limit);
      return `${copy.parameter[failure.parameter]}: ${failure.value} ${failure.unit} — ${bound}`;
    });

  const header = [
    `${copy.sampledAt}: ${when}`,
    ...(input.laboratory ? [`${copy.laboratory}: ${input.laboratory}`] : []),
  ];

  const text = [
    copy.intro(input.facilityName, input.poolName),
    '',
    ...lines.map((line) => `- ${line}`),
    '',
    ...header,
    '',
    copy.closing,
    '',
    `— ${input.organizationName}`,
    copy.signature,
  ].join('\n');

  const html = [
    `<p>${escapeHtml(copy.intro(input.facilityName, input.poolName))}</p>`,
    `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    `<p>${header.map(escapeHtml).join('<br>')}</p>`,
    `<p>${escapeHtml(copy.closing)}</p>`,
    `<p>— ${escapeHtml(input.organizationName)}<br><small>${escapeHtml(copy.signature)}</small></p>`,
  ].join('\n');

  return { to: input.to, subject: copy.subject(input.poolName), text, html };
}

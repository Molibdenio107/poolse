import type { Email } from './notifier.js';

export interface PlatformAlertEmailInput {
  to: string;
  kind: 'denied' | 'write';
  /** The dotted machine key: `platform.denied`, `tenant.suspended`. */
  action: string;
  /** Who did it, as Clerk knows them. */
  clerkUserId: string;
  /** The club it was about, when there was one. */
  organizationName: string | null;
  organizationId: string | null;
  when: Date;
  /**
   * What moved, or what was asked for — the same shape the audit entry carries.
   * Column names to `{ before, after }` for a write; the refused path for a
   * denial.
   */
  detail: Record<string, unknown>;
}

/**
 * "Somebody was refused at `/admin`", or "somebody changed a club" — POOLSE-64.
 *
 * The ticket's own sentence for why this exists: **a trail nobody reads is not a
 * control**. `platform_audit_log` has recorded every platform request since the
 * area was built, and nothing has ever read it. The realistic risk on this side
 * of the product is not somebody breaking the guard — it is somebody becoming
 * Rui — and what catches that is a message arriving at an address they do not
 * hold, seconds after the act.
 *
 * **In Portuguese only, and that is the one place in this product where a single
 * language is right.** Every other email here is written in the *organization's*
 * language, because it is addressed to a club. This one is addressed to Poolse:
 * there is no organization whose locale to read — a refusal at the door names no
 * tenant at all — and the operator is one known person. Inventing a locale
 * lookup with no source, or defaulting to English in a product whose source
 * language is `pt-PT`, would both be worse than saying this plainly.
 *
 * **Every fact is in the message.** An alert saying "something happened, log in
 * to see" is an alert that costs a trip to a laptop before anybody knows whether
 * it matters — the same rule `water-alert-email.ts` follows. So the club, the
 * person, the moment and each column that moved arrive in the body.
 *
 * **No amounts, and none to filter out.** What a platform action writes is
 * dates, statuses and ceilings; the euros of a manual payment live in
 * `manual_payment` and never enter `changed`. `docs/financials.md` §9 is
 * satisfied by what is written rather than by a filter on the way out.
 */
export function platformAlertEmail(input: PlatformAlertEmailInput): Email {
  const club =
    input.organizationName ?? (input.organizationId === null ? null : input.organizationId);

  const subject =
    input.kind === 'denied'
      ? `Poolse · acesso recusado a /admin (${input.clerkUserId})`
      : `Poolse · ${club ?? 'plataforma'} — ${input.action}`;

  const heading =
    input.kind === 'denied'
      ? 'Alguém tentou entrar na área de administração da plataforma e foi recusado.'
      : 'Foi feita uma alteração a um cliente na área de administração da plataforma.';

  const facts: [string, string][] = [
    ['Quando', stamp(input.when)],
    ['Quem', input.clerkUserId],
    ['Ação', input.action],
    ...(club === null ? [] : ([['Cliente', club]] as [string, string][])),
  ];

  const changes = describe(input.detail);

  /*
   * The closing line is the only instruction, and it is deliberately not "click
   * here": a link in a security alert is the shape of the attack it warns about.
   * Somebody who did not do this should reach `/admin` the way they always do.
   */
  const closing =
    input.kind === 'denied'
      ? 'Se não foi você, confirme quem tem acesso em platform_admin e considere rodar as credenciais.'
      : 'Se não foi você, a sessão de administração da plataforma está comprometida.';

  const text = [
    heading,
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    ...(changes.length === 0 ? [] : ['', 'Alterações:', ...changes.map((line) => `  ${line}`)]),
    '',
    closing,
    '',
    'Esta mensagem foi enviada automaticamente pelo Poolse.',
  ].join('\n');

  const html = [
    `<p>${escapeHtml(heading)}</p>`,
    '<ul>',
    ...facts.map(
      ([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`,
    ),
    '</ul>',
    ...(changes.length === 0
      ? []
      : [
          '<p><strong>Alterações:</strong></p><ul>',
          ...changes.map((line) => `<li>${escapeHtml(line)}</li>`),
          '</ul>',
        ]),
    `<p>${escapeHtml(closing)}</p>`,
    '<p style="color:#6b7280;font-size:12px">Esta mensagem foi enviada automaticamente pelo Poolse.</p>',
  ].join('');

  return { to: input.to, subject, text, html };
}

/**
 * `suspended_at: — → 22-09-2026 21:04` — one line per column that moved.
 *
 * Reads the `changed` map a platform write records, and falls back to the raw
 * key/value for anything else (a denial carries a path, not a change). An
 * unrecognised shape is printed rather than dropped: this is a security alert,
 * and the one thing it must never do is quietly say less than it knows.
 */
function describe(detail: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(detail)) {
    if (key === 'changed' && isRecord(value)) {
      for (const [column, move] of Object.entries(value)) {
        if (isRecord(move) && 'before' in move && 'after' in move) {
          lines.push(`${column}: ${show(move['before'])} → ${show(move['after'])}`);
        } else {
          lines.push(`${column}: ${show(move)}`);
        }
      }
      continue;
    }

    lines.push(`${key}: ${show(value)}`);
  }

  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Null is a dash, not the word "null" — an empty column is a blank, not a value. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return isoStamp(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The product's one date shape, `dd-MM-yyyy`, applied to a value that may or may
 * not be a date.
 *
 * `lib/date-format.ts` owns that shape for the web app and cannot be imported
 * here — it is a Next module and this runs in the API, the same wall that gives
 * `water-alert-email.ts` its own copy of the Portuguese. What is shared is the
 * rule, written down in CLAUDE.md: one shape, hyphens, day first, in the club's
 * zone.
 */
function isoStamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) return value;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  // A bare `YYYY-MM-DD` is a *day* — parsed at midday above so no timezone can
  // push it onto the day before, which is the off-by-one this product has
  // already paid for once.
  return value.length === 10 ? stamp(parsed).slice(0, 10) : stamp(parsed);
}

const APP_TIME_ZONE = 'Europe/Lisbon';

/** `22-09-2026 21:04`, built from parts so no locale's separators can intrude. */
function stamp(when: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(when);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? '';

  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

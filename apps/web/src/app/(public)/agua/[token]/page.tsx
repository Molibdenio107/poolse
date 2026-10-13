import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createTranslator } from 'next-intl';
import { AlertTriangle, CheckCircle2, Minus } from 'lucide-react';
import { formatDate, formatTime } from '@/lib/date-format';
import { timeAgo } from '@/lib/relative-time';
import { fetchPublicWater, type PublicReading } from '@/lib/public-water';
import { cn } from '@/lib/utils';
import { LabGradeChip } from '@/components/lab-grade-chip';
import { PublicNotices } from '@/components/public-notices';
import pt from '@/messages/pt-PT.json';
import en from '@/messages/en.json';

/**
 * A tank's public water page — POOLSE-71.
 *
 * Opened by a QR at the entrance or shown all day on a lobby screen, by people
 * who are not users of Poolse. So: no login, no app shell, and nothing on it but
 * the site, the tank and the latest readings — the API's public endpoint returns
 * nothing else to show.
 *
 * **Every verdict is words and an icon**, never colour alone, and a reading more
 * than a day old says so: a good reading from last week is not a good reading.
 * The verdict and the staleness are the API's, decided once; this page renders
 * them.
 *
 * **Language** is `?lang=en`, else Portuguese. There is no session to remember a
 * choice in, and a printed QR should open in the club's language.
 *
 * **The lobby variant** is `?screen=1`: larger type, no links, and a refresh every
 * five minutes by `<meta http-equiv>` — no script to fail on a screen nobody is
 * watching.
 */

const REFRESH_SECONDS = 300;

export default async function PublicWaterPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string; screen?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const { lang, screen } = await searchParams;
  const locale = lang === 'en' ? 'en' : 'pt-PT';
  const lobby = screen === '1';
  const t = createTranslator({ locale, messages: locale === 'en' ? en : pt });

  /*
   * A blip is not a missing page — October 2026 sweep. A 5xx, a throttle or an
   * unreachable API used to throw to Next's error page, which has no refresh: a
   * lobby screen that hit one stayed on "Application error" until somebody
   * walked up to it. It now says so and, on a screen, tries again on its own.
   */
  let page: Awaited<ReturnType<typeof fetchPublicWater>>;
  try {
    page = await fetchPublicWater(token);
  } catch {
    return (
      <main
        lang={locale}
        className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-2 bg-background px-4 py-16 text-foreground"
      >
        {lobby && <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />}
        <h1 className="text-xl font-semibold">{t('publicWater.unavailable')}</h1>
        <p className="text-foreground-muted">{t('publicWater.unavailableHint')}</p>
      </main>
    );
  }
  if (page === null) notFound();

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const now = Date.now();

  const query = (next: Record<string, string | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ lang, screen, ...next })) {
      if (value !== undefined) search.set(key, value);
    }
    return search.size > 0 ? `?${search}` : '';
  };

  return (
    <main
      lang={locale}
      className={cn(
        'mx-auto flex min-h-screen w-full flex-col gap-6 bg-background px-4 py-8 text-foreground',
        lobby ? 'max-w-5xl text-xl' : 'max-w-2xl',
      )}
    >
      {lobby && <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />}

      <header className="flex flex-col gap-1">
        <p className={cn('text-foreground-muted', lobby ? 'text-2xl' : 'text-sm')}>
          {page.facilityName}
        </p>
        <h1 className={cn('font-semibold', lobby ? 'text-5xl' : 'text-2xl')}>{page.poolName}</h1>
        <p className={cn('text-foreground-muted', lobby ? 'text-xl' : 'text-sm')}>
          {t('publicWater.subtitle')}
        </p>
      </header>

      {page.readings.length === 0 ? (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('publicWater.noReadings')}</p>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.readings.map((reading) => (
            <ReadingRow
              key={reading.metric}
              reading={reading}
              lobby={lobby}
              label={t(`facilities.metric.${reading.metric}` as never)}
              value={`${number.format(reading.value)} ${reading.metric === 'ph' ? '' : reading.unit}`.trim()}
              band={bandText(reading, number, t)}
              verdict={t(`publicWater.state.${reading.state}` as never)}
              taken={t('publicWater.takenAt', {
                date: formatDate(reading.takenAt),
                time: formatTime(reading.takenAt),
              })}
              stale={
                reading.stale
                  ? t('publicWater.stale', { ago: timeAgo(reading.takenAt, locale, now) ?? '' })
                  : null
              }
            />
          ))}
        </ul>
      )}

      {/*
        The latest laboratory grade — POOLSE-72. The grade and the day and
        nothing else from the report; words and an icon, never colour alone.
      */}
      {page.lab !== null && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-4">
          <div className="flex flex-col gap-0.5">
            <span className={cn('font-medium', lobby && 'text-2xl')}>{t('publicWater.lab.title')}</span>
            <span className={cn('text-foreground-muted', lobby ? 'text-lg' : 'text-sm')}>
              {t('publicWater.lab.sampled', { date: formatDate(page.lab.sampledAt) })}
            </span>
          </div>
          <LabGradeChip
            grade={page.lab.grade}
            label={t(`labResults.grade.${page.lab.grade}` as never)}
            className={lobby ? 'text-xl' : undefined}
          />
        </section>
      )}

      {/* POOLSE-73: the complaints book and the rules in force, on every public page. */}
      <PublicNotices
        complaints={page.complaints}
        regulations={page.regulation === null ? [] : [page.regulation]}
        large={lobby}
        labels={{
          complaints: t('publicNotices.complaints'),
          complaintsPublic: t('publicNotices.complaintsPublic'),
          regulation: t('publicNotices.regulation'),
          effectiveFrom: (date) => t('publicNotices.effectiveFrom', { date }),
        }}
      />

      <footer
        className={cn(
          'mt-auto flex flex-wrap items-center justify-between gap-2 text-foreground-muted',
          lobby ? 'text-base' : 'text-sm',
        )}
      >
        <span>{t('publicWater.footer')}</span>
        {!lobby && (
          <Link
            href={`/agua/${token}${query({ lang: locale === 'en' ? undefined : 'en' })}`}
            className="underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('publicWater.otherLanguage')}
          </Link>
        )}
      </footer>
    </main>
  );
}

function bandText(
  reading: PublicReading,
  number: Intl.NumberFormat,
  t: (key: never, values?: Record<string, string>) => string,
): string | null {
  const band = reading.band;
  if (band === null) return null;
  if (band.from !== null && band.to !== null) {
    return t('publicWater.band.range' as never, {
      from: number.format(band.from),
      to: number.format(band.to),
    });
  }
  if (band.to !== null) return t('publicWater.band.max' as never, { to: number.format(band.to) });
  if (band.from !== null) {
    return t('publicWater.band.min' as never, { from: number.format(band.from) });
  }
  return null;
}

function ReadingRow({
  reading,
  lobby,
  label,
  value,
  band,
  verdict,
  taken,
  stale,
}: {
  reading: PublicReading;
  lobby: boolean;
  label: string;
  value: string;
  band: string | null;
  verdict: string;
  taken: string;
  stale: string | null;
}): React.ReactElement {
  const outside = reading.state === 'low' || reading.state === 'high';
  const Icon = reading.state === 'unjudged' ? Minus : outside ? AlertTriangle : CheckCircle2;

  return (
    <li
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded border bg-surface p-4',
        outside ? 'border-danger' : 'border-border',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className={cn('font-medium', lobby ? 'text-3xl' : 'text-lg')}>{label}</span>
        <span className="text-sm text-foreground-muted">{taken}</span>
        {stale !== null && <span className="text-sm font-medium text-warning">{stale}</span>}
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className={cn('font-semibold tabular-nums', lobby ? 'text-5xl' : 'text-2xl')}>
          {value}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-medium',
            outside ? 'text-danger' : reading.state === 'inside' ? 'text-success' : 'text-foreground-muted',
          )}
        >
          <Icon aria-hidden className="size-5" />
          {verdict}
        </span>
        {band !== null && <span className="text-sm text-foreground-muted">{band}</span>}
      </div>
    </li>
  );
}

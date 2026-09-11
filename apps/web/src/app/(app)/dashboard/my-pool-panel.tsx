import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import type { PoolDetail } from '@/lib/api';
import { excursions } from '@/lib/water';
import { excursionText } from '@/lib/excursion-text';
import { timeAgo } from '@/lib/relative-time';
import { withFrom } from '@/lib/back';

/**
 * "A minha piscina" — the personal tenant's dashboard, slice 4.5.
 *
 * A club opens Poolse asking how much of the water is sold; a person with a
 * pool in the garden opens it asking whether the water is all right. This is
 * that answer in one card: the latest reading of each metric, judged against
 * the bands *this* pool is held to, and when the sample was taken. The whole
 * record, the charts, the ranges and the entry form stay on the pool's own
 * page, one click away — a dashboard that could record an analysis is a
 * dashboard somebody types into by accident.
 *
 * Every judgement here is the pool page's, not a second one: `excursions` from
 * `@poolse/rules` against the API's resolved `bands`, exactly as the readings
 * block and the alert email do. The icon and the sentence go together — colour
 * never carries the meaning alone.
 *
 * One card per pool, because nothing stops a personal tenant adding a second
 * tank and a jacuzzi is a pool with a very short band on temperature.
 */
export async function MyPoolPanel({ pool }: { pool: PoolDetail }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();

  const latest = pool.analyses[pool.analyses.length - 1];
  const bad = latest === undefined ? [] : excursions(latest.values, pool.bands);
  const badFor = (metric: string) => bad.find((excursion) => excursion.metric === metric);
  const href = withFrom(`/dashboard/facilities/pools/${pool.id}`, '/dashboard');

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {pool.name}
        </h2>
        {latest !== undefined && (
          <p className="text-sm text-foreground-muted">
            {t('dashboard.lastAnalysis', {
              when: format.dateTime(new Date(latest.takenAt), 'stamp'),
              ago: timeAgo(latest.takenAt, locale) ?? '',
            })}
          </p>
        )}
      </div>

      {latest === undefined ? (
        <p className="text-sm text-foreground-muted">{t('dashboard.noAnalysisYet')}</p>
      ) : (
        <>
          {/*
            Judged, not just shown. A tile that only said "7.9" would leave the
            reader to remember the band; the pool page's tiles do exactly that,
            and this card exists to save the click.
          */}
          <dl className="grid gap-3 sm:grid-cols-3">
            {latest.values.map((value) => {
              const excursion = badFor(value.metric);
              const text = excursion === undefined ? null : excursionText(excursion);
              const judged = pool.bands[value.metric] !== undefined;
              return (
                <div
                  key={value.metric}
                  className="flex flex-col gap-0.5 rounded border border-border p-3"
                >
                  <dt className="text-sm text-foreground-muted">
                    {t(`facilities.metric.${value.metric}`)}
                  </dt>
                  <dd className="text-lg font-medium">
                    {value.value}{' '}
                    <span className="text-sm font-normal text-foreground-muted">{value.unit}</span>
                  </dd>
                  {excursion !== undefined && text !== null ? (
                    <dd className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      {t(text.key, text.values)}
                    </dd>
                  ) : judged ? (
                    <dd className="inline-flex items-center gap-1 text-xs font-medium text-success">
                      <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
                      {t('dashboard.inRange')}
                    </dd>
                  ) : (
                    // A metric the pool does not judge says so, rather than
                    // looking like one that happens to be fine.
                    <dd className="text-xs text-foreground-muted">{t('dashboard.notJudged')}</dd>
                  )}
                </div>
              );
            })}
          </dl>

          {bad.length > 0 && (
            <p className="text-sm text-warning">{t('dashboard.outOfRange', { count: bad.length })}</p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href={href}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {latest === undefined
            ? t('facilities.recordAnalysisTitle')
            : t('dashboard.openPool')}
        </Link>
      </div>
    </section>
  );
}

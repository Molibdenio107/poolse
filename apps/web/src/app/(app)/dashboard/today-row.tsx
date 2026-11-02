'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { OccupancyTodayWidgetData, RecintosWidgetData, TodayLesson } from '@/lib/api';
import { formatReading } from '@/lib/pool-metrics';
import { cn } from '@/lib/utils';
import { HourChart } from './hour-chart';

const TANK_TONE: Record<RecintosWidgetData['pools'][number]['state'], BadgeTone> = {
  ok: 'ok',
  warn: 'late',
  due: 'pending',
  none: 'muted',
};

const inHour = (lessons: TodayLesson[], hour: number): TodayLesson[] =>
  lessons.filter((lesson) => lesson.startMin < (hour + 1) * 60 && lesson.endMin > hour * 60);

/**
 * *Hoje, hora a hora* beside *Recintos · estado agora* — one row that shares
 * the hour somebody opened (Rui, 02-11-2026): opening a bar lists that hour's
 * lessons on the left and, on the right, how many people are in each tank in
 * that hour, beside its water. Both counts come from the same lessons the bar
 * counts, so the three never disagree.
 */
export function TodayRow({
  today,
  todayShown,
  todayFailed,
  recintos,
  recintosShown,
  recintosFailed,
}: {
  today: OccupancyTodayWidgetData | null;
  todayShown: boolean;
  todayFailed: boolean;
  recintos: RecintosWidgetData | null;
  recintosShown: boolean;
  recintosFailed: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  const lessons = today?.lessons ?? [];
  const hourLessons = open === null ? [] : inHour(lessons, open);
  const hourLabel = open === null ? '' : String(open).padStart(2, '0');

  return (
    <div className="grid grid-cols-1 gap-page-gap lg:grid-cols-3">
      {todayShown && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card lg:col-span-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('dashboard.summary.byHour')}
          </h3>
          {today === null ? (
            <p className="text-sm text-foreground-muted">
              {todayFailed ? t('dashboard.widgetFailed') : t('dashboard.summary.noLessons')}
            </p>
          ) : (
            <HourChart
              hours={today.hours}
              nowHour={today.nowHour}
              lessons={lessons}
              swimmers={today.swimmers}
              open={open}
              onOpen={setOpen}
            />
          )}
        </section>
      )}
      {recintosShown && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {open === null ? t('dashboard.summary.recintos') : t('dashboard.summary.recintosAt', { hour: hourLabel })}
          </h3>
          {recintos === null ? (
            <p className="text-sm text-foreground-muted">
              {recintosFailed ? t('dashboard.widgetFailed') : t('dashboard.summary.noTanks')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recintos.pools.map((pool) => {
                const here = hourLessons.filter((lesson) => lesson.poolId === pool.poolId);
                const people = here.reduce((sum, lesson) => sum + lesson.swimmers, 0);
                return (
                  <li key={pool.poolId} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <FromLink
                        href={`/dashboard/facilities/pools/${pool.poolId}?tab=water`}
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {pool.poolName}
                      </FromLink>
                      <Badge tone={TANK_TONE[pool.state]}>{t(`dashboard.summary.tank.${pool.state}`)}</Badge>
                    </span>
                    {open !== null && (
                      <span className="text-sm">
                        {people === 0
                          ? t('dashboard.summary.tankEmptyAt', { hour: hourLabel })
                          : t('dashboard.summary.tankPeopleAt', { count: people, lessons: here.length, hour: hourLabel })}
                      </span>
                    )}
                    {pool.readings.length > 0 && (
                      <span className="font-mono text-xs tabular-nums text-foreground-muted">
                        {pool.readings.map((reading, index) => (
                          <span key={reading.metric} className={cn(reading.out && 'font-semibold text-warning')}>
                            {index > 0 && ' · '}
                            {t(`facilities.metric.${reading.metric}`)} {formatReading(reading.value, locale)}
                            {reading.unit === '' || reading.unit === 'pH' ? '' : ` ${reading.unit}`}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {open !== null && hourLessons.some((lesson) => lesson.poolId === null) && (
            <p className="text-xs text-foreground-muted">{t('dashboard.summary.noTankLessons')}</p>
          )}
        </section>
      )}
    </div>
  );
}

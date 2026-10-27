import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, Droplets, Package, Plus, SprayCan, Wrench } from 'lucide-react';
import { apiFetch, type MaintenanceHome } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { timeAgo } from '@/lib/relative-time';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { OneTap } from './one-tap';
import { PushCard } from '../push-card';

/**
 * The maintenance home — POOLSE-90 slice 3. A to-do list over every site:
 * due tasks (mine or nobody's), Espaços overdue for cleaning and open avarias
 * and reposições, each the server's answer and never recomputed here. *Limpo*
 * and *Concluir* are one tap on the backoffice's own endpoints; *Reportar* is a
 * short form; *Registar análise* opens the pool's water tab, the one place an
 * analysis is recorded — a second copy of that form would be a second form to
 * keep in step.
 */
export default async function MaintenanceHomePage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  let home: MaintenanceHome;
  try {
    home = await apiFetch<MaintenanceHome>('/app/maintenance');
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const nothing = home.tasks.length === 0 && home.overdueSpaces.length === 0 && home.issues.length === 0;
  const card = 'flex flex-col gap-2 rounded-lg border border-border bg-surface p-3';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{t('app.maintenance.title')}</h1>
        <Link
          href="/app/manutencao/reportar"
          className="inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-4 text-control font-medium hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Plus className="size-4" aria-hidden />
          {t('app.maintenance.report')}
          <LinkBusy />
        </Link>
      </div>

      {nothing && (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('app.maintenance.allDone')}
        </p>
      )}

      {home.tasks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Wrench className="size-4" aria-hidden />
            {t('app.maintenance.tasks', { count: home.tasks.length })}
          </h2>
          <ul className="flex flex-col gap-2">
            {home.tasks.map((task) => (
              <li key={task.id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{task.title}</span>
                    <span className="text-sm text-foreground-muted">
                      {[task.facilityName, task.spaceName ?? task.poolName ?? task.inventoryItemName]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="text-sm font-medium text-warning">
                      {task.lastDoneAt === null
                        ? t('app.maintenance.neverDone')
                        : task.daysOverdue > 0
                          ? t('app.maintenance.daysLate', { days: task.daysOverdue })
                          : t('app.maintenance.dueToday')}
                    </span>
                  </div>
                  <OneTap kind="complete" id={task.id} label={t('app.maintenance.completeNamed', { name: task.title })} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.overdueSpaces.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <SprayCan className="size-4" aria-hidden />
            {t('app.maintenance.toClean', { count: home.overdueSpaces.length })}
          </h2>
          <ul className="flex flex-col gap-2">
            {home.overdueSpaces.map((space) => (
              <li key={space.id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{space.name}</span>
                    <span className="text-sm text-foreground-muted">{space.facilityName}</span>
                    <span className="text-sm font-medium text-warning">
                      {space.lastCleanedAt === null
                        ? t('app.maintenance.neverCleaned')
                        : t('app.maintenance.lastCleaned', { ago: timeAgo(space.lastCleanedAt, locale) ?? '' })}
                    </span>
                  </div>
                  <OneTap kind="clean" id={space.id} label={t('app.maintenance.cleanNamed', { name: space.name })} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.issues.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            {t('app.maintenance.issues', { count: home.issues.length })}
          </h2>
          <ul className="flex flex-col gap-2">
            {home.issues.map((issue) => (
              <li key={issue.id} className={card}>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {issue.type === 'fault' ? (
                    <Wrench className="size-3.5" aria-hidden />
                  ) : (
                    <Package className="size-3.5" aria-hidden />
                  )}
                  {t(`spaces.issueType.${issue.type}`)}
                  {' · '}
                  {t('spaces.severity.chip', { severity: t(`spaces.severity.${issue.severity}`) })}
                </span>
                <span>{issue.description}</span>
                <span className="text-sm text-foreground-muted">
                  {[issue.facilityName, issue.spaceName ?? issue.poolName, timeAgo(issue.reportedAt, locale)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.pools.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Droplets className="size-4" aria-hidden />
            {t('app.maintenance.analysis')}
          </h2>
          <ul className="flex flex-col gap-2">
            {home.pools.map((pool) => (
              <li key={pool.id}>
                <Link
                  href={`/dashboard/facilities/pools/${pool.id}?tab=water&from=${encodeURIComponent('/app/manutencao')}`}
                  className="flex min-h-control items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{pool.name}</span>
                    <span className="text-sm text-foreground-muted">{pool.facilityName}</span>
                  </span>
                  <span className="text-sm font-medium text-primary">{t('app.maintenance.recordAnalysis')}</span>
                  <LinkBusy />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PushCard />
    </>
  );
}

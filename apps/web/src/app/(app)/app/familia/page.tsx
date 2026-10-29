import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppAgenda, type AppAgendaEntry, type FamilyLeave } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { FamilyCertificates } from './certificates';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { cn } from '@/lib/utils';
import { EntryCard, FeeStatus, dayHeading } from './agenda-parts';
import { RecentLessons } from './feedback';
import { PushCard } from '../push-card';
import { UserPlus } from 'lucide-react';

/**
 * The family agenda — POOLSE-90 slice 1 (roadmap 3.3 and 3.6).
 *
 * The answer to "is there class, when, where, is the water warm, are we up to
 * date", for every child the reader is a guardian of — or the reader, on the
 * adult path — in one list by day, two weeks ahead, each entry naming its child.
 * A child filter narrows it (`?child=`; a stranger's id is the API's 404).
 * Coming lessons only (Rui, Open 1) — and, under them, *Últimas aulas*: the
 * ones attended in the last week, to say how they went (POOLSE-116).
 */
export default async function FamilyAgenda({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child } = await searchParams;
  const query = child === undefined ? '' : `?child=${encodeURIComponent(child)}`;

  let agenda: AppAgenda;
  try {
    agenda = await apiFetch<AppAgenda>(`/app/agenda${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // Best-effort: a failed read of the leaves says so and costs the agenda nothing.
  const leaves = await outcome(apiFetch<{ leaves: FamilyLeave[] }>('/app/medical-leave'));
  const storageReady = await storageConfigured();

  const several = agenda.children.length > 1;
  const nameOf = new Map(agenda.children.map((one) => [one.id, one.name]));
  const water = new Map(agenda.water.map((one) => [one.poolId, one]));
  const byDay = new Map<string, AppAgendaEntry[]>();
  for (const entry of agenda.entries) {
    byDay.set(entry.localDate, [...(byDay.get(entry.localDate) ?? []), entry]);
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.family.title')}</h1>

      {agenda.children.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('app.family.nobody')}
        </p>
      ) : (
        <>
          {several && (
            <nav aria-label={t('app.family.childFilter')} className="flex flex-wrap gap-2">
              {[{ id: undefined, name: t('app.family.everyone') }, ...agenda.children].map((one) => {
                const chosen = one.id === child;
                return (
                  <Link
                    key={one.id ?? 'all'}
                    href={one.id === undefined ? '/app/familia' : `/app/familia?child=${one.id}`}
                    aria-current={chosen ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-control items-center justify-center rounded-full border px-4 text-control',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
                    )}
                  >
                    {one.name}
                    <LinkBusy />
                  </Link>
                );
              })}
            </nav>
          )}

          <FeeStatus children={agenda.children} />

          {leaves.state === 'ok' ? (
            <FamilyCertificates
              leaves={leaves.data.leaves.filter((leave) => child === undefined || leave.studentId === child)}
              names={several ? nameOf : null}
              storageReady={storageReady}
            />
          ) : leaves.state === 'failed' ? (
            <PageError message={t('app.family.certificatesFailed')} />
          ) : null}

          {agenda.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
              {t('app.family.empty')}
            </p>
          ) : (
            [...byDay.entries()].map(([date, entries]) => (
              <section key={date} className="flex flex-col gap-2">
                <h2 className="text-base font-semibold">{dayHeading(t, date)}</h2>
                <ul className="flex flex-col gap-2">
                  {entries.map((entry) => (
                    <li key={`${entry.sessionId}-${entry.studentId}`}>
                      <EntryCard
                        entry={entry}
                        childName={several && child === undefined ? (nameOf.get(entry.studentId) ?? null) : null}
                        water={entry.poolId === null ? null : (water.get(entry.poolId) ?? null)}
                        href={`/app/familia/aulas/${entry.sessionId}`}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          <RecentLessons recent={agenda.recent} names={several && child === undefined ? nameOf : null} />
        </>
      )}

      {/* POOLSE-121: ask the club for a place in a class, for a child or a new one. */}
      <Link
        href="/app/familia/inscrever"
        className="flex min-h-control items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-control font-medium hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex items-center gap-2">
          <UserPlus className="size-4 text-primary" aria-hidden />
          {t('app.join.open')}
        </span>
        <LinkBusy />
      </Link>

      <PushCard />
    </>
  );
}

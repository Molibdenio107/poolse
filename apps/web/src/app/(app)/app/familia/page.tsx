import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppAgenda, type AppAgendaEntry } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { EntryCard, dayHeading } from './agenda-parts';
import { ChildFilter } from './child-filter';
import { PersonAvatar } from '@/components/person-avatar';
import { ChevronRight, UserPlus } from 'lucide-react';

/**
 * The family agenda — POOLSE-90 slice 1 (roadmap 3.3 and 3.6).
 *
 * The answer to "is there class, when, where, is the water warm, are we up to
 * date", for every child the reader is a guardian of — or the reader, on the
 * adult path — in one list by day, two weeks ahead, each entry naming its child.
 * A child filter narrows it (`?child=`; a stranger's id is the API's 404).
 * Coming lessons only (Rui, Open 1).
 *
 * *Início* since POOLSE-136: a card per child with the next lesson, then the
 * coming lessons as rows. Fees moved to *Pagamentos*, past lessons and
 * certificates to *Aulas*, the push switch to *Perfil* — one task per screen.
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

  const several = agenda.children.length > 1;
  const nameOf = new Map(agenda.children.map((one) => [one.id, one.name]));
  const water = new Map(agenda.water.map((one) => [one.poolId, one]));
  const byDay = new Map<string, AppAgendaEntry[]>();
  for (const entry of agenda.entries) {
    byDay.set(entry.localDate, [...(byDay.get(entry.localDate) ?? []), entry]);
  }

  return (
    <>
      <h1>{t('app.tabs.familia.inicio')}</h1>

      {agenda.children.length === 0 ? (
        <p className="text-foreground-muted">{t('app.family.nobody')}</p>
      ) : (
        <>
          <ChildFilter base="/app/familia" children={agenda.children} chosen={child} />

          {/* The handoff's child cards: each child and their next lesson, one tap to them alone. */}
          {child === undefined && (
            <ul className="flex flex-col gap-2">
              {agenda.children.map((one) => {
                const next = agenda.entries.find((entry) => entry.studentId === one.id && entry.status !== 'cancelled');
                const body = (
                  <>
                    {/* The handoff's child card (POOLSE-140): a 44 px avatar, the name at 700. */}
                    <PersonAvatar id={one.id} name={one.name} className="size-11 text-sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="app-card-name font-bold">{one.name}</span>
                      <span className="app-secondary text-sm text-foreground-muted">
                        {next === undefined
                          ? t('app.family.noNext')
                          : t('app.family.next', {
                              when: `${dayHeading(t, next.localDate)} · ${next.localTime}`,
                              name: next.className,
                            })}
                      </span>
                    </span>
                    {several && <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />}
                  </>
                );
                const card = 'flex min-h-[64px] items-center gap-3 rounded bg-surface px-4 py-3 shadow-card';
                return (
                  <li key={one.id}>
                    {several ? (
                      <Link
                        href={`/app/familia?child=${one.id}`}
                        className={`${card} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
                      >
                        {body}
                        <LinkBusy />
                      </Link>
                    ) : (
                      <div className={card}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {agenda.entries.length === 0 ? (
            <p className="text-foreground-muted">{t('app.family.empty')}</p>
          ) : (
            [...byDay.entries()].map(([date, entries]) => (
              <section key={date} className="flex flex-col">
                <h2 className="app-section-label">{dayHeading(t, date)}</h2>
                {/* Rows, not cards (rule 6): edge to edge, a hairline between. */}
                <ul className="flex flex-col divide-y divide-border">
                  {entries.map((entry) => (
                    <li key={`${entry.sessionId}-${entry.studentId}`}>
                      <EntryCard
                        entry={entry}
                        childName={several && child === undefined ? (nameOf.get(entry.studentId) ?? null) : null}
                        water={entry.poolId === null ? null : (water.get(entry.poolId) ?? null)}
                        href={`/app/familia/aulas/${entry.sessionId}`}
                        row
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      {/* POOLSE-121: ask the club for a place in a class, for a child or a new one. */}
      <Link
        href="/app/familia/inscrever"
        className="flex min-h-control items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card text-control font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex items-center gap-2">
          <UserPlus className="size-4 text-primary" aria-hidden />
          {t('app.join.open')}
        </span>
        <LinkBusy />
      </Link>
    </>
  );
}

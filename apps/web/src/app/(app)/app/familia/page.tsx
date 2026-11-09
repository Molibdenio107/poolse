import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppAgenda, type AppAviso } from '@/lib/api';
import { FamilyAvisos } from './avisos';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { ChildFilter } from './child-filter';
import { NextLessonHero } from '@/components/app/next-lesson-hero';
import { RecentLessons } from './feedback';
import { CalendarPlus } from 'lucide-react';

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
 *
 * Since POOLSE-174 the card is `NextLessonHero`, which opens the lesson, and
 * since POOLSE-175 the coming lessons as rows are *Aulas*.
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
  // POOLSE-166: the club's live avisos — best effort, never the reason Início fails
  // (the messages module off answers 403, which is simply none).
  const avisos = apiFetch<{ avisos: AppAviso[] }>('/app/avisos')
    .then((answer) => answer.avisos)
    .catch(() => [] as AppAviso[]);
  try {
    agenda = await apiFetch<AppAgenda>(`/app/agenda${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const shown = child === undefined ? agenda.children : agenda.children.filter((one) => one.id === child);
  const water = new Map(agenda.water.map((one) => [one.poolId, one]));

  return (
    <>
      <h1>{t('app.tabs.familia.inicio')}</h1>

      <FamilyAvisos avisos={await avisos} />

      {agenda.children.length === 0 ? (
        <p className="text-foreground-muted">{t('app.family.nobody')}</p>
      ) : (
        <>
          <ChildFilter base="/app/familia" children={agenda.children} chosen={child} />

          {/* POOLSE-174: the next lesson for each child. The calendar is *Aulas* (POOLSE-175). */}
          <ul className="flex flex-col gap-3">
            {shown.map((one) => {
              const own = agenda.entries.filter((entry) => entry.studentId === one.id);
              const next = own.find((entry) => entry.status !== 'cancelled');
              return (
                <li key={one.id}>
                  <NextLessonHero
                    child={one}
                    entries={own}
                    water={next?.poolId == null ? null : (water.get(next.poolId) ?? null)}
                    from={child === undefined ? '/app/familia' : `/app/familia?child=${child}`}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Past lessons sit here, where a family gives feedback (Rui, 06-11-2026). */}
      {await RecentLessons({
        recent: agenda.recent,
        names: agenda.children.length > 1 && child === undefined ? new Map(agenda.children.map((one) => [one.id, one.name])) : null,
        from: child === undefined ? '/app/familia' : `/app/familia?child=${child}`,
      })}

      {/*
        POOLSE-121: ask the club for a place in a class. It lives as a
        row under *Perfil › + Natação* now (Rui, 09-11-2026), and comes back here only for a family with no
        lesson coming (the agenda's two weeks): the moment it is the main thing to do.
      */}
      {agenda.entries.every((entry) => entry.status === 'cancelled') && (
      <Link
        href="/app/familia/inscrever"
        className="flex min-h-control items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card text-control font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex items-center gap-2">
          <CalendarPlus className="size-4 text-primary" aria-hidden />
          {t('app.join.open')}
        </span>
        <LinkBusy />
      </Link>
      )}
    </>
  );
}

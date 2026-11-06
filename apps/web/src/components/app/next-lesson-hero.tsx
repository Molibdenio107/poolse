import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronRight, Lock } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { Classmates } from '@/components/app/classmates';
import { PersonAvatar } from '@/components/person-avatar';
import { apiFetch, type AppAgendaEntry, type AppChild, type AppClassmates, type AppWater } from '@/lib/api';
import { photoUrlFor } from '@/lib/photo';
import { withFrom } from '@/lib/back';
import { formatDate, formatDayMonth } from '@/lib/date-format';
import { FeeSentence, WaterLine, endTime } from '@/app/(app)/app/familia/agenda-parts';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Início* is the next lesson — POOLSE-174. One per child: the first coming
 * lesson that is not cancelled, the water at its tank, and the fee line.
 *
 * **The hero is the lesson's link, for one child or several**; the chips above
 * are what narrow the list. The fee line sits beneath it as a link of its own,
 * because a link cannot hold a link, and it is the only money on *Início*.
 *
 * With nothing coming there is no link and no fill: the card says so, and says
 * until when if a closure is why.
 */
export async function NextLessonHero({
  child,
  entries,
  water,
  from,
}: {
  child: AppChild;
  /** This child's coming lessons, soonest first. */
  entries: AppAgendaEntry[];
  water: AppWater | null;
  /** Where *Voltar* on the lesson comes back to. */
  from: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const next = entries.find((entry) => entry.status !== 'cancelled');
  const closure = entries.find((entry) => entry.byClosure && entry.closedUntil !== null);
  const photo = photoUrlFor(child.photoFileId ?? null);
  // Best effort: the hero still says the lesson if this read fails.
  const people =
    next === undefined
      ? null
      : await apiFetch<AppClassmates>(`/app/lessons/${next.sessionId}/classmates`).catch(() => null);

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-hero)] shadow-card">
      {next === undefined ? (
        <div className="flex items-center gap-3 bg-surface p-4">
          <PersonAvatar id={child.id} name={child.name} photoUrl={photo} className="size-11 text-sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="app-card-name font-bold">{child.name}</span>
            {closure === undefined ? (
              <span className="text-sm text-foreground-muted">{t('app.family.hero.nothing')}</span>
            ) : (
              <span className="flex items-center gap-1 text-sm font-medium text-warning">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                {t('app.family.hero.closedUntil', { date: formatDate(closure.closedUntil!) })}
              </span>
            )}
          </span>
        </div>
      ) : (
        <Link
          href={withFrom(`/app/familia/aulas/${next.sessionId}`, from)}
          className={`app-hero flex flex-col gap-3 bg-primary p-4 text-primary-foreground ${FOCUS}`}
        >
          <span className="flex items-center gap-3">
            {/* On the card's own colour: the avatar's tint is a wash, and the fill would swallow it. */}
            <span className="shrink-0 rounded-full bg-surface">
              <PersonAvatar id={child.id} name={child.name} photoUrl={photo} className="size-11 text-sm" />
            </span>
            <span className="app-card-name min-w-0 flex-1 font-bold">{child.name}</span>
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-xl font-bold tracking-tight">{formatDayMonth(next.localDate, locale)}</span>
            <span className="font-semibold tabular-nums">
              {next.localTime} – {endTime(next.localTime, next.durationMinutes)}
            </span>
            <span>{[next.className, next.poolName].filter(Boolean).join(' · ')}</span>
          </span>
          {water !== null && <WaterLine water={water} />}
          {/* What the family already told the club, which left *Início* with the rows. */}
          {next.going !== null && (
            <span className="text-sm font-medium">
              {next.going ? t('app.notice.saidGoing') : t('app.notice.saidNotGoing')}
            </span>
          )}
          <LinkBusy />
        </Link>
      )}

      {/* Outside the link: a link cannot hold the buttons that open a photo. */}
      {people !== null && <Classmates data={people} collapse />}

      {child.fees !== null && (
        <Link
          href="/app/familia/pagamentos"
          className={`flex min-h-control items-center justify-between gap-3 bg-surface px-4 py-2 ${FOCUS}`}
        >
          <FeeSentence fees={child.fees} />
          <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}
    </div>
  );
}

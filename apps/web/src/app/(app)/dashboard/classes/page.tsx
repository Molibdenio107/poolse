import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Classes } from '@/lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';

/**
 * The whole week, and who is in it.
 *
 * Deliberately a *timetable* and not a calendar, and the subtitle says so. It
 * shows "Tuesdays at 18:00", not "Tuesday 15 December", because until closures
 * and session generation exist (1.5 and 1.6) nothing here knows the pool shuts
 * in August. A grid that looked like a calendar while showing a class on
 * Christmas Day would be worse than one that is honest about what it is.
 */
export default async function ClassesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Classes | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Classes>('/class-groups');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const dayNames = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)]),
  );

  // One entry per slot per turma: a turma running Tuesday and Thursday appears
  // in both columns, which is what a week looks like.
  const entries: WeekEntry[] = (data?.groups ?? []).flatMap((group) =>
    group.schedules.map((slot) => ({
      key: slot.id,
      weekday: slot.weekday,
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      title: group.name,
      subtitle: [group.poolName, group.lane === null ? null : t('classes.laneN', { lane: group.lane })]
        .filter(Boolean)
        .join(' · '),
      people: group.students
        .filter((student) => student.status === 'active')
        .map((student) => `${student.firstName} ${student.lastName}`),
      href: `/dashboard/classes/${group.id}`,
    })),
  );

  const unscheduled = (data?.groups ?? []).filter((group) => group.schedules.length === 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('classes.title')}</h1>
          <p className="text-foreground-muted">{t('classes.subtitle')}</p>
        </div>
      </header>

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
        <>
          {data.canManage && (
            <Link
              href="/dashboard/classes/new"
              className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              {t('classes.create')}
            </Link>
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('classes.week')}
              </h2>
              <p className="text-sm text-foreground-muted">{t('classes.weekHint')}</p>
            </div>

            <WeekGrid entries={entries} dayNames={dayNames} emptyLabel={t('classes.noSlots')} />
          </section>

          {unscheduled.length > 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('classes.unscheduled')}
              </h2>
              <p className="mb-4 text-sm text-foreground-muted">{t('classes.unscheduledHint')}</p>
              <ul className="flex flex-col gap-2">
                {unscheduled.map((group) => (
                  <li key={group.id}>
                    <Link
                      href={`/dashboard/classes/${group.id}`}
                      className="text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.groups.length === 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <p>{t('classes.none')}</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {data.canManage ? t('classes.noneHintManager') : t('classes.noneHintMember')}
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

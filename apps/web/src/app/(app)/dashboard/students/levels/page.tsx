import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import Link from 'next/link';
import { ApiError, apiFetch, type Students, type StudentLevel } from '../../../../../lib/api';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CreateLevelForm } from './level-forms';
import { LevelList } from './level-list';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * The progression an operator puts their students through.
 *
 * A separate page from the register because it is set up once and then rarely
 * touched, and putting it on the students screen would give the daily job a
 * settings panel it does not need. Reached by a link from there.
 */
/**
 * The ladder in age order — round 5.
 *
 * A *reading* of the ladder, not the ladder: the club's own order is what the
 * grip writes, and this leaves it alone. Escalões with no range at all sort
 * last, because "not decided" is not an age and putting them at nought would
 * claim they were for newborns.
 */
function byAge(levels: StudentLevel[]): StudentLevel[] {
  return [...levels].sort((a, b) => {
    const unset = (level: StudentLevel): number =>
      level.minAgeMonths === null && level.maxAgeMonths === null ? 1 : 0;
    if (unset(a) !== unset(b)) return unset(a) - unset(b);

    const from = (level: StudentLevel): number => level.minAgeMonths ?? 0;
    const to = (level: StudentLevel): number => level.maxAgeMonths ?? 1440;
    return from(a) - from(b) || to(a) - to(b) || a.name.localeCompare(b.name);
  });
}

export default async function LevelsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const byAgeOrder = (await searchParams).sort === 'age';

  let data: Students | null = null;
  let failure: LoadFailure | null = null;

  try {
    data = await apiFetch<Students>('/students');
  } catch (error) {
    failure = describeLoad(error);
  }

  const all = data?.levels ?? [];
  const levels = byAgeOrder ? byAge(all) : all;

  return (
    <PageShell
      title={t('students.levels')}
      subtitle={t('students.levelsSubtitle')}
      back={{ href: "/dashboard/students", label: t('students.backToRegister') }}
    >


      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && (
        <>
          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
          )}

          {/*
            Folded, and above the ladder — round 5.

            A club sets its progression up once a season and then reads it all
            year, so an always-open form pushed the thing people actually came
            for below the fold. `<details>` rather than a state hook because it
            is the browser's own disclosure: keyboard-operable, announced as a
            disclosure to a screen reader, and it works before any JavaScript
            arrives. At the top rather than the bottom because "add" belongs
            where the list starts, not after a scroll past twelve levels.
          */}
          {data.canManage && (
            <details className="group rounded border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-sm font-medium uppercase tracking-wider text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <ChevronRight
                  aria-hidden
                  className="size-4 transition-transform group-open:rotate-90"
                />
                {t('students.addLevel')}
              </summary>
              <div className="border-t border-border p-5">
                <CreateLevelForm organizationId={data.organizationId} levels={all} />
              </div>
            </details>
          )}

          {/*
            Two readings of the same ladder, in the URL rather than in a hook —
            it survives a refresh and can be sent to a colleague, like every
            other sort in this app.
          */}
          {levels.length > 0 && (
            <nav className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/students/levels"
                aria-current={byAgeOrder ? undefined : 'true'}
                className={cn(
                  'rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  byAgeOrder
                    ? 'border-border hover:bg-surface-muted'
                    : 'border-primary bg-primary/10 text-primary',
                )}
              >
                {t('students.sortByLadder')}
              </Link>
              <Link
                href="/dashboard/students/levels?sort=age"
                aria-current={byAgeOrder ? 'true' : undefined}
                className={cn(
                  'rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  byAgeOrder
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                {t('students.sortByAge')}
              </Link>
            </nav>
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            {/* Said in words, because the grip is missing while it is on and a
                control that disappears without explanation reads as a bug. */}
            {byAgeOrder && levels.length > 0 && (
              <p className="text-sm text-foreground-muted">{t('students.sortedByAgeHint')}</p>
            )}
            {levels.length === 0 ? (
              <div className="flex flex-col gap-1">
                <p>{t('students.noLevels')}</p>
                <p className="text-sm text-foreground-muted">{t('students.noLevelsHint')}</p>
              </div>
            ) : (
              <LevelList
                organizationId={data.organizationId}
                levels={levels}
                canManage={data.canManage}
                sorted={byAgeOrder}
              />
            )}
          </section>

        </>
      )}
    </PageShell>
  );
}

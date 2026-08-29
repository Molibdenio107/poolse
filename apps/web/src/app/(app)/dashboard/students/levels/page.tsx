import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '../../../../../lib/api';
import { ChevronRight } from 'lucide-react';
import { CreateLevelForm } from './level-forms';
import { LevelList } from './level-list';
import { PageShell } from '@/components/page-shell';

/**
 * The progression an operator puts their students through.
 *
 * A separate page from the register because it is set up once and then rarely
 * touched, and putting it on the students screen would give the daily job a
 * settings panel it does not need. Reached by a link from there.
 */
export default async function LevelsPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Students | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<Students>('/students');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const levels = data?.levels ?? [];

  return (
    <PageShell
      title={t('students.levels')}
      subtitle={t('students.levelsSubtitle')}
      back={{ href: "/dashboard/students", label: t('students.backToRegister') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
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
                <CreateLevelForm organizationId={data.organizationId} />
              </div>
            </details>
          )}

          <section className="rounded border border-border bg-surface p-5">
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
              />
            )}
          </section>

        </>
      )}
    </PageShell>
  );
}

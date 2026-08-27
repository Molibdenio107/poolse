import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '../../../../../lib/api';
import { AgeRangeBadge } from '@/components/age-range';
import {
  ArchiveLevelButton,
  CreateLevelForm,
  EditLevelForm,
  MoveLevelButton,
} from './level-forms';
import { BackLink } from '@/components/back-link';

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('students.levels')}</h1>
          <p className="text-foreground-muted">{t('students.levelsSubtitle')}</p>
        </div>
      </header>

      <BackLink href="/dashboard/students" label={t('students.backToRegister')} />

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

          <section className="rounded border border-border bg-surface p-5">
            {levels.length === 0 ? (
              <div className="flex flex-col gap-1">
                <p>{t('students.noLevels')}</p>
                <p className="text-sm text-foreground-muted">{t('students.noLevelsHint')}</p>
              </div>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {levels.map((level, index) => (
                  <li
                    key={level.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-baseline gap-3">
                      <span className="text-sm text-foreground-muted">{index + 1}.</span>
                      <span className="truncate">{level.name}</span>
                      <AgeRangeBadge level={level} />
                      <span className="whitespace-nowrap text-sm text-foreground-muted">
                        {t('students.count', { count: level.studentCount })}
                      </span>
                    </div>

                    {data.canManage && (
                      <div className="flex flex-wrap items-center gap-1">
                        <EditLevelForm organizationId={data.organizationId} level={level} />
                        <MoveLevelButton
                          organizationId={data.organizationId}
                          levelId={level.id}
                          direction="up"
                          disabled={index === 0}
                        />
                        <MoveLevelButton
                          organizationId={data.organizationId}
                          levelId={level.id}
                          direction="down"
                          disabled={index === levels.length - 1}
                        />
                        <ArchiveLevelButton
                          organizationId={data.organizationId}
                          levelId={level.id}
                          name={level.name}
                          studentCount={level.studentCount}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.canManage && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('students.addLevel')}
              </h2>
              <CreateLevelForm organizationId={data.organizationId} />
            </section>
          )}
        </>
      )}
    </main>
  );
}

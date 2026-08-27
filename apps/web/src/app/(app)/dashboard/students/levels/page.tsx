import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '../../../../../lib/api';
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
    </PageShell>
  );
}

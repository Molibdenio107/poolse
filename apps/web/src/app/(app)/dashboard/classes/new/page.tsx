import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Classes } from '@/lib/api';
import { ClassForm } from '../class-forms';
import { PageShell } from '@/components/page-shell';

/**
 * A new turma.
 *
 * The weekly pattern is not on this form on purpose: a turma with no days is a
 * perfectly valid half-finished thing, and asking for the name, level and
 * instructor at the same time as three days of the week makes the first step
 * feel like the whole job. Submitting lands on the turma's page, where the days
 * and the students go.
 */
export default async function NewClassPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Classes | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<Classes>('/class-groups');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={t('classes.create')}
      subtitle={t('classes.createHint')}
      back={{ href: "/dashboard/classes", label: t('classes.backToClasses') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('classes.readOnly')}</p>
      )}

      {data !== null && data.canManage && (
        <section className="rounded border border-border bg-surface p-5">
          <ClassForm organizationId={data.organizationId} options={data.options} mode="create" />
        </section>
      )}
    </PageShell>
  );
}

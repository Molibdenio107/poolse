import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Students } from '@/lib/api';
import { StudentForm } from '../student-forms';
import { PageShell } from '@/components/page-shell';

/**
 * A new student.
 *
 * The register is a screen an operator searches and scans; the create form used
 * to sit underneath it, which meant scrolling past fifty children to reach it and
 * meant the page had two jobs. Now it has one, and this has the other.
 *
 * Submitting lands on the new student's own page, where the photograph, the
 * consents and the swim times live — the things you fill in next.
 */
export default async function NewStudentPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Students | null = null;
  let failure: string | null = null;

  try {
    // The register, for the level list and the write permission. Both belong to
    // the organization, not to the student who does not exist yet.
    data = await apiFetch<Students>('/students');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={t('students.add')}
      subtitle={t('students.addHint')}
      back={{ href: "/dashboard/students", label: t('students.backToRegister') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
      )}

      {data !== null && data.canManage && (
        <section className="rounded border border-border bg-surface p-5">
          <StudentForm
            organizationId={data.organizationId}
            levels={data.levels}
            mode="create"
            ageOfMajority={data.ageOfMajority}
          />
        </section>
      )}
    </PageShell>
  );
}

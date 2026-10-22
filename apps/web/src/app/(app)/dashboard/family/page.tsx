import { FromLink } from '@/components/from-link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { EntityIcon } from '@/components/entity-icon';
import { PageError, PageShell } from '@/components/page-shell';

interface FamilyStudent {
  id: string;
  name: string;
  relationship: string | null;
  /** The reader's own record, as a student. */
  self: boolean;
}

/**
 * A family's way in — 15 October 2026 (Rui).
 *
 * *Os meus educandos* for a guardian, *O meu registo* for a student. One record
 * goes straight to it; several are a short list. `GET /family` only ever
 * answers the reader's own, and each record re-checks it besides.
 */
export default async function FamilyPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let students: FamilyStudent[] = [];
  let failure: LoadFailure | null = null;
  try {
    students = (await apiFetch<{ students: FamilyStudent[] }>('/family')).students;
  } catch (error) {
    failure = describeLoad(error);
  }

  // Outside the try: redirect() signals by throwing.
  const [only] = students;
  if (failure === null && students.length === 1 && only !== undefined) {
    redirect(`/dashboard/students/${only.id}`);
  }

  return (
    <PageShell
      // *O meu registo* when every record listed is the reader's own — the
      // same choice the sidebar makes — never "my children" for a student.
      title={
        students.length > 0 && students.every((student) => student.self)
          ? t('family.navStudent')
          : t('family.title')
      }
      subtitle={t('family.subtitle')}
    >
      {failure !== null && <PageError message={t(failure.key)} />}

      {failure === null && students.length === 0 && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('family.none')}</p>
        </section>
      )}

      {students.length > 1 && (
        <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {students.map((student) => (
            <li key={student.id}>
              <FromLink
                href={`/dashboard/students/${student.id}`}
                className="flex items-center gap-3 p-4 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <EntityIcon kind="student" className="text-foreground-muted" />
                <span className="font-medium text-primary">{student.name}</span>
                <span className="text-sm text-foreground-muted">
                  {student.self ? t('family.yourself') : (student.relationship ?? '')}
                </span>
              </FromLink>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

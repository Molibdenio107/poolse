import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Guardians } from '../../../../../lib/api';
import { Pagination } from '@/components/pagination';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { RoleBadge } from '@/components/role-badge';
import { PageShell } from '@/components/page-shell';

/**
 * Encarregados de educação — POOLSE-35.
 *
 * Under Alunos, not under Pessoas. Pessoas is the staff section now; a guardian
 * is part of a family the club teaches, and putting them among the instructors
 * made both lists worse.
 *
 * **One guardian, many students.** That is the whole reason this page is grouped
 * by person rather than being a flat list: the mother of three appears once,
 * with her three children under her, and correcting her phone number is one
 * edit. Before POOLSE-17 she was three copies typed in separately.
 *
 * Somebody who is both a guardian and a student appears here *and* in the
 * register, as the same record — the split is by role, and roles are a set.
 */
export default async function GuardiansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let data: Guardians | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<Guardians>(`/guardians${page > 1 ? `?page=${page}` : ''}`);
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const guardians = data?.guardians.items ?? [];

  // A link to a page past the end, or the last row on the last page archived.
  if (data !== null && isPastEnd(page, data.guardians.total, data.guardians.limit)) {
    redirect(
      pageHref(
        '/dashboard/students/guardians',
        {},
        lastPage(data.guardians.total, data.guardians.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('students.guardiansTitle')}
      subtitle={t('students.guardiansSubtitle')}
      back={{ href: "/dashboard/students", label: t('students.backToRegister') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
        <section className="rounded border border-border bg-surface p-5">
          {guardians.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p>{t('students.noGuardians')}</p>
              <p className="text-sm text-foreground-muted">{t('students.noGuardiansHint')}</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {guardians.map((guardian) => (
                <li key={guardian.membershipId} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {/* A list, so the list form — POOLSE-32 AC7 applies the
                          same rule to encarregados as to everybody else. */}
                      <span className="font-medium" title={guardian.name}>
                        {guardian.shortName}
                      </span>
                      <RoleBadge role="guardian" />
                    </span>
                    <span className="text-sm text-foreground-muted">
                      {[guardian.email, guardian.phone].filter(Boolean).join(' · ')}
                    </span>
                  </div>

                  {/*
                    The children, named and linked. "Encarregado de 3 alunos" as a
                    bare count would make somebody open the record to find out
                    which three, which is the click this page exists to save.
                  */}
                  {guardian.students.length === 0 ? (
                    <p className="text-sm text-foreground-muted">
                      {t('students.guardianOfNobody')}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1 pl-4 text-sm">
                      {guardian.students.map((student) => (
                        <li key={student.id} className="flex flex-wrap items-baseline gap-2">
                          <Link
                            href={`/dashboard/students/${student.id}`}
                            className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            {student.name}
                          </Link>
                          {student.relationship !== null && (
                            <span className="text-foreground-muted">{student.relationship}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Pagination page={data.guardians} basePath="/dashboard/students/guardians" />
        </section>
      )}
    </PageShell>
  );
}

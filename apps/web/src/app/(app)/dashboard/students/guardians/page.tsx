import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Guardians } from '../../../../../lib/api';
import { Pagination } from '@/components/pagination';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { RoleBadge } from '@/components/role-badge';
import { PageError, PageShell } from '@/components/page-shell';

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
  searchParams: Promise<{ page?: string; search?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam, search = '' } = await searchParams;
  const page = readPage(pageParam);
  const term = search.trim();

  let data: Guardians | null = null;
  let failure: LoadFailure | null = null;

  try {
    const query = new URLSearchParams();
    if (term !== '') query.set('search', term);
    if (page > 1) query.set('page', String(page));

    data = await apiFetch<Guardians>(`/guardians${query.size > 0 ? `?${query}` : ''}`);
  } catch (error) {
    failure = describeLoad(error);
  }

  const guardians = data?.guardians.items ?? [];

  // A link to a page past the end, or the last row on the last page archived.
  if (data !== null && isPastEnd(page, data.guardians.total, data.guardians.limit)) {
    redirect(
      pageHref(
        '/dashboard/students/guardians',
        { search: term },
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
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          {/* Name, email or phone — what the row shows. POOLSE-30. */}
          <SearchInput
            label={t('search.label')}
            placeholder={t('students.guardianSearchPlaceholder')}
          />

          <SearchStatus total={data.guardians.total} term={term} />

          {guardians.length === 0 ? (
            <div className="flex flex-col items-start gap-1">
              {term !== '' ? (
                <>
                  <p>{t('search.noResults', { term })}</p>
                  <p className="text-sm text-foreground-muted">{t('search.noResultsHint')}</p>
                  <Link
                    href="/dashboard/students/guardians"
                    className="mt-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('search.clearSearch')}
                  </Link>
                </>
              ) : (
                <>
                  <p>{t('students.noGuardians')}</p>
                  <p className="text-sm text-foreground-muted">{t('students.noGuardiansHint')}</p>
                </>
              )}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {guardians.map((guardian) => (
                <li key={guardian.membershipId} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {/* A list, so the list form — POOLSE-32 AC7 applies the
                          same rule to encarregados as to everybody else. */}
                      {/*
                        Linked when this person is also enrolled — round 4. Most
                        rows are plain text, because most encarregados do not
                        swim; a link that only sometimes exists is why this is a
                        conditional rather than an always-anchor with no href.
                      */}
                      {guardian.studentId === null ? (
                        <span className="font-medium" title={guardian.name}>
                          {guardian.shortName}
                        </span>
                      ) : (
                        <Link
                          href={`/dashboard/students/${guardian.studentId}`}
                          title={guardian.name}
                          className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {guardian.shortName}
                        </Link>
                      )}

                      {/*
                        "Encarregado de" reads into the list of children below —
                        round 4 replaced the badge with the phrase, because the
                        badge said what they are and the phrase says what the
                        next three lines are.
                      */}
                      {guardian.students.length > 0 && (
                        <span className="text-sm text-foreground-muted">
                          {t('students.guardianOfLabel')}
                        </span>
                      )}
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
                    /*
                      No relationship tag — round 4. "Pai" and "Mãe" after every
                      name added a column of noise to a list whose job is "which
                      children is this person responsible for", and the
                      relationship is still on the guardian's own record where it
                      is edited.
                    */
                    <ul className="flex flex-col gap-1 pl-4 text-sm">
                      {guardian.students.map((student) => (
                        <li key={student.id}>
                          <Link
                            href={`/dashboard/students/${student.id}`}
                            className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            {student.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Pagination
            page={data.guardians}
            basePath="/dashboard/students/guardians"
            query={{ search: term }}
          />
        </section>
      )}
    </PageShell>
  );
}

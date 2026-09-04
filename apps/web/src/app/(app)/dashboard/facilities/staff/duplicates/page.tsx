import { redirect } from 'next/navigation';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type MergeCandidate,
  type Paginated,
  type People,
} from '@/lib/api';
import { MergeButton } from './merge-button';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';

/**
 * Duplicates, and what merging them would do — POOLSE-17 AC10.
 *
 * The ticket calls the merge "the risky part" and asks for it in phases: a
 * read-only report, reviewed, and only then the merge itself. This is the
 * report, and it is a screen rather than a log file because the person who can
 * judge whether two records are the same human is the one running the club, not
 * whoever has database access.
 *
 * Every field the two records disagree about is listed with both values. Nothing
 * is merged from here without somebody reading that first, so no contact detail
 * disappears without having been shown.
 */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let report: Paginated<MergeCandidate> | null = null;
  let organizationId = '';
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    /*
     * Both are owner/admin reads; the report is the one that decides the page.
     *
     * `/people` is fetched only for the organization id, so it asks for one row
     * rather than a default page of fifteen — POOLSE-29 made that free, and
     * pulling a page of staff to read a single field would be waste that grows.
     */
    const [merges, people] = await Promise.all([
      apiFetch<{ candidates: Paginated<MergeCandidate> }>(
        `/people/merge-report${page > 1 ? `?page=${page}` : ''}`,
      ),
      apiFetch<People>('/people?limit=1'),
    ]);
    report = merges.candidates;
    organizationId = people.organizationId;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  if (report !== null && isPastEnd(page, report.total, report.limit)) {
    redirect(
      pageHref('/dashboard/facilities/staff/duplicates', {}, lastPage(report.total, report.limit)),
    );
  }

  return (
    <PageShell
      title={t('people.duplicates')}
      subtitle={t('people.duplicatesSubtitle')}
      back={{ href: "/dashboard/facilities/staff", label: t('staff.backToStaff') }}
    >


      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('people.duplicatesRestricted')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {report !== null && report.total === 0 && (
        <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
          <p>{t('people.noDuplicates')}</p>
          <p className="text-sm text-foreground-muted">{t('people.noDuplicatesHint')}</p>
        </section>
      )}

      {report !== null && report.total > 0 && (
        <>
          <p className="text-sm text-foreground-muted">{t('people.mergeWarning')}</p>

          <ul className="flex flex-col gap-4">
            {report.items.map((pair) => (
              <li
                key={`${pair.keepId}:${pair.absorbId}`}
                className="flex flex-col gap-3 rounded border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{pair.keepName}</span>
                  <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
                    {t(pair.matchedOn === 'nif' ? 'people.matchedNif' : 'people.matchedEmail')}
                  </span>
                </div>

                <p className="text-sm text-foreground-muted">
                  {t('people.mergeExplains', { keep: pair.keepName, absorb: pair.absorbName })}
                </p>

                {/*
                  Every disagreement, both values. The ticket's rule is that no
                  discarded value vanishes unreported, and this is where it is
                  reported — before the merge, not in a log afterwards.
                */}
                {Object.keys(pair.conflicts).length > 0 ? (
                  <dl className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
                    {Object.entries(pair.conflicts).map(([field, values]) => (
                      <div key={field} className="flex flex-wrap gap-x-2">
                        <dt className="font-medium">{t(`people.field.${field}`)}</dt>
                        <dd>
                          {t('people.conflictKeeps', { keep: values.keep, absorb: values.absorb })}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-foreground-muted">{t('people.noConflicts')}</p>
                )}

                <MergeButton
                  organizationId={organizationId}
                  keepId={pair.keepId}
                  absorbId={pair.absorbId}
                  label={t('people.mergeInto', { keep: pair.keepName })}
                />
              </li>
            ))}
          </ul>

          <Pagination page={report} basePath="/dashboard/facilities/staff/duplicates" />
        </>
      )}
    </PageShell>
  );
}

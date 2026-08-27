import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type MergeCandidate, type People } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { MergeButton } from './merge-button';

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
export default async function DuplicatesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let candidates: MergeCandidate[] | null = null;
  let organizationId = '';
  let failure: string | null = null;
  let notPermitted = false;

  try {
    // Both are owner/admin reads; the report is the one that decides the page.
    const [report, people] = await Promise.all([
      apiFetch<{ candidates: MergeCandidate[] }>('/people/merge-report'),
      apiFetch<People>('/people'),
    ]);
    candidates = report.candidates;
    organizationId = people.organizationId;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <BackLink href="/dashboard/people" label={t('people.backToPeople')} />

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t('people.duplicates')}</h1>
        <p className="text-foreground-muted">{t('people.duplicatesSubtitle')}</p>
      </header>

      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('people.duplicatesRestricted')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {candidates !== null && candidates.length === 0 && (
        <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
          <p>{t('people.noDuplicates')}</p>
          <p className="text-sm text-foreground-muted">{t('people.noDuplicatesHint')}</p>
        </section>
      )}

      {candidates !== null && candidates.length > 0 && (
        <>
          <p className="text-sm text-foreground-muted">{t('people.mergeWarning')}</p>

          <ul className="flex flex-col gap-4">
            {candidates.map((pair) => (
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
        </>
      )}
    </main>
  );
}

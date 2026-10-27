import { FromLink } from '@/components/from-link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Printer } from 'lucide-react';
import { ApiError, apiFetch, type MeetDetail } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backTarget } from '@/lib/back';
import { formatDate, formatStamp } from '@/lib/date-format';
import { formatTime } from '@/components/progress-chart';
import { PageError, PageShell, ScrollX } from '@/components/page-shell';
import { ArchiveMeetButton } from '../archive-meet';
import { roundKey } from '../round-key';

/**
 * One meet — POOLSE-81: the club's results, each marked when it is still the
 * swimmer's best, a warning beside a competitive swimmer with no licence, and
 * the swimmers the file named that matched nobody.
 */
export default async function MeetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { from } = await searchParams;
  const { id } = await params;

  let meet: MeetDetail | null = null;
  let failure: LoadFailure | null = null;
  try {
    meet = await apiFetch<MeetDetail>(`/meets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    failure = describeLoad(error);
  }

  const target = backTarget(from, '/dashboard/students/provas');
  const back = { href: target.href, label: t(target.labelKey) };
  if (meet === null) {
    return (
      <PageShell title={t('meets.title')} back={back}>
        {failure !== null && (
          <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
        )}
      </PageShell>
    );
  }

  return (
    <PageShell
      title={meet.name}
      subtitle={[
        meet.startsOn === meet.endsOn
          ? formatDate(meet.startsOn)
          : `${formatDate(meet.startsOn)} — ${formatDate(meet.endsOn)}`,
        meet.city,
        meet.course === null ? null : t(`progress.course.${meet.course}`),
        meet.official ? t('progress.official') : t('meets.friendly'),
      ]
        .filter(Boolean)
        .join(' · ')}
      back={back}
      actions={
        <>
          {/*
            The sheet on paper — POOLSE-115. Its own tab, a plain anchor because
            `Link` would prefetch it, and `print=1` so arriving opens the dialog.
          */}
          <a
            href={`/dashboard/students/provas/${meet.id}/print?print=1`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Printer aria-hidden className="size-4" />
            {t('meets.print.button')}
          </a>
          {meet.canArchive && (
            <ArchiveMeetButton organizationId={meet.organizationId} meetId={meet.id} results={meet.resultCount} />
          )}
        </>
      }
    >
      {meet.sourceFileName !== null && meet.importedAt !== null && (
        <p className="text-sm text-foreground-muted">
          {t('meets.importedFrom', { file: meet.sourceFileName, at: formatStamp(meet.importedAt) })}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('meets.results', { count: meet.results.length })}
        </h2>
        {meet.results.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('meets.noResults')}</p>
        ) : (
          <ScrollX>
            <table className="w-full text-left text-sm">
              <thead className="text-foreground-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-normal">{t('meets.column.swimmer')}</th>
                  <th scope="col" className="py-2 pr-4 font-normal">{t('meets.column.event')}</th>
                  <th scope="col" className="py-2 pr-4 font-normal">{t('meets.column.time')}</th>
                  <th scope="col" className="py-2 font-normal">{t('meets.column.notes')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {meet.results.map((result) => (
                  <tr key={result.recordId}>
                    <td className="py-2 pr-4">
                      <FromLink
                        href={`/dashboard/students/${result.studentId}/progress`}
                        className="underline underline-offset-4 hover:text-primary"
                      >
                        {result.studentName}
                      </FromLink>
                    </td>
                    <td className="py-2 pr-4">
                      {result.distanceM} m {t(`progress.strokes.${result.stroke}`)}
                      {result.round !== null && result.round !== 'TIM' && (
                        <span className="text-foreground-muted"> · {t(`meets.round.${roundKey(result.round)}`)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono">{formatTime(result.timeMs)}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {result.isPersonalBest && (
                          <span className="rounded bg-success/15 px-2 text-success">
                            {t('progress.personalBest')}
                          </span>
                        )}
                        {result.licenceMissing && (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="size-3.5" aria-hidden />
                            {t('meets.noLicence')}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
      </section>

      {meet.unmatched.length > 0 && (
        <section className="flex flex-col gap-2 rounded border border-warning/40 bg-warning/10 p-5">
          <h2 className="text-sm font-medium">{t('meets.unmatchedTitle', { count: meet.unmatched.length })}</h2>
          <p className="text-sm text-foreground-muted">{t('meets.unmatchedHint')}</p>
          <ul className="list-disc pl-5 text-sm">
            {meet.unmatched.map((athlete) => (
              <li key={athlete.name}>
                {athlete.name} · {t('meets.resultCount', { count: athlete.results })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

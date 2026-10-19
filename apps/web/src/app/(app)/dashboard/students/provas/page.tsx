import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type MeetList } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { formatDate } from '@/lib/date-format';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { ImportMeet } from './import-meet';

/**
 * Provas — POOLSE-81.
 *
 * The club's meets, newest first, paginated because it grows every season.
 * Owner, admin and instructor; a family reads its own child's results in
 * Progressão and nothing here. Results arrive by importing the meet's LENEX file
 * (or by naming a meet on the time form).
 */
export default async function MeetsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let data: MeetList | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    data = await apiFetch<MeetList>(`/meets${page > 1 ? `?page=${page}` : ''}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  if (data !== null && isPastEnd(page, data.total, data.limit)) {
    redirect(pageHref('/dashboard/students/provas', {}, lastPage(data.total, data.limit)));
  }

  return (
    <PageShell
      title={t('meets.title')}
      subtitle={t('meets.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
      actions={
        data?.canImport ? (
          <ImportMeet organizationId={data.organizationId} rememberedClubCode={data.rememberedClubCode} />
        ) : null
      }
    >
      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('meets.notPermitted')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      )}

      {data !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          {data.total === 0 ? (
            <div className="flex flex-col gap-1">
              <p>{t('meets.empty')}</p>
              <p className="text-sm text-foreground-muted">{t('meets.emptyHint')}</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.items.map((meet) => (
                <li key={meet.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link
                      href={`/dashboard/students/provas/${meet.id}`}
                      className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {meet.name}
                    </Link>
                    <span className="text-sm text-foreground-muted">
                      {meet.startsOn === meet.endsOn
                        ? formatDate(meet.startsOn)
                        : `${formatDate(meet.startsOn)} — ${formatDate(meet.endsOn)}`}
                    </span>
                  </div>
                  <p className="text-sm text-foreground-muted">
                    {[
                      meet.city,
                      meet.course === null ? null : t(`progress.course.${meet.course}`),
                      meet.official ? t('progress.official') : t('meets.friendly'),
                      t('meets.resultCount', { count: meet.resultCount }),
                      meet.imported ? t('meets.fromFile') : t('meets.typed'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={data} basePath="/dashboard/students/provas" />
        </section>
      )}
    </PageShell>
  );
}

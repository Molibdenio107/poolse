import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Closures } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { ClosureCalendar } from './closure-calendar';

/**
 * When the pool is shut — slice 1.5, rebuilt as a year for POOLSE-31.
 *
 * Was two lists, one of holidays and one of everything else. A list answers
 * "what closures exist"; the question an operator actually has is "is the pool
 * open that week", and a year of months answers it without them holding twelve
 * date ranges in their head.
 *
 * Both kinds of row survive the change and stay distinguishable. The national
 * holidays were put there by Poolse on the operator's instruction; the rest were
 * typed by a person. Both are removable, and that is the point of showing the
 * holidays at all: a municipal pool that opens on the 5th of October needs to
 * find the thing that took its classes away and delete it.
 */

/** A year either side is enough to plan with, and keeps the switcher small. */
const SPAN = 1;

export default async function ClosuresPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { year: requested } = await searchParams;

  const thisYear = new Date().getUTCFullYear();
  const parsed = Number(requested);
  // A hand-typed year in the query string is not trusted into a Date.
  const year = Number.isInteger(parsed) && parsed > 2000 && parsed < 2100 ? parsed : thisYear;

  let data: Closures | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Closures>('/closures');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const years = Array.from({ length: SPAN * 2 + 1 }, (_, index) => thisYear - SPAN + index);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('calendar.closures')}</h1>
          <p className="text-foreground-muted">{t('calendar.closuresSubtitle')}</p>
        </div>
      </header>

      <BackLink href="/dashboard/calendar" label={t('calendar.backToCalendar')} />

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
        <>
          {/*
            Links rather than a select, so a year is a real address: an operator
            can bookmark 2027 and send it to somebody.
          */}
          <nav className="flex flex-wrap items-center gap-2" aria-label={t('calendar.year')}>
            {years.map((option) => (
              <Link
                key={option}
                href={`/dashboard/calendar/closures?year=${option}`}
                aria-current={option === year ? 'page' : undefined}
                className={
                  option === year
                    ? 'rounded bg-primary/15 px-3 py-1 text-sm font-medium text-primary'
                    : 'rounded px-3 py-1 text-sm text-foreground-muted hover:bg-surface-muted'
                }
              >
                {option}
              </Link>
            ))}
          </nav>

          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('calendar.closuresReadOnly')}</p>
          )}

          <ClosureCalendar
            organizationId={data.organizationId}
            year={year}
            closures={data.closures}
            pools={data.pools}
            canManage={data.canManage}
          />
        </>
      )}
    </main>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Closures } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ClosureCalendar } from './closure-calendar';
import { PageShell } from '@/components/page-shell';

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

/**
 * The same four years Férias offers, in the same order.
 *
 * Next year first: closures are planned ahead far more often than they are
 * looked up afterwards, and a calendar that opens on the year you are least
 * likely to want is a click nobody needed.
 */
function yearsAround(current: number): number[] {
  return [current + 1, current, current - 1, current - 2];
}

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
    /*
     * Year-scoped — POOLSE-29. The grid itself is exempt from paging (twelve
     * months is a fixed window), but it used to fetch every closure the club had
     * ever declared and discard all but this year in the browser. Repeating
     * closures come back whatever their year, because they belong to this one.
     */
    data = await apiFetch<Closures>(`/closures?year=${year}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const years = yearsAround(thisYear);

  return (
    <PageShell
      title={t('calendar.closures')}
      subtitle={t('calendar.closuresSubtitle')}
      back={{ href: "/dashboard/calendar", label: t('calendar.backToCalendar') }}
    >


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
          {/* The same switcher as Férias, to the class — one calendar, one look. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <nav aria-label={t('calendar.year')} className="flex flex-wrap gap-1">
              {years.map((option) => (
                <Link
                  key={option}
                  href={`/dashboard/calendar/closures?year=${option}`}
                  aria-current={option === year ? 'page' : undefined}
                  className={cn(
                    'rounded border px-3 py-1.5 text-sm transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    option === year
                      ? 'border-primary bg-primary/15 font-medium text-primary'
                      : 'border-border hover:border-primary/50 hover:text-primary',
                  )}
                >
                  {option}
                </Link>
              ))}
            </nav>
          </div>

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
    </PageShell>
  );
}

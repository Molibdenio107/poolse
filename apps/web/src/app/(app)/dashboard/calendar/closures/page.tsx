import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Closure, type Closures } from '@/lib/api';
import { longDate, shortDate } from '@/lib/dates';
import { ClosureForm, RemoveClosure } from '../calendar-forms';

/**
 * When the pool is shut — slice 1.5.
 *
 * Two kinds of row, and the difference matters enough to separate them on
 * screen. The national holidays were put there by Poolse, on the operator's
 * instruction to close on them automatically; the rest were typed by a person.
 * Both are removable, and that is the point of showing the holidays at all: a
 * municipal pool that opens on the 5th of October needs to be able to find the
 * thing that took its classes away and delete it.
 */
export default async function ClosuresPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  let data: Closures | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Closures>('/closures');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const manual = (data?.closures ?? []).filter((closure) => closure.source === 'manual');
  const holidays = (data?.closures ?? []).filter(
    (closure) => closure.source === 'national_holiday',
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('calendar.closures')}</h1>
          <p className="text-foreground-muted">{t('calendar.closuresSubtitle')}</p>
        </div>
      </header>

      <Link href="/dashboard/calendar" className="self-start text-sm text-primary hover:underline">
        {t('calendar.backToCalendar')}
      </Link>

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
          {data.canManage && (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('calendar.addClosure')}
                </h2>
                <p className="mt-1 text-sm text-foreground-muted">{t('calendar.addClosureHint')}</p>
              </div>
              <ClosureForm organizationId={data.organizationId} pools={data.pools} />
            </section>
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('calendar.yourClosures')}
            </h2>

            {manual.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('calendar.noClosures')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {manual.map((closure) => (
                  <ClosureRow
                    key={closure.id}
                    closure={closure}
                    organizationId={data.organizationId}
                    canManage={data.canManage}
                    locale={locale}
                    labels={{
                      wholeOrganization: t('calendar.wholeOrganization'),
                      repeats: t('calendar.repeatsBadge'),
                      note: t('calendar.effectNote'),
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('calendar.holidays')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('calendar.holidaysHint')}</p>
            </div>

            {holidays.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('calendar.noHolidays')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {holidays.map((closure) => (
                  <ClosureRow
                    key={closure.id}
                    closure={closure}
                    organizationId={data.organizationId}
                    canManage={data.canManage}
                    locale={locale}
                    labels={{
                      wholeOrganization: t('calendar.wholeOrganization'),
                      repeats: t('calendar.repeatsBadge'),
                      note: t('calendar.effectNote'),
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function ClosureRow({
  closure,
  organizationId,
  canManage,
  locale,
  labels,
}: {
  closure: Closure;
  organizationId: string;
  canManage: boolean;
  locale: string;
  labels: { wholeOrganization: string; repeats: string; note: string };
}): React.ReactElement {
  // A single day reads as a single day. "25 December to 25 December" is the kind
  // of phrasing that makes software feel like it is talking to itself.
  const when =
    closure.startsOn === closure.endsOn
      ? longDate(closure.startsOn, locale)
      : `${shortDate(closure.startsOn, locale)} – ${longDate(closure.endsOn, locale)}`;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">{closure.reason}</p>
        <p className="text-sm text-foreground-muted">
          {when} · {closure.poolName ?? labels.wholeOrganization}
          {closure.repeatsAnnually && ` · ${labels.repeats}`}
          {!closure.blocksGeneration && ` · ${labels.note}`}
        </p>
      </div>
      {canManage && <RemoveClosure organizationId={organizationId} closure={closure} />}
    </li>
  );
}

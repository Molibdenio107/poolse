import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Register } from '@/lib/api';
import { longDate } from '@/lib/dates';
import { RegisterForm } from './register-form';
import { PageShell } from '@/components/page-shell';
import { laneLabel } from '@/lib/lanes';

type RegisterResponse = Register & { organizationId: string; canRecord: boolean };

/**
 * Marking one class — slice 1.8.
 *
 * Its own screen rather than an expanding row on the calendar, and the reason is
 * the acceptance criterion: an instructor marks a class in under a minute, and
 * on a phone at the poolside. A panel inside a seven-column grid is a panel
 * nobody can read with wet hands.
 */
export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ week?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { sessionId } = await params;
  const { week } = await searchParams;

  let register: RegisterResponse | null = null;
  let failure: string | null = null;
  let notPermitted = false;

  try {
    register = await apiFetch<RegisterResponse>(`/sessions/${sessionId}/attendance`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.code === 'forbidden_role') notPermitted = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  // Back to the week the instructor came from, not to today's. Marking last
  // Tuesday and being returned to this week is the kind of thing that makes
  // somebody give up halfway through a backlog of registers.
  const back = week === undefined ? '/dashboard/calendar' : `/dashboard/calendar?week=${week}`;

  return (
    <PageShell
      title={register?.className ?? t('calendar.title')}
      subtitle={
        register === null
          ? undefined
          : [
              longDate(register.localDate, locale),
              register.localTime,
              register.poolName,
              laneLabel(register.lanes, t),
              register.instructorName,
            ]
              .filter(Boolean)
              .join(' · ')
      }
      back={{ href: back, label: t('calendar.backToCalendar') }}
    >

      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('attendance.restricted')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {register !== null && (
        <>

          {/*
            A cancelled class is not marked. Saying so beats rendering a register
            that would refuse to save — and the database refuses the reverse too:
            once a class is marked it can no longer be cancelled.
          */}
          {register.status === 'cancelled' ? (
            <section className="rounded border border-border bg-surface p-5">
              <p>{t('attendance.classCancelled')}</p>
            </section>
          ) : register.canRecord ? (
            <RegisterForm register={register} />
          ) : (
            <section className="rounded border border-border bg-surface p-5">
              <p className="text-sm text-foreground-muted">{t('attendance.readOnly')}</p>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

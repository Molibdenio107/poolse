import { notFound } from 'next/navigation';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Register } from '@/lib/api';
import { RegisterForm } from './register-form';
import { SessionActions } from './session-actions';
import { moduleIsOn } from '@/lib/modules';
import { PageError, PageShell } from '@/components/page-shell';
import { laneLabel } from '@/lib/lanes';
import { formatDate } from '@/lib/date-format';
import { backLabelKey, readFrom } from '@/lib/back';
import { FeedbackList } from '@/components/feedback-list';

type RegisterResponse = Register & {
  organizationId: string;
  canRecord: boolean;
  canCancel: boolean;
  canEndSeries: boolean;
};

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
  searchParams: Promise<{ week?: string; from?: string; plan?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { sessionId } = await params;
  const { week, from, plan } = await searchParams;

  let register: RegisterResponse | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    register = await apiFetch<RegisterResponse>(`/sessions/${sessionId}/attendance`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.code === 'forbidden_role') notPermitted = true;
    else failure = describeLoad(error);
  }

  // Back to the week the instructor came from, not to today's. Marking last
  // Tuesday and being returned to this week is the kind of thing that makes
  // somebody give up halfway through a backlog of registers.
  const calendarWeek = week === undefined ? '/dashboard/calendar' : `/dashboard/calendar?week=${week}`;
  // The dashboard's next-class card sends `from`; the calendar sends `week`.
  const origin = readFrom(from);

  return (
    <PageShell
      title={register?.className ?? t('calendar.title')}
      subtitle={
        register === null
          ? undefined
          : [
              formatDate(register.localDate),
              register.localTime,
              register.poolName,
              laneLabel(register.lanes, t),
              register.instructorName,
            ]
              .filter(Boolean)
              .join(' · ')
      }
      back={
        origin === null
          ? { href: calendarWeek, label: t('calendar.backToCalendar') }
          : { href: origin, label: t(backLabelKey(origin) as never) }
      }
    >

      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p className="font-medium">{t('attendance.restricted')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {register !== null && (
        <>
          {/*
            The plan, the stand-in and Cancelar aula — POOLSE-88 slice 2. On a
            phone this page is the lesson's page; the calendar's hover card is a
            desk tool. Above the roll, because a stand-in or a cancellation is
            decided before anybody is marked.
          */}
          <SessionActions
            organizationId={register.organizationId}
            sessionId={register.sessionId}
            className={register.className}
            when={`${formatDate(register.localDate)}, ${register.localTime}`}
            date={formatDate(register.localDate)}
            classGroupId={register.classGroupId}
            cancelled={register.status === 'cancelled'}
            canCancel={register.canCancel}
            management={register.canEndSeries}
            messagesOn={await moduleIsOn('messages')}
            openPlan={plan === 'open'}
          />

          {/*
            Aulas experimentais — POOLSE-69. Above the roll and outside the form:
            nothing here is marked, and a trial guest is not a student. Words, so
            "who is the child I don't know" has its answer before the class starts.
          */}
          {register.trialGuests.length > 0 && register.status !== 'cancelled' && (
            <section className="flex flex-col gap-2 rounded border border-border bg-surface p-4">
              <h2 className="font-medium">
                {t('attendance.trialGuests', { count: register.trialGuests.length })}
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {register.trialGuests.map((guest) => (
                  <li key={guest.leadId}>
                    {guest.ageYears === null
                      ? guest.name
                      : t('attendance.trialGuest', { name: guest.name, age: guest.ageYears })}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-foreground-muted">{t('attendance.trialGuestsHint')}</p>
            </section>
          )}

          {/*
            A cancelled class is not marked. Saying so beats rendering a register
            that would refuse to save — and the database refuses the reverse too:
            once a class is marked it can no longer be cancelled.
          */}
          {register.status === 'cancelled' ? (
            <section className="rounded border border-border bg-surface p-5">
              <p>{t('attendance.classCancelled')}</p>
            </section>
          ) : register.canRecord && !register.started ? (
            /*
              A register opens when the class starts — Rui, 28-10-2026. Before
              that it says when, and who is expected, with each family's
              *Não vou* beside its name; nothing can be marked, and the API
              refuses a save the same way.
            */
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <p className="font-medium">
                {t('attendance.notStarted', {
                  date: formatDate(register.localDate),
                  time: register.localTime,
                })}
              </p>
              {register.entries.length > 0 && (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {register.entries.map((entry) => {
                    const notice = (register.notices ?? []).find(
                      (one) => one.studentId === entry.studentId,
                    );
                    return (
                      <li key={entry.studentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>{entry.shortName}</span>
                        {notice !== undefined && (
                          <span className="rounded border border-border px-2 py-0.5 text-xs text-foreground-muted">
                            {t(notice.going ? 'attendance.noticeGoing' : 'attendance.noticeNotGoing')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : register.canRecord ? (
            <RegisterForm register={register} />
          ) : (
            <section className="rounded border border-border bg-surface p-5">
              <p className="text-sm text-foreground-muted">{t('attendance.readOnly')}</p>
            </section>
          )}

          {/*
            What the students said — POOLSE-116. Below the roll: it is read after
            the lesson, never before marking. Only for whoever taught it (and
            the office); a colleague's register carries none, so no strip.
          */}
          {register.status !== 'cancelled' && (register.canRecord || register.canEndSeries) && (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="font-medium">{t('feedback.title')}</h2>
              {(register.feedback ?? []).length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('feedback.noneForLesson')}</p>
              ) : (
                <FeedbackList items={register.feedback ?? []} by="student" canArchive={register.canEndSeries} />
              )}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

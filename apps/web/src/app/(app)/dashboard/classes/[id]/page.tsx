import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type ClassGroup, type Classes } from '@/lib/api';
import { PersonAvatar } from '@/components/person-avatar';
import { BackLink } from '@/components/back-link';
import {
  AddSlotForm,
  ArchiveClassButton,
  ClassForm,
  EndEnrollmentButton,
  EnrolForm,
  RemoveSlotButton,
} from '../class-forms';

/**
 * One turma: what it is, when it runs, and who is in it.
 *
 * The three sit on one page because they are one thing an operator sets up in
 * one sitting — name the turma, give it its days, put the children in it.
 */
export default async function ClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;

  let group: (ClassGroup & { canManage: boolean }) | null = null;
  let all: Classes | null = null;
  let failure: string | null = null;
  let missing = false;

  try {
    [group, all] = await Promise.all([
      apiFetch<ClassGroup & { canManage: boolean }>(`/class-groups/${id}`),
      apiFetch<Classes>('/class-groups'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) missing = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const dayNames = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)]),
  );

  const active = group?.students.filter((student) => student.status === 'active') ?? [];
  const waiting = group?.students.filter((student) => student.status === 'waiting') ?? [];

  // Only offer students who are not already in this turma — the API refuses
  // duplicates, and a list that offers a name it will then reject is a list
  // that wastes a click.
  const enrolledIds = new Set(group?.students.map((student) => student.studentId));
  const available = (all?.options.students ?? []).filter(
    (student) => !enrolledIds.has(student.id),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {group?.name ?? t('classes.title')}
          </h1>
          <p className="text-foreground-muted">
            {[group?.levelName, group?.instructorName, group?.poolName].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* POOLSE-20. The screen an instructor opens during a lesson, so it is
            reachable from the turma in one press rather than through a menu. */}
        <Link
          href={`/dashboard/classes/${id}/skills`}
          className="shrink-0 rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('skills.title')}
        </Link>
      </header>

      <BackLink href="/dashboard/classes" label={t('classes.backToClasses')} />

      {missing && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('classes.notFound')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {group !== null && all !== null && (
        <>
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('classes.details')}
            </h2>
            {group.canManage ? (
              <ClassForm
                organizationId={all.organizationId}
                options={all.options}
                group={group}
                mode="edit"
              />
            ) : (
              <p className="text-sm text-foreground-muted">{t('classes.readOnly')}</p>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('classes.pattern')}
              </h2>
              <p className="text-sm text-foreground-muted">{t('classes.patternHint')}</p>
            </div>

            {group.schedules.length === 0 ? (
              <p className="text-foreground-muted">{t('classes.noSlotsYet')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {group.schedules.map((slot) => (
                  <li
                    key={slot.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span>
                      {dayNames[slot.weekday]}{' '}
                      <span className="font-mono">{slot.startTime}</span>
                      <span className="text-foreground-muted">
                        {' '}
                        · {t('classes.minutes', { count: slot.durationMinutes })}
                      </span>
                    </span>
                    {group.canManage && (
                      <RemoveSlotButton
                        organizationId={all.organizationId}
                        groupId={group.id}
                        scheduleId={slot.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {group.canManage && (
              <div className="border-t border-border pt-4">
                <AddSlotForm
                  organizationId={all.organizationId}
                  groupId={group.id}
                  dayNames={dayNames}
                />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {group.capacity === null
                ? t('classes.enrolledUnlimited', { count: active.length })
                : t('classes.enrolledOf', { count: active.length, capacity: group.capacity })}
            </h2>

            {active.length === 0 ? (
              <p className="text-foreground-muted">{t('classes.nobodyEnrolled')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {active.map((student) => (
                  <li
                    key={student.enrollmentId}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <PersonAvatar
                        id={student.studentId}
                        name={`${student.firstName} ${student.lastName}`}
                        size="sm"
                      />
                      <Link
                        href={`/dashboard/students/${student.studentId}`}
                        className="truncate text-primary hover:underline"
                      >
                        {student.lastName}, {student.firstName}
                      </Link>
                    </span>
                    {group.canManage && (
                      <EndEnrollmentButton
                        organizationId={all.organizationId}
                        groupId={group.id}
                        enrollmentId={student.enrollmentId}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {waiting.length > 0 && (
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm text-foreground-muted">
                  {t('classes.waitingList', { count: waiting.length })}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {waiting.map((student) => (
                    <li
                      key={student.enrollmentId}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0"
                    >
                      <span className="truncate">
                        {student.waitingPosition ?? '—'}. {student.lastName}, {student.firstName}
                      </span>
                      {group.canManage && (
                        <EndEnrollmentButton
                          organizationId={all.organizationId}
                          groupId={group.id}
                          enrollmentId={student.enrollmentId}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {group.canManage && (
              <div className="border-t border-border pt-4">
                <EnrolForm
                  organizationId={all.organizationId}
                  groupId={group.id}
                  students={available}
                />
              </div>
            )}
          </section>

          {group.canManage && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-5">
              <span className="text-sm text-foreground-muted">{t('classes.archiveHint')}</span>
              <ArchiveClassButton
                organizationId={all.organizationId}
                groupId={group.id}
                enrolled={active.length + waiting.length}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

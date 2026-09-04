import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type ClassGroup, type Classes } from '@/lib/api';
import { PersonAvatar } from '@/components/person-avatar';
import { PageError, PageShell } from '@/components/page-shell';
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
  let failure: LoadFailure | null = null;
  let missing = false;

  try {
    [group, all] = await Promise.all([
      apiFetch<ClassGroup & { canManage: boolean }>(`/class-groups/${id}`),
      apiFetch<Classes>('/class-groups'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) missing = true;
    else failure = describeLoad(error);
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
    <PageShell
      title={group?.name ?? t('classes.title')}
      subtitle={[group?.levelName, group?.instructorName, group?.poolName].filter(Boolean).join(' · ')}
      back={{ href: "/dashboard/classes", label: t('classes.backToClasses') }}
      actions={<Link
          href={`/dashboard/classes/${id}/skills`}
          className="shrink-0 rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('skills.title')}
        </Link>}
    >


      {missing && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('classes.notFound')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
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
                        name={student.displayName}
                        size="sm"
                      />
                      {/* A roster is the narrowest column in the app — POOLSE-32
                          criterion 2. The full name is on the detail page. */}
                      <Link
                        href={`/dashboard/students/${student.studentId}`}
                        className="truncate text-primary hover:underline"
                        title={student.displayName}
                      >
                        {student.shortName}
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
                      <span className="truncate" title={student.displayName}>
                        {student.waitingPosition ?? '—'}. {student.shortName}
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
                  // The turma's level, so the picker can offer the right ages
                  // first — round 5. Null when the turma has no level.
                  level={
                    all.options.levels.find((candidate) => candidate.id === group.levelId) ?? null
                  }
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
    </PageShell>
  );
}

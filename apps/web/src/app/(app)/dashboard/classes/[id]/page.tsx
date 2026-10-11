import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type ClassGroup, type Classes, type GroupCost } from '@/lib/api';
import { centsToText } from '@/lib/energy-invoice';
import { PersonAvatar } from '@/components/person-avatar';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import {
  AddSlotForm,
  ArchiveClassButton,
  ClassForm,
  EndEnrollmentButton,
  EnrolForm,
  RemoveSlotButton,
} from '../class-forms';
import { EnrollmentCategoryPicker } from './enrollment-category';
import { backLabelKey, readFrom } from '@/lib/back';

/**
 * One turma: what it is, when it runs, and who is in it.
 *
 * The three sit on one page because they are one thing an operator sets up in
 * one sitting — name the turma, give it its days, put the children in it.
 *
 * **Tabs since the detail-tabs change**: General (the form, with Arquivar at
 * its foot), Horário and Alunos.
 */
export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { id } = await params;
  const { tab, from } = await searchParams;

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

  // Back to where the link was followed from, when it says — the `withFrom`
  // links from the dashboard, Energia and Turmas. October 2026 sweep.
  const origin = readFrom(from);
  const back =
    origin === null
      ? { href: '/dashboard/classes', label: t('classes.backToClasses') }
      : { href: origin, label: t(backLabelKey(origin) as never) };

  if (group === null || all === null) {
    return (
      <PageShell title={t('classes.title')} back={back}>
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
      </PageShell>
    );
  }

  const loaded = group;
  const options = all;

  return (
    <DetailPage
      title={loaded.name}
      subtitle={[loaded.levelName, loaded.instructorName, loaded.poolName].filter(Boolean).join(' · ')}
      back={back}
      actions={
        <Link
          href={`/dashboard/classes/${id}/skills`}
          className="shrink-0 rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('skills.title')}
        </Link>
      }
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('classes.details')}
                </h2>
                {loaded.canManage ? (
                  <ClassForm
                    organizationId={options.organizationId}
                    options={options.options}
                    group={loaded}
                    mode="edit"
                  />
                ) : (
                  <p className="text-sm text-foreground-muted">{t('classes.readOnly')}</p>
                )}
              </section>

              {loaded.canManage && (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-5">
                  <span className="text-sm text-foreground-muted">{t('classes.archiveHint')}</span>
                  <ArchiveClassButton
                    organizationId={options.organizationId}
                    groupId={loaded.id}
                    enrolled={active.length + waiting.length}
                  />
                </section>
              )}
            </>
          ),
        },
        {
          slug: 'schedule',
          labelKey: 'classes.pattern',
          badge: { kind: 'count', value: loaded.schedules.length },
          content: () => (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('classes.pattern')}
                </h2>
                <p className="text-sm text-foreground-muted">{t('classes.patternHint')}</p>
              </div>

              {loaded.schedules.length === 0 ? (
                <p className="text-foreground-muted">{t('classes.noSlotsYet')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {loaded.schedules.map((slot) => (
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
                      {loaded.canManage && (
                        <RemoveSlotButton
                          organizationId={options.organizationId}
                          groupId={loaded.id}
                          scheduleId={slot.id}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {loaded.canManage && (
                <div className="border-t border-border pt-4">
                  <AddSlotForm
                    organizationId={options.organizationId}
                    groupId={loaded.id}
                    dayNames={dayNames}
                  />
                </div>
              )}
            </section>
          ),
        },
        {
          slug: 'students',
          labelKey: 'detailTabs.students',
          badge: { kind: 'count', value: active.length },
          content: async () => {
            /*
              What this turma's hours in the water cost — POOLSE-28 AC 6, beside
              the occupancy because the two together decide whether a class is
              worth running. Fetched when this tab opens.

              Null when the endpoint refuses: the report is owner and admin, so
              an instructor gets the occupancy and no shell of a figure. Read off
              the tank's own report, never computed here.
            */
            const energy = await apiFetch<GroupCost>(`/energy/class-groups/${id}/cost`).catch(
              () => null,
            );

            return (
              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {loaded.capacity === null
                    ? t('classes.enrolledUnlimited', { count: active.length })
                    : t('classes.enrolledOf', { count: active.length, capacity: loaded.capacity })}
                </h2>

                {/*
                  The cost of the water, under the heading that counts the people
                  in it. Absent entirely when the tank is unmetered or unpriced —
                  there is no figure to soften, and an empty row would read as free.
                */}
                {energy?.share != null && energy.share.shareCents !== null && (
                  <p className="text-sm text-foreground-muted">
                    {t('energy.perUse.groupShare', {
                      amount: `${centsToText(energy.share.shareCents)} €`,
                      hours: format.number(energy.share.taughtMinutes / 60, {
                        maximumFractionDigits: 1,
                      }),
                      pool: energy.poolName ?? '',
                      rate:
                        energy.costPerHourCents === null
                          ? '—'
                          : `${centsToText(energy.costPerHourCents)} €`,
                    })}{' '}
                    {t('energy.perUse.groupCaveat')}
                  </p>
                )}

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
                          <PersonAvatar id={student.studentId} name={student.displayName} size="sm" />
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
                        <span className="flex shrink-0 items-center gap-2">
                          {/*
                            The category that actually applies to this person —
                            POOLSE-23 AC4. Shown to everybody who can read the
                            roster and editable only by somebody who may manage
                            it. The picker's empty answer is "from the turma",
                            because clearing a person's own category returns them
                            to their turma's.
                          */}
                          {options.options.feeCategories.length > 0 &&
                            (loaded.canManage ? (
                              <EnrollmentCategoryPicker
                                enrollmentId={student.enrollmentId}
                                categories={options.options.feeCategories}
                                own={student.feeCategoryId}
                                effective={student.feeCategoryName}
                              />
                            ) : (
                              student.feeCategoryName !== null && (
                                <span className="rounded bg-surface-muted px-2 py-0.5 text-sm text-foreground-muted">
                                  {student.feeCategoryName}
                                </span>
                              )
                            ))}

                          {loaded.canManage && (
                            <EndEnrollmentButton
                              organizationId={options.organizationId}
                              groupId={loaded.id}
                              enrollmentId={student.enrollmentId}
                            />
                          )}
                        </span>
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
                          {loaded.canManage && (
                            <EndEnrollmentButton
                              organizationId={options.organizationId}
                              groupId={loaded.id}
                              enrollmentId={student.enrollmentId}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {loaded.canManage && (
                  <div className="border-t border-border pt-4">
                    <EnrolForm
                      // The turma's level, so the picker can offer the right ages
                      // first — round 5. Null when the turma has no level.
                      level={
                        options.options.levels.find((candidate) => candidate.id === loaded.levelId) ??
                        null
                      }
                      organizationId={options.organizationId}
                      groupId={loaded.id}
                      students={available}
                    />
                  </div>
                )}
              </section>
            );
          },
        },
      ]}
    />
  );
}

import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Classes,
  type EnrolledStudent,
  type FacilityGrid,
} from '@/lib/api';
import { PartnerClasses } from './partner-classes';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import { PageError, PageShell } from '@/components/page-shell';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The whole week, and who is in it.
 *
 * Deliberately a *timetable* and not a calendar, and the subtitle says so. It
 * shows "Tuesdays at 18:00", not "Tuesday 15 December", because until closures
 * and session generation exist (1.5 and 1.6) nothing here knows the pool shuts
 * in August. A grid that looked like a calendar while showing a class on
 * Christmas Day would be worse than one that is honest about what it is.
 */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  /*
    Which turmas — slice 1.12.

    In the URL rather than in a preference, for the reason POOLSE-54 settled for
    the grid's staffing filter: "the four I teach" is a finding somebody links to
    or comes back to, not a habit. The API decides the default from the caller's
    roles, so an absent parameter is not "all" — it is "whichever is useful to
    you", and the answer comes back in `scope`.
  */
  const { scope } = await searchParams;
  const asked = scope === 'mine' || scope === 'all' ? `?scope=${scope}` : '';

  let data: Classes | null = null;
  let failure: LoadFailure | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Classes>(`/class-groups${asked}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = describeLoad(error);
  }

  /*
    The lane grid, for the parcerias block below — one request, best-effort.

    Turmas have had a card each on this screen since the beginning; a parceria
    had nothing, so the only way to move a school's hour was to find its block on
    the calendar and drag it. Losing this must not cost the page, so a refusal
    leaves the block absent rather than the screen broken.
  */
  let grid: (FacilityGrid & { facilityId: string; openWeekdays: number[] }) | null = null;
  if (data !== null) {
    const site = data.facilities[0];
    if (site !== undefined) {
      const loaded = await apiFetch<FacilityGrid>(`/facilities/${site.id}/grid`).catch(
        () => null,
      );
      if (loaded !== null) {
        grid = {
          ...loaded,
          facilityId: site.id,
          // Closed days are not offered in the pickers. The API refuses them
          // anyway; this is what stops somebody being invited to try.
          openWeekdays: site.hours
            .filter((hour) => hour.available)
            .map((hour) => hour.weekday),
        };
      }
    }
  }

  const dayNames = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)]),
  );

  /**
   * The active roll, alphabetical — POOLSE-08.
   *
   * `localeCompare` with the reader's locale rather than a raw string sort, so
   * "Ângela" sorts where a Portuguese speaker looks for it instead of after "Zé".
   * Waiting-list students are excluded: they are not in the class yet, and a
   * register that listed them would be wrong on the day.
   */
  const namesOf = (group: { students: EnrolledStudent[] }): string[] =>
    group.students
      .filter((student) => student.status === 'active')
      // Already abbreviated and already filed by surname by the server —
      // POOLSE-32. Re-sorting here on the composed string would order by given
      // name and disagree with every other list of the same children.
      .map((student) => student.shortName);

  // One entry per slot per turma: a turma running Tuesday and Thursday appears
  // in both columns, which is what a week looks like.
  const turmaEntries: WeekEntry[] = (data?.groups ?? []).flatMap((group) =>
    group.schedules.map((slot) => ({
      key: slot.id,
      weekday: slot.weekday,
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      title: group.name,
      subtitle: [group.poolName, group.lane === null ? null : t('classes.laneN', { lane: group.lane })]
        .filter(Boolean)
        .join(' · '),
      // No roll inside the card — round 5. The names made every square as tall
      // as its turma is big, so a week of twelve classes was a page of lists.
      // They are on the hover panel below, which is where somebody asking "who
      // is in this?" looks.

      href: `/dashboard/classes/${group.id}`,
      // POOLSE-15. The full roll and the detail the column has no room for. The
      // names are the same array the slot already holds, so this costs nothing
      // and needs no request of its own.
      detail: {
        facts: [
          group.levelName === null
            ? null
            : { label: t('classes.level'), value: group.levelName },
          /*
           * What a place here costs — POOLSE-42.
           *
           * Matched on this turma's level and its own weekly slot count, by the
           * API. Absent rather than zero when the site has no price for that
           * combination: "0,00 €" would read as free.
           */
          group.monthlyPriceCents === null
            ? null
            : {
                label: t('classes.price'),
                value: t('classes.priceMonthly', {
                  amount: formatCents(locale, group.monthlyPriceCents),
                }),
              },
          group.instructorName === null
            ? null
            : { label: t('classes.instructor'), value: group.instructorName },
          {
            label: t('classes.when'),
            value: `${dayNames[slot.weekday]} · ${slot.startTime} · ${slot.durationMinutes}′`,
          },
          group.poolName === null
            ? null
            : {
                label: t('classes.pool'),
                value: [
                  group.poolName,
                  group.lane === null ? null : t('classes.laneN', { lane: group.lane }),
                ]
                  .filter(Boolean)
                  .join(' · '),
              },
        ].filter((fact): fact is { label: string; value: string } => fact !== null),
        // Only where a capacity is set. "9/null" would be worse than silence.
        occupancy:
          group.capacity === null
            ? undefined
            : `${namesOf(group).length}/${group.capacity}`,
        people: namesOf(group),
        peopleEmpty: t('classes.noStudents'),
      },
    })),
  );

  /*
   * The parcerias, on the same week grid as the turmas.
   *
   * A school's hour occupies the pool exactly as a turma does, and a "This week"
   * that showed only turmas was telling a manager the Tuesday morning was free
   * when a school had booked every lane of it. The Parcerias card below stays —
   * it is where a partnership is *edited* — but the week is the week.
   *
   * Distinguished by the **partner's own colour** as a left rule, which is the
   * colour the lane grid already tints its blocks with, so the same school reads
   * the same on both screens. Never colour alone: the card carries the partner's
   * name and the headcount as text, and the hover panel says the rest.
   */
  const partnerEntries: WeekEntry[] = (grid?.bookings ?? [])
    .filter((booking) => booking.subjectType === 'parceria')
    .map((booking) => {
      const lanes = booking.laneIds
        .map((id) => grid?.lanes.find((lane) => lane.id === id)?.name)
        .filter((name): name is string => name !== undefined);

      const teacher =
        booking.ownInstructorName ?? booking.instructorName ?? booking.subtitle;

      return {
        key: `parceria:${booking.id}`,
        weekday: booking.weekday,
        startTime: booking.startTime,
        durationMinutes: booking.durationMinutes,
        title: booking.name,
        subtitle: [booking.subtitle, lanes.join(', ')].filter(Boolean).join(' · '),
        accentColour: booking.partnerColour,
        detail: {
          facts: [
            booking.subtitle === null
              ? null
              : { label: t('grid.partner'), value: booking.subtitle },
            booking.groupTag === null
              ? null
              : { label: t('partners.tag'), value: booking.groupTag },
            {
              label: t('classes.when'),
              value: `${dayNames[booking.weekday]} · ${booking.startTime} · ${booking.durationMinutes}′`,
            },
            lanes.length === 0
              ? null
              : { label: t('grid.lane'), value: lanes.join(', ') },
            teacher === null
              ? null
              : { label: t('grid.instructor'), value: teacher },
          ].filter((fact): fact is { label: string; value: string } => fact !== null),
          /*
           * The participant count, where the group has been sized. A parceria
           * takes no register — POOLSE-46 settled that — so there are no names
           * to list, and the panel says so rather than showing an empty roll.
           */
          occupancy:
            booking.headcount === null ? undefined : String(booking.headcount),
          people: [],
          peopleEmpty: t('classes.partnerNoRoll'),
        },
      };
    });

  const entries = [...turmaEntries, ...partnerEntries];

  /*
   * Not paginated — POOLSE-29. The week grid is a calendar bounded by the week,
   * not a register bounded by tenant size, so it is exempt under the rule in
   * CONVENTIONS.md. Paging it would empty Tuesday rather than shorten the page.
   */
  const unscheduled = (data?.groups ?? []).filter((group) => group.schedules.length === 0);

  return (
    <PageShell
      title={t('classes.title')}
      subtitle={t('classes.subtitle')}
      actions={<Link
          href="/dashboard/classes/seasons"
          className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('seasons.title')}
        </Link>}
    >

      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && (
        <>
          {/*
            The switch, and only for somebody with two views — slice 1.12.

            An instructor holding no office role has one list and does not need a
            control telling them so; an owner who also teaches has two real
            questions on the same evening — "what am I teaching" and "what is the
            club running" — and this is how they move between them.
          */}
          {data.canSwitchScope && (
            <nav aria-label={t('classes.scopeLabel')} className="flex flex-wrap items-center gap-2">
              {(['all', 'mine'] as const).map((option) => {
                const current = data.scope === option;
                return (
                  <Link
                    key={option}
                    href={option === 'all' ? '/dashboard/classes' : '/dashboard/classes?scope=mine'}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'rounded border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      current
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-border text-foreground-muted hover:border-border-strong hover:text-foreground',
                    )}
                  >
                    {t(option === 'all' ? 'classes.scopeAll' : 'classes.scopeMine')}
                  </Link>
                );
              })}
            </nav>
          )}

          {/*
            And for an instructor who has only their own, a line saying so —
            never a silent filter. A list of four where the club runs forty must
            explain itself, or it reads as turmas having gone missing.
          */}
          {!data.canSwitchScope && data.scope === 'mine' && (
            <p className="text-sm text-foreground-muted">{t('classes.scopeMineOnly')}</p>
          )}

          {data.canManage && (
            <Link
              href="/dashboard/classes/new"
              className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              {t('classes.create')}
            </Link>
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('classes.week')}
              </h2>
              <p className="text-sm text-foreground-muted">{t('classes.weekHint')}</p>
            </div>

            <WeekGrid
              entries={entries}
              dayNames={dayNames}
              emptyLabel={t('classes.noSlots')}
              // The one screen where a class on the grid opens its turma.
              // The whole square opens the turma here — this grid has no
              // controls on it, so the card can mean exactly one thing.
              linkCards
            />
          </section>

          {unscheduled.length > 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('classes.unscheduled')}
              </h2>
              <p className="mb-4 text-sm text-foreground-muted">{t('classes.unscheduledHint')}</p>
              <ul className="flex flex-col gap-2">
                {unscheduled.map((group) => (
                  <li key={group.id}>
                    <Link
                      href={`/dashboard/classes/${group.id}`}
                      className="text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {grid !== null && (
            <PartnerClasses
              organizationId={data.organizationId}
              facilityId={grid.facilityId}
              bookings={grid.bookings.filter((booking) => booking.subjectType === 'parceria')}
              slots={grid.slots}
              lanes={grid.lanes}
              openWeekdays={grid.openWeekdays}
              // The site's hours, so the time picker cannot offer an hour the
              // club is shut — POOLSE-QA-04.
              hours={data.facilities.find((site) => site.id === grid.facilityId)?.hours ?? []}
              canManage={data.canManage}
            />
          )}

          {data.groups.length === 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <p>{t('classes.none')}</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {data.canManage ? t('classes.noneHintManager') : t('classes.noneHintMember')}
              </p>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

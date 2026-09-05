'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FacilityDay, GridBooking, GridLane, GridSlot } from '@/lib/api';
import { withinHours } from '@/lib/opening-hours';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { Hint } from '@/components/ui/tooltip';
import { withFrom } from '@/lib/back';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';
import { moveBookingAction } from './classes.actions';
import { saveGroupAction } from '../facilities/[facilityId]/partners.actions';

/**
 * A partnership's timetable, on the Classes screen.
 *
 * Turmas have had a card each here since the beginning; parcerias had nothing,
 * which meant the only way to change when a school swims was to find its block
 * on the lane grid and drag it. That is a good way to move something by a row.
 * It is a poor way to say "6A is on Wednesday now, and there are 26 of them".
 *
 * **One card per booking, not per group.** A group that swims on Monday and
 * Wednesday is two rows on the grid and two lines on an invoice, and editing
 * "6A" as a single thing would beg the question of which of its two hours had
 * just been moved.
 *
 * **Two saves behind one button.** The day, the hour and the lanes belong to the
 * booking; the participant count belongs to the group. They are different rows
 * in different tables, so the form issues whichever of the two actually changed
 * — and if only the headcount moved, no booking is touched and no conflict check
 * runs against a move nobody made.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PartnerClasses({
  organizationId,
  facilityId,
  bookings,
  allBookings,
  slots,
  lanes,
  openWeekdays,
  hours,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  /** Parceria bookings only — the caller filters, so this renders what it is given. */
  bookings: GridBooking[];
  /** Every booking on the grid, for working out whether a tank is full — 8.1. */
  allBookings: GridBooking[];
  slots: GridSlot[];
  hours: FacilityDay[];
  lanes: GridLane[];
  /** ISO weekdays the site opens. A closed day is not offered. */
  openWeekdays: number[];
  canManage: boolean;
}): React.ReactElement | null {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  // Nothing to show is not an empty state here: the Classes screen belongs to
  // turmas, and a club with no partnerships should not be told so twice.
  if (bookings.length === 0) return null;

  return (
    <section className="rounded border border-border bg-surface">
      {/*
        Collapsed by default — round 5, ticket 8.0.

        This screen belongs to turmas. Partnerships are edited here because there
        is nowhere better, not because they are what somebody came for, and an
        expanded list of a school's twelve groups pushed the week's own turmas
        below the fold every time.

        The heading is the toggle: a real button with `aria-expanded`, so it is
        reachable and announced, and the count is on the closed header so the
        reason to open it is visible while it is shut.
      */}
      <h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="partner-classes-body"
          className="flex w-full items-center justify-between gap-3 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <span>
            <span className="block text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('partnerClasses.title')}
              <span className="ml-2 normal-case tracking-normal text-foreground">
                {t('partnerClasses.count', { count: bookings.length })}
              </span>
            </span>
            <span className="mt-1 block text-sm text-foreground-muted">
              {t('partnerClasses.hint')}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </h2>

      {open && (
      <ul id="partner-classes-body" className="flex flex-col gap-3 border-t border-border p-5">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <PartnerCard
              organizationId={organizationId}
              facilityId={facilityId}
              booking={booking}
              allBookings={allBookings}
              slots={slots}
              hours={hours}
              lanes={lanes}
              openWeekdays={openWeekdays}
              canManage={canManage}
            />
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}

/**
 * Which lanes of the tank are in use at this booking's hour — round 5, 8.1.
 *
 * **Visible text, with the tooltip saying the same thing.** The ticket asks for
 * a hover tooltip; the convention is that a tooltip may clarify a control but is
 * never the only place a piece of information appears. Both are satisfied by
 * putting the sentence on the card and letting `title` repeat it — and the
 * element is focusable, so the hover is not a mouse-only feature.
 *
 * Counted across *everything* sharing the tank at that time, not just this
 * booking: "all lanes taken" is a fact about the water, and a card that only
 * knew its own lanes would say three of six were busy while a turma held the
 * other three.
 *
 * The numbers are the lanes' own positions, so "1, 3, 4" means the lanes the
 * club calls 1, 3 and 4 — not the first, third and fourth of whatever this
 * booking happens to hold.
 */
function lanesInUse(
  booking: GridBooking,
  all: GridBooking[],
  lanes: GridLane[],
): { taken: { position: number; by: string }[]; total: number } | null {
  const own = lanes.find((lane) => lane.id === booking.laneIds[0]);
  if (own === undefined) return null;

  const poolLanes = lanes.filter((lane) => lane.poolId === own.poolId);
  const start = toMinutes(booking.startTime);
  const end = start + booking.durationMinutes;

  /*
   * Who holds each lane, not merely that somebody does — round 6, ticket 3.
   *
   * The list in the hover gives every lane a row, and a row reading only "3."
   * is a marker with nothing beside it. The name is what makes the breakdown
   * worth opening: it says the tank is full *of what*, which is the question
   * somebody looking at a clash is actually asking.
   *
   * First writer wins on the rare double-booking, so the row is stable rather
   * than depending on array order.
   */
  const busy = new Map<string, string>();
  for (const other of all) {
    if (other.weekday !== booking.weekday) continue;
    const from = toMinutes(other.startTime);
    if (from >= end || from + other.durationMinutes <= start) continue;
    for (const laneId of other.laneIds) if (!busy.has(laneId)) busy.set(laneId, other.name);
  }

  return {
    taken: poolLanes
      .filter((lane) => busy.has(lane.id))
      .map((lane) => ({ position: lane.position, by: busy.get(lane.id) ?? '' }))
      .sort((left, right) => left.position - right.position),
    total: poolLanes.length,
  };
}

/**
 * The busy lanes, each marked with its own number — round 6, ticket 3.
 *
 * **An `<ol>` with no list-style, and the number written out.** A browser's own
 * marker counts the items, so lanes 1, 3 and 4 would be marked "1. 2. 3." — a
 * list that says the tank has three lanes in use and names the wrong ones. The
 * marker has to be the lane's own position, which means rendering it.
 *
 * `<ol>` rather than `<ul>` because the order carries meaning: these are lanes
 * across a tank, read left to right, and a screen reader announcing them as an
 * ordered list of three is telling the truth about the shape of the water.
 *
 * The number is `aria-hidden` and repeated inside the row's accessible label,
 * because "3." read as a bare marker beside a name is two fragments rather than
 * a sentence.
 */
function LaneList({ taken }: { taken: { position: number; by: string }[] }): React.ReactElement {
  const t = useTranslations();

  return (
    <ol className="flex list-none flex-col gap-0.5 p-0">
      {taken.map((lane) => (
        <li key={lane.position} className="flex items-baseline gap-1.5">
          <span aria-hidden className="w-5 shrink-0 text-right tabular-nums text-foreground-muted">
            {lane.position}.
          </span>
          <span>
            <span className="sr-only">{t('partnerClasses.lane', { lane: lane.position })} </span>
            {lane.by}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** `HH:MM` to minutes past midnight, for the overlap test above. */
function toMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function PartnerCard({
  organizationId,
  facilityId,
  booking,
  allBookings,
  slots,
  lanes,
  openWeekdays,
  hours,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  booking: GridBooking;
  allBookings: GridBooking[];
  slots: GridSlot[];
  lanes: GridLane[];
  openWeekdays: number[];
  hours: FacilityDay[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, saveGroup, groupPending] = useSavedAction(saveGroupAction, INITIAL);

  const [weekday, setWeekday] = useState(String(booking.weekday));
  const [slotId, setSlotId] = useState(booking.slotId ?? '');
  const [laneCount, setLaneCount] = useState(String(Math.max(1, booking.laneIds.length)));
  const [headcount, setHeadcount] = useState(String(booking.headcount ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * The lanes a count implies, starting where the booking already starts.
   *
   * "Three pistas" has to become three specific, adjacent lane ids, because that
   * is what a booking occupies — and they must be contiguous or the API refuses
   * them. Growing from the current first lane is the reading that leaves the
   * block where the operator last put it.
   */
  const poolLanes = lanes.filter(
    (lane) => lane.poolId === lanes.find((l) => l.id === booking.laneIds[0])?.poolId,
  );
  const anchor = Math.max(
    0,
    poolLanes.findIndex((lane) => lane.id === booking.laneIds[0]),
  );
  const wanted = poolLanes.slice(anchor, anchor + Number(laneCount || '1'));

  /** Which slots this day group offers, so the picker never lists a Saturday row. */
  const group =
    Number(weekday) === 6 ? 'saturday' : Number(weekday) === 7 ? 'sunday' : 'weekday';
  /*
   * The hours this day actually offers — POOLSE-QA-04.
   *
   * `dayGroup` alone only keeps Saturday's rows off a Tuesday. It said nothing
   * about a site that opens at 12:30, so the editor listed 06:30–07:15 through
   * 11:45–12:30 as ordinary choices and the API refused every one of them. The
   * same rule the calendar grid uses, from the same function, so the two screens
   * cannot drift apart again.
   */
  const daySlots = slots.filter(
    (slot) =>
      slot.dayGroup === group &&
      withinHours(hours, Number(weekday), slot.startTime, slot.endTime),
  );

  const scheduleChanged =
    Number(weekday) !== booking.weekday ||
    slotId !== (booking.slotId ?? '') ||
    wanted.length !== booking.laneIds.length;

  const sizeChanged = Number(headcount) !== (booking.headcount ?? 0);

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (scheduleChanged) {
        const moved = await moveBookingAction(organizationId, booking.id, {
          weekday: Number(weekday),
          slotId: slotId === '' ? null : slotId,
          startTime: slotId === '' ? booking.startTime : null,
          laneIds: wanted.map((lane) => lane.id),
        });
        if (!moved.ok) {
          // The API names what is in the way; showing it beside the card is the
          // whole point of having the reason rather than a status code.
          setError(moved.detail ?? moved.errorKey);
          return;
        }
      }

      if (sizeChanged && booking.partnerGroupId !== null && booking.partnerId !== null) {
        /*
         * Every group field goes, not just the number.
         *
         * `saveGroupAction` writes the row wholesale, so sending only the count
         * would blank the tag, the notes and the group's own instructor. They
         * ride along from the grid payload for exactly this reason.
         */
        const form = new FormData();
        form.set('partnerId', booking.partnerId);
        form.set('groupId', booking.partnerGroupId);
        form.set('name', booking.name);
        form.set('participantCount', headcount);
        form.set('levelId', booking.levelId ?? '');
        form.set('tag', booking.groupTag ?? '');
        form.set('notes', booking.groupNotes ?? '');
        if (booking.bringsOwnInstructor) {
          form.set('bringsOwnInstructor', 'on');
          form.set('ownInstructorName', booking.ownInstructorName ?? '');
        }
        saveGroup(form);
      }
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || groupPending;
  const laneUse = lanesInUse(booking, allBookings, lanes);

  return (
    <div className="flex flex-col gap-3 rounded border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Decorative: the names beside it carry the information. */}
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: booking.partnerColour ?? undefined }}
        />
        <span className="font-medium">{booking.name}</span>
        {booking.partnerId !== null && (
          <Link
            href={withFrom(
              `/dashboard/facilities/partners/${booking.partnerId}`,
              '/dashboard/classes',
            )}
            className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {booking.subtitle}
          </Link>
        )}
        {booking.groupTag !== null && (
          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground-muted">
            {booking.groupTag}
          </span>
        )}

        {/*
          Which lanes the tank has busy at this hour — 8.1, reworked in round 6.

          **The summary stays visible; the hover breaks it down.** A `title`
          attribute cannot hold a list, and round 6 asks for one whose markers
          are the lane numbers themselves. So the sentence a person needs —
          "all lanes taken", or which numbers — is still text on the card, and
          the tooltip adds only who is in each lane, which every other card on
          this screen already says out loud. Nothing lives in the tooltip alone.

          `tabIndex={0}` so it opens on keyboard focus as well as hover: a
          control whose meaning is only available to a pointer is a control
          half the users cannot read. Radix handles the rest.
        */}
        {laneUse !== null && (
          <Hint
            text={
              laneUse.taken.length >= laneUse.total ? (
                t('partnerClasses.allLanesTaken')
              ) : (
                <LaneList taken={laneUse.taken} />
              )
            }
          >
            <span
              tabIndex={0}
              className="rounded text-sm text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {laneUse.taken.length >= laneUse.total
                ? t('partnerClasses.allLanesTaken')
                : t('partnerClasses.lanesInUse', {
                    lanes: laneUse.taken.map((lane) => lane.position).join(', '),
                  })}
            </span>
          </Hint>
        )}
      </div>

      {canManage ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className={FIELD_COLUMN}>
              <label htmlFor={`day-${booking.id}`} className={FIELD_LABEL}>
                {t('partnerClasses.day')}
              </label>
              <select
                id={`day-${booking.id}`}
                value={weekday}
                onChange={(event) => setWeekday(event.target.value)}
                className={CONTROL_LINE}
              >
                {/* Closed days are not offered — the API refuses them anyway. */}
                {openWeekdays.map((day) => (
                  <option key={day} value={String(day)}>
                    {t(`week.${day}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className={FIELD_COLUMN}>
              <label htmlFor={`slot-${booking.id}`} className={FIELD_LABEL}>
                {t('partnerClasses.time')}
              </label>
              <select
                id={`slot-${booking.id}`}
                value={slotId}
                onChange={(event) => setSlotId(event.target.value)}
                className={CONTROL_LINE}
              >
                <option value="">{t('partnerClasses.offGrid')}</option>
                {daySlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.startTime}–{slot.endTime}
                  </option>
                ))}
              </select>
            </div>

            <div className={FIELD_COLUMN}>
              <label htmlFor={`lanes-${booking.id}`} className={FIELD_LABEL}>
                {t('partnerClasses.lanes')}
              </label>
              <input
                id={`lanes-${booking.id}`}
                type="number"
                min={1}
                max={Math.max(1, poolLanes.length)}
                value={laneCount}
                onChange={(event) => setLaneCount(event.target.value)}
                className={CONTROL_LINE}
              />
            </div>

            <div className={FIELD_COLUMN}>
              <label htmlFor={`size-${booking.id}`} className={FIELD_LABEL}>
                {t('partnerClasses.students')}
              </label>
              <input
                id={`size-${booking.id}`}
                type="number"
                min={0}
                value={headcount}
                onChange={(event) => setHeadcount(event.target.value)}
                className={CONTROL_LINE}
              />
            </div>
          </div>

          {/* Which lanes the number actually means, spelled out. "3" is not a
              position, and the operator is choosing a place as well as a count. */}
          {wanted.length > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('partnerClasses.willUse', {
                lanes: wanted.map((lane) => lane.name).join(', '),
              })}
            </p>
          )}

          {error !== null && <p className="text-sm text-danger">{t(error)}</p>}

          <div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending || (!scheduleChanged && !sizeChanged)}
              className={cn(BUTTON)}
            >
              {pending ? t('common.working') : t('common.save')}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-foreground-muted">
          {t('partnerClasses.readOnly', {
            day: t(`week.${booking.weekday}`),
            time: booking.startTime,
            lanes: booking.laneIds.length,
            students: booking.headcount ?? 0,
          })}
        </p>
      )}
    </div>
  );
}

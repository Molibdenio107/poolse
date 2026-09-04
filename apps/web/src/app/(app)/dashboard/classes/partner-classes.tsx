'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FacilityDay, GridBooking, GridLane, GridSlot } from '@/lib/api';
import { withinHours } from '@/lib/opening-hours';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { withFrom } from '@/lib/back';
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
  slots: GridSlot[];
  hours: FacilityDay[];
  lanes: GridLane[];
  /** ISO weekdays the site opens. A closed day is not offered. */
  openWeekdays: number[];
  canManage: boolean;
}): React.ReactElement | null {
  const t = useTranslations();

  // Nothing to show is not an empty state here: the Classes screen belongs to
  // turmas, and a club with no partnerships should not be told so twice.
  if (bookings.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('partnerClasses.title')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">{t('partnerClasses.hint')}</p>
      </div>

      <ul className="flex flex-col gap-3">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <PartnerCard
              organizationId={organizationId}
              facilityId={facilityId}
              booking={booking}
              slots={slots}
              hours={hours}
              lanes={lanes}
              openWeekdays={openWeekdays}
              canManage={canManage}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartnerCard({
  organizationId,
  facilityId,
  booking,
  slots,
  lanes,
  openWeekdays,
  hours,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  booking: GridBooking;
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

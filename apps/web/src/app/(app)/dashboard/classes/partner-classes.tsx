'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FromLink } from '@/components/from-link';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FacilityDay, GridBooking, GridLane, GridSlot } from '@/lib/api';
import { withinHours } from '@/lib/opening-hours';
import { partnerClashSentence } from '@/lib/partner-days';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { Hint } from '@/components/ui/tooltip';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';
import { bookPartnerDaysAction, moveBookingAction, removePartnerDayAction } from './classes.actions';
import { saveGroupAction } from '../facilities/[facilityId]/partners.actions';
import { Reveal } from '@/components/ui/reveal';

/**
 * A partnership's timetable, on the Classes screen.
 *
 * Turmas have had a card each here since the beginning; parcerias had nothing,
 * which meant the only way to change when a school swims was to find its block
 * on the lane grid and drag it. That is a good way to move something by a row.
 * It is a poor way to say "6A is on Wednesday now, and there are 26 of them".
 *
 * **One card per group, one line per day** — POOLSE-117 (Rui, 28-10-2026). A
 * school's class that swims on Monday and Thursday is one class: the card says
 * its name, its partnership and its headcount once, then a line per day, each
 * with its own day, hour and lanes and a *Remover este dia*. *Adicionar dia*
 * books another, through the same all-or-nothing path the calendar uses.
 *
 * **Two kinds of save.** The day, the hour and the lanes belong to a booking;
 * the participant count belongs to the group. They are different rows in
 * different tables, so each has its own button and touches only its own row.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border bg-surface text-foreground hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The lane a booking starts in; `''` is *Sem pista*. */
const NO_LANE = '';

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
  defaultOpen = false,
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
  /**
   * Open on arrival. True where the list is the whole of what is on screen —
   * the Classes page's Parcerias section, 12 October 2026 — because a section
   * chosen by its pill that then needs a second click to show anything is a
   * click spent for nothing. The collapse below was for a page that stacked it
   * under the week.
   */
  defaultOpen?: boolean;
}): React.ReactElement | null {
  const t = useTranslations();
  const [open, setOpen] = useState(defaultOpen);

  // Nothing to show is not an empty state here: the Classes screen belongs to
  // turmas, and a club with no partnerships should not be told so twice.
  if (bookings.length === 0) return null;

  // One card per group, its days in week order.
  const groups = new Map<string, GridBooking[]>();
  for (const booking of bookings) {
    const key = booking.partnerGroupId ?? booking.id;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  for (const days of groups.values()) {
    days.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  }

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
                {t('partnerClasses.count', { count: groups.size })}
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

      <Reveal open={open}>
        <ul id="partner-classes-body" className="flex flex-col gap-3 border-t border-border p-5">
          {[...groups.entries()].map(([key, days]) => (
            <li key={key}>
              <GroupCard
                organizationId={organizationId}
                facilityId={facilityId}
                days={days}
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
      </Reveal>
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

/** Which slots a day offers: its day group, inside the site's hours (POOLSE-QA-04). */
function slotsOn(slots: GridSlot[], hours: FacilityDay[], weekday: number): GridSlot[] {
  const group = weekday === 6 ? 'saturday' : weekday === 7 ? 'sunday' : 'weekday';
  return slots.filter(
    (slot) => slot.dayGroup === group && withinHours(hours, weekday, slot.startTime, slot.endTime),
  );
}

/** `count` adjacent lanes of one tank from `first`, or none for *Sem pista*. */
function lanesFrom(lanes: GridLane[], first: string, count: number): GridLane[] {
  const start = lanes.find((lane) => lane.id === first);
  if (start === undefined) return [];
  const pool = lanes.filter((lane) => lane.poolId === start.poolId).sort((a, b) => a.position - b.position);
  const at = pool.findIndex((lane) => lane.id === first);
  return pool.slice(at, at + Math.max(1, count));
}

/** The lane picker's options: *Sem pista*, then every lane named with its tank. */
function LaneOptions({ lanes }: { lanes: GridLane[] }): React.ReactElement {
  const t = useTranslations();
  return (
    <>
      <option value={NO_LANE}>{t('partnerDays.noLane')}</option>
      {lanes.map((lane) => (
        <option key={lane.id} value={lane.id}>
          {lane.poolName} · {lane.name}
        </option>
      ))}
    </>
  );
}

function GroupCard({
  organizationId,
  facilityId,
  days,
  allBookings,
  slots,
  lanes,
  openWeekdays,
  hours,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  /** The group's bookings, one per day, at least one. */
  days: GridBooking[];
  allBookings: GridBooking[];
  slots: GridSlot[];
  lanes: GridLane[];
  openWeekdays: number[];
  hours: FacilityDay[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const first = days[0]!;
  const [, saveGroup, groupPending] = useSavedAction(saveGroupAction, INITIAL);
  const [headcount, setHeadcount] = useState(String(first.headcount ?? 0));
  const [adding, setAdding] = useState(false);
  const sizeChanged = Number(headcount) !== (first.headcount ?? 0);

  function saveSize(): void {
    if (first.partnerGroupId === null || first.partnerId === null) return;
    /*
     * Every group field goes, not just the number. `saveGroupAction` writes the
     * row wholesale, so sending only the count would blank the tag, the notes
     * and the group's own instructor. They ride along from the grid payload.
     */
    const form = new FormData();
    form.set('partnerId', first.partnerId);
    form.set('groupId', first.partnerGroupId);
    form.set('name', first.name);
    form.set('participantCount', headcount);
    form.set('levelId', first.levelId ?? '');
    form.set('tag', first.groupTag ?? '');
    form.set('notes', first.groupNotes ?? '');
    if (first.bringsOwnInstructor) {
      form.set('bringsOwnInstructor', 'on');
      form.set('ownInstructorName', first.ownInstructorName ?? '');
    }
    saveGroup(form);
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Decorative: the names beside it carry the information. */}
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: first.partnerColour ?? undefined }}
        />
        <span className="font-medium">{first.name}</span>
        {first.partnerId !== null && (
          <FromLink
            href={`/dashboard/facilities/partners/${first.partnerId}`}
            className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {first.subtitle}
          </FromLink>
        )}
        {first.groupTag !== null && (
          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground-muted">
            {first.groupTag}
          </span>
        )}
        <span className="text-sm text-foreground-muted">
          {t('partnerDays.dayCount', { count: days.length })}
        </span>
      </div>

      {/* The headcount is the group's — one figure, whichever day. */}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className={FIELD_COLUMN}>
            <label htmlFor={`size-${first.id}`} className={FIELD_LABEL}>
              {t('partnerClasses.students')}
            </label>
            <input
              id={`size-${first.id}`}
              type="number"
              min={0}
              value={headcount}
              onChange={(event) => setHeadcount(event.target.value)}
              className={cn(CONTROL_LINE, 'w-28')}
            />
          </div>
          {sizeChanged && (
            <button type="button" onClick={saveSize} disabled={groupPending} className={BUTTON}>
              {groupPending ? t('common.working') : t('common.save')}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">
          {t('partnerDays.students', { count: first.headcount ?? 0 })}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-border rounded border border-border">
        {days.map((booking) => (
          <li key={booking.id} className="p-3">
            <DayLine
              organizationId={organizationId}
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

      {canManage && first.partnerGroupId !== null && (
        <>
          <div>
            <button
              type="button"
              onClick={() => setAdding(!adding)}
              aria-expanded={adding}
              className={QUIET}
            >
              <Plus aria-hidden className="size-4" />
              {t('partnerDays.addDay')}
            </button>
          </div>
          <Reveal open={adding}>
            <AddDay
              organizationId={organizationId}
              facilityId={facilityId}
              groupId={first.partnerGroupId}
              slots={slots}
              hours={hours}
              lanes={lanes}
              openWeekdays={openWeekdays}
              onDone={() => setAdding(false)}
            />
          </Reveal>
        </>
      )}
    </div>
  );
}

/** One day of a group: its day, hour and lanes, editable, and *Remover este dia*. */
function DayLine({
  organizationId,
  booking,
  allBookings,
  slots,
  lanes,
  openWeekdays,
  hours,
  canManage,
}: {
  organizationId: string;
  booking: GridBooking;
  allBookings: GridBooking[];
  slots: GridSlot[];
  lanes: GridLane[];
  openWeekdays: number[];
  hours: FacilityDay[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();

  const [weekday, setWeekday] = useState(String(booking.weekday));
  const [slotId, setSlotId] = useState(booking.slotId ?? '');
  const [firstLane, setFirstLane] = useState(booking.laneIds[0] ?? NO_LANE);
  const [laneCount, setLaneCount] = useState(String(Math.max(1, booking.laneIds.length)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * The lanes a count implies, from the first lane chosen. "Three pistas" has to
   * become three specific, adjacent lane ids, because that is what a booking
   * occupies — and they must be contiguous or the API refuses them.
   */
  const wanted = firstLane === NO_LANE ? [] : lanesFrom(lanes, firstLane, Number(laneCount || '1'));
  const daySlots = slotsOn(slots, hours, Number(weekday));

  const changed =
    Number(weekday) !== booking.weekday ||
    slotId !== (booking.slotId ?? '') ||
    wanted.map((lane) => lane.id).join() !== booking.laneIds.join();

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
    const moved = await moveBookingAction(organizationId, booking.id, {
      weekday: Number(weekday),
      slotId: slotId === '' ? null : slotId,
      startTime: slotId === '' ? booking.startTime : null,
      laneIds: wanted.map((lane) => lane.id),
    });
    setBusy(false);
    // The API names what is in the way; showing it beside the line is the
    // whole point of having the reason rather than a status code.
    if (!moved.ok) setError(moved.detail ?? moved.errorKey);
  }

  async function remove(): Promise<void> {
    setError(null);
    setBusy(true);
    const removed = await removePartnerDayAction(organizationId, booking.id);
    setBusy(false);
    if (!removed.ok) {
      setError(removed.errorKey);
      return;
    }
    router.refresh();
  }

  const laneUse = lanesInUse(booking, allBookings, lanes);

  const summary = (
    <span className="text-sm">
      {t('partnerDays.line', {
        day: t(`week.${booking.weekday}`),
        time: booking.startTime,
        minutes: booking.durationMinutes,
      })}
      {' · '}
      {booking.laneIds.length === 0
        ? t('partnerDays.noLane')
        : t('partnerDays.laneCount', { count: booking.laneIds.length })}
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {summary}
        {/*
          Which lanes the tank has busy at this hour — 8.1, reworked in round 6.
          The sentence is on the line; the hover only adds who is in each lane,
          and it opens on keyboard focus too.
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

      {canManage && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
              <label htmlFor={`lane-${booking.id}`} className={FIELD_LABEL}>
                {t('partnerDays.firstLane')}
              </label>
              <select
                id={`lane-${booking.id}`}
                value={firstLane}
                onChange={(event) => setFirstLane(event.target.value)}
                className={CONTROL_LINE}
              >
                <LaneOptions lanes={lanes} />
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
                disabled={firstLane === NO_LANE}
                value={laneCount}
                onChange={(event) => setLaneCount(event.target.value)}
                className={CONTROL_LINE}
              />
            </div>
          </div>

          {/* Which lanes the number actually means, spelled out. */}
          {wanted.length > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('partnerClasses.willUse', { lanes: wanted.map((lane) => lane.name).join(', ') })}
            </p>
          )}

          {error !== null && <p className="text-sm text-danger">{t(error)}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy || !changed} className={BUTTON}>
              {busy ? t('common.working') : t('common.save')}
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy} className={QUIET}>
              <Trash2 aria-hidden className="size-4" />
              {t('partnerDays.removeDay')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** *Adicionar dia*: one more day at its own hour and lanes, refused in words on a clash. */
function AddDay({
  organizationId,
  groupId,
  slots,
  lanes,
  openWeekdays,
  hours,
  onDone,
}: {
  organizationId: string;
  facilityId: string;
  groupId: string;
  slots: GridSlot[];
  lanes: GridLane[];
  openWeekdays: number[];
  hours: FacilityDay[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [weekday, setWeekday] = useState(String(openWeekdays[0] ?? 1));
  const [slotId, setSlotId] = useState('');
  const [firstLane, setFirstLane] = useState(NO_LANE);
  const [laneCount, setLaneCount] = useState('1');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const daySlots = slotsOn(slots, hours, Number(weekday));
  const slot = daySlots.find((one) => one.id === slotId);

  async function add(): Promise<void> {
    if (slot === undefined) return;
    setErrors([]);
    setBusy(true);
    const result = await bookPartnerDaysAction(organizationId, groupId, {
      weekdays: [Number(weekday)],
      startTime: slot.startTime,
      durationMinutes: toMinutes(slot.endTime) - toMinutes(slot.startTime),
      laneIds: firstLane === NO_LANE ? [] : lanesFrom(lanes, firstLane, Number(laneCount || '1')).map((lane) => lane.id),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(
        result.clashes === undefined || result.clashes.length === 0
          ? [t(result.errorKey)]
          : result.clashes.map((clash) => partnerClashSentence(t, clash, slot.startTime)),
      );
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-dashed border-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className={FIELD_COLUMN}>
          <label htmlFor={`add-day-${groupId}`} className={FIELD_LABEL}>
            {t('partnerClasses.day')}
          </label>
          <select
            id={`add-day-${groupId}`}
            value={weekday}
            onChange={(event) => {
              setWeekday(event.target.value);
              setSlotId('');
            }}
            className={CONTROL_LINE}
          >
            {openWeekdays.map((day) => (
              <option key={day} value={String(day)}>
                {t(`week.${day}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={FIELD_COLUMN}>
          <label htmlFor={`add-slot-${groupId}`} className={FIELD_LABEL}>
            {t('partnerClasses.time')}
          </label>
          <select
            id={`add-slot-${groupId}`}
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            className={CONTROL_LINE}
          >
            <option value="">{t('partnerDays.chooseTime')}</option>
            {daySlots.map((one) => (
              <option key={one.id} value={one.id}>
                {one.startTime}–{one.endTime}
              </option>
            ))}
          </select>
        </div>
        <div className={FIELD_COLUMN}>
          <label htmlFor={`add-lane-${groupId}`} className={FIELD_LABEL}>
            {t('partnerDays.firstLane')}
          </label>
          <select
            id={`add-lane-${groupId}`}
            value={firstLane}
            onChange={(event) => setFirstLane(event.target.value)}
            className={CONTROL_LINE}
          >
            <LaneOptions lanes={lanes} />
          </select>
        </div>
        <div className={FIELD_COLUMN}>
          <label htmlFor={`add-lanes-${groupId}`} className={FIELD_LABEL}>
            {t('partnerClasses.lanes')}
          </label>
          <input
            id={`add-lanes-${groupId}`}
            type="number"
            min={1}
            disabled={firstLane === NO_LANE}
            value={laneCount}
            onChange={(event) => setLaneCount(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-danger" role="alert">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" onClick={() => void add()} disabled={busy || slot === undefined} className={BUTTON}>
          {busy ? t('common.working') : t('partnerDays.addThisDay')}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { DayGroup, TimeSlot } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import { addSlotsAction, removeSlotAction, updateSlotAction } from './slots.actions';

/**
 * The rows a schedule is written on — POOLSE-44.
 *
 * A club's timetable has rows before it has classes, and they are a property of
 * the building: 06:30, 08:45, 09:30, 10:15 … with a hole at lunchtime and a
 * different set at the weekend.
 *
 * **Generate, then correct.** That order is the whole design. Real grids are
 * produced by a rule and then hand-fixed — a 45-minute pitch with a gap in it,
 * and one slot that starts at 06:30 because the masters swim before work. An
 * editor that only generated would be abandoned at the first exception; one that
 * only took rows one at a time would never be filled in at all.
 *
 * **Three day groups, side by side.** Saturday and Sunday are separate because a
 * club that opens Saturday morning and not Sunday has to be able to say so.
 *
 * The generator runs here, in the browser, and posts the rows it produced. It is
 * arithmetic over what the operator typed, and doing it on the server would be a
 * second way to create a slot — with the operator unable to see the rows before
 * committing to them.
 */

const INITIAL: FormState = { ok: false };

const DAY_GROUPS: readonly DayGroup[] = ['weekday', 'saturday', 'sunday'];

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'h-control rounded border border-border px-4 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Minutes from midnight. `24:00` is 1440 — the end of the day, not the start. */
function toMinutes(clock: string): number {
  const [h = '0', m = '0'] = clock.split(':');
  return Number(h) * 60 + Number(m);
}

function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Whether a string is a time this grid can hold. */
function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) || value === '24:00';
}

export function SlotsPanel({
  organizationId,
  facilityId,
  slots,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  slots: TimeSlot[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<DayGroup>('weekday');

  const shown = slots.filter((slot) => slot.dayGroup === group);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('slots.hint')}</p>

      {/*
        The three groups as tabs rather than three stacked lists: they are the
        same grid asked about a different day, and a club looks at one at a time.
        Each carries its own count, so an empty weekend is visible without
        switching to it.
      */}
      <div role="tablist" aria-label={t('slots.dayGroupLabel')} className="flex flex-wrap gap-2">
        {DAY_GROUPS.map((candidate) => {
          const count = slots.filter((slot) => slot.dayGroup === candidate).length;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === group}
              onClick={() => setGroup(candidate)}
              className={cn(
                'rounded border px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                candidate === group
                  ? 'border-primary bg-primary/15 font-medium text-primary'
                  : 'border-border hover:border-primary/50 hover:text-primary',
              )}
            >
              {t(`slots.group.${candidate}`)}{' '}
              <span className="tabular-nums text-foreground-muted">({count})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('slots.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((slot) => (
            <li key={slot.id} className="py-2 first:pt-0 last:pb-0">
              <SlotRow
                organizationId={organizationId}
                facilityId={facilityId}
                slot={slot}
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="rounded border border-dashed border-border">
          <button
            type="button"
            onClick={() => setOpen((shownNow) => !shownNow)}
            aria-expanded={open}
            aria-controls="slot-generator"
            className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ChevronRight
              aria-hidden
              className={cn('size-4 transition-transform', open && 'rotate-90')}
            />
            {t('slots.generate')}
          </button>

          {open && (
            <div id="slot-generator" className="border-t border-border p-4">
              <Generator
                organizationId={organizationId}
                facilityId={facilityId}
                group={group}
                existing={shown}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Failure({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;

  return (
    <p className="w-full text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && state.detail !== '' && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

/**
 * One slot, corrected where it sits.
 *
 * Read-only until asked, because this list is scanned far more often than it is
 * edited and a column of live inputs reads as a form to fill in rather than as
 * the grid the club runs on.
 */
function SlotRow({
  organizationId,
  facilityId,
  slot,
  canManage,
}: {
  organizationId: string;
  facilityId: string;
  slot: TimeSlot;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useSavedAction(updateSlotAction, INITIAL);
  const [removeState, remove, removing] = useSavedAction(removeSlotAction, INITIAL);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-mono tabular-nums">
          {slot.startTime} – {slot.endTime}
        </span>

        {canManage && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('slots.edit')}
            </button>

            <form action={remove}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="facilityId" value={facilityId} />
              <input type="hidden" name="slotId" value={slot.id} />
              <button
                type="submit"
                disabled={removing}
                aria-label={t('slots.removeLabel', { from: slot.startTime, to: slot.endTime })}
                className="rounded text-foreground-muted hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Trash2 className="size-4" />
              </button>
            </form>
          </div>
        )}

        <Failure state={removeState} />
      </div>
    );
  }

  return (
    <form action={action} onSubmit={() => setEditing(false)} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="slotId" value={slot.id} />
      <input type="hidden" name="dayGroup" value={slot.dayGroup} />

      <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
        <label htmlFor={`slot-from-${slot.id}`} className={FIELD_LABEL}>
          {t('slots.from')}
        </label>
        <input
          id={`slot-from-${slot.id}`}
          name="startTime"
          type="time"
          required
          defaultValue={slot.startTime}
          className={CONTROL_LINE}
        />
      </div>

      <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
        <label htmlFor={`slot-to-${slot.id}`} className={FIELD_LABEL}>
          {t('slots.to')}
        </label>
        {/*
          Text rather than `type="time"`: a browser time picker cannot express
          `24:00`, and "to the end of the day" is a real slot a club writes.
        */}
        <input
          id={`slot-to-${slot.id}`}
          name="endTime"
          required
          defaultValue={slot.endTime}
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
          className={CONTROL_LINE}
        />
      </div>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? t('common.working') : t('common.save')}
      </button>
      <button type="button" onClick={() => setEditing(false)} className={BUTTON_QUIET}>
        {t('common.cancel')}
      </button>

      <Failure state={state} />
    </form>
  );
}

/**
 * "Gerar grelha" — start, end, duration, interval.
 *
 * Everything it will create is listed before anything is sent, and rows that
 * would collide with a slot already there are marked and dropped. The operator
 * sees the grid they are about to get; the alternative is a button that either
 * works or produces a conflict message about a row they never saw.
 */
function Generator({
  organizationId,
  facilityId,
  group,
  existing,
}: {
  organizationId: string;
  facilityId: string;
  group: DayGroup;
  existing: TimeSlot[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(addSlotsAction, INITIAL);

  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('12:00');
  const [duration, setDuration] = useState('45');
  const [gap, setGap] = useState('0');

  const valid = isClock(from) && isClock(to);
  const length = Number(duration);
  const interval = Number(gap);

  /*
   * The rows this would produce, computed as the operator types.
   *
   * A slot that would overlap something already on the grid is left out rather
   * than sent and refused: the server would reject the whole batch on the first
   * collision, and "we skipped 10:15 because it is taken" is a better answer
   * than "nothing happened".
   */
  const proposed: { startTime: string; endTime: string; clashes: boolean }[] = [];

  if (valid && Number.isFinite(length) && length > 0 && Number.isFinite(interval) && interval >= 0) {
    const end = toMinutes(to);
    for (let at = toMinutes(from); at + length <= end; at += length + interval) {
      const startTime = toClock(at);
      const endTime = toClock(at + length);
      proposed.push({
        startTime,
        endTime,
        clashes: existing.some(
          (slot) => toMinutes(slot.startTime) < at + length && at < toMinutes(slot.endTime),
        ),
      });
      // A zero-length step would loop forever; the guard above makes that
      // impossible, and this says so out loud for the next reader.
      if (length + interval <= 0) break;
    }
  }

  const wanted = proposed.filter((slot) => !slot.clashes);
  const skipped = proposed.length - wanted.length;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input
        type="hidden"
        name="slots"
        value={JSON.stringify(
          wanted.map((slot) => ({
            dayGroup: group,
            startTime: slot.startTime,
            endTime: slot.endTime,
          })),
        )}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
          <label htmlFor="generate-from" className={FIELD_LABEL}>
            {t('slots.from')}
          </label>
          <input
            id="generate-from"
            type="time"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
          <label htmlFor="generate-to" className={FIELD_LABEL}>
            {t('slots.to')}
          </label>
          <input
            id="generate-to"
            type="time"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-32')}>
          <label htmlFor="generate-duration" className={FIELD_LABEL}>
            {t('slots.duration')}
          </label>
          <input
            id="generate-duration"
            type="number"
            min={5}
            max={480}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-32')}>
          <label htmlFor="generate-gap" className={FIELD_LABEL}>
            {t('slots.interval')}
          </label>
          <input
            id="generate-gap"
            type="number"
            min={0}
            max={240}
            value={gap}
            onChange={(event) => setGap(event.target.value)}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      {/*
        What it will do, before it does it. Colour is not carrying the skipped
        rows — they are struck through and the count is stated in words.
      */}
      {proposed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground-muted">
            {t('slots.willCreate', { count: wanted.length })}
            {skipped > 0 && <> {t('slots.willSkip', { count: skipped })}</>}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {proposed.map((slot) => (
              <li
                key={slot.startTime}
                className={cn(
                  'rounded border px-2 py-0.5 font-mono text-xs tabular-nums',
                  slot.clashes
                    ? 'border-border text-foreground-muted line-through'
                    : 'border-primary/40 bg-primary/10',
                )}
              >
                {slot.startTime}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Failure state={state} />

      <button
        type="submit"
        disabled={pending || wanted.length === 0}
        className={cn(BUTTON, 'self-start')}
      >
        {pending ? t('common.working') : t('slots.generateAction', { count: wanted.length })}
      </button>
    </form>
  );
}

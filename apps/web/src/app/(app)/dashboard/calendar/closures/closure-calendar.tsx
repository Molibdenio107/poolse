'use client';

import { today } from '@/lib/dates';
import { useActionState, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, X } from 'lucide-react';
import type { Closure } from '@/lib/api';
import { YearGrid, type DayState } from '@/components/year-grid';
import { CONTROL_LINE, FIELD_LABEL, TextField } from '@/components/ui/field';
import type { FormState } from '../../actions';
import { createClosureAction, impactAction, removeClosureAction } from './closures.actions';

/**
 * Encerramentos as a year — POOLSE-31.
 *
 * The same twelve-month grid as Férias, and deliberately so: an operator who has
 * learned one calendar in this product should not have to learn a second. What
 * differs is what a day means — leave belongs to a person, a closure belongs to
 * the building.
 *
 * **Ranges are picked the way people pick dates.** Click the first day, move,
 * click the last. The days between paint as you move, so the range you are about
 * to create is the range you can see. A pair of date fields would be fewer
 * moving parts and would also mean typing "2027-03-14" to say "that Saturday".
 *
 * **Feriados are shown, not hidden.** Greyed, named, and not selectable: the
 * pool is already closed, and a closure over the top of one would be a second
 * reason for the same day. They stay keyboard-reachable, because a day whose
 * name only a mouse can reach is a day half the staff cannot read.
 *
 * **What a closure costs is said before it is made.** If the range covers
 * classes whose register has already been taken, the confirmation says how many.
 * Cancelling a class nobody marked is routine; cancelling one somebody stood at
 * the poolside and wrote down is not.
 */

const INITIAL: FormState = { ok: false };

/** Inclusive, and tolerant of the two clicks arriving in either order. */
function rangeOf(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function within(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

export function ClosureCalendar({
  organizationId,
  year,
  closures,
  pools,
  canManage,
}: {
  organizationId: string;
  year: number;
  closures: Closure[];
  /** Just enough to name a pool in the scope picker — what /closures sends. */
  pools: { id: string; name: string }[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  // Built here rather than passed in, exactly as Férias builds them: the month
  // and weekday names belong to the reader's locale, and the grid is the only
  // thing that needs them.
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(year, index, 1)),
        ),
      ),
    [locale, year],
  );

  const weekdayInitials = useMemo(
    () =>
      // 2024-01-01 was a Monday, so this walks Monday → Sunday in the reader's
      // own language rather than hard-coding "S T Q Q S S D".
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + index)),
        ),
      ),
    [locale],
  );

  const labelFor = (day: string): string =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));

  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<[string, string] | null>(null);

  /**
   * Day → the closure covering it.
   *
   * Built once per render rather than scanning every closure for each of 365
   * days. A club with twenty closures and a year of cells is 7 300 comparisons
   * otherwise, on every hover.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, Closure>();
    for (const closure of closures) {
      // A repeating closure is a pattern; this grid shows one year, so it is
      // projected onto that year rather than onto the dates it was created with.
      const from = closure.repeatsAnnually
        ? `${year}-${closure.startsOn.slice(5)}`
        : closure.startsOn;
      const to = closure.repeatsAnnually ? `${year}-${closure.endsOn.slice(5)}` : closure.endsOn;

      for (
        let day = new Date(`${from}T00:00:00Z`);
        day <= new Date(`${to}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        const iso = day.toISOString().slice(0, 10);
        if (iso.startsWith(String(year)) && !map.has(iso)) map.set(iso, closure);
      }
    }
    return map;
  }, [closures, year]);

  // The range being drawn: anchored on the first click, ending wherever the
  // cursor or focus currently is.
  const preview = anchor !== null && hovered !== null ? rangeOf(anchor, hovered) : null;

  const stateFor = (day: string): DayState => {
    /*
      The chosen range stays lit while the form is open — round 4 follow-up.

      Before, the second click cleared `anchor`, which cleared the preview, so
      the days you had just picked went back to looking like every other day and
      the form below asked for a reason for a range you could no longer see.
      Checked before the closure and preview branches because it is the most
      specific thing that can be true of a day: it is the one you are acting on.
    */
    if (pending !== null && within(day, pending[0], pending[1])) {
      return {
        className: 'bg-primary/40 ring-2 ring-inset ring-primary',
        description: t('calendar.legendSelecting'),
      };
    }

    const closure = byDay.get(day);

    if (closure !== undefined) {
      const holiday = closure.source !== 'manual';
      return {
        // Feriados read as absence of a working day; a closure reads as a
        // decision somebody made. Different colours because they are different
        // facts, and both carry their name.
        className: holiday ? 'bg-surface-muted text-foreground-muted' : 'bg-warning/25',
        description: closure.reason,
        title: closure.reason,
        disabled: holiday,
        focusable: holiday,
        // A dot marks a closure somebody made, so the two kinds differ by more
        // than hue. Absent on a feriado rather than set to undefined — see
        // exactOptionalPropertyTypes.
        ...(holiday ? {} : { marker: '•' }),
      };
    }

    if (preview !== null && within(day, preview[0], preview[1])) {
      return { className: 'bg-primary/30', description: t('calendar.rangeEnd') };
    }

    return {};
  };

  const pick = (day: string): void => {
    if (!canManage) return;

    /*
      A click anywhere on the grid abandons the range — round 4 follow-up.

      The way out of a half-finished closure used to be finding the "clear"
      button in the strip above; clicking another day did nothing at all, which
      is the first thing anybody tries. Now the grid is the escape hatch: one
      click puts the calendar back to neutral and takes the reason card with it.
      The second click then starts a fresh range, which is one more click than
      strictly necessary and much easier to explain than a click that both
      cancels and re-anchors.
    */
    if (pending !== null) {
      setPending(null);
      setAnchor(null);
      setHovered(null);
      return;
    }

    if (anchor === null) {
      setAnchor(day);
      setHovered(day);
      return;
    }

    // Second click closes the range and opens the form. The name is asked for
    // there rather than here, because a closure without a reason is a mystery
    // in six months.
    setPending(rangeOf(anchor, day));
    setAnchor(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        The same strip Férias puts above its grid: a bordered surface panel
        holding the state of the selection and the way out of it. Same shell,
        different verbs — that page counts chosen days and submits a request,
        this one is drawing a range.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
        <span className="text-sm">
          {anchor === null
            ? t('calendar.rangeStartHint')
            : t('calendar.rangeAnchored', { day: anchor })}
        </span>

        {anchor !== null && (
          <button
            type="button"
            onClick={() => {
              setAnchor(null);
              setHovered(null);
            }}
            className="rounded text-sm text-foreground-muted hover:text-foreground"
          >
            {t('calendar.clearRange')}
          </button>
        )}

        <Legend />
      </div>

      <p className="text-sm text-foreground-muted">
        {pending !== null
          ? t('calendar.rangeHeldHint')
          : anchor === null
            ? t('calendar.gridHint')
            : t('calendar.rangeEndHint')}
      </p>

      <YearGrid
        year={year}
        monthNames={monthNames}
        weekdayInitials={weekdayInitials}
        stateFor={stateFor}
        // Still pickable while a range is held: that click is what clears it.
        onPick={canManage ? pick : undefined}
        onHover={setHovered}
        labelFor={labelFor}
        // A closure cannot be declared for a week that has already happened.
        pastBefore={today()}
      />

      {pending !== null && (
        <ClosureForm
          organizationId={organizationId}
          range={pending}
          pools={pools}
          onDone={() => setPending(null)}
        />
      )}

      <ClosureList closures={closures} canManage={canManage} organizationId={organizationId} />
    </div>
  );
}

/**
 * What the colours mean — criterion 2, and the rule from CLAUDE.md.
 *
 * Every band on this calendar is also a row in the list below, so the colour is
 * a way of finding something rather than the only way of knowing it. The legend
 * is what makes the grid readable at a glance without that trip.
 */
function Legend(): React.ReactElement {
  const t = useTranslations();

  const items = [
    { className: 'bg-surface-muted border border-border', label: t('calendar.legendHoliday') },
    { className: 'bg-warning/25', label: t('calendar.legendClosure') },
    { className: 'bg-primary/30', label: t('calendar.legendSelecting') },
  ];

  return (
    <ul className="ml-auto flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className={`size-3 shrink-0 rounded ${item.className}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Naming the range, and saying what it will cost.
 *
 * The impact is fetched when the form opens rather than as the range is drawn:
 * one request per confirmed range instead of one per day hovered.
 */
function ClosureForm({
  organizationId,
  range,
  pools,
  onDone,
}: {
  organizationId: string;
  range: [string, string];
  pools: { id: string; name: string }[];
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, saving] = useActionState(createClosureAction, INITIAL);
  const [impact, setImpact] = useState<{ sessions: number; marked: number } | null>(null);
  const [asked, setAsked] = useState(false);

  if (!asked) {
    setAsked(true);
    void impactAction(organizationId, range[0], range[1]).then(setImpact);
  }

  if (state.ok) {
    onDone();
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded border border-primary/40 bg-surface p-5"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="startsOn" value={range[0]} />
      <input type="hidden" name="endsOn" value={range[1]} />

      <h2 className="font-medium">
        {t('calendar.closeFrom', { from: range[0], to: range[1] })}
      </h2>

      {/*
        Criterion 10. A register already taken means somebody stood at the
        poolside and wrote it down; they are told before the closure is made, not
        after.
      */}
      {impact !== null && impact.marked > 0 && (
        <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t('calendar.impactMarked', { marked: impact.marked, sessions: impact.sessions })}
        </p>
      )}

      {impact !== null && impact.marked === 0 && impact.sessions > 0 && (
        <p className="text-sm text-foreground-muted">
          {t('calendar.impactSessions', { count: impact.sessions })}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <TextField
          name="reason"
          label={t('calendar.closureReason')}
          placeholder={t('calendar.closureReasonPlaceholder')}
          required
          maxLength={200}
          error={state.fields?.['reason'] === undefined ? undefined : t(state.fields['reason'])}
          className="min-w-56 flex-1"
        />

        {pools.length > 0 && (
          <label className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>{t('calendar.closureScope')}</span>
            <select
              name="poolId"
              defaultValue=""
              className={CONTROL_LINE}
            >
              <option value="">{t('calendar.wholeSite')}</option>
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="text-sm text-foreground-muted">{t('calendar.closureEffect')}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {saving ? t('common.working') : t('calendar.addClosure')}
        </button>
        <button type="button" onClick={onDone} className="rounded border border-border px-4 py-2">
          {t('common.cancel')}
        </button>
      </div>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">
          {t(state.errorKey, { existing: state.detail ?? '' })}
        </p>
      )}
    </form>
  );
}

/**
 * The closures this club decided on — not the feriados.
 *
 * Round 4: the national holidays were dropped from this list. They are the same
 * thirteen days every year, Poolse put them there rather than the operator, and
 * repeating them under the grid pushed the two or three closures somebody
 * actually has to manage off the bottom of the screen. What is left is the list
 * of things there is something to do about, each with its remove button.
 *
 * The feriados keep their own colour on the grid and their name in each day's
 * accessible label, so nothing has vanished — but their name is no longer
 * visible text anywhere on the page, which is a real trade against this repo's
 * rule that a tooltip must never be the only place information appears. It is
 * the operator's call and it is recorded here so the next reader knows it was
 * a decision. If it turns out to bite, the fix is a compact "Feriados" summary
 * beside the legend rather than putting all thirteen rows back.
 */
function ClosureList({
  closures,
  canManage,
  organizationId,
}: {
  closures: Closure[];
  canManage: boolean;
  organizationId: string;
}): React.ReactElement {
  const t = useTranslations();

  const managed = closures.filter((closure) => closure.source === 'manual');

  if (managed.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('calendar.noClosures')}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
      {managed.map((closure) => (
        <li
          key={closure.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
        >
          {/*
            One swatch and no badge: every row here is a manual closure now, so
            the branch that distinguished them from feriados would be dead code
            pretending the list still holds both.
          */}
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="size-3 shrink-0 rounded bg-warning/25" />
            <span className="font-medium">{closure.reason}</span>
          </span>

          <span className="flex items-center gap-3 text-sm text-foreground-muted">
            {closure.startsOn === closure.endsOn
              ? closure.startsOn
              : `${closure.startsOn} — ${closure.endsOn}`}
            {canManage && (
              <RemoveClosure
                organizationId={organizationId}
                closureId={closure.id}
                reason={closure.reason}
              />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RemoveClosure({
  organizationId,
  closureId,
  reason,
}: {
  organizationId: string;
  closureId: string;
  reason: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(removeClosureAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="closureId" value={closureId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('calendar.removeClosure', { reason })}
        className="rounded p-1 text-foreground-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </form>
  );
}

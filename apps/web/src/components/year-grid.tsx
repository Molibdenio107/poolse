'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * A year as twelve months of days — backlog round 3, stories 6 and 8.
 *
 * One component, two modes, exactly as the round-2 note about the timetable grid
 * warned: build it once or build it twice and debug it twice. "As minhas férias"
 * selects days; "Mapa da equipa" shows whose they are. What differs is what a
 * day *looks* like and whether it can be picked, so both are props rather than
 * two components.
 *
 * **Keyboard is not an afterthought here.** Drag-select is offered, but every day
 * is a real `<button>` in the tab order with an accessible name, so the whole
 * grid is usable with a keyboard alone. A mouse-only calendar is a calendar half
 * the staff of a municipal pool cannot use.
 */

export interface DayState {
  /** Painted background, if any. Otherwise the day is plain. */
  className?: string;
  /** Appended to the accessible name — "aprovado", "Rita Lopes e Tiago Freitas". */
  description?: string;
  /** Sundays and public holidays. Rendered dim and not pickable. */
  disabled?: boolean;
  /**
   * Reachable by keyboard even though it cannot be picked — POOLSE-31.
   *
   * A feriado is dim because it is not selectable, but its name is information
   * an operator wants, and a day that only a mouse can interrogate is a day half
   * the staff cannot read. Focusing it announces its full label.
   */
  focusable?: boolean;
  /** Native tooltip, for the mouse. Never the only place the name appears. */
  title?: string;
  /** A small mark under the number, for a second cue that is not colour. */
  marker?: string;
}

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Days in a month, without constructing a Date per candidate. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

/** ISO weekday, Monday 1 … Sunday 7. */
function isoWeekdayOf(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function YearGrid({
  year,
  monthNames,
  weekdayInitials,
  stateFor,
  onPick,
  onHover,
  labelFor,
  pastBefore,
  className,
}: {
  year: number;
  /** Twelve, translated, January first. */
  monthNames: string[];
  /** Seven, translated, Monday first — one or two letters. */
  weekdayInitials: string[];
  stateFor: (day: string) => DayState;
  /** Absent in read-only mode, which is what the team map uses. */
  onPick?: ((day: string) => void) | undefined;
  /**
   * The day under the cursor, or null on leaving the grid — POOLSE-31.
   *
   * What makes a range preview possible: click the first day, and every day up
   * to the one being hovered paints as it would if you clicked. Optional, so the
   * two vacation modes carry none of it.
   */
  onHover?: ((day: string | null) => void) | undefined;
  /** Full accessible name for a day — "3 de Agosto de 2026". */
  labelFor: (day: string) => string;
  /**
   * Everything before this ISO day is over — round 4.
   *
   * Closures, férias and classes are all things you plan, and none of them can
   * be planned backwards. Leaving last February pickable meant the grid offered
   * 365 days of which only the tail was a real choice, and an operator dragging
   * a range upward could book a holiday into a week that has already happened.
   * Dimmed and unpickable, but still focusable, for the same reason a feriado is:
   * what happened in March is information, it is just not a decision any more.
   *
   * Optional. A grid with no notion of "now" — a historical report, say — leaves
   * it unset and behaves exactly as before.
   */
  pastBefore?: string | undefined;
  className?: string;
}): React.ReactElement {
  // Recomputed only when the year changes. Twelve months of cells is cheap, but
  // it is cheap 366 times and this component re-renders on every click.
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const total = daysIn(year, month);
        // Blanks before the 1st so every column is the same weekday all year.
        const lead = isoWeekdayOf(year, month, 1) - 1;
        return {
          month,
          lead,
          days: Array.from({ length: total }, (_, offset) => iso(year, month, offset + 1)),
        };
      }),
    [year],
  );

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>
      {months.map(({ month, lead, days }) => (
        <section key={month} className="rounded border border-border bg-surface p-3">
          <h3 className="mb-2 text-sm font-medium">{monthNames[month - 1]}</h3>

          {/*
            No `role="grid"`. A grid role requires rows, and these cells are laid
            out by CSS with no row elements between them — declaring one without
            the other is invalid ARIA, which announces worse than nothing at all.
            What carries the meaning instead is each day being a real button with
            its full date and status as its accessible name.
          */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAY_KEYS.map((weekday) => (
              <div
                key={weekday}
                // The initials are decoration over columns whose meaning is
                // already in each day's accessible name, so they are hidden
                // rather than read out seven times per month.
                aria-hidden
                className="pb-1 text-center text-[0.65rem] uppercase text-foreground-muted"
              >
                {weekdayInitials[weekday - 1]}
              </div>
            ))}

            {Array.from({ length: lead }, (_, index) => (
              <div key={`lead-${index}`} aria-hidden />
            ))}

            {days.map((day) => {
              const state = stateFor(day);
              const number = Number(day.slice(8));

              // ISO dates compare correctly as strings, which is the whole
              // reason this grid speaks in `YYYY-MM-DD` rather than Date.
              const past = pastBefore !== undefined && day < pastBefore;
              const inert = state.disabled === true || past;

              if (inert || onPick === undefined) {
                return (
                  <div
                    key={day}
                    // Still labelled, and given a role that can carry a label:
                    // in the team map this is how somebody listening to the page
                    // learns who is away, and it is the reason colour is never
                    // the only cue here.
                    role="img"
                    tabIndex={state.focusable === true || past ? 0 : undefined}
                    title={state.title}
                    onMouseEnter={onHover === undefined ? undefined : () => onHover(day)}
                    aria-label={`${labelFor(day)}${state.description ? `, ${state.description}` : ''}`}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center rounded text-xs',
                      inert ? 'text-foreground-muted/50' : 'text-foreground',
                      state.className,
                      // Last, so it wins over whatever a closure or a vacation
                      // painted: a day that is over reads as over first, and as
                      // whatever happened on it second.
                      past && 'bg-surface-muted/40 opacity-60',
                    )}
                  >
                    {number}
                    {state.marker !== undefined && (
                      <span aria-hidden className="text-[0.6rem] leading-none">
                        {state.marker}
                      </span>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPick(day)}
                  // Pointer-drag selection: entering a cell with the button held
                  // extends the range. `buttons === 1` is the primary button
                  // still down, which is what tells a drag from a hover.
                  onPointerEnter={(event) => {
                    if (event.buttons === 1) onPick(day);
                    onHover?.(day);
                  }}
                  // Focus previews too, so the range can be chosen without a
                  // mouse — the second click has a keyboard equivalent already
                  // (Enter on the day), and this is what makes it legible.
                  onFocus={() => onHover?.(day)}
                  title={state.title}
                  aria-label={`${labelFor(day)}${state.description ? `, ${state.description}` : ''}`}
                  aria-pressed={state.className !== undefined}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center rounded text-xs transition-colors',
                    'hover:bg-primary/15',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                    state.className,
                  )}
                >
                  {number}
                  {state.marker !== undefined && (
                    <span aria-hidden className="text-[0.6rem] leading-none">
                      {state.marker}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

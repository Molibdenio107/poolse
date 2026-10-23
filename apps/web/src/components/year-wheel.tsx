'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * A year, chosen on a wheel — POOLSE-111 (Rui: "like a slot machine, not
 * filling the page").
 *
 * A compact listbox, five rows tall, centred on the chosen year: scroll it and
 * the year that settles in the middle is the value; arrows move one, PageUp and
 * PageDown five, Home and End to the ends; **typing a year jumps to it** ("20",
 * then "15" is 2015). The value posts through a hidden field, so it sits in a
 * server-action form like any other control.
 *
 * **Without JavaScript it is a plain `<input type="number">`** with the same
 * name and bounds — the wheel replaces it only once the page is running.
 * An optional *Sem limite* row at the top stands for an open-ended band
 * (Seniores, born 2007 and earlier).
 *
 * Reusable wherever a year is picked; built for the FPN age groups' born
 * from / born up to.
 */

const ROW = 32;
const VISIBLE = 5;
const TYPE_PAUSE_MS = 1000;
/** How near a scroll must come to count as there — snapping rounds by a pixel or two. */
const ARRIVED = 2;
const FIELD_HINT = 'text-sm text-foreground-muted';

export function YearWheel({
  name,
  label,
  initial,
  min,
  max,
  emptyLabel,
  hint,
  error,
}: {
  name: string;
  label: string;
  /** The saved year; null for none. */
  initial: number | null;
  min: number;
  max: number;
  /** When given, a first row meaning "no year" — an open-ended band. */
  emptyLabel?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}): React.ReactElement {
  const id = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [value, setValue] = useState<number | null>(initial);
  // The saved year moves (a save, a reload): follow it.
  const seededFrom = useRef(initial);
  if (seededFrom.current !== initial) {
    seededFrom.current = initial;
    setValue(initial);
  }

  // Newest first, so *Sem limite* sits beside this year rather than a century ago.
  const years: number[] = [];
  for (let year = max; year >= min; year -= 1) years.push(year);
  const items: (number | null)[] = emptyLabel === undefined ? years : [null, ...years];
  const indexOf = (year: number | null): number => {
    const at = items.indexOf(year);
    if (at !== -1) return at;
    // A year outside the range (an old row) or none where none is not offered: the nearest end.
    return year === null ? 0 : year > max ? (emptyLabel === undefined ? 0 : 1) : items.length - 1;
  };
  const index = indexOf(value);

  const box = useRef<HTMLDivElement>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fromScroll = useRef(false);
  // Where a move the wheel made itself is heading: its own scroll events are not a choice.
  const heading = useRef<number | null>(null);
  const typed = useRef({ text: '', at: 0 });

  // The chosen row is the middle one; a change not made by scrolling scrolls to it.
  useEffect(() => {
    if (!mounted || box.current === null) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const target = index * ROW;
    if (Math.abs(box.current.scrollTop - target) <= ARRIVED) return;
    heading.current = target;
    // A step glides; a jump (typing a year) lands at once, rather than gliding
    // past eighty years the person did not choose.
    const far = Math.abs(box.current.scrollTop - target) > 3 * ROW;
    box.current.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' });
  }, [index, mounted]);

  const choose = (at: number): void => {
    const clamped = Math.max(0, Math.min(items.length - 1, at));
    setValue(items[clamped] ?? null);
  };

  const onScroll = (): void => {
    if (heading.current !== null && box.current !== null) {
      if (Math.abs(box.current.scrollTop - heading.current) <= ARRIVED) heading.current = null;
      return;
    }
    if (settling.current !== null) clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      if (box.current === null) return;
      const at = Math.round(box.current.scrollTop / ROW);
      if (at !== index) {
        fromScroll.current = true;
        choose(at);
      }
    }, 120);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (event.key in step) {
      event.preventDefault();
      choose(index + step[event.key]!);
    } else if (event.key === 'Home') {
      event.preventDefault();
      choose(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      choose(items.length - 1);
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      // Typing a year jumps to it: digits gather until a pause, and four make a year.
      const now = Date.now();
      const text = (now - typed.current.at > TYPE_PAUSE_MS ? '' : typed.current.text) + event.key;
      typed.current = { text: text.length > 4 ? event.key : text, at: now };
      if (typed.current.text.length === 4) {
        const year = Number(typed.current.text);
        if (year >= min && year <= max) setValue(year);
      }
    }
  };

  const optionId = (at: number): string => `${id}-year-${at}`;

  if (!mounted) {
    // The fallback, and the first paint: a number field with the same name.
    return (
      <div className={FIELD_COLUMN}>
        <label htmlFor={`${id}-number`} className={FIELD_LABEL}>
          {label}
        </label>
        <input
          id={`${id}-number`}
          type="number"
          name={name}
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(event) => setValue(event.target.value === '' ? null : Number(event.target.value))}
          className={cn(CONTROL_LINE, 'w-32')}
        />
        {hint !== undefined && <p className={FIELD_HINT}>{hint}</p>}
        {error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={FIELD_COLUMN}>
      <span id={`${id}-label`} className={FIELD_LABEL}>
        {label}
      </span>
      <input type="hidden" name={name} value={value ?? ''} />
      <div className="relative w-36">
        {/* The band the chosen year sits in — the slot machine's window. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-0 rounded border border-primary bg-primary/10"
          style={{ top: ((VISIBLE - 1) / 2) * ROW + 1, height: ROW }}
        />
        <div
          ref={box}
          role="listbox"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={optionId(index)}
          {...(hint === undefined ? {} : { 'aria-describedby': `${id}-hint` })}
          {...(error === undefined ? {} : { 'aria-invalid': true })}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          className={cn(
            'relative z-10 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded border bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            error === undefined ? 'border-border' : 'border-danger',
          )}
          // The 1px border each side is added, so the middle row is exactly the middle.
          style={{ height: VISIBLE * ROW + 2, paddingBlock: ((VISIBLE - 1) / 2) * ROW }}
        >
          {items.map((year, at) => (
            <div
              key={year ?? 'none'}
              id={optionId(at)}
              role="option"
              aria-selected={at === index}
              onClick={() => choose(at)}
              className={cn(
                'flex snap-center cursor-pointer items-center justify-center text-control tabular-nums',
                at === index ? 'font-semibold text-foreground' : 'text-foreground-muted',
              )}
              style={{ height: ROW }}
            >
              {year ?? emptyLabel}
            </div>
          ))}
        </div>
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className={FIELD_HINT}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

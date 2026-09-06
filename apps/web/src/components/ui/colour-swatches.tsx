'use client';

import { useState } from 'react';
import { Check, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';

/**
 * Eight colours and a clear — round 6.
 *
 * **Not `<input type="color">`, and that is the point of the component.** A free
 * picker lets somebody choose pale yellow, and the white text on the block goes
 * to 1.3:1 with nothing to warn them; it also picks one colour for two themes,
 * so a club on the light theme chooses something that is wrong on the dark one.
 * These eight are tokens whose ratios were measured in both — see the note in
 * `globals.css` — which is the same reason `booking_category.colour` is an enum.
 *
 * Controlled, and posting through a hidden input, so it behaves like every other
 * field here: React 19 resets a form when an action returns, and an uncontrolled
 * swatch row would forget the choice at the moment somebody is being asked to
 * correct something else on the form.
 *
 * **Colour is never the only cue.** The chosen swatch carries a tick as well as
 * a ring, so the state is readable without seeing the difference between two
 * hues; and everywhere this colour is used, the thing it colours is also named.
 */

export const CLASS_COLOURS = [
  'teal',
  'green',
  'lime',
  'amber',
  'orange',
  'rose',
  'magenta',
  'violet',
] as const;

export type ClassColourName = (typeof CLASS_COLOURS)[number];

/** The token each name paints with. Tailwind needs the whole class at build time. */
const SWATCH: Record<ClassColourName, string> = {
  teal: 'bg-level-1',
  green: 'bg-level-2',
  lime: 'bg-level-3',
  amber: 'bg-level-4',
  orange: 'bg-level-5',
  rose: 'bg-level-6',
  magenta: 'bg-level-7',
  violet: 'bg-level-8',
};

export function ColourSwatches({
  name,
  label,
  initial,
  hint,
  clearLabel,
  nameOf,
}: {
  name: string;
  label: string;
  initial: string | null;
  hint?: string;
  /** "No colour", translated by the caller — this component holds no strings. */
  clearLabel: string;
  /** Each colour's name in words, so the choice is not colour alone. */
  nameOf: (colour: ClassColourName) => string;
}): React.ReactElement {
  const [value, setValue] = useState<string>(initial ?? '');

  return (
    <div className={cn(FIELD_COLUMN, 'max-w-form')}>
      <span className={FIELD_LABEL}>{label}</span>

      <input type="hidden" name={name} value={value} />

      <div className="flex flex-wrap items-center gap-1.5">
        {CLASS_COLOURS.map((colour) => {
          const chosen = value === colour;
          return (
            <button
              key={colour}
              type="button"
              onClick={() => setValue(colour)}
              aria-pressed={chosen}
              title={nameOf(colour)}
              aria-label={nameOf(colour)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full transition-shadow duration-150',
                SWATCH[colour],
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                chosen && 'ring-2 ring-foreground ring-offset-2 ring-offset-surface',
              )}
            >
              {chosen && <Check className="size-4 text-white" aria-hidden="true" />}
            </button>
          );
        })}

        {/*
          Clearing is a choice of its own, not the absence of one: a turma with
          no colour takes its level's, which is a real and common answer.
        */}
        <button
          type="button"
          onClick={() => setValue('')}
          aria-pressed={value === ''}
          title={clearLabel}
          aria-label={clearLabel}
          className={cn(
            'flex size-7 items-center justify-center rounded-full border border-border-strong text-foreground-muted transition-shadow duration-150',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            value === '' && 'ring-2 ring-foreground ring-offset-2 ring-offset-surface',
          )}
        >
          <Ban className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {hint !== undefined && <p className="text-sm text-foreground-muted">{hint}</p>}
    </div>
  );
}

'use client';

import { Check, CircleDashed, Eye, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SkillState } from '@/lib/skills';
import { cn } from '@/lib/utils';

/**
 * The four skill states — POOLSE-20, criterion 1.
 *
 * **Each has an icon as well as a colour**, and the icons differ in shape rather
 * than only in fill: a dashed circle, a play triangle, an eye, a tick. That is
 * what makes the grid readable to a colour-blind instructor, and what makes it
 * readable at all on a phone in bright sun at the poolside — where hue is the
 * first thing to go.
 *
 * **Clear of the attendance palette** (POOLSE-13: soft red for faltou, soft
 * orange for falta justificada) **and of the role palette** (POOLSE-18). Both
 * appear on screens next to this one, and a green tick that meant "present" in
 * one grid and "adquirido" in another would be a genuine confusion rather than a
 * theoretical one.
 *
 * The progression reads as it feels: nothing yet, under way, being watched,
 * done. Colour intensity climbs with it, so a row of skills has a visible
 * gradient from left to right when a student is working through them in order.
 */

const TONE: Record<SkillState, { icon: typeof Check; className: string }> = {
  // Deliberately the quietest thing on the grid. Most cells are this, most of
  // the time, and they should recede rather than shout.
  not_started: { icon: CircleDashed, className: 'bg-surface-muted text-foreground-muted' },
  started: { icon: Play, className: 'bg-role-student/15 text-role-student' },
  tested: { icon: Eye, className: 'bg-role-instructor/15 text-role-instructor' },
  attained: { icon: Check, className: 'bg-success/20 text-success' },
};

export function SkillStateChip({
  state,
  className,
}: {
  state: SkillState;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const { icon: Icon, className: tone } = TONE[state];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-sm',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`skills.state.${state}`)}
    </span>
  );
}

/**
 * A grid cell: the icon alone, with the state in its accessible name.
 *
 * The word does not fit in a column one-twentieth of a phone wide, so the cell
 * carries the icon and the label goes to the accessible name — which is why the
 * legend above the grid is not optional. Nothing here is known only by colour:
 * the shape differs too.
 */
export function SkillStateCell({
  state,
  ready,
  overridden,
}: {
  state: SkillState;
  /** False when signing off would need an override — shown before the tap. */
  ready: boolean;
  overridden: boolean;
}): React.ReactElement {
  const { icon: Icon, className } = TONE[state];

  return (
    <span
      className={cn(
        'flex size-full items-center justify-center rounded',
        className,
        // A skill that cannot yet be signed off is ringed, so an instructor sees
        // which taps will ask them a question before they make them.
        !ready && state !== 'attained' && 'ring-1 ring-inset ring-warning/40',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {/*
        An overridden sign-off is marked. It is a legitimate decision, not a
        problem — but it was somebody's judgement rather than the thresholds', and
        that is worth being able to see on the grid.
      */}
      {overridden && <span aria-hidden className="ml-0.5 text-[0.6rem] leading-none">*</span>}
    </span>
  );
}

/** What the icons mean, shown wherever the grid is. */
export function SkillLegend(): React.ReactElement {
  const t = useTranslations();
  const states: SkillState[] = ['not_started', 'started', 'tested', 'attained'];

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {states.map((state) => (
        <li key={state}>
          <SkillStateChip state={state} />
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-sm text-foreground-muted">
        <span aria-hidden className="rounded px-1 ring-1 ring-inset ring-warning/40">
          &nbsp;
        </span>
        {t('skills.legendNotReady')}
      </li>
    </ul>
  );
}
